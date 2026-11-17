/* ============================================================================
   GhostLink — cloud account + global refresh
   ----------------------------------------------------------------------------
   Loaded by index.html as a module.

   Two jobs:

   1. ACCOUNT
      Google sign-in through the same Firebase project as TextNexus
      (nexus-web-development-official). Everything GhostLink already keeps in
      localStorage (settings, shortcuts, custom apps, proxy config, bookmarks,
      favourites, achievements...) is mirrored to

          users/<uid>/ghostlink/data/<key> = { v: <raw string>, t: <ms> }

      Local writes are picked up by a Storage.prototype hook, so any existing
      save path in the app syncs without touching every call site. On sign-in
      the timestamped records are merged (newest wins per key), remote-only
      values are applied and the page reloads once so the app boots with them.

   2. GLOBAL REFRESH
      Watches `system/refresh` in the Realtime Database — the same token the
      TextNexus system console writes. A tab adopts the current token when it
      loads, then reloads once whenever the token changes. Staff accounts can
      also publish a token from GhostLink settings.

   Realtime Database rules must allow: users/<uid>/ghostlink for that user,
   presence/ghostlink for signed-in users, and the existing system/refresh
   rules used by the TextNexus console. See README.md.
   ========================================================================== */

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import {
    getAuth,
    onAuthStateChanged,
    GoogleAuthProvider,
    signInWithPopup,
    signInWithRedirect,
    getRedirectResult,
    setPersistence,
    browserLocalPersistence,
    signOut as firebaseSignOut
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
    getDatabase,
    ref,
    onValue,
    onDisconnect,
    set,
    update,
    get,
    push,
    remove
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-database.js";

const FIREBASE_CONFIG = {
    apiKey: "AIzaSyAO_ffupJOIMPE9m4ARtaqSzC1vGDkIAco",
    authDomain: "nexus-web-development-official.firebaseapp.com",
    projectId: "nexus-web-development-official",
    databaseURL: "https://nexus-web-development-official-default-rtdb.firebaseio.com"
};

/* Shared with /system-console.html on textnexus.me. */
const REFRESH_PATH = "system/refresh";
const REFRESH_STORAGE_KEY = "gl_system_refresh_token";
const RELOAD_GUARD = "gl_cloud_reload";
const META_KEY = "gl_cloud_meta";

/* Staff accounts allowed to publish a global refresh from inside GhostLink.
   The database rules remain the real gate. */
const STAFF = [
    "brodywilliams0226@gmail.com",
    "bkeppel001@stpaul.k12.mn.us",
    "bmkeppel7@gmail.com"
];

/* Everything the app persists that belongs to the person, not the device.
   Counters, caches and one-off flags are deliberately excluded. */
const SYNC_KEY_LIST = [
    "ghostlink_apps",
    "ghostlink_shortcuts",
    "ghostlink_config",
    "ghostlink_nav_order",
    "ghostlink_words",
    "ghostlink_custom_presets",
    "gl_shortcuts",
    "gl_search_engine",
    "proxServer",
    "wispAutoswitch",
    "proxyMaxTabs",
    "customWisps",
    "proxyBookmarks",
    "afkCloakEnabled",
    "afkCloakTimeout",
    "gl_cloak_page",
    "gl_cloak_content",
    "gl_cloak_mouseleave",
    "gl_cloak_vischange",
    "gn-favs",
    "gl_achievements"
];
const SYNC_KEYS = new Set(SYNC_KEY_LIST);

/* ---------------------------------------------------------------- storage -- */

/* Capture the real Storage methods before patching, otherwise our own helpers
   would recurse through the hook. */
const ORIG = {
    getItem: Storage.prototype.getItem,
    setItem: Storage.prototype.setItem,
    removeItem: Storage.prototype.removeItem,
    clear: Storage.prototype.clear
};

let applyingRemote = false;
const lastWritten = new Map(); // key -> value we last saw locally
const pending = new Map();     // key -> upload timer

function localGet(key) {
    try { return ORIG.getItem.call(window.localStorage, key); } catch { return null; }
}
function localSet(key, value) {
    try { ORIG.setItem.call(window.localStorage, key, value); return true; } catch { return false; }
}
function localRemove(key) {
    try { ORIG.removeItem.call(window.localStorage, key); } catch { /* ignore */ }
}

function readMeta() {
    try { return JSON.parse(localGet(META_KEY) || "{}") || {}; } catch { return {}; }
}
function writeMeta(key, t) {
    const meta = readMeta();
    meta[key] = t;
    try { ORIG.setItem.call(window.localStorage, META_KEY, JSON.stringify(meta)); } catch { /* ignore */ }
}

/* --------------------------------------------------------------- app state -- */

const state = {
    ready: false,
    user: null,
    uid: null,
    status: "idle",        // idle | saving | synced | error
    error: "",
    notice: "",
    lastSync: 0,
    tabs: 0,
    pending: 0,
    firstSnapshot: false,
    wiping: false
};

const TAB_ID = (window.crypto && window.crypto.randomUUID)
    ? window.crypto.randomUUID()
    : "tab-" + Math.random().toString(36).slice(2, 10) + "-" + Date.now();

let app = null;
let auth = null;
let db = null;
let cloudUnsub = null;
let tabsUnsub = null;
let presenceRef = null;
let heartbeat = null;
let noticeTimer = null;

const $ = (id) => document.getElementById(id);
const dataPath = (uid) => "users/" + uid + "/ghostlink/data";

function emit(kind = "update") {
    renderAccount();
    try {
        window.dispatchEvent(new CustomEvent("ghostlink-cloud", { detail: { kind, state: publicState() } }));
    } catch { /* ignore */ }
}

function publicState() {
    return {
        ready: state.ready,
        signedIn: !!state.user,
        email: state.user?.email || "",
        name: state.user?.displayName || "",
        photo: state.user?.photoURL || "",
        status: state.status,
        error: state.error,
        notice: state.notice,
        tabs: state.tabs,
        lastSync: state.lastSync,
        staff: isStaff(state.user)
    };
}

function isStaff(user) {
    const email = (user?.email || "").toLowerCase();
    return !!email && STAFF.includes(email);
}

function setNotice(message) {
    state.notice = message || "";
    if (noticeTimer) clearTimeout(noticeTimer);
    if (message) noticeTimer = setTimeout(() => { state.notice = ""; emit(); }, 6000);
    emit();
}

/* ------------------------------------------------------------- local saves -- */

function noteLocalWrite(key, value) {
    if (!SYNC_KEYS.has(key) || applyingRemote || state.wiping) return;
    if (lastWritten.get(key) === value) return;
    lastWritten.set(key, value);
    const t = Date.now();
    writeMeta(key, t);
    if (state.uid) scheduleUpload(key, value, t);
}

function installStorageHook() {
    if (window.__glStorageHooked) return;
    window.__glStorageHooked = true;

    Storage.prototype.setItem = function (key, value) {
        ORIG.setItem.call(this, key, value);
        if (this === window.localStorage) noteLocalWrite(key, String(value));
    };
    Storage.prototype.removeItem = function (key) {
        ORIG.removeItem.call(this, key);
        if (this === window.localStorage) noteLocalWrite(key, null);
    };
    Storage.prototype.clear = function () {
        ORIG.clear.call(this);
        if (this !== window.localStorage || !state.uid || state.wiping) return;
        const t = Date.now();
        SYNC_KEY_LIST.forEach((key) => {
            lastWritten.delete(key);
            writeMeta(key, t);
            scheduleUpload(key, null, t);
        });
    };
}

/* Writes from a same-origin iframe (for example the new-tab page) do not run
   through this window's hook, so mirror them from the storage event. */
window.addEventListener("storage", (event) => {
    if (!event.key || !SYNC_KEYS.has(event.key) || !state.uid || state.wiping) return;
    const current = localGet(event.key);
    if (current === event.newValue) return;
    lastWritten.set(event.key, event.newValue);
    const t = Date.now();
    writeMeta(event.key, t);
    scheduleUpload(event.key, event.newValue, t);
});

/* ------------------------------------------------------------------ upload -- */

function scheduleUpload(key, value, t) {
    if (!state.uid) return;
    const existing = pending.get(key);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
        pending.delete(key);
        state.pending = pending.size;
        writeKey(key, value, t);
    }, 650);
    pending.set(key, timer);
    state.pending = pending.size;
    state.status = "saving";
    emit("saving");
}

async function writeKey(key, value, t) {
    if (!state.uid || !db) return;
    try {
        await set(ref(db, dataPath(state.uid) + "/" + key), { v: value, t });
        state.lastSync = Date.now();
        state.error = "";
        if (pending.size === 0) state.status = "synced";
        emit("synced");
    } catch (error) {
        state.status = "error";
        state.error = "Could not save to cloud (" + (error?.code || error?.message || "unknown") + ").";
        emit("error");
    }
}

function applyValue(key, value, t) {
    applyingRemote = true;
    try {
        if (value == null) localRemove(key);
        else localSet(key, value);
        writeMeta(key, t);
        lastWritten.set(key, value);
    } finally {
        applyingRemote = false;
    }
}

/* ---------------------------------------------------------------- reconcile -- */

function reconcile(remote, { uploadLocal = false } = {}) {
    let changed = 0;
    const uploads = [];
    const meta = readMeta();

    SYNC_KEY_LIST.forEach((key) => {
        const record = remote ? remote[key] : null;
        const localValue = localGet(key);
        const localT = Number(meta[key]) || 0;

        if (record && typeof record === "object") {
            const remoteT = Number(record.t) || 0;
            const remoteValue = record.v == null ? null : String(record.v);
            if (remoteT > localT) {
                if (remoteValue !== localValue) {
                    applyValue(key, remoteValue, remoteT);
                    changed++;
                } else {
                    writeMeta(key, remoteT);
                    lastWritten.set(key, remoteValue);
                }
            } else if (uploadLocal && localValue != null && localT > remoteT) {
                uploads.push([key, localValue, localT]);
            }
        } else if (uploadLocal && localValue != null) {
            uploads.push([key, localValue, localT || Date.now()]);
        }
    });

    uploads.forEach(([key, value, t]) => {
        writeMeta(key, t);
        scheduleUpload(key, value, t);
    });

    if (changed) {
        state.lastSync = Date.now();
        reloadForCloud();
    }
    return changed;
}

/* Guard against a reload loop if per-key timestamps cannot be persisted
   (for example when localStorage is full). Two reloads in 30s is enough to
   restore an account; after that the merge stops reloading on its own. */
function canAutoReload() {
    try {
        const log = JSON.parse(sessionStorage.getItem("gl_cloud_reload_log") || '{"at":0,"n":0}');
        const now = Date.now();
        if (now - (Number(log.at) || 0) < 30000) log.n = (Number(log.n) || 0) + 1;
        else { log.at = now; log.n = 1; }
        sessionStorage.setItem("gl_cloud_reload_log", JSON.stringify(log));
        return log.n <= 2;
    } catch {
        return true;
    }
}

function reloadForCloud() {
    try {
        if (sessionStorage.getItem(RELOAD_GUARD) === "1") return;
        sessionStorage.setItem(RELOAD_GUARD, "1");
    } catch { /* private mode */ }
    if (!canAutoReload()) {
        state.error = "Account data was restored — reload the page to finish.";
        emit("error");
        return;
    }
    setNotice("Restoring your account data…");
    setTimeout(() => window.location.reload(), 450);
}

/* ------------------------------------------------------------------ profile -- */

function writeProfile(user) {
    if (!db || !user) return;
    update(ref(db, "users/" + user.uid + "/ghostlink/profile"), {
        email: user.email || "",
        name: user.displayName || "",
        photo: user.photoURL || "",
        lastSeen: Date.now(),
        source: location.hostname || "local"
    }).catch(() => { /* rules may only cover the data node */ });
}

/* ---------------------------------------------------------------- presence -- */

function startPresence(user) {
    stopPresence();
    if (!db || !user) return;
    presenceRef = ref(db, "presence/ghostlink/" + TAB_ID);
    const payload = {
        uid: user.uid,
        email: user.email || "",
        name: user.displayName || "",
        page: (location.pathname.split("/").pop() || "index.html"),
        startedAt: Date.now(),
        lastSeen: Date.now(),
        agent: (navigator.userAgent || "").slice(0, 140)
    };
    onDisconnect(presenceRef).remove().catch(() => {});
    set(presenceRef, payload).catch(() => {});
    heartbeat = setInterval(() => {
        if (!presenceRef) return;
        update(presenceRef, { lastSeen: Date.now() }).catch(() => {});
    }, 20000);
}

function stopPresence() {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
    if (presenceRef) {
        const dying = presenceRef;
        presenceRef = null;
        remove(dying).catch(() => {});
    }
}

function watchTabs() {
    if (tabsUnsub || !db) return;
    tabsUnsub = onValue(ref(db, "presence/ghostlink"), (snapshot) => {
        const now = Date.now();
        const tabs = Object.values(snapshot.val() || {}).filter((tab) => {
            return typeof tab === "object" && (now - (Number(tab.lastSeen) || 0)) < 90000;
        });
        state.tabs = tabs.length;
        emit("tabs");
    }, () => { state.tabs = 0; });
}

function unwatchTabs() {
    if (tabsUnsub) { try { tabsUnsub(); } catch { /* ignore */ } }
    tabsUnsub = null;
    state.tabs = 0;
}

/* ------------------------------------------------------------------- cloud -- */

function attachCloud(uid) {
    detachCloud();
    state.firstSnapshot = false;
    cloudUnsub = onValue(ref(db, dataPath(uid)), (snapshot) => {
        const remote = snapshot.val() || {};
        state.error = "";
        if (!state.firstSnapshot) {
            state.firstSnapshot = true;
            reconcile(remote, { uploadLocal: true });
            state.lastSync = Date.now();
            state.status = pending.size ? "saving" : "synced";
            emit("synced");
        } else {
            reconcile(remote, { uploadLocal: false });
        }
    }, (error) => {
        const code = error?.code || "";
        state.status = "error";
        state.error = code === "PERMISSION_DENIED"
            ? "Cloud database denied access — check the Realtime Database rules."
            : "Cloud sync unavailable (" + (code || error?.message || "network") + ").";
        emit("error");
    });
}

function detachCloud() {
    if (cloudUnsub) { try { cloudUnsub(); } catch { /* ignore */ } }
    cloudUnsub = null;
}

async function pull(manual = false) {
    if (!state.uid || !db) throw new Error("Sign in with Google first.");
    const snapshot = await get(ref(db, dataPath(state.uid)));
    const changed = reconcile(snapshot.val() || {}, { uploadLocal: true });
    if (manual && !changed) setNotice("Already up to date.");
}

async function pushAll() {
    if (!state.uid || !db) throw new Error("Sign in with Google first.");
    const now = Date.now();
    const writes = [];
    SYNC_KEY_LIST.forEach((key) => {
        const value = localGet(key);
        if (value == null) return;
        writeMeta(key, now);
        lastWritten.set(key, value);
        writes.push(set(ref(db, dataPath(state.uid) + "/" + key), { v: value, t: now }));
    });
    if (!writes.length) { setNotice("Nothing to back up yet."); return; }
    await Promise.all(writes);
    state.lastSync = Date.now();
    state.status = "synced";
    setNotice("Backed up “" + writes.length + "” settings to your account.");
}

async function wipeCloud() {
    if (!state.uid || !db) return;
    state.wiping = true;
    try {
        await remove(ref(db, dataPath(state.uid)));
    } finally {
        setTimeout(() => { state.wiping = false; }, 1500);
    }
}

/* -------------------------------------------------------------------- auth -- */

async function signIn() {
    if (!auth) throw new Error("Firebase is unavailable on this page — check your connection and reload.");
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    try {
        await signInWithPopup(auth, provider);
    } catch (error) {
        const code = error?.code || "";
        const redirectFallback = [
            "auth/popup-blocked",
            "auth/cancelled-popup-request",
            "auth/web-storage-unsupported",
            "auth/operation-not-supported-in-this-environment"
        ];
        if (redirectFallback.includes(code)) {
            await signInWithRedirect(auth, provider);
            return;
        }
        throw error;
    }
}

async function signOut() {
    stopPresence();
    detachCloud();
    unwatchTabs();
    state.firstSnapshot = false;
    state.status = "idle";
    state.lastSync = 0;
    if (auth) await firebaseSignOut(auth);
}

/* ----------------------------------------------------------------- refresh -- */

let lastSeenToken = readStoredToken();
let initialEvent = true;

function readStoredToken() {
    const value = Number(localGet(REFRESH_STORAGE_KEY));
    return Number.isFinite(value) && value > 0 ? value : null;
}
function rememberToken(token) {
    lastSeenToken = token;
    localSet(REFRESH_STORAGE_KEY, String(token));
}

function watchRefresh() {
    if (!db) return;
    onValue(ref(db, REFRESH_PATH), (snapshot) => {
        const token = Number(snapshot.val()) || 0;
        if (!token) { initialEvent = false; return; }
        if (initialEvent) {
            initialEvent = false;
            rememberToken(token);
            return;
        }
        if (token !== lastSeenToken) {
            rememberToken(token);
            window.location.reload();
        }
    }, (error) => {
        console.warn("GhostLink global refresh unavailable:", error?.code || error?.message);
    });
}

async function triggerRefresh() {
    if (!state.user) throw new Error("Sign in with Google first.");
    if (!isStaff(state.user)) throw new Error("Only staff accounts can refresh every open tab.");
    if (!db) throw new Error("Firebase is unavailable on this page.");
    const token = Date.now();
    rememberToken(token);
    await set(ref(db, REFRESH_PATH), token);
    push(ref(db, "nexus/audit_logs"), {
        action: "GLOBAL_REFRESH",
        source: "ghostlink",
        adminEmail: state.user.email || "",
        timestamp: token,
        details: "Refresh token " + token
    }).catch(() => { /* audit log is best effort */ });
    return token;
}

/* ---------------------------------------------------------------------- UI -- */

function statusText() {
    if (state.notice) return state.notice;
    if (!state.ready) return "Connecting to Firebase…";
    if (!state.user) return "Not signed in";
    if (state.error) return state.error;
    if (state.status === "saving") return "Saving changes…";
    if (state.lastSync) return "Saved · " + new Date(state.lastSync).toLocaleTimeString();
    return "Cloud sync ready";
}

function renderAccount() {
    const user = state.user;
    const out = $("gl-account-out");
    const inside = $("gl-account-in");
    if (out) out.style.display = user ? "none" : "";
    if (inside) inside.style.display = user ? "" : "none";

    if (user) {
        const avatar = $("gl-account-avatar");
        if (avatar) {
            if (user.photoURL) { avatar.src = user.photoURL; avatar.style.display = ""; }
            else avatar.style.display = "none";
        }
        const name = $("gl-account-name");
        if (name) name.textContent = user.displayName || "Signed in";
        const email = $("gl-account-email");
        if (email) email.textContent = user.email || "";
    }

    const status = $("gl-account-status");
    if (status) status.textContent = statusText();
    const dot = $("gl-account-dot");
    if (dot) dot.style.background = state.error ? "#ff4444" : (state.status === "saving" ? "#fbbf24" : "var(--accent)");
    const tabs = $("gl-account-tabs");
    if (tabs) tabs.textContent = state.tabs > 0 ? state.tabs + " tab" + (state.tabs === 1 ? "" : "s") + " open" : "";
    const panel = $("gl-refresh-panel");
    if (panel) panel.style.display = isStaff(user) ? "" : "none";

    const sidebar = $("gl-sidebar-account");
    if (sidebar) {
        sidebar.title = user ? (user.email || "Account") : "Sign in with Google";
        const glyph = $("gl-sidebar-glyph");
        const photo = $("gl-sidebar-avatar");
        if (user && user.photoURL) {
            if (photo) { photo.src = user.photoURL; photo.style.display = ""; }
            if (glyph) glyph.style.display = "none";
        } else {
            if (photo) photo.style.display = "none";
            if (glyph) {
                glyph.style.display = "";
                const seed = user ? (user.displayName || user.email || "G") : "G";
                glyph.textContent = seed.trim().charAt(0).toUpperCase() || "G";
            }
        }
        const label = $("gl-sidebar-label");
        if (label) label.textContent = user ? (user.displayName || user.email || "Account") : "Sign in with Google";
        const sdot = $("gl-sidebar-dot");
        if (sdot) sdot.style.display = user ? "" : "none";
    }
}

function flash(message) {
    const el = $("gl-refresh-msg");
    if (el) el.textContent = message || "";
}

function friendlyError(error) {
    const code = error?.code || "";
    if (code === "auth/popup-closed-by-user") return "Sign-in cancelled.";
    if (code === "auth/unauthorized-domain") return "This domain is not authorised in Firebase Authentication.";
    if (code === "auth/operation-not-allowed") return "Google sign-in is disabled in the Firebase project.";
    if (code === "auth/network-request-failed") return "Network error — check your connection.";
    return error?.message || String(error);
}

async function withUi(work) {
    try {
        await work();
    } catch (error) {
        console.warn("GhostLink cloud:", error);
        setNotice(friendlyError(error));
        flash(friendlyError(error));
    }
}

function bindUi() {
    const on = (id, handler) => {
        const el = $(id);
        if (el) el.addEventListener("click", handler);
    };

    on("gl-google-signin", () => withUi(() => signIn()));
    on("gl-signout", () => withUi(() => signOut()));
    on("gl-sync-now", () => withUi(() => pull(true)));
    on("gl-backup-now", () => withUi(() => pushAll()));
    on("gl-system-refresh", () => withUi(async () => {
        flash("Sending…");
        const token = await triggerRefresh();
        flash("Sent at " + new Date(token).toLocaleTimeString() + " — every other open tab will reload.");
    }));
    on("gl-sidebar-account", () => {
        if (!state.user) { withUi(() => signIn()); return; }
        if (typeof window.nav === "function") window.nav("settings");
        $("gl-account-card")?.scrollIntoView({ behavior: "smooth", block: "center" });
    });

    renderAccount();
}

/* ---------------------------------------------------------------- bootstrap -- */

installStorageHook();

try {
    app = getApps().find((existing) => existing.name === "ghostlink")
        || initializeApp(FIREBASE_CONFIG, "ghostlink");
    auth = getAuth(app);
    db = getDatabase(app);

    setPersistence(auth, browserLocalPersistence).catch(() => {});
    getRedirectResult(auth).catch(() => {});

    watchRefresh();

    onAuthStateChanged(auth, (user) => {
        state.ready = true;
        state.user = user || null;
        state.uid = user?.uid || null;

        if (user) {
            state.error = "";
            writeProfile(user);
            startPresence(user);
            watchTabs();
            attachCloud(user.uid);
        } else {
            detachCloud();
            stopPresence();
            unwatchTabs();
            state.firstSnapshot = false;
        }
        emit("auth");
    }, (error) => {
        state.ready = true;
        state.error = "Auth unavailable (" + (error?.code || error?.message || "unknown") + ").";
        emit("error");
    });
} catch (error) {
    state.ready = true;
    state.error = "Firebase could not start on this page.";
    console.warn("GhostLink cloud could not start:", error);
}

setTimeout(() => {
    try { sessionStorage.removeItem(RELOAD_GUARD); } catch { /* ignore */ }
}, 6000);

window.GhostLinkCloud = {
    getState: publicState,
    signIn: () => withUi(() => signIn()),
    signOut: () => withUi(() => signOut()),
    pull: () => withUi(() => pull(true)),
    pushAll: () => withUi(() => pushAll()),
    wipeCloud: () => wipeCloud(),
    triggerRefresh: () => triggerRefresh(),
    isStaff: () => isStaff(state.user),
    refreshToken: () => lastSeenToken,
    refresh: renderAccount
};

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindUi, { once: true });
} else {
    bindUi();
}

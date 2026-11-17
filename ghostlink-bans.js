/* ============================================================================
   GhostLink — bans, suspension notice and staff moderation
   ----------------------------------------------------------------------------
   Imported by system.js, so index.html needs no changes.

   ENFORCEMENT
   Reads the shared TextNexus ban list (`nexus/bans`) and the account's
   `isBanned` flag, then covers the app with a suspension notice when the
   signed-in Google account matches an active email, device or fingerprint ban.

   STAFF TOOLS
   Adds a Support tab to the sidebar. Staff can suspend a TextNexus account by
   email with a reason and revoke it; this writes the same `nexus/bans` record
   the TextNexus system console uses, flags the account, and appends a
   BAN_ADD / BAN_REVOKE entry to `nexus/audit_logs`. Staff and owner accounts are
   protected, exactly like the disabled Ban buttons in TextNexus admin.html.

   Realtime Database rules must allow: `nexus/bans` read for signed-in accounts
   and write for staff, `nexus/users/<uid>` self read, and `nexus/audit_logs`
   writes whose `adminEmail` is the writer's own address.
   ========================================================================== */

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
    getDatabase,
    ref,
    get,
    set,
    update,
    push
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-database.js";

const FIREBASE_CONFIG = {
    apiKey: "AIzaSyAO_ffupJOIMPE9m4ARtaqSzC1vGDkIAco",
    authDomain: "nexus-web-development-official.firebaseapp.com",
    projectId: "nexus-web-development-official",
    databaseURL: "https://nexus-web-development-official-default-rtdb.firebaseio.com"
};

// Keep in step with system.js, global-refresh-client.js and the TextNexus
// guards; the Realtime Database rules accept ban writes only from staff.
const STAFF_EMAILS = [
    "brodywilliams0226@gmail.com",
    "bkeppel001@stpaul.k12.mn.us",
    "bmkeppel7@gmail.com"
];

// Matches OWNER_EMAILS in TextNexus admin.html.
const OWNER_EMAILS = ["brodywilliams0226@gmail.com", "imcrabfr@gmail.com"];
const PROTECTED_EMAILS = Array.from(new Set(STAFF_EMAILS.concat(OWNER_EMAILS)));
const PROTECTED_ROLES = ["owner", "admin"];

const DEVICE_KEY = "nexus-device-id";
const NOTICE_ID = "ghostlink-ban-notice";
const SUPPORT_PAGE_ID = "gl-support-page";
const SUPPORT_NAV_ID = "nav-support";

const normal = (value) => String(value == null ? "" : value).trim().toLowerCase();

// The same named app global-refresh-client.js and system.js use, so this sees
// the one Google session the sidebar shows.
const app = getApps().find((existing) => existing.name === "ghostlink")
    || initializeApp(FIREBASE_CONFIG, "ghostlink");
const auth = getAuth(app);
const db = getDatabase(app);

const state = { ready: false, user: null, banned: false, reason: "", staff: false };
let listLoading = false;

function isStaff() {
    return !!state.user && STAFF_EMAILS.includes(normal(state.user.email));
}

/* ---------------- device identity, same keys as the TextNexus guard ------- */

function getDeviceId() {
    try {
        let id = localStorage.getItem(DEVICE_KEY);
        if (!id) {
            id = "dev_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
            localStorage.setItem(DEVICE_KEY, id);
        }
        return id;
    } catch (error) {
        return "";
    }
}

function getFingerprint() {
    let source = "";
    try {
        source = [
            navigator.userAgent,
            navigator.platform,
            navigator.language,
            `${screen.width}x${screen.height}`,
            `${screen.colorDepth}`,
            Intl.DateTimeFormat().resolvedOptions().timeZone
        ].join("|");
    } catch (error) {
        return "";
    }
    let hash = 2166136261;
    for (let i = 0; i < source.length; i += 1) {
        hash ^= source.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return "fp_" + (hash >>> 0).toString(36);
}

function isActiveBan(ban) {
    return !!ban && ban.active !== false && ban.lifted !== true;
}

function banMatches(ban, account) {
    if (!isActiveBan(ban)) return false;
    const type = String(ban.type || "").toLowerCase();
    const value = normal(ban.value);
    if (!value) return false;
    if (type === "email") return value === account.email;
    if (type === "device") return value === account.deviceId || value === account.fingerprint;
    return false;
}

/* ---------------- suspension notice ---------------- */

function hideNotice() {
    const notice = document.getElementById(NOTICE_ID);
    if (notice) notice.remove();
}

function showNotice() {
    let notice = document.getElementById(NOTICE_ID);
    if (!notice) {
        notice = document.createElement("div");
        notice.id = NOTICE_ID;
        notice.setAttribute("role", "alertdialog");
        notice.setAttribute("aria-modal", "true");
        notice.style.cssText = "position:fixed;inset:0;z-index:2147483600;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(3,6,10,0.97);color:#eef4ff;font-family:Inter,system-ui,-apple-system,'Segoe UI',sans-serif;text-align:center;";
        notice.innerHTML = '<div style="max-width:440px;width:100%;padding:30px 26px;border:1px solid rgba(226,86,74,0.45);border-radius:16px;background:#0a0f16;">'
            + '<div style="display:inline-block;font-size:9px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;padding:4px 10px;border-radius:999px;border:1px solid rgba(226,86,74,0.45);color:#e2564a;background:rgba(226,86,74,0.12);margin-bottom:16px;">Account suspended</div>'
            + '<h1 style="margin:0 0 10px;font-size:21px;line-height:1.3;font-weight:600;">This account cannot use GhostLink</h1>'
            + '<p data-ban-reason style="margin:0 0 16px;font-size:13px;line-height:1.65;color:#9fb3cf;"></p>'
            + '<p style="margin:0 0 18px;font-size:11.5px;line-height:1.6;color:#64748b;">If you think this is a mistake, contact TextNexus support and include the reason above.</p>'
            + '<a href="https://textnexus.me/support.html" target="_blank" rel="noopener" style="display:inline-block;margin-bottom:16px;font-size:12px;color:#6ecbff;">Open support</a>'
            + '<div><button type="button" data-ban-signout style="cursor:pointer;padding:10px 18px;border-radius:8px;border:1px solid rgba(226,86,74,0.45);background:transparent;color:#e2564a;font-size:12px;">SIGN OUT</button></div>'
            + '</div>';
        document.body.appendChild(notice);
        const out = notice.querySelector("[data-ban-signout]");
        if (out) {
            out.addEventListener("click", () => {
                try { window.GhostLinkCloud?.signOut?.(); } catch (error) { /* ignore */ }
            });
        }
    }
    const reason = notice.querySelector("[data-ban-reason]");
    if (reason) reason.textContent = state.reason || "No reason was recorded.";
}

async function checkAccount(user) {
    if (!user) return { banned: false, reason: "" };

    const account = {
        email: normal(user.email),
        deviceId: normal(getDeviceId()),
        fingerprint: normal(getFingerprint())
    };

    try {
        const bans = (await get(ref(db, "nexus/bans"))).val() || {};
        const hit = Object.keys(bans).find((id) => banMatches(bans[id], account));
        if (hit) return { banned: true, reason: String(bans[hit].reason || "") };
    } catch (error) {
        // A failed read must not lock a signed-in account out of the app.
        return { banned: false, reason: "" };
    }

    try {
        const flagged = (await get(ref(db, `nexus/users/${user.uid}/isBanned`))).val();
        if (flagged === true) {
            return { banned: true, reason: "This account was suspended by TextNexus staff." };
        }
    } catch (error) { /* no flag recorded for this account */ }

    return { banned: false, reason: "" };
}

function applyBan(result) {
    state.banned = !!result.banned;
    state.reason = result.reason || "";
    if (state.banned) showNotice();
    else hideNotice();
    refreshSupport();
}

/* ---------------- moderation ---------------- */

function requireStaff() {
    if (!state.user) throw new Error("Sign in with a staff account first.");
    if (!state.ready) throw new Error("Your account is still loading.");
    if (!isStaff()) throw new Error("Only TextNexus staff can manage bans.");
    if (state.banned) throw new Error("A suspended account cannot manage bans.");
}

async function logAudit(action, details) {
    if (!state.user) return;
    try {
        await push(ref(db, "nexus/audit_logs"), {
            action: String(action).slice(0, 100),
            adminEmail: String(state.user.email || ""),
            timestamp: Date.now(),
            details: String(details || "").slice(0, 200)
        });
    } catch (error) { /* an audit failure must never undo the ban itself */ }
}

// Accounts can sit under more than one TextNexus user tree, so search each one
// the way admin.html and system-console.html do.
async function findAccountByEmail(email) {
    const wanted = normal(email);
    if (!wanted) return null;
    for (const path of ["nexus/users", "textnexus/users", "users"]) {
        try {
            const users = (await get(ref(db, path))).val() || {};
            for (const uid of Object.keys(users)) {
                const record = users[uid];
                if (record && normal(record.email) === wanted) return { uid, record };
            }
        } catch (error) { /* not readable for this account; try the next tree */ }
    }
    return null;
}

async function setAccountBanFlag(uid, banned) {
    if (!uid) return;
    for (const path of [`nexus/users/${uid}`, `textnexus/users/${uid}`, `users/${uid}`]) {
        try {
            await update(ref(db, path), { isBanned: banned });
        } catch (error) { /* the ban record itself is the authority */ }
    }
}

async function listEmailBans() {
    requireStaff();
    const bans = (await get(ref(db, "nexus/bans"))).val() || {};
    return Object.keys(bans)
        .filter((id) => isActiveBan(bans[id]) && String(bans[id].type || "").toLowerCase() === "email")
        .map((id) => ({
            id,
            email: String(bans[id].value || ""),
            reason: String(bans[id].reason || ""),
            at: Number(bans[id].at) || 0
        }))
        .sort((a, b) => b.at - a.at);
}

async function banEmail(email, reason) {
    requireStaff();
    const value = normal(email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error("Enter a valid email address.");

    if (value === normal(state.user.email)) throw new Error("You can't ban your own account.");
    if (PROTECTED_EMAILS.includes(value)) {
        throw new Error("That account belongs to staff or an owner and can't be suspended.");
    }

    const cleanReason = String(reason == null ? "" : reason).trim().slice(0, 200) || "No reason recorded.";

    const match = await findAccountByEmail(value);
    if (match && PROTECTED_ROLES.includes(normal(match.record.role))) {
        throw new Error("That account belongs to staff or an owner and can't be suspended.");
    }

    const bans = (await get(ref(db, "nexus/bans"))).val() || {};
    const duplicate = Object.keys(bans).some((id) => isActiveBan(bans[id])
        && String(bans[id].type || "").toLowerCase() === "email"
        && normal(bans[id].value) === value);
    if (duplicate) throw new Error("That email is already suspended.");

    const entry = push(ref(db, "nexus/bans"));
    await set(entry, {
        type: "email",
        value,
        reason: cleanReason,
        at: Date.now(),
        by: String(state.user.email || ""),
        active: true
    });

    const uid = match ? match.uid : null;
    await setAccountBanFlag(uid, true);
    await logAudit("BAN_ADD", `email: ${value} \u2014 ${cleanReason}`);
    return { id: entry.key, uid };
}

async function unban(id) {
    requireStaff();
    const key = String(id == null ? "" : id).trim();
    if (!key) throw new Error("Missing ban id.");
    const ban = (await get(ref(db, `nexus/bans/${key}`))).val();
    if (!ban) throw new Error("That ban no longer exists.");
    if (!isActiveBan(ban)) throw new Error("That ban is already lifted.");

    await update(ref(db, `nexus/bans/${key}`), {
        active: false,
        liftedAt: Date.now(),
        liftedBy: String(state.user.email || "")
    });

    if (String(ban.type || "").toLowerCase() === "email") {
        const match = await findAccountByEmail(ban.value);
        await setAccountBanFlag(match ? match.uid : null, false);
    }

    await logAudit("BAN_REVOKE", `${ban.type}: ${ban.value}`);
    return { id: key };
}

/* ---------------- Support tab ---------------- */

function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (character) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[character]);
}

function buildSupportPage() {
    let page = document.getElementById(SUPPORT_PAGE_ID);
    if (page) return page;

    page = document.createElement("section");
    page.id = SUPPORT_PAGE_ID;
    page.className = "view-section";
    page.style.display = "none";
    page.innerHTML = `
        <div class="settings-header">
            <h2>Support</h2>
            <p style="color:var(--text-dim)">Account status, suspensions and staff moderation.</p>
        </div>
        <div class="settings-grid">
            <div class="settings-card">
                <h3>Your account</h3>
                <p id="gl-sup-email" style="font-size:0.85rem;color:var(--text-primary);margin-bottom:6px;overflow-wrap:anywhere;">Not signed in</p>
                <p id="gl-sup-state" style="font-size:0.78rem;color:var(--text-dim);line-height:1.6;margin-bottom:14px;"></p>
                <button class="btn-small" id="gl-sup-signout" type="button" style="width:100%;padding:10px;color:#ff4444;border-color:rgba(255,68,68,0.4);display:none;">SIGN OUT</button>
                <p style="font-size:0.78rem;color:var(--text-dim);line-height:1.6;margin-top:12px;margin-bottom:0;">
                    Need something else? Open the
                    <a href="https://textnexus.me/support.html" target="_blank" rel="noopener" style="color:var(--accent);">TextNexus support page</a>.
                </p>
            </div>
            <div class="settings-card" id="gl-sup-mod" style="display:none;">
                <h3>Ban / unban</h3>
                <p style="font-size:0.78rem;color:var(--text-dim);line-height:1.6;margin-bottom:14px;">
                    Suspend a TextNexus account by email. Writes the shared <code>nexus/bans</code> record, applies to GhostLink and the rest of TextNexus, and is logged to the audit trail. Staff and owner accounts can't be suspended.
                </p>
                <label for="gl-sup-ban-email" style="display:block;font-size:0.68rem;letter-spacing:1px;text-transform:uppercase;color:var(--text-dim);margin-bottom:6px;">Email to suspend</label>
                <input type="text" id="gl-sup-ban-email" placeholder="user@example.com" autocomplete="off" spellcheck="false" style="width:100%;margin-bottom:10px;">
                <label for="gl-sup-ban-reason" style="display:block;font-size:0.68rem;letter-spacing:1px;text-transform:uppercase;color:var(--text-dim);margin-bottom:6px;">Reason</label>
                <input type="text" id="gl-sup-ban-reason" maxlength="200" placeholder="Shown on the suspension screen" autocomplete="off" style="width:100%;margin-bottom:12px;">
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                    <button class="btn-small run" id="gl-sup-ban-submit" type="button">BAN USER</button>
                    <button class="btn-small" id="gl-sup-ban-refresh" type="button">REFRESH</button>
                </div>
                <p id="gl-sup-msg" role="status" aria-live="polite" style="font-size:0.75rem;color:var(--text-dim);min-height:16px;margin:10px 0 6px;"></p>
                <div style="font-size:0.68rem;letter-spacing:1px;text-transform:uppercase;color:var(--text-dim);margin-bottom:6px;">Active email bans</div>
                <div id="gl-sup-list" style="display:flex;flex-direction:column;gap:8px;">
                    <p style="font-size:0.75rem;color:var(--text-dim);margin:0;">Sign in as a staff account to load bans.</p>
                </div>
            </div>
        </div>
    `;

    const anchor = document.getElementById("settings");
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(page, anchor.nextSibling);
    else document.body.appendChild(page);

    page.querySelector("#gl-sup-signout")?.addEventListener("click", () => {
        try { window.GhostLinkCloud?.signOut?.(); } catch (error) { /* ignore */ }
    });
    page.querySelector("#gl-sup-ban-submit")?.addEventListener("click", submitBan);
    page.querySelector("#gl-sup-ban-refresh")?.addEventListener("click", () => loadBanList());
    return page;
}

function showSupport() {
    const page = buildSupportPage();
    document.querySelectorAll(".view-section").forEach((section) => { section.style.display = "none"; });
    page.style.display = "block";
    document.querySelectorAll(".nav-item").forEach((item) => item.classList.remove("active"));
    const navItem = document.getElementById(SUPPORT_NAV_ID);
    if (navItem) navItem.classList.add("active");
    refreshSupport();
}

function ensureSupportNav() {
    const bottom = document.getElementById("sidebar-nav-bottom");
    if (!bottom || document.getElementById(SUPPORT_NAV_ID)) return;
    const item = document.createElement("div");
    item.id = SUPPORT_NAV_ID;
    item.className = "nav-item";
    item.dataset.id = "support";
    item.title = "Support and staff moderation";
    item.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg><span>Support</span>';
    item.addEventListener("click", showSupport);
    bottom.appendChild(item);
}

// The sidebar is rebuilt whenever nav order changes, so put the tab back.
function watchSidebar() {
    const bottom = document.getElementById("sidebar-nav-bottom");
    if (!bottom || bottom.dataset.banSupportWatched === "1") return;
    bottom.dataset.banSupportWatched = "1";
    const observer = new MutationObserver(() => ensureSupportNav());
    observer.observe(bottom, { childList: true });
    ensureSupportNav();
}

// The app's nav() only knows its own sections, so hide Support whenever it is
// used for another page.
function wrapNav() {
    const base = window.nav;
    if (typeof base !== "function" || base.__glBanWrap) return;
    const wrapped = function (page, appData) {
        if (page !== "support") {
            const support = document.getElementById(SUPPORT_PAGE_ID);
            if (support) support.style.display = "none";
        }
        return base.call(this, page, appData);
    };
    wrapped.__glBanWrap = true;
    window.nav = wrapped;
}

function supportMsg(text, bad) {
    const el = document.querySelector(`#${SUPPORT_PAGE_ID} #gl-sup-msg`);
    if (!el) return;
    el.textContent = text || "";
    el.style.color = bad ? "#ff6b6b" : "var(--text-dim)";
}

function refreshSupport() {
    const page = buildSupportPage();
    const email = (state.user && state.user.email) || "";
    const emailEl = page.querySelector("#gl-sup-email");
    const stateEl = page.querySelector("#gl-sup-state");
    const outEl = page.querySelector("#gl-sup-signout");
    const modEl = page.querySelector("#gl-sup-mod");

    if (emailEl) emailEl.textContent = email || "Not signed in";
    if (stateEl) {
        stateEl.textContent = state.banned
            ? (state.reason || "This account is suspended.")
            : (email
                ? (isStaff() ? "Signed in as staff. Moderation controls are on the right." : "Signed in. Games, apps and the proxy are available.")
                : "Sign in from Settings to use GhostLink.");
    }
    if (outEl) outEl.style.display = email ? "block" : "none";

    const showMod = isStaff() && !!email && !state.banned && state.ready;
    if (modEl) modEl.style.display = showMod ? "block" : "none";
    if (showMod) loadBanList();
    watchSidebar();
    wrapNav();
}

async function loadBanList() {
    const list = document.querySelector(`#${SUPPORT_PAGE_ID} #gl-sup-list`);
    if (!list || listLoading || !isStaff() || state.banned) return;
    listLoading = true;
    try {
        const bans = await listEmailBans();
        if (!bans.length) {
            list.innerHTML = '<p style="font-size:0.75rem;color:var(--text-dim);margin:0;">No active email bans.</p>';
            return;
        }
        list.innerHTML = bans.map((ban) => {
            const when = ban.at ? new Date(ban.at).toLocaleString() : "unknown date";
            return '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;border:1px solid var(--border);border-radius:9px;padding:10px 12px;">'
                + '<div style="min-width:0;"><strong style="display:block;font-size:0.8rem;color:var(--text-primary);overflow-wrap:anywhere;">' + escapeHtml(ban.email) + '</strong>'
                + '<span style="display:block;font-size:0.7rem;color:var(--text-dim);margin-top:3px;line-height:1.5;">'
                + escapeHtml(ban.reason || "No reason recorded.") + ' &middot; ' + escapeHtml(when) + '</span></div>'
                + '<button class="btn-small" type="button" data-ban="' + escapeHtml(ban.id) + '">REVOKE</button>'
                + '</div>';
        }).join("");
        list.querySelectorAll("[data-ban]").forEach((button) => {
            button.addEventListener("click", () => revokeBan(button.getAttribute("data-ban")));
        });
    } catch (error) {
        list.innerHTML = '<p style="font-size:0.75rem;color:#ff6b6b;margin:0;">Could not load bans: '
            + escapeHtml(error && error.message ? error.message : error) + '</p>';
    } finally {
        listLoading = false;
    }
}

async function submitBan() {
    const page = document.getElementById(SUPPORT_PAGE_ID);
    const emailEl = page?.querySelector("#gl-sup-ban-email");
    const reasonEl = page?.querySelector("#gl-sup-ban-reason");
    const button = page?.querySelector("#gl-sup-ban-submit");
    const email = emailEl ? emailEl.value.trim() : "";
    const reason = reasonEl ? reasonEl.value.trim() : "";

    if (button) { button.disabled = true; button.textContent = "BANNING\u2026"; }
    supportMsg("Saving ban\u2026", false);
    try {
        await banEmail(email, reason);
        if (emailEl) emailEl.value = "";
        if (reasonEl) reasonEl.value = "";
        supportMsg("Banned " + email + ".", false);
        await loadBanList();
    } catch (error) {
        supportMsg(error && error.message ? error.message : "Could not save the ban.", true);
    } finally {
        if (button) { button.disabled = false; button.textContent = "BAN USER"; }
    }
}

async function revokeBan(id) {
    if (!window.confirm("Revoke this ban?")) return;
    supportMsg("Lifting ban\u2026", false);
    try {
        await unban(id);
        supportMsg("Ban revoked.", false);
        await loadBanList();
    } catch (error) {
        supportMsg(error && error.message ? error.message : "Could not revoke the ban.", true);
    }
}

/* ---------------- boot ---------------- */

window.GhostLinkBans = {
    isStaff,
    isBanned: () => state.banned,
    listEmailBans,
    banEmail,
    unban,
    refresh: refreshSupport,
    show: showSupport
};

buildSupportPage();
watchSidebar();
wrapNav();

onAuthStateChanged(auth, async (user) => {
    state.user = user;
    state.ready = false;
    refreshSupport();

    if (!user) {
        state.ready = true;
        applyBan({ banned: false, reason: "" });
        return;
    }

    let result;
    try {
        result = await checkAccount(user);
    } catch (error) {
        console.warn("GhostLink ban check failed:", error && error.message);
        result = { banned: false, reason: "" };
    }

    // A sign-out or account switch while the check was running wins.
    if (state.user !== user) return;

    state.ready = true;
    applyBan(result);
});

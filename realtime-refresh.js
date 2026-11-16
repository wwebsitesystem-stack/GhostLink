/*
 * GhostLink global refresh.
 *
 * Notice pages load this module. It watches `system/refresh` in the Firebase
 * Realtime Database, so staff can publish one number from /system-console.html
 * (or the Firebase console) and every open GhostLink tab reloads once to pick
 * up the new build.
 *
 * A first load always adopts the current token, so a visitor is never reloaded
 * just for arriving after a refresh was published. Each tab keeps its own
 * in-memory copy of the token, so a sibling tab writing localStorage cannot
 * mark another tab as already refreshed.
 */
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getDatabase, ref, onValue, set } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-database.js";

const firebaseConfig = {
    apiKey: "AIzaSyAO_ffupJOIMPE9m4ARtaqSzC1vGDkIAco",
    authDomain: "nexus-web-development-official.firebaseapp.com",
    projectId: "nexus-web-development-official",
    databaseURL: "https://nexus-web-development-official-default-rtdb.firebaseio.com"
};

const REFRESH_PATH = "system/refresh";
const STORAGE_KEY = "ghostlink:site-refresh";

let lastSeen = readStoredToken();
let triggeredToken = null;
let initialEvent = true;
let reloading = false;

function readStoredToken() {
    try {
        const value = Number(localStorage.getItem(STORAGE_KEY));
        return Number.isFinite(value) && value > 0 ? value : null;
    } catch {
        return null;
    }
}

function remember(token) {
    lastSeen = token;
    try { localStorage.setItem(STORAGE_KEY, String(token)); } catch { /* private mode */ }
}

function reloadFor(token) {
    if (reloading) return;
    reloading = true;
    remember(token);
    window.location.reload();
}

// Reuse the page's default Firebase app where there is one so the staff
// session in this tab is the identity used by triggerGlobalRefresh().
function firebaseApp() {
    const apps = getApps();
    if (apps[0]?.options?.databaseURL) return apps[0];
    return apps.find(app => app.name === "ghostlink-refresh")
        || initializeApp(firebaseConfig, "ghostlink-refresh");
}

async function triggerGlobalRefresh() {
    const database = getDatabase(firebaseApp());
    const token = Date.now();
    // This page (and the shell around it) stays put; every other open tab
    // reloads when the new token reaches it.
    triggeredToken = token;
    await set(ref(database, REFRESH_PATH), token);
    remember(token);
    return token;
}

function adopt(token) {
    const value = Number(token);
    if (Number.isFinite(value) && value > 0) remember(value);
}

try {
    const database = getDatabase(firebaseApp());
    onValue(ref(database, REFRESH_PATH), (snapshot) => {
        const token = Number(snapshot.val()) || 0;
        if (!token) {
            initialEvent = false;
            return;
        }
        if (initialEvent) {
            initialEvent = false;
            remember(token);
            return;
        }
        if (triggeredToken !== null && token === triggeredToken) {
            triggeredToken = null;
            remember(token);
            return;
        }
        if (token !== lastSeen) reloadFor(token);
    }, (error) => {
        console.warn("GhostLink global refresh unavailable:", error?.code || error?.message);
    });
} catch (error) {
    console.warn("GhostLink global refresh could not start:", error?.message);
}

window.GhostLinkRefresh = {
    trigger: triggerGlobalRefresh,
    adopt,
    token: () => lastSeen
};

export { triggerGlobalRefresh };

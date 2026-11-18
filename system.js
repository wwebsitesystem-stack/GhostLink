/*
 * GhostLink system status: staff bypass, maintenance/lockdown gate, announcements.
 *
 * Loaded by index.html. Reads `system` (world-readable) and the signed-in
 * GhostLink account, then either shows a slim banner to staff or blocks the
 * app for everyone else. Staff accounts always get through, so a lockdown can
 * never lock the team out.
 */
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getDatabase, ref, onValue } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-database.js";

// Bans: shared TextNexus records, suspension notice and the staff Support tab.
import "./ghostlink-bans.js?v=2026-11-17";

const firebaseConfig = {
    apiKey: "AIzaSyAO_ffupJOIMPE9m4ARtaqSzC1vGDkIAco",
    authDomain: "nexus-web-development-official.firebaseapp.com",
    projectId: "nexus-web-development-official",
    databaseURL: "https://nexus-web-development-official-default-rtdb.firebaseio.com"
};

// The only accounts that can see past a lockdown or open the control panel.
const STAFF_EMAILS = [
    "brodywilliams0226@gmail.com",
    "bkeppel001@stpaul.k12.mn.us",
    "bmkeppel7@gmail.com"
];

const MODES = {
    operational: { label: "Operational", blocking: false, tone: "info", dot: "#6ecbff" },
    degraded:    { label: "Degraded",    blocking: false, tone: "warning", dot: "#d4d4d8" },
    testing:     { label: "Testing",     blocking: false, tone: "info", dot: "#6ecbff", staffOnly: true },
    maintenance: { label: "Maintenance", blocking: true,  tone: "danger", dot: "#e2564a", page: "maintenance.html" },
    lockdown:    { label: "Lockdown",    blocking: true,  tone: "danger", dot: "#e2564a", page: "lockdown.html" },
    offline:     { label: "Offline",     blocking: true,  tone: "danger", dot: "#e2564a", page: "offline.html" }
};

const TONES = {
    info:    { bg: "rgba(110, 203, 255, 0.12)", border: "rgba(110, 203, 255, 0.45)", dot: "#6ecbff" },
    warning: { bg: "rgba(255, 255, 255, 0.12)", border: "rgba(255, 255, 255, 0.45)", dot: "#d4d4d8" },
    danger:  { bg: "rgba(226, 86, 74, 0.18)",   border: "rgba(226, 86, 74, 0.5)",    dot: "#e2564a" }
};

const BAR_ID = "ghostlink-system-banner";
const GATE_ID = "ghostlink-system-gate";
const STYLE_ID = "ghostlink-system-style";
const isTopLevel = window.top === window.self;

let currentState = {};
let isStaff = false;
let authSettled = false;

function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
        #${BAR_ID} {
            position: fixed; top: 0; left: 0; right: 0; width: 100%;
            box-sizing: border-box; z-index: 2147483000;
            display: flex; align-items: center; gap: 10px;
            padding: 9px 18px;
            font-family: Inter, system-ui, -apple-system, "Segoe UI", sans-serif;
            font-size: 12.5px; line-height: 1.5; color: #eef4ff;
            background: #0a0a0a; border-bottom: 1px solid transparent;
        }
        #${BAR_ID}[hidden] { display: none; }
        #${BAR_ID} .gl-sys-dot {
            width: 7px; height: 7px; border-radius: 999px; flex: 0 0 auto;
            box-shadow: 0 0 8px currentColor;
        }
        #${BAR_ID} .gl-sys-text { flex: 1 1 auto; min-width: 0; }
        #${BAR_ID} .gl-sys-tag {
            flex: 0 0 auto; font-size: 9px; font-weight: 700; letter-spacing: 0.12em;
            text-transform: uppercase; padding: 2px 8px; border-radius: 999px;
            border: 1px solid currentColor; opacity: 0.85;
        }
        /* GhostLink's chrome is fixed, so move it down with the banner instead
           of letting the bar sit on top of the logo. body padding handles the
           main column; this handles the fixed sidebar. */
        html[data-gl-system-bar] .sidebar {
            top: var(--gl-system-bar-height, 0px);
            height: calc(100vh - var(--gl-system-bar-height, 0px));
        }
        #${GATE_ID} {
            position: fixed; inset: 0; z-index: 2147483001;
            display: flex; align-items: center; justify-content: center;
            padding: 0; background: #000;
            font-family: Inter, system-ui, -apple-system, "Segoe UI", sans-serif;
            color: #eef4ff; text-align: center;
        }
        #${GATE_ID}[hidden] { display: none; }
        #${GATE_ID} .gl-gate-frame {
            display: block; width: 100%; height: 100%;
            border: 0; background: #000;
        }
        #${GATE_ID} .gl-gate-card {
            max-width: 460px; width: 100%; padding: 34px 30px;
            border: 1px solid rgba(214, 231, 255, 0.14); border-radius: 16px;
            background: #0a0f16;
        }
        #${GATE_ID} .gl-gate-badge {
            display: inline-flex; align-items: center; gap: 7px;
            font-size: 9px; font-weight: 700; letter-spacing: 0.14em;
            text-transform: uppercase; padding: 4px 10px;
            border-radius: 999px; margin-bottom: 16px;
            border: 1px solid rgba(226, 86, 74, 0.45); color: #e2564a;
            background: rgba(226, 86, 74, 0.12);
        }
        #${GATE_ID} h1 { margin: 0 0 10px; font-size: 21px; line-height: 1.3; font-weight: 600; }
        #${GATE_ID} p { margin: 0 0 20px; font-size: 13px; line-height: 1.65; color: #9fb3cf; }
        @media (max-width: 560px) {
            #${BAR_ID} { font-size: 11.5px; padding: 8px 12px; }
            #${BAR_ID} .gl-sys-tag { display: none; }
        }
    `;
    document.head.appendChild(style);
}

function ensureBar() {
    let bar = document.getElementById(BAR_ID);
    if (bar) return bar;

    bar = document.createElement("div");
    bar.id = BAR_ID;
    bar.setAttribute("role", "status");
    bar.setAttribute("aria-live", "polite");
    bar.hidden = true;

    const dot = document.createElement("span");
    dot.className = "gl-sys-dot";
    const text = document.createElement("span");
    text.className = "gl-sys-text";
    const tag = document.createElement("span");
    tag.className = "gl-sys-tag";

    bar.append(dot, text, tag);
    document.body.insertBefore(bar, document.body.firstChild);
    return bar;
}

// The banner is fixed, so push the page down by exactly its height instead of
// letting it cover the top of the app. The page's own top padding is kept and
// restored when the banner goes away.
function syncBannerSpace() {
    const body = document.body;
    if (!body) return;
    const root = document.documentElement;
    const bar = document.getElementById(BAR_ID);

    if (!bar || bar.hidden) {
        if (body.dataset.glSysPad !== undefined) {
            body.style.paddingTop = body.dataset.glSysPad;
            delete body.dataset.glSysPad;
            delete body.dataset.glSysBasePad;
        }
        delete root.dataset.glSystemBar;
        root.style.removeProperty("--gl-system-bar-height");
        return;
    }

    if (body.dataset.glSysBasePad === undefined) {
        body.dataset.glSysPad = body.style.paddingTop || "";
        body.dataset.glSysBasePad = String(parseFloat(getComputedStyle(body).paddingTop) || 0);
    }
    const base = Number(body.dataset.glSysBasePad) || 0;
    const height = Math.ceil(bar.getBoundingClientRect().height);
    body.style.paddingTop = `${Math.round(base + height)}px`;
    root.style.setProperty("--gl-system-bar-height", `${height}px`);
    root.dataset.glSystemBar = "1";
}

function ensureGate() {
    let gate = document.getElementById(GATE_ID);
    if (gate) return gate;

    gate = document.createElement("div");
    gate.id = GATE_ID;
    gate.setAttribute("role", "alertdialog");
    gate.setAttribute("aria-modal", "true");
    gate.hidden = true;
    gate.innerHTML = `
        <iframe class="gl-gate-frame" data-gate-frame title="GhostLink status notice" src="about:blank"></iframe>
        <noscript>
            <div class="gl-gate-card" style="margin:24px">
                <span class="gl-gate-badge">Status</span>
                <h1>GhostLink is unavailable</h1>
                <p>JavaScript is off, so the live notice cannot load. Reload once JavaScript is available.</p>
            </div>
        </noscript>
    `;
    document.body.appendChild(gate);
    return gate;
}

function stateMode(state) {
    const raw = String(state?.status || "").toLowerCase();
    if (MODES[raw]) return raw;
    if (state?.maintenance === true) return "maintenance";
    return "operational";
}

function paint() {
    const mode = stateMode(currentState);
    const def = MODES[mode];
    const banner = currentState?.banner || {};
    const announce = banner.enabled === true;

    document.documentElement.dataset.systemStatus = mode;

    const bar = isTopLevel ? ensureBar() : null;
    const gate = ensureGate();
    const frame = gate.querySelector("[data-gate-frame]");
    const blocked = def.blocking && authSettled && !isStaff;

    // Staff (or anyone when nothing is wrong) see at most a slim banner.
    const staffNotice = isStaff && def.blocking;
    // Testing is a staff-only mode, so the mode itself always surfaces a notice
    // for staff even when the public announcement banner is switched off.
    const testingNotice = isStaff && Boolean(def.staffOnly);
    const showBar = isTopLevel && (blocked ? false : (staffNotice || testingNotice || (announce && !(def.staffOnly && !isStaff))));

    if (showBar && bar) {
        const tone = TONES[def.blocking ? "danger" : banner.tone] || TONES.info;
        const message = def.blocking
            ? (currentState?.message || `GhostLink is in ${def.label.toLowerCase()}. You are seeing this because your account bypasses it.`)
            : (banner.message || (testingNotice
                ? `GhostLink is in ${def.label.toLowerCase()}. This notice only shows for staff accounts.`
                : "Heads up from the GhostLink team."));
        // Tint an opaque background so the bar stays readable over the page.
        bar.style.backgroundImage = `linear-gradient(${tone.bg}, ${tone.bg})`;
        bar.style.borderBottomColor = tone.border;
        const dot = bar.querySelector(".gl-sys-dot");
        dot.style.background = tone.dot;
        dot.style.color = tone.dot;
        bar.querySelector(".gl-sys-text").textContent = message;
        const tag = bar.querySelector(".gl-sys-tag");
        tag.textContent = def.blocking ? `${def.label} · staff bypass` : (def.staffOnly ? "Testing" : "Notice");
        tag.style.color = tone.dot;
        bar.hidden = false;
    } else if (bar) {
        bar.hidden = true;
    }
    if (bar) syncBannerSpace();

    if (blocked && frame) {
        // Every blocking mode has its own page. Load it full-viewport so visitors
        // get the real, editable notice instead of a generic card.
        // Relative so the notice resolves under whatever path the app is served
        // from (GhostLink lives at /GhostLink/ on GitHub Pages).
        const page = def.page || "maintenance.html";
        const key = `${page}|${currentState?.message || ""}`;
        if (frame.dataset.key !== key) {
            const qs = new URLSearchParams({
                mode,
                since: String(Number(currentState?.updatedAt) || Date.now())
            });
            if (currentState?.message) qs.set("message", currentState.message);
            frame.dataset.key = key;
            frame.title = `GhostLink ${def.label.toLowerCase()} notice`;
            frame.src = `${page}?${qs.toString()}`;
        }
        gate.hidden = false;
        document.documentElement.style.overflow = "hidden";
    } else {
        gate.hidden = true;
        document.documentElement.style.overflow = "";
    }
}

// Runs in the shell and inside the frame: a page opened directly has to be
// blocked too, not only the shell that happens to frame it.
{
    injectStyle();
    if (isTopLevel) window.addEventListener("resize", syncBannerSpace);
    try {
        // Share the named app global-refresh-client.js uses, so the Google
        // session in the sidebar is the same identity this gate checks.
        const app = getApps().find((existing) => existing.name === "ghostlink")
            || initializeApp(firebaseConfig, "ghostlink");
        const db = getDatabase(app);
        const auth = getAuth(app);

        onValue(ref(db, "system"), (snap) => {
            currentState = snap.val() || {};
            window.GhostLinkSystem = currentState;
            paint();
        }, (error) => {
            console.warn("GhostLink system status unavailable:", error?.code || error?.message);
        });

        onAuthStateChanged(auth, (user) => {
            isStaff = !!user
                && user.emailVerified !== false
                && STAFF_EMAILS.includes(String(user.email || "").toLowerCase());
            authSettled = true;
            paint();
        });
    } catch (error) {
        // Fail soft: a broken status feed must never take the app down.
        console.warn("GhostLink system status could not start:", error?.message);
    }
}

export { STAFF_EMAILS, MODES };

// Bundled games: the games table reads the online catalogue only, so hand it
// the local catalogue from the last module the page loads. A failure is logged
// and never blocks the status gate.
import("./games/local-games.js").catch((error) => {
    console.warn("GhostLink bundled games unavailable:", error && error.message);
});

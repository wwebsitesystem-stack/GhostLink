/*
 * Nexus system status: staff bypass, maintenance/lockdown gate, announcements.
 *
 * Reads `system` (world-readable) and the signed-in user, then either shows a
 * slim banner to staff or blocks the workspace for everyone else. Staff accounts
 * always get through, so a lockdown can never lock the team out.
 */
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getDatabase, ref, onValue } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-database.js";

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
    operational: { label: "Operational", blocking: false, tone: "info", dot: "#7fd1a8" },
    degraded:    { label: "Degraded",    blocking: false, tone: "warning", dot: "#d4d4d8" },
    testing:     { label: "Testing",     blocking: false, tone: "info", dot: "#7fa8c9", staffOnly: true },
    maintenance: { label: "Maintenance", blocking: true,  tone: "danger", dot: "#e2564a", page: "maintenance.html" },
    lockdown:    { label: "Lockdown",    blocking: true,  tone: "danger", dot: "#e2564a", page: "lockdown.html" },
    offline:     { label: "Offline",     blocking: true,  tone: "danger", dot: "#e2564a", page: "offline.html" }
};

const TONES = {
    info:    { bg: "rgba(127, 168, 201, 0.14)", border: "rgba(127, 168, 201, 0.45)", dot: "#7fa8c9" },
    warning: { bg: "rgba(255, 255, 255, 0.14)", border: "rgba(255, 255, 255, 0.48)", dot: "#d4d4d8" },
    danger:  { bg: "rgba(200, 69, 58, 0.16)",   border: "rgba(200, 69, 58, 0.5)",    dot: "#e2564a" }
};

const BAR_ID = "nexus-system-banner";
const GATE_ID = "nexus-system-gate";
const STYLE_ID = "nexus-system-style";
const isTopLevel = window.top === window.self;

let currentState = {};
let isStaff = false;
let authSettled = false;

function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
        /* Fixed, not in flow: the workspace body is a flex row, so an in-flow
           bar would become a tall column beside the sidebar. */
        #${BAR_ID} {
            position: fixed; top: 0; left: 0; right: 0; width: 100%;
            box-sizing: border-box; z-index: 2147483000;
            display: flex; align-items: center; gap: 10px;
            padding: 9px 18px;
            font-family: Inter, system-ui, -apple-system, "Segoe UI", sans-serif;
            font-size: 12.5px; line-height: 1.5; color: #eef4ff;
            background: #0b1220; border-bottom: 1px solid transparent;
        }
        #${BAR_ID}[hidden] { display: none; }
        #${BAR_ID} .nx-sys-dot { width: 7px; height: 7px; border-radius: 999px; flex: 0 0 auto; box-shadow: 0 0 8px currentColor; }
        #${BAR_ID} .nx-sys-text { flex: 1 1 auto; min-width: 0; }
        #${BAR_ID} .nx-sys-tag {
            flex: 0 0 auto; font-size: 9px; font-weight: 700; letter-spacing: 0.12em;
            text-transform: uppercase; padding: 2px 8px; border-radius: 999px;
            border: 1px solid currentColor; opacity: 0.85;
        }
        #${GATE_ID} {
            position: fixed; inset: 0; z-index: 2147483001;
            display: flex; align-items: center; justify-content: center;
            padding: 0; background: #0a0a0a;
            font-family: Inter, system-ui, -apple-system, "Segoe UI", sans-serif;
            color: #eef4ff; text-align: center;
        }
        #${GATE_ID}[hidden] { display: none; }
        #${GATE_ID} .nx-gate-frame { display: block; width: 100%; height: 100%; border: 0; background: #0a0a0a; }
        #${GATE_ID} .nx-gate-card {
            max-width: 460px; width: 100%; padding: 34px 30px;
            border: 1px solid rgba(214, 231, 255, 0.14); border-radius: 16px;
            background: #0d1524;
        }
        #${GATE_ID} .nx-gate-badge {
            display: inline-flex; align-items: center; gap: 7px;
            font-size: 9px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase;
            padding: 4px 10px; border-radius: 999px; margin-bottom: 16px;
            border: 1px solid rgba(161, 161, 170, 0.45); color: #e2564a;
            background: rgba(200, 69, 58, 0.12);
        }
        #${GATE_ID} h1 { margin: 0 0 10px; font-size: 21px; line-height: 1.3; font-weight: 600; letter-spacing: -0.01em; }
        #${GATE_ID} p { margin: 0 0 20px; font-size: 13px; line-height: 1.65; color: #9fb3cf; }
        #${GATE_ID} .nx-gate-links { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }
        #${GATE_ID} a {
            display: inline-flex; align-items: center; gap: 7px;
            font-size: 11.5px; font-weight: 600; color: #eef4ff; text-decoration: none;
            border: 1px solid rgba(214, 231, 255, 0.18); border-radius: 9px; padding: 8px 13px;
        }
        #${GATE_ID} a:hover { border-color: rgba(214, 231, 255, 0.4); }
        @media (max-width: 560px) {
            #${BAR_ID} { font-size: 11.5px; padding: 8px 12px; }
            #${BAR_ID} .nx-sys-tag { display: none; }
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
    dot.className = "nx-sys-dot";
    const text = document.createElement("span");
    text.className = "nx-sys-text";
    const tag = document.createElement("span");
    tag.className = "nx-sys-tag";

    bar.append(dot, text, tag);
    document.body.insertBefore(bar, document.body.firstChild);
    return bar;
}

// The banner is fixed, so push the page down by exactly its height instead of
// letting it cover the top of the workspace. The page's own top padding is
// kept and restored when the banner goes away.
function syncBannerSpace() {
    const body = document.body;
    if (!body) return;
    const bar = document.getElementById(BAR_ID);
    if (!bar || bar.hidden) {
        if (body.dataset.nxSysPad === undefined) return;
        body.style.paddingTop = body.dataset.nxSysPad;
        delete body.dataset.nxSysPad;
        delete body.dataset.nxSysBasePad;
        return;
    }
    if (body.dataset.nxSysBasePad === undefined) {
        body.dataset.nxSysPad = body.style.paddingTop || "";
        body.dataset.nxSysBasePad = String(parseFloat(getComputedStyle(body).paddingTop) || 0);
    }
    const base = Number(body.dataset.nxSysBasePad) || 0;
    const height = Math.ceil(bar.getBoundingClientRect().height);
    body.style.paddingTop = `${Math.round(base + height)}px`;
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
        <iframe class="nx-gate-frame" data-gate-frame title="Nexus status notice" src="about:blank"></iframe>
        <noscript>
            <div class="nx-gate-card" style="margin:24px">
                <span class="nx-gate-badge">Status</span>
                <h1>Nexus is unavailable</h1>
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
            ? (currentState?.message || `Nexus is in ${def.label.toLowerCase()}. You are seeing this because your account bypasses it.`)
            : (banner.message || (testingNotice
                ? `Nexus is in ${def.label.toLowerCase()}. This notice only shows for staff accounts.`
                : "Heads up from the Nexus team."));
        // Tint an opaque background so the bar stays readable over the page.
        bar.style.backgroundImage = `linear-gradient(${tone.bg}, ${tone.bg})`;
        bar.style.borderBottomColor = tone.border;
        bar.querySelector(".nx-sys-dot").style.background = tone.dot;
        bar.querySelector(".nx-sys-dot").style.color = tone.dot;
        bar.querySelector(".nx-sys-text").textContent = message;
        const tag = bar.querySelector(".nx-sys-tag");
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
        const page = def.page ? `/${def.page}` : "/maintenance.html";
        const key = `${page}|${currentState?.message || ""}`;
        if (frame.dataset.key !== key) {
            const qs = new URLSearchParams({
                mode,
                since: String(Number(currentState?.updatedAt) || Date.now())
            });
            if (currentState?.message) qs.set("message", currentState.message);
            frame.dataset.key = key;
            frame.title = `Nexus ${def.label.toLowerCase()} notice`;
            frame.src = `${page}?${qs.toString()}`;
        }
        gate.hidden = false;
        // Keep keyboard focus inside the block so the page underneath is inert
        // to screen readers without permanently changing the live DOM.
        document.documentElement.style.overflow = "hidden";
    } else {
        gate.hidden = true;
        document.documentElement.style.overflow = "";
    }
    if (!frame) console.warn("Nexus gate frame missing");
}

// Runs in the shell and inside the frame: a page opened directly has to be
// blocked too, not only the shell that happens to frame it.
{
    injectStyle();
    if (isTopLevel) window.addEventListener("resize", syncBannerSpace);
    try {
        const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
        const db = getDatabase(app);
        const auth = getAuth(app);

        onValue(ref(db, "system"), (snap) => {
            currentState = snap.val() || {};
            window.nexusSystem = currentState;
            paint();
        }, (error) => {
            console.warn("Nexus system status unavailable:", error?.code || error?.message);
        });

        onAuthStateChanged(auth, (user) => {
            isStaff = !!user && user.emailVerified !== false && STAFF_EMAILS.includes(String(user.email || "").toLowerCase());
            authSettled = true;
            paint();
        });
    } catch (error) {
        console.warn("Nexus system status could not start:", error?.message);
    }
}

export { STAFF_EMAILS, MODES };

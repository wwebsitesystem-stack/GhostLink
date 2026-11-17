/**
 * Site-wide shutdown gate.
 *
 * GhostLink's pages already load system.js, which blocks the UI in the browser.
 * That only covers a page once it has loaded and only while JavaScript and
 * Firebase are reachable, so opening a file directly — or blocking
 * firebaseio.com so the check never settles — still got through. This
 * middleware runs at the edge before the asset server for every request, so a
 * shutdown mode now covers every file the project serves.
 *
 * The mode lives in `system/status` in the shared Nexus Firebase project,
 * which is world-readable. The read happens server-side, so a visitor cannot
 * interfere with it, and the answer is cached for a few seconds.
 *
 * The blocked response is a self-contained notice rather than one of the
 * notice pages: those pages load system.js, and loading the gate inside the
 * gate would frame the notice forever. Only /system-console.html (staff-gated
 * in the browser) and the scripts it needs stay reachable, so the mode can be
 * switched back. If the status cannot be read and nothing is cached, requests
 * pass through — a database hiccup must never take the whole site down.
 */

const SYSTEM_BASE = "https://nexus-web-development-official-default-rtdb.firebaseio.com";
const CACHE_MS = 10_000;

// Blocking modes and the label their notice uses.
const BLOCKING = new Map([
  ["maintenance", "maintenance"],
  ["lockdown", "lockdown"],
  ["offline", "shut down"]
]);

// The only paths that keep working while a blocking mode is active: the staff
// console used to lift the mode, and the scripts it loads.
const ALLOWED = new Set([
  "/system-console",
  "/system-console.html",
  "/system.js",
  "/realtime-refresh.js",
  "/global-refresh-client.js",
  "/ghostlink-bans.js"
]);

let cached = { at: 0, known: false, mode: null };

async function readJson(path) {
  // Bounded: every request waits on this, so a slow database must not stall it.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    const res = await fetch(`${SYSTEM_BASE}${path}`, {
      cf: { cacheTtl: 10, cacheEverything: true },
      headers: { accept: "application/json" },
      signal: controller.signal
    });
    if (!res.ok) return null;
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function currentMode() {
  const now = Date.now();
  if (cached.known && now - cached.at < CACHE_MS) return cached.mode;

  let known = false;
  let mode = null;
  try {
    const status = String((await readJson("/system/status.json")) ?? "").toLowerCase();
    if (BLOCKING.has(status)) {
      mode = status;
      known = true;
    } else if (status === "operational" || status === "degraded" || status === "testing") {
      known = true;
    } else {
      // Older console builds wrote only the boolean; keep honouring it.
      const legacy = await readJson("/system/maintenance.json");
      known = true;
      if (legacy === true) mode = "maintenance";
    }
  } catch (error) {
    // Keep the last answer (even a stale one); with nothing cached, fail open.
    console.warn("GhostLink shutdown check failed:", error?.message || error);
  }

  if (known) cached = { at: now, known, mode };
  return known ? mode : cached.mode;
}

function pathname(url) {
  const path = url.pathname.replace(/\/+$/, "").toLowerCase();
  return path || "/";
}

function noticePage(mode) {
  const label = BLOCKING.get(mode) || mode;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>GhostLink is ${label}</title>
<style>
  html,body{height:100%;margin:0}
  body{display:grid;place-items:center;padding:24px;background:#05070a;color:#e8feff;
    font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
  .card{width:min(460px,100%);border:1px solid #1d2b33;border-radius:16px;
    background:#0a1116;padding:34px 30px}
  .badge{display:inline-block;margin-bottom:16px;padding:4px 10px;border-radius:999px;
    font-size:9px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;
    color:#6ecbff;border:1px solid rgba(110,203,255,.45);background:rgba(110,203,255,.1)}
  h1{margin:0 0 10px;font-size:21px;line-height:1.3}
  p{margin:0 0 20px;font-size:13px;line-height:1.65;color:#8aa3ad}
  a{display:inline-flex;padding:8px 13px;border:1px solid #1d2b33;
    border-radius:9px;color:#e8feff;font-size:11.5px;font-weight:600;text-decoration:none}
</style>
</head>
<body>
  <div class="card">
    <span class="badge">${label}</span>
    <h1>GhostLink is ${label}.</h1>
    <p>GhostLink has been taken offline on purpose. Nothing has been deleted — it will be turned back on by the team.</p>
    <a href="/system-console">Staff access</a>
  </div>
</body>
</html>`;
}

export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);
  const mode = await currentMode();
  if (!mode) return next();
  if (ALLOWED.has(pathname(url))) return next();

  const html = noticePage(mode);
  return new Response(request.method === "HEAD" ? null : html, {
    status: 503,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "retry-after": "60",
      "x-nexus-mode": mode
    }
  });
}

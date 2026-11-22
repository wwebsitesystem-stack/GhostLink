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

// Nexus 10.0 return hold. The shared release window opened at 3:00 PM Central
// on Friday, November 20, 2026 and lifts on Monday, November 23, 2026 at
// 9:50 AM Central, when Nexus is back up on its new domain, textnexus.dev.
const NEXUS10_START = Date.parse("2026-11-20T21:00:00Z"); // 3:00 PM CST
const NEXUS10_END = Date.parse("2026-11-23T15:50:00Z");   // 9:50 AM CST, Nexus reopens

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

function nexus10Notice() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>GhostLink is back up Monday at 9:50 AM CT</title>
<style>
  html,body{height:100%;margin:0}
  [hidden]{display:none!important}
  body{display:grid;place-items:center;padding:24px;background:#05070a;color:#e8feff;
    font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
  .card{width:min(520px,100%);border:1px solid #1d2b33;border-radius:16px;
    background:radial-gradient(circle at 100% 0%,rgba(110,203,255,.12),transparent 58%),#0a1116;
    padding:34px 30px}
  .badge{display:inline-block;margin-bottom:16px;padding:4px 10px;border-radius:999px;
    font-size:9px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;
    color:#6ecbff;border:1px solid rgba(110,203,255,.45);background:rgba(110,203,255,.1)}
  h1{margin:0 0 10px;font-size:22px;line-height:1.3}
  p{margin:0 0 14px;font-size:13px;line-height:1.7;color:#8aa3ad}
  p b{color:#e8feff}
  .timer{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:18px 0}
  .timer div{padding:12px 4px;border:1px solid #1d2b33;border-radius:11px;
    background:rgba(110,203,255,.05);text-align:center}
  .timer b{display:block;color:#e8feff;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
    font-size:clamp(22px,6vw,30px);font-weight:500;font-variant-numeric:tabular-nums;line-height:1}
  .timer span{display:block;margin-top:6px;color:#6f8791;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
    font-size:8px;font-weight:700;letter-spacing:.16em;text-transform:uppercase}
  .next{margin:18px 0 20px;padding:13px 15px;border:1px solid rgba(110,203,255,.28);
    border-radius:11px;background:rgba(110,203,255,.07);color:#c9e9ff}
  a{display:inline-flex;padding:8px 13px;border:1px solid #1d2b33;
    border-radius:9px;color:#e8feff;font-size:11.5px;font-weight:600;text-decoration:none}
</style>
</head>
<body>
  <div class="card">
    <span class="badge">Nexus 10.0 &middot; Back up Monday</span>
    <h1>GhostLink is back up with a new domain.</h1>
    <p>GhostLink is back up on <b>textnexus.dev</b>, with <b>textnexus.me</b> right
      beside it. The workspace, apps and settings reopen Monday, November 23 at
      9:50 AM CT.</p>
    <p>Nothing has been deleted &mdash; your apps, shortcuts and settings are safe.</p>
    <div class="timer" role="timer" aria-label="Time until GhostLink reopens">
      <div><b data-gl-days>00</b><span>Days</span></div>
      <div><b data-gl-hours>00</b><span>Hours</span></div>
      <div><b data-gl-minutes>00</b><span>Minutes</span></div>
      <div><b data-gl-seconds>00</b><span>Seconds</span></div>
    </div>
    <p class="next"><b>Doors open:</b> Monday, November 23 at 9:50 AM CT. This page
      opens GhostLink for you when the countdown ends.</p>
    <a href="/system-console">Staff access</a>
  </div>
  <script>
    (function () {
      "use strict";
      var deadline = Date.parse("2026-11-23T09:50:00-06:00");
      var fields = {
        days: document.querySelector("[data-gl-days]"),
        hours: document.querySelector("[data-gl-hours]"),
        minutes: document.querySelector("[data-gl-minutes]"),
        seconds: document.querySelector("[data-gl-seconds]")
      };
      var openTimer = 0;
      var KEY = "gl-nx10-open-attempt";
      var RETRY_MS = 15000;

      function pad(value) { return String(Math.max(0, value)).padStart(2, "0"); }
      function lastAttempt() {
        try { return Number(window.sessionStorage.getItem(KEY)) || 0; }
        catch (error) { return 0; }
      }
      function openSite() {
        try { window.sessionStorage.setItem(KEY, String(Date.now())); }
        catch (error) { /* storage blocked: the reload still happens */ }
        window.location.replace("/");
      }
      function scheduleOpen() {
        if (openTimer) return;
        var since = Date.now() - lastAttempt();
        var wait = since > 0 && since < RETRY_MS ? RETRY_MS - since : 1200;
        openTimer = window.setTimeout(openSite, Math.max(300, wait));
      }
      function paint() {
        if (!Number.isFinite(deadline)) return false;
        var remaining = deadline - Date.now();
        if (remaining <= 0) {
          var timer = document.querySelector(".timer");
          if (timer) timer.hidden = true;
          document.title = "GhostLink is back up | TextNexus";
          scheduleOpen();
          return false;
        }
        var total = Math.ceil(remaining / 1000);
        fields.days.textContent = pad(Math.floor(total / 86400));
        fields.hours.textContent = pad(Math.floor((total % 86400) / 3600));
        fields.minutes.textContent = pad(Math.floor((total % 3600) / 60));
        fields.seconds.textContent = pad(total % 60);
        return true;
      }

      if (paint()) window.setInterval(paint, 1000);
      document.addEventListener("visibilitychange", function () {
        if (!document.hidden) paint();
      });
    })();
  </script>
</body>
</html>`;
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

  // The 10.0 hold outranks the normal status feed, so GhostLink keeps showing
  // the launch-delay notice for as long as Nexus is waiting on its new domain.
  const now = Date.now();
  if (now >= NEXUS10_START && now < NEXUS10_END && !ALLOWED.has(pathname(url))) {
    const html = nexus10Notice();
    return new Response(request.method === "HEAD" ? null : html, {
      status: 503,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "retry-after": "60",
        "x-nexus-mode": "nexus10"
      }
    });
  }

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

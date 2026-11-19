/*
 * Nexus Social announcement pop-up.
 *
 * The copy and the on/off switch live in the Realtime Database at
 * `system/announcement`, edited from the Broadcast tab of
 * /system-console.html. Public pages load this next to nexus-theme.js; it
 * shows once per message, never on staff consoles and never inside the
 * workspace shell's embedded frames, so the notice cannot stack into
 * several copies. When the node is missing or unreachable the built-in copy
 * below is used, so the notice keeps working before staff ever touch it.
 */
(function () {
    "use strict";

    var CONFIG_URL = "https://nexus-web-development-official-default-rtdb.firebaseio.com/system/announcement.json";
    var CONFIG_TIMEOUT = 2000;
    var STORAGE_PREFIX = "nexus-social-announcement:";
    var LEGACY_KEY = "nexus-social-announcement-2026-11";
    var DISMISSED = "1";
    var STYLE_ID = "nexus-social-style";
    var OVERLAY_ID = "nexus-social-overlay";

    // Keep in step with ANNOUNCE_DEFAULTS in system-console.html: the panel
    // starts from this text and a saved `system/announcement` replaces it.
    var DEFAULTS = {
        kicker: "Nexus Social · Coming soon",
        title: "Nexus is making its very own social media website!",
        body: "We will have everything just like other companies like TikTok, Instagram, Facebook, YouTube."
    };

    // Staff consoles have their own work to do; a launch promo is not for them.
    var STAFF_PAGES = /(?:^|\/)(?:admin|owner|system-console|nexus_admin_control_center|system_analytics_health|admin-chat-migration|email-manager|secret1|testing)\.html$/i;
    if (STAFF_PAGES.test(window.location.pathname)) return;

    // The workspace embeds pages in the shell iframe; the top-level page owns
    // the one copy of the notice.
    if (window.top !== window.self) return;

    function text(value, fallback, limit) {
        var candidate = typeof value === "string" ? value.trim() : "";
        return (candidate || fallback).slice(0, limit);
    }

    function revisionOf(config) {
        var stamp = config && (config.updatedAt || config.rev);
        return stamp ? String(stamp) : "default";
    }

    function alreadySeen(revision) {
        try {
            if (revision === "default" && window.localStorage.getItem(LEGACY_KEY) === DISMISSED) return true;
            return window.localStorage.getItem(STORAGE_PREFIX + revision) === DISMISSED;
        } catch (error) {
            return false;
        }
    }

    function remember(revision) {
        try { window.localStorage.setItem(STORAGE_PREFIX + revision, DISMISSED); }
        catch (error) { /* storage blocked: the notice simply shows again next page */ }
    }

    // One small public read of the staff-editable notice. The request is capped
    // so a slow or blocked Firebase never holds the page's first paint, and a
    // failed read falls back to the built-in copy.
    function readConfig() {
        if (typeof window.fetch !== "function") return Promise.resolve(null);
        return new Promise(function (resolve) {
            var settled = false;
            var controller = null;
            var timer = 0;

            function finish(value) {
                if (settled) return;
                settled = true;
                window.clearTimeout(timer);
                resolve(value && typeof value === "object" ? value : null);
            }

            try { controller = new AbortController(); } catch (error) { controller = null; }
            timer = window.setTimeout(function () {
                if (controller) {
                    try { controller.abort(); } catch (error) { /* already finished */ }
                }
                finish(null);
            }, CONFIG_TIMEOUT);

            try {
                window.fetch(CONFIG_URL, {
                    cache: "no-store",
                    credentials: "omit",
                    signal: controller ? controller.signal : undefined
                }).then(function (response) {
                    if (!response || !response.ok) {
                        finish(null);
                        return null;
                    }
                    return response.json();
                }).then(finish).catch(function () { finish(null); });
            } catch (error) {
                finish(null);
            }
        });
    }

    function injectStyle() {
        if (document.getElementById(STYLE_ID)) return;
        var style = document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = `
            #${OVERLAY_ID} {
                position: fixed; inset: 0; z-index: 90000;
                display: flex; align-items: center; justify-content: center;
                padding: 24px;
                background: rgba(3, 5, 10, 0.74);
                -webkit-backdrop-filter: blur(8px);
                backdrop-filter: blur(8px);
                font-family: Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
                opacity: 0; transition: opacity .22s ease;
            }
            #${OVERLAY_ID}.is-open { opacity: 1; }
            #${OVERLAY_ID} .nx-social-card {
                position: relative;
                width: min(460px, 100%);
                padding: 30px 28px 26px;
                border-radius: 18px;
                border: 1px solid rgba(255, 255, 255, 0.14);
                background:
                    radial-gradient(circle at 100% 0%, rgba(127, 168, 201, 0.18), transparent 62%),
                    linear-gradient(160deg, rgba(255, 255, 255, 0.05), transparent 55%),
                    #0d0d10;
                box-shadow: 0 30px 90px -30px #000, inset 0 1px 0 rgba(255, 255, 255, 0.05);
                color: #f4f4f5;
                transform: translateY(10px) scale(0.98);
                transition: transform .22s cubic-bezier(0.16, 1, 0.3, 1);
            }
            #${OVERLAY_ID}.is-open .nx-social-card { transform: none; }
            #${OVERLAY_ID} .nx-social-kicker {
                display: inline-flex; align-items: center; gap: 7px;
                margin-bottom: 14px; padding: 4px 10px; border-radius: 999px;
                border: 1px solid rgba(255, 255, 255, 0.18);
                background: rgba(255, 255, 255, 0.06);
                color: #b9c6d8;
                font-size: 9px; font-weight: 700; letter-spacing: 0.16em;
                text-transform: uppercase;
            }
            #${OVERLAY_ID} .nx-social-kicker::before {
                content: "";
                width: 6px; height: 6px; border-radius: 999px;
                background: #7fd1a8; box-shadow: 0 0 8px #7fd1a8;
            }
            #${OVERLAY_ID} h2 {
                margin: 0 0 10px;
                font-size: clamp(21px, 4.6vw, 25px);
                line-height: 1.24; font-weight: 650; letter-spacing: -0.02em;
            }
            #${OVERLAY_ID} p {
                margin: 0 0 22px;
                color: #a7b3c4;
                font-size: 13.5px; line-height: 1.65;
                white-space: pre-line;
                overflow-wrap: anywhere;
            }
            #${OVERLAY_ID} .nx-social-close {
                width: 100%;
                padding: 11px 16px;
                border: 1px solid rgba(255, 255, 255, 0.2);
                border-radius: 10px;
                background: #f4f4f5; color: #0a0a0a;
                font: inherit; font-size: 13px; font-weight: 650;
                cursor: pointer;
                transition: background .15s ease, border-color .15s ease, transform .15s ease;
            }
            #${OVERLAY_ID} .nx-social-close:hover { background: #fff; transform: translateY(-1px); }
            #${OVERLAY_ID} .nx-social-close:focus-visible { outline: 2px solid #7fa8c9; outline-offset: 3px; }
            @media (max-width: 520px) {
                #${OVERLAY_ID} { padding: 14px; }
                #${OVERLAY_ID} .nx-social-card { padding: 24px 20px 20px; border-radius: 16px; }
            }
            @media (prefers-reduced-motion: reduce) {
                #${OVERLAY_ID}, #${OVERLAY_ID} .nx-social-card { transition: none; }
                #${OVERLAY_ID} .nx-social-card { transform: none; }
            }
        `;
        document.head.appendChild(style);
    }

    function buildCard(copy) {
        var card = document.createElement("div");
        card.className = "nx-social-card";
        card.setAttribute("role", "document");

        var kicker = document.createElement("span");
        kicker.className = "nx-social-kicker";
        kicker.textContent = copy.kicker;

        var title = document.createElement("h2");
        title.id = "nexus-social-title";
        title.textContent = copy.title;

        var body = document.createElement("p");
        body.id = "nexus-social-copy";
        body.textContent = copy.body;

        var close = document.createElement("button");
        close.type = "button";
        close.className = "nx-social-close";
        close.textContent = "Got it";

        card.appendChild(kicker);
        card.appendChild(title);
        card.appendChild(body);
        card.appendChild(close);
        return { card: card, close: close };
    }

    function show(config, revision) {
        if (document.getElementById(OVERLAY_ID)) return;
        injectStyle();

        var copy = {
            kicker: text(config.kicker, DEFAULTS.kicker, 80),
            title: text(config.title, DEFAULTS.title, 160),
            body: text(config.body, DEFAULTS.body, 400)
        };

        var previouslyFocused = document.activeElement;
        var overlay = document.createElement("div");
        overlay.id = OVERLAY_ID;
        overlay.setAttribute("role", "dialog");
        overlay.setAttribute("aria-modal", "true");
        overlay.setAttribute("aria-labelledby", "nexus-social-title");
        overlay.setAttribute("aria-describedby", "nexus-social-copy");

        var parts = buildCard(copy);
        overlay.appendChild(parts.card);
        document.body.appendChild(overlay);

        var close = parts.close;
        var dismissed = false;

        function dismiss() {
            if (dismissed) return;
            dismissed = true;
            remember(revision);
            overlay.classList.remove("is-open");
            document.removeEventListener("keydown", onKey);
            window.setTimeout(function () {
                if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            }, 220);
            try {
                if (previouslyFocused && typeof previouslyFocused.focus === "function") {
                    previouslyFocused.focus({ preventScroll: true });
                }
            } catch (error) { /* the page moved on */ }
        }

        function onKey(event) {
            if (event.key === "Escape") {
                event.preventDefault();
                dismiss();
                return;
            }
            if (event.key === "Tab") {
                event.preventDefault();
                close.focus({ preventScroll: true });
            }
        }

        overlay.addEventListener("click", function (event) {
            if (event.target === overlay) dismiss();
        });
        close.addEventListener("click", dismiss);
        document.addEventListener("keydown", onKey);

        window.requestAnimationFrame(function () { overlay.classList.add("is-open"); });
        window.requestAnimationFrame(function () {
            try { close.focus({ preventScroll: true }); } catch (error) { close.focus(); }
        });
    }

    function boot() {
        readConfig().then(function (config) {
            // Staff turned it off: nothing to show, no matter the browser.
            if (config && config.enabled === false) return;
            var revision = revisionOf(config);
            if (alreadySeen(revision)) return;
            show(config || DEFAULTS, revision);
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", boot, { once: true });
    } else {
        boot();
    }
})();

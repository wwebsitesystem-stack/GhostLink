/*
 * Compatibility shim for the third-party game wrappers in the online catalogue.
 *
 * A Flash entry is not the game itself: it is a small wrapper page that loads
 * Ruffle and a .swf from another repository. Two things break those wrappers
 * over time:
 *
 *   1. They pin an old Ruffle nightly. The build they use (0.2.0, October 2025)
 *      can freeze the whole tab on some SWFs instead of failing cleanly. Every
 *      wrapper is moved to the current stable Ruffle here, so a new build only
 *      has to be changed in this file.
 *   2. Some SWFs are larger than jsDelivr's 20 MB limit and answer 403. The one
 *      affected game is re-pointed at raw.githubusercontent.com, which serves
 *      the same repository file with CORS and no size cap.
 *
 * The shim also gives wrappers without a <base> one pointing at the wrapper
 * itself, and adds a visible no-start message instead of leaving a silent black
 * frame. It runs on the HTML before the game frame writes it.
 */
(function () {
    "use strict";

    var RUFFLE_VERSION = "0.7.1";
    var FALLBACK_DELAY = 12000;

    // jsDelivr refuses files over 20 MB. Fancy Pants Adventure 4 Part 1 is
    // 24.8 MB, so serve that one from the upstream repository directly.
    var SWF_OVERRIDES = {
        "https://cdn.jsdelivr.net/gh/Stinkalistic/Flash-games@main/750785_fpaworld4p1.swf":
            "https://raw.githubusercontent.com/Stinkalistic/Flash-games/main/750785_fpaworld4p1.swf"
    };

    function escapeAttribute(value) {
        return String(value)
            .replace(/&/g, "&amp;")
            .replace(/"/g, "&quot;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
    }

    function rewriteRuffle(html) {
        // Matches both the script URL and the publicPath in the wrapper config.
        return html.replace(/@ruffle-rs\/ruffle@[^"'\s<>/]+/g, "@ruffle-rs/ruffle@" + RUFFLE_VERSION);
    }

    function rewriteSwfs(html) {
        Object.keys(SWF_OVERRIDES).forEach(function (from) {
            html = html.split(from).join(SWF_OVERRIDES[from]);
        });
        return html;
    }

    function ensureBase(html, sourceUrl) {
        // A wrapper's own base is deliberate; leave it alone. Adding one when
        // it is missing keeps relative scripts and assets pointed at the
        // wrapper repository instead of the parent site.
        if (!sourceUrl || /<base\b/i.test(html)) return html;
        var tag = '<base href="' + escapeAttribute(sourceUrl) + '">';
        if (/<head[^>]*>/i.test(html)) {
            return html.replace(/<head[^>]*>/i, function (match) { return match + tag; });
        }
        return tag + html;
    }

    function addParentHook(html) {
        // Some exported wrappers call a helper on the embedding page. The
        // games table does not provide it, so the call throws before the game
        // starts. Define a no-op only if it is missing.
        var hook = '<script>try{if(window.parent&&!window.parent.maeExportApis_)window.parent.maeExportApis_=function(){}}catch(e){}</script>';
        if (/<head[^>]*>/i.test(html)) {
            return html.replace(/<head[^>]*>/i, function (match) { return match + hook; });
        }
        return hook + html;
    }

    function addFallback(html) {
        var fallback = [
            '<style>',
            'html,body{margin:0;min-height:100%;background:#000}',
            '#nx-game-fallback{position:fixed;inset:0;display:none;place-items:center;z-index:2147483647;',
            'background:#05070b;color:#e8f2ff;font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;',
            'text-align:center;padding:24px}',
            '#nx-game-fallback.show{display:grid}',
            '#nx-game-fallback .nx-card{max-width:430px;border:1px solid rgba(255,255,255,.14);border-radius:14px;',
            'padding:22px 24px;background:rgba(255,255,255,.04);box-shadow:0 24px 60px rgba(0,0,0,.45)}',
            '#nx-game-fallback h2{margin:0 0 8px;font-size:16px}',
            '#nx-game-fallback p{margin:0;opacity:.72;font-size:12.5px}',
            '</style>',
            '<div id="nx-game-fallback" role="status"><div class="nx-card">',
            '<h2>This game didn&rsquo;t start</h2>',
            '<p>The original wrapper or its game file may be offline. Try another game, or open this one again later.</p>',
            '</div></div>',
            '<script>',
            '(function(){',
            'var start=Date.now(),shown=false;',
            'function visible(el){if(!el||!el.getBoundingClientRect)return false;var r=el.getBoundingClientRect();return r.width>4&&r.height>4;}',
            'function check(){',
            'var box=document.getElementById("nx-game-fallback");if(!box)return;',
            'var media=document.querySelector("ruffle-player,ruffle-object,ruffle-embed,canvas,video");',
            'var text=document.body&&document.body.innerText?document.body.innerText.trim():"";',
            'if(visible(media)||text.length>60){if(shown){box.classList.remove("show");shown=false;}return;}',
            'if(Date.now()-start>=12000&&!shown){box.classList.add("show");shown=true;}',
            '}',
            'setTimeout(check,12000);setInterval(check,3000);',
            '})();',
            '</script>'
        ].join('');
        if (/<\/body>/i.test(html)) {
            return html.replace(/<\/body>/i, fallback + '</body>');
        }
        return html + fallback;
    }

    function prepare(html, sourceUrl) {
        if (typeof html !== "string" || !html) return html;
        try {
            html = rewriteRuffle(html);
            html = rewriteSwfs(html);
            html = ensureBase(html, sourceUrl);
            html = addParentHook(html);
            html = addFallback(html);
        } catch (error) {
            // Never stop a game from loading because the shim itself failed.
            return html;
        }
        return html;
    }

    window.NexusGameCompat = {
        prepare: prepare,
        ruffle: RUFFLE_VERSION,
        fallbackDelay: FALLBACK_DELAY
    };
})();

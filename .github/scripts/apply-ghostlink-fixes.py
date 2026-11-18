#!/usr/bin/env python3
"""Apply the prepared GhostLink fixes to index.html.

The workflow that runs this commits the result, so the single-file app keeps
its shape and needs no build step. Every replacement asserts that it matched
once, which stops a half-applied change from being committed.
"""
from pathlib import Path
import re
import sys

INDEX = Path("index.html")
html = INDEX.read_text(encoding="utf-8")
original = html


def replace_once(old, new, label):
    global html
    count = html.count(old)
    if count != 1:
        sys.exit(f"apply-ghostlink-fixes: {label} matched {count} times, expected 1")
    html = html.replace(old, new, 1)


# 1. Remove the AI Terminal. It loaded a jsDelivr URL that is served as
#    text/plain, so the panel only ever showed HTML source, and it never had a
#    working backend of its own.
ends_with_newline = html.endswith("\n")
html = "\n".join(
    line for line in html.splitlines()
    if not line.strip().startswith("{ id: 'ai', name: 'AI Terminal'")
    and 'value="ai">AI Terminal</option>' not in line
)
if ends_with_newline:
    html += "\n"

replace_once("ai:'AI Terminal', ", "", "AI Terminal shortcut label")
replace_once(
    "top: ['home', 'games', 'ai', 'lucide', 'proxy'],",
    "top: ['home', 'games', 'lucide', 'proxy'],",
    "default navigation layout",
)
replace_once(
    "navOrder.top = navOrder.top.filter(id => id !== 'gnmath');\n"
    "        navOrder.bottom = navOrder.bottom.filter(id => id !== 'gnmath');",
    "navOrder.top = navOrder.top.filter(id => id !== 'gnmath' && id !== 'ai');\n"
    "        navOrder.bottom = navOrder.bottom.filter(id => id !== 'gnmath' && id !== 'ai');",
    "saved navigation layout filter",
)
html, count = re.subn(
    r"\n\s*\} else if \(page === 'ai'\) \{.*?\n\s*\} else if \(page === 'lucide'\) \{",
    "\n            } else if (page === 'lucide') {",
    html,
    count=1,
    flags=re.S,
)
if count != 1:
    sys.exit("apply-ghostlink-fixes: AI route matched %d times, expected 1" % count)
replace_once(
    "async function nav(page, appData = null) {",
    "async function nav(page, appData = null) {\n"
    "            // The AI Terminal is gone; old shortcuts and links land on Home.\n"
    "            if (page === 'ai') page = 'home';",
    "navigation entry point",
)
html = html.replace("Games, the AI terminal and the browser", "Games and the browser")

# 2. Merge the pinned catalogue (Battle Royale, Undertale, Deltarune) into the
#    online one. It ships with the site so these three never depend on the
#    remote catalogue being reachable.
replace_once(
    """                const response = await fetch(zonesURL + "?t=" + Date.now());
                zones = await response.json();
                if (!gamesLoadPopularityCache()) gamesFetchPopularity();""",
    """                const response = await fetch(zonesURL + "?t=" + Date.now());
                zones = await response.json();
                try {
                    const extraResponse = await fetch("ghostlink-extra-games.json?t=" + Date.now());
                    if (extraResponse.ok) {
                        const extraGames = await extraResponse.json();
                        if (Array.isArray(extraGames) && extraGames.length) {
                            const knownIds = new Set(zones.map(zone => String(zone.id)));
                            zones = zones.concat(extraGames.filter(zone => !knownIds.has(String(zone.id))));
                        }
                    }
                } catch (error) { /* the online catalogue still works without the pinned games */ }
                if (!gamesLoadPopularityCache()) gamesFetchPopularity();""",
    "game catalogue loader",
)

# 3. Pinned entries keep a specter: url so openZone does not treat them as
#    external links; the real wrapper URL travels in source.
replace_once(
    "            const url = gamesResolveUrl(file.url);",
    "            const url = gamesResolveUrl(file.source || file.url);",
    "game source resolution",
)

# 4. Endoparasitic needs pointer lock: its desktop port never asks for it, so
#    the cursor leaves the canvas and aiming is impossible. The helper is
#    injected into the game document, where the click counts as user activation.
helper = """        // Endoparasitic (and its sequel) are mouse-look shooters. The desktop port
        // never asks for pointer lock, so the cursor drifts out of the canvas. A
        // small in-frame helper locks the pointer on the first click and tells the
        // player how to release it.
        function gamesInjectPointerLock(html, file) {
            if (!/endoparasitic/i.test(file.name || '')) return html;
            const closeScript = '<' + '/script>';
            const helper = `
<style>
#nx-pointer-lock-hint{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:2147483647;
 padding:8px 14px;border-radius:999px;background:rgba(0,0,0,.72);color:#fff;
 font:600 12px/1.4 system-ui,sans-serif;letter-spacing:.02em;pointer-events:none;text-align:center;
 box-shadow:0 4px 18px rgba(0,0,0,.45);opacity:.94;transition:opacity .3s}
#nx-pointer-lock-hint small{display:block;font-weight:400;opacity:.7;font-size:10px}
</style>
<div id="nx-pointer-lock-hint">Click the game to lock the mouse<small>Esc releases the cursor</small></div>
<script>
(function(){
  var hint=document.getElementById('nx-pointer-lock-hint');
  var canvas=null;
  function findCanvas(){ if(!canvas||!canvas.isConnected) canvas=document.querySelector('canvas'); return canvas; }
  function setHint(text,sub){ if(!hint||!hint.isConnected) return; hint.innerHTML=text+'<small>'+sub+'</small>'; hint.style.opacity='1'; }
  document.addEventListener('pointerlockchange',function(){
    if(document.pointerLockElement){ setHint('Mouse locked','Press Esc to release'); setTimeout(function(){ if(hint) hint.style.opacity='0.25'; },1600); }
    else { setHint('Click the game to lock the mouse','Esc releases the cursor'); }
  },true);
  document.addEventListener('pointerlockerror',function(){ setHint('Mouse lock was blocked','Click the game window, then try again'); },true);
  document.addEventListener('click',function(event){
    var target=event.target;
    if(!target||!target.closest) return;
    if(target.closest('button, a, input, select, textarea')) return;
    if(!target.closest('canvas') && target!==document.body) return;
    var c=findCanvas();
    if(!c||document.pointerLockElement===c) return;
    if(c.requestPointerLock){ try{ c.requestPointerLock(); }catch(e){} }
  },true);
})();
${closeScript}`;
            const at = html.toLowerCase().lastIndexOf('</body>');
            return at === -1 ? html + helper : html.slice(0, at) + helper + html.slice(at);
        }

        async function openZone(file) {"""
replace_once(
    "        async function openZone(file) {",
    helper,
    "openZone function",
)
replace_once(
    "                const html = cleanHTML(await gamesFetchText(url));",
    "                let html = cleanHTML(await gamesFetchText(url));\n"
    "                html = gamesInjectPointerLock(html, file);",
    "game HTML loader",
)
replace_once(
    '            <iframe id="zoneFrame"></iframe>',
    '            <iframe id="zoneFrame" allow="pointer-lock; fullscreen; gamepad; autoplay"></iframe>',
    "game frame",
)
replace_once(
    """                zoneFrame = document.createElement('iframe');
                zoneFrame.id = 'zoneFrame';
                zoneViewer.appendChild(zoneFrame);""",
    """                zoneFrame = document.createElement('iframe');
                zoneFrame.id = 'zoneFrame';
                zoneFrame.setAttribute('allow', 'pointer-lock; fullscreen; gamepad; autoplay');
                zoneViewer.appendChild(zoneFrame);""",
    "dynamic game frame",
)

if html == original:
    print("apply-ghostlink-fixes: nothing to do (already applied)")
else:
    INDEX.write_text(html, encoding="utf-8")
    print("apply-ghostlink-fixes: index.html updated")

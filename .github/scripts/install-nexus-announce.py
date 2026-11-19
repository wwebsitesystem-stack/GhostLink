#!/usr/bin/env python3
"""Install the Nexus Social launch pop-up on GhostLink.

`index.html` is far too large to edit without a full checkout, so this script
patches it here, from the copy the workflow already checked out. Every edit is
guarded by its anchor and is idempotent, so re-running is safe.
"""
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
POPUP_URL = "https://textnexus.me/nexus-announce.js?v=2026-11-19-social-controls"
SCRIPT_TAG = '    <script src="nexus-announce.js?v=2026-11-19-social-controls" defer></script>\n'

OLD_STAFF = r"var STAFF_PAGES = /^\/(?:admin|owner|system-console|nexus_admin_control_center|system_analytics_health|admin-chat-migration|email-manager|secret1|testing)\.html$/i;"
NEW_STAFF = r"var STAFF_PAGES = /(?:^|\/)(?:admin|owner|system-console|nexus_admin_control_center|system_analytics_health|admin-chat-migration|email-manager|secret1|testing)\.html$/i;"

changed = []


def read(name):
    return (ROOT / name).read_text(encoding="utf-8")


def write(name, text):
    (ROOT / name).write_text(text, encoding="utf-8")
    if name not in changed:
        changed.append(name)


def require_once(text, anchor, label):
    count = text.count(anchor)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one anchor, found {count}")


# ---- the pop-up itself -------------------------------------------------
# Same file the Nexus site serves; only the staff-page check gains a leading
# directory segment so `/GhostLink/system-console.html` is recognised.
request = urllib.request.Request(POPUP_URL, headers={"User-Agent": "GhostLink-Announce/1.0"})
source = urllib.request.urlopen(request, timeout=30).read().decode("utf-8")
if "system/announcement" not in source:
    raise SystemExit("nexus-announce.js download did not contain the live notice")
if OLD_STAFF in source:
    source = source.replace(OLD_STAFF, NEW_STAFF, 1)
elif NEW_STAFF not in source:
    raise SystemExit("nexus-announce.js staff-page guard changed unexpectedly")
write("nexus-announce.js", source)

# ---- pages that should show it ----------------------------------------
for name, anchor in (
    ("index.html", '    <script type="module" src="system.js?v=2026-11-16"></script>'),
    ("feedback.html", "    <script>\n        (function () {"),
):
    page = read(name)
    if "nexus-announce.js" in page:
        continue
    require_once(page, anchor, name)
    write(name, page.replace(anchor, SCRIPT_TAG + anchor, 1))

# ---- GhostLink admin console ------------------------------------------
console = read("system-console.html")
if 'id="announce-save"' not in console:
    markup_anchor = '''            <section>
                <div class="row-head">
                    <div>
                        <h2>Global refresh</h2>'''
    markup = '''            <section>
                <div class="row-head">
                    <div>
                        <h2>Nexus Social pop-up</h2>
                        <p class="hint">The launch notice on the GhostLink app. Saves <code>system/announcement</code>, the same node the Nexus console edits, so neither site needs a deploy.</p>
                    </div>
                    <span id="announce-pill" class="pill">default copy</span>
                </div>
                <div class="switch-row">
                    <div>
                        <h3>Show the pop-up</h3>
                        <p>Off hides it for everyone on the next page load.</p>
                    </div>
                    <label class="switch">
                        <input id="announce-toggle" type="checkbox" aria-label="Show the Nexus Social pop-up">
                        <span aria-hidden="true"></span>
                    </label>
                </div>
                <label class="field" for="announce-kicker" style="margin-top:14px">Kicker</label>
                <input id="announce-kicker" type="text" maxlength="80" placeholder="Nexus Social &middot; Coming soon">
                <label class="field" for="announce-title" style="margin-top:12px">Headline</label>
                <input id="announce-title" type="text" maxlength="160" placeholder="Nexus is making its very own social media website!">
                <label class="field" for="announce-body" style="margin-top:12px">Message</label>
                <textarea id="announce-body" rows="3" maxlength="400" placeholder="We will have everything just like other companies like TikTok, Instagram, Facebook, YouTube."></textarea>
                <div class="actions">
                    <button id="announce-save" class="btn primary" type="button">Save &amp; publish</button>
                    <button id="announce-defaults" class="btn" type="button">Load default copy</button>
                    <span id="announce-msg" class="inline-msg" role="status" aria-live="polite"></span>
                </div>
                <p class="hint" style="margin-top:10px">Saving shows the pop-up again to everyone, including people who dismissed the last message.</p>
            </section>

'''
    require_once(console, markup_anchor, "system-console.html markup")
    console = console.replace(markup_anchor, markup + markup_anchor, 1)

    helpers = '''        /* ---- Nexus Social pop-up ---- */

        const ANNOUNCE_DEFAULTS = {
            kicker: "Nexus Social · Coming soon",
            title: "Nexus is making its very own social media website!",
            body: "We will have everything just like other companies like TikTok, Instagram, Facebook, YouTube."
        };
        const announceToggle = $("announce-toggle"), announceKicker = $("announce-kicker");
        const announceTitle = $("announce-title"), announceBody = $("announce-body");
        let announceDirty = false;

        function announceText(value, fallback) {
            return typeof value === "string" && value.trim() ? value.trim() : fallback;
        }

        function renderAnnouncePill(config) {
            const pill = $("announce-pill");
            if (config && config.enabled === false) {
                pill.textContent = "hidden";
                pill.className = "pill";
                return;
            }
            pill.textContent = config ? "live" : "default copy";
            pill.className = "pill live";
        }

        function fillAnnouncement(state) {
            const config = state && state.announcement && typeof state.announcement === "object"
                ? state.announcement
                : null;
            announceToggle.checked = config ? config.enabled !== false : true;
            announceKicker.value = announceText(config && config.kicker, ANNOUNCE_DEFAULTS.kicker);
            announceTitle.value = announceText(config && config.title, ANNOUNCE_DEFAULTS.title);
            announceBody.value = announceText(config && config.body, ANNOUNCE_DEFAULTS.body);
            announceDirty = false;
            renderAnnouncePill(config);
        }

        function markAnnounceDirty() {
            announceDirty = true;
            const pill = $("announce-pill");
            pill.textContent = "unsaved";
            pill.className = "pill";
        }

'''
    webhook_anchor = "        /* ---- webhook ---- */"
    require_once(console, webhook_anchor, "system-console.html helpers")
    console = console.replace(webhook_anchor, helpers + webhook_anchor, 1)

    auth_anchor = '''            await loadConfig();
            fillForm(live);
        });'''
    require_once(console, auth_anchor, "system-console.html auth")
    console = console.replace(auth_anchor, '''            await loadConfig();
            fillForm(live);
            fillAnnouncement(live);
        });''', 1)

    live_anchor = '''            live = snapshot.val() || {};
            if (!dirty) fillForm(live);'''
    require_once(console, live_anchor, "system-console.html live")
    console = console.replace(live_anchor, '''            live = snapshot.val() || {};
            if (!dirty) fillForm(live);
            if (!announceDirty) fillAnnouncement(live);''', 1)

    input_anchor = '''        [bannerToggle, bannerMessage, bannerTone].forEach((element) =>
            element.addEventListener("input", () => setDirty(true)));'''
    require_once(console, input_anchor, "system-console.html inputs")
    console = console.replace(input_anchor, input_anchor + '''
        [announceToggle, announceKicker, announceTitle, announceBody].forEach((element) =>
            element.addEventListener("input", markAnnounceDirty));''', 1)

    save_handler = '''        $("announce-save").addEventListener("click", async () => {
            if (!user) return;
            const enabled = announceToggle.checked;
            const title = announceTitle.value.trim();
            const body = announceBody.value.trim();
            if (enabled && (!title || !body)) {
                $("announce-msg").textContent = "A headline and a message are required while the pop-up is on.";
                $("announce-msg").className = "inline-msg error";
                return;
            }
            const button = $("announce-save");
            button.disabled = true;
            $("announce-msg").textContent = "Saving...";
            $("announce-msg").className = "inline-msg";
            try {
                const announcement = {
                    enabled: enabled,
                    kicker: (announceKicker.value.trim() || ANNOUNCE_DEFAULTS.kicker).slice(0, 80),
                    title: (title || ANNOUNCE_DEFAULTS.title).slice(0, 160),
                    body: (body || ANNOUNCE_DEFAULTS.body).slice(0, 400),
                    updatedAt: Date.now(),
                    updatedBy: user.email || ""
                };
                await update(systemRef, { announcement });
                await push(ref(db, "nexus/audit_logs"), {
                    action: "ANNOUNCEMENT_UPDATE",
                    adminEmail: user.email || "",
                    timestamp: Date.now(),
                    details: `${enabled ? "on" : "off"}: ${announcement.title}`.slice(0, 200)
                }).catch(() => {});
                fillAnnouncement({ announcement });
                $("announce-msg").textContent = enabled
                    ? "Saved — the pop-up shows on the next GhostLink page load."
                    : "Saved — the pop-up is hidden for everyone.";
                $("announce-msg").className = "inline-msg ok";
            } catch (error) {
                $("announce-msg").textContent = `Could not save: ${error?.code || error?.message}`;
                $("announce-msg").className = "inline-msg error";
            } finally {
                button.disabled = false;
            }
        });

        $("announce-defaults").addEventListener("click", () => {
            announceKicker.value = ANNOUNCE_DEFAULTS.kicker;
            announceTitle.value = ANNOUNCE_DEFAULTS.title;
            announceBody.value = ANNOUNCE_DEFAULTS.body;
            markAnnounceDirty();
            $("announce-msg").textContent = "Default copy loaded — save to publish it.";
            $("announce-msg").className = "inline-msg";
        });

'''
    reload_anchor = '''        $("reload").addEventListener("click", () => {
            fillForm(live);'''
    require_once(console, reload_anchor, "system-console.html reload")
    console = console.replace(reload_anchor, save_handler + '''        $("reload").addEventListener("click", () => {
            fillForm(live);
            fillAnnouncement(live);''', 1)

    write("system-console.html", console)

print("changed: " + (", ".join(changed) if changed else "nothing (already installed)"))

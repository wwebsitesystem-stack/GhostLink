# GhostLink

> **Nexus is back up Monday at 9:50 AM CT.** Nexus returns on its new domain,
> `textnexus.dev`, with `textnexus.me` alongside it. GhostLink comes back at the
> same time; nothing has been deleted.

Single-page proxy browser. `index.html` is the whole app; `global-refresh-client.js`
adds the Google account and the Firebase-backed global refresh.

- `index.html` — the app, served at the site root: proxy browser, apps, settings,
  cloud account. Defaults to the blue `#6ecbff` accent on black, with a saved theme
  from Settings overriding it.
- `ghostlink.html` — a small redirect to the root, kept so older links to
  `/ghostlink.html` still land on the app.
- `global-refresh-client.js` — Google account and Firebase global refresh.

The tutoring front that briefly sat in front of the proxy (the role-picker cover and
`teacher.html`) is gone. It is still in git history at `4988bd1` if it is ever wanted.

## Sign-in required

GhostLink opens on a full-screen sign-in gate. Nothing behind it is reachable
until a Google account is signed in, and signing out brings the gate back.

- The gate lives in `index.html` and mirrors the session that
  `global-refresh-client.js` already owns (the `ghostlink-cloud` event and
  `window.GhostLinkCloud.getState()`); it reads `signedIn`, `ready`, `error` and
  `notice` from that state.
- If Google sign-in cannot load at all (offline, blocked `gstatic.com`, or a
  domain that is not authorised in Firebase), the gate stays up and says so —
  there is no guest path through it.
- Like the staff gate, this is a client-side gate: anyone who edits the page in
  devtools can uncover the UI. Hosting-level access control (for example
  Cloudflare Access) and the Realtime Database rules are the real gate.

## Cloud account + global refresh

Uses the existing **nexus-web-development-official** Firebase project (the same
one as TextNexus), so one Google account covers both.

### Files to deploy

Upload all of them to the same folder:

- `index.html`
- `ghostlink.html`
- `global-refresh-client.js`

`index.html` loads the module as `./global-refresh-client.js`, so the app and the
module have to sit in the same folder.

### Firebase console checklist

1. **Authentication → Sign-in method** — Google must be enabled (it already is
   for the Nexus account).
2. **Authentication → Settings → Authorized domains** — `textnexus.dev` and
   `textnexus.me` plus any other host that serves GhostLink (for example
   `wwebsitesystem-stack.github.io`).
3. **Realtime Database → Rules** — add the blocks below **inside** the existing
   rules. Do not replace the whole tree: the `nexus` rules power the site and
   the system console.

```json
{
  "rules": {
    "users": {
      "$uid": {
        "ghostlink": {
          ".read": "auth != null && auth.uid === $uid",
          ".write": "auth != null && auth.uid === $uid"
        }
      }
    },
    "presence": {
      "ghostlink": {
        ".read": "auth != null",
        "$tab": {
          ".write": "auth != null && (!newData.exists() || newData.child('uid').val() === auth.uid)"
        }
      }
    }
  }
}
```

If the rules already contain a `users` node, add the `ghostlink` child inside it
instead of duplicating `users`. `system/refresh` keeps whatever rule the
TextNexus console already uses — GhostLink only reads it (public read is enough)
and staff accounts write it.

### What gets saved

Sign in from the sidebar avatar or **Settings → Cloud Account**. GhostLink mirrors
these localStorage keys to `users/<uid>/ghostlink/data/<key>` as `{ v, t }`
(newest timestamp wins, per key):

```
ghostlink_apps            ghostlink_shortcuts      ghostlink_config
ghostlink_nav_order       ghostlink_words          ghostlink_custom_presets
gl_shortcuts              gl_search_engine         proxServer
wispAutoswitch            proxyMaxTabs             customWisps
proxyBookmarks            afkCloakEnabled          afkCloakTimeout
gl_cloak_page             gl_cloak_content         gl_cloak_mouseleave
gl_cloak_vischange        gn-favs                  gl_achievements
```

Device counters and caches (`gl_visit_count`, `gn-popularity-v1`,
`ghostlink_seen_commit`, …) stay local. Every existing save path is captured by a
`Storage.prototype` hook, so no call sites had to change. On first sign-in the
local state uploads; on later sign-ins the newest value per key wins and the page
reloads once so the app boots with the account's data. **Factory reset** also
deletes the cloud copy.

Open tabs are recorded at `presence/ghostlink/<tabId>` (20s heartbeat,
`onDisconnect` cleanup) and the settings card shows how many GhostLink tabs are
signed in.

### Global refresh

`system/refresh` holds a millisecond token. A tab adopts the current token when
it loads and reloads once when the token changes — same contract as
`realtime-refresh.js` on the Nexus site, so:

- **TextNexus → System panel → Global refresh** reloads every open GhostLink tab
  as well as every Nexus tab.
- Staff signed into GhostLink can do the same from **Settings → Cloud Account →
  Global Refresh**.

Staff list (client-side gate; database rules are the real gate) lives in
`STAFF` at the top of `global-refresh-client.js`.

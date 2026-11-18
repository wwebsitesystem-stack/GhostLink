/*
 * Bundled games for GhostLink.
 *
 * The games table in index.html reads the online catalogue only. This module
 * adds the entries from games/catalog.js in front of it, the same way the
 * TextNexus copy of GhostLink does, so a game can ship with the app instead of
 * depending on the CDN catalogue. It is imported from system.js; if anything
 * fails, the online catalogue is left untouched.
 */

let installed = false;

function addLocalGames(localGames) {
    // `zones` is the games table's catalogue array, declared by the classic
    // script in index.html. It is a global lexical binding, not window.zones.
    if (typeof zones === "undefined" || !Array.isArray(zones)) return;

    // A card opens `source` when both fields exist, so a bundled game has to
    // point that at its own file instead of at the upstream project page.
    const entries = localGames.map((game) => (
        game.local ? Object.assign({}, game, { source: game.url }) : game
    ));

    const replaced = new Set(
        entries
            .filter((game) => game.replaces !== undefined)
            .map((game) => String(game.replaces))
    );
    const kept = zones.filter((zone) => !replaced.has(String(zone.id)));
    const known = new Set(kept.map((zone) => String(zone.id)));
    const missing = entries.filter((game) => !known.has(String(game.id)));

    if (!missing.length && kept.length === zones.length) return;

    zones = missing.concat(kept);
    if (typeof window.gamesSetupFeatured === "function") window.gamesSetupFeatured();
    if (typeof window.gamesHandleSearch === "function") window.gamesHandleSearch();
}

async function install() {
    if (installed) return;
    if (!document.getElementById("gamesContainer")) return;
    if (typeof window.gamesListZones !== "function") return;
    installed = true;

    await import("./catalog.js");
    const localGames = Array.isArray(window.NEXUS_GAMES) ? window.NEXUS_GAMES : [];
    if (!localGames.length) return;

    const listZones = window.gamesListZones;
    window.gamesListZones = async function (...args) {
        await listZones.apply(this, args);
        try {
            addLocalGames(localGames);
        } catch (error) {
            console.warn("GhostLink bundled games could not be added:", error && error.message);
        }
    };

    // The games tab may already have been opened before this module ran.
    addLocalGames(localGames);
}

install().catch((error) => {
    console.warn("GhostLink bundled games unavailable:", error && error.message);
});

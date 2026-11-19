/* Bundled game library for GhostLink.
 *
 * Read by games/local-games.js, which puts these entries in front of the
 * online catalogue. Keep the shape in sync with textnexus.me's games/catalog.js.
 */
window.NEXUS_GAMES = [
    {
        "id": "nx-papers-pls",
        "name": "Papers Pls",
        "genre": "Simulation",
        "cover": "games/covers/papers-pls.svg",
        "url": "games/arcade/papers-pls.html",
        "local": true,
        "singleFile": true,
        "folder": "games/arcade",
        "author": "TextNexus",
        "license": "MIT",
        "source": "https://github.com/wwebsitesystem-stack/textnexus.me",
        "replaces": 187
    },
    {
        "id": "nx-super-liquid-soccer",
        "name": "Super Liquid Soccer",
        "genre": "Sports",
        "cover": "games/covers/super-liquid-soccer.svg",
        "url": "games/super-liquid-soccer/index.html",
        "local": true,
        "singleFile": false,
        "folder": "games/super-liquid-soccer",
        "author": "Punyrobot",
        "license": "Free to play (bundled)",
        "source": "https://poki.com/en/g/super-liquid-soccer",
        "replaces": 1510
    }
];

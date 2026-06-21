# Brawler — game + map editor

Vite project for the pixel brawler. Builds into `../public/brawler/`, which the
site deploys as-is (Vercel `outputDirectory: "public"`), so deploy is unchanged —
just build first.

## Develop

```
cd game
npm install      # first time
npm run dev      # http://localhost:5173/brawler/  (game)
                 # http://localhost:5173/brawler/editor.html  (editor)
```

Hot-module reload is on: edit `src/*.js` and the page updates instantly.

## Build (before deploying)

```
npm run build    # writes ../public/brawler/  (game, editor, maps, hashed assets)
```

Then deploy the site the usual way (the build output is plain static files).

## How maps work

Maps are **data, not code** — JSON files in `public/maps/*.json`:

```json
{ "name": "arena1", "cols": 64, "rows": 36, "cell": 20,
  "tiles": ["....#=....", "..."] }
```

One character per grid cell: `.` empty · `#` solid · `=` one-way ledge · `S` spawn.

- The **game** loads `?map=NAME` (default `arena1`) via `fetch`, or `?map=__draft`
  to play the editor's current draft from `localStorage`.
- The **editor** (`editor.html`) paints tiles / stamps prefab pieces, and **Save**
  writes JSON straight into `public/maps/` via the File System Access API
  (download fallback on unsupported browsers). **Play** opens the game on the
  current draft.

`src/stage.js` is the shared core (tile types, `buildColliders`, `findSpawns`,
`serializeMap`) imported by both, so they can't disagree on the format.

## How characters work

Same pattern as maps — characters are **JSON sprites** in `public/chars/*.json`:

```json
{ "name": "striker", "w": 16, "h": 24,
  "palette": ["#246b61", "#54e0c8"],
  "pixels": ["................", "....."] }
```

16×24 px = 2 map-cubes wide × 3 tall (8px per cube). Each pixel char is `.`
(transparent) or a base-62 index into `palette` — full color, compact files.

- The **game** gives each roster character a sprite if `chars/<key>.json` exists,
  else falls back to the wireframe box. `?char=__draft` shows the creator's draft
  on the player's fighter. Sprites flip with facing and scale onto the physics box.
- The **creator** (`creator.html`) is a pixel editor: full color picker, paint /
  erase / eyedropper, pan/zoom, live x6 + in-game previews. **Save** writes JSON
  into `public/chars/`; **Play** opens the game on the current draft.

`src/char.js` is the shared core (`getPixel`/`setPixel`, `makeSpriteCanvas`,
`serializeChar`).

## Multiplayer (WebSockets via PartyKit)

Up to 8-player free-for-all. The client stays on Vercel; the WebSocket server
runs on Cloudflare via **PartyKit** (Vercel can't host persistent sockets).

Model: **client relay + interpolation**. Each client simulates its own fighter
(zero input lag), sends ~20Hz snapshots, and interpolates remotes ~100ms behind.
Hits are **attacker-authoritative** — the attacker sends a `hit` event, the
victim applies it. The host also simulates CPU fighters.

```
src/mp.js          multiplayer client (lobby UI + PartySocket + engine bridge)
lobby.html         multiplayer page (lobby overlay over the game canvas)
partykit/server.js room server: roster, host election, snapshot/hit relay
partykit.json      PartyKit config
```

### Local multiplayer dev
```
npm run party      # PartyKit dev server on localhost:1999
npm run dev        # client on http://localhost:5173/brawler/lobby.html
```
Open the lobby in two browser windows (same `?room=CODE`) to test. The client
defaults to `localhost:1999`; override with `VITE_PARTY_HOST` (see .env.example).

### Deploy
```
# 1. server (needs a free Cloudflare account; interactive login first time)
npm run deploy:party          # -> wss://brawler.<you>.partykit.dev

# 2. client — point it at the deployed server, then build for Vercel
echo "VITE_PARTY_HOST=brawler.<you>.partykit.dev" > .env
npm run build                 # -> ../public/brawler
# then deploy the site (public/) as usual
```

## Files

```
src/stage.js    shared map format + geometry
src/char.js     shared sprite format + rendering
src/game.js     engine (physics, combat, camera, render)
src/main.js     solo entry            src/mp.js       multiplayer client
src/editor.js   visual map editor      src/creator.js  pixel character editor
src/net? (folded into mp.js)          partykit/server.js  WS room server
index.html  game   editor.html  editor   creator.html  creator   lobby.html  multiplayer
public/maps/    map JSON files         public/chars/  character JSON files
```

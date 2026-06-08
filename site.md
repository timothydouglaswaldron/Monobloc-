# Monobloc.online — Working Context

Context/handoff notes for Claude. This is a **no-build static site** (plain HTML/CSS/JS).

## Where things are

- **Local project root:** `C:\Users\timot\Skiller\monobloc-site` (Git Bash: `~/Skiller/monobloc-site`)
- **Served directory:** `public/` (everything user-facing lives here)
- **Live URL:** https://monobloc-site.vercel.app
- **Not a git repo.** Source was recovered from the Vercel deployment via the API (see below). There is no GitHub remote.

## Vercel

- Logged-in CLI user: `timothydouglaswaldron-6015`
- Team / org id: `team_Clkpuph7Lj3MBbesbmDCDmkc`
- Project: `monobloc-site` (id `prj_ckSMpZ2zAZAg7v3u5hVhs6neIPYb`)
- Auth token file (Windows): `C:\Users\timot\AppData\Roaming\com.vercel.cli\Data\auth.json`

### Deploy to production
```bash
cd ~/Skiller/monobloc-site && vercel --prod --yes
```
`vercel.json` has `outputDirectory: public`, `cleanUrls: true`, `trailingSlash: true`, redirect rules for old Webflow URLs, and cache headers. Production auto-aliases to `monobloc-site.vercel.app`.
**Always confirm with the user before deploying.**

### How the source was recovered (CLI-only deploy, no git)
List files: `GET https://api.vercel.com/v6/deployments/<dpl_id>/files?teamId=<team>`
Each file: `GET https://api.vercel.com/v7/deployments/<dpl_id>/files/<uid>?teamId=<team>` → returns `{"data":"<base64>"}`. Get `<dpl_id>` from `vercel inspect <deployment-url>`.

## CRITICAL: cache-busting on every asset change

Vercel serves `/assets/*` with `Cache-Control: max-age=31536000, immutable`. So **whenever you edit `public/assets/styles.css` or `public/assets/keynav.js`, bump the `?v=N` query in ALL html files**, or returning visitors get stale assets.

Current version: **v35**. Bump command (replace 35/36 — note `demos.js`/`admin.js` are also versioned, and `admin/index.html` is in the list now):
```bash
cd ~/Skiller/monobloc-site/public && sed -i 's#styles\.css?v=35#styles.css?v=36#; s#keynav\.js?v=35#keynav.js?v=36#; s#demos\.js?v=35#demos.js?v=36#; s#admin\.js?v=35#admin.js?v=36#' 404.html index.html live/index.html media/index.html shop/index.html demos/index.html admin/index.html
```

## File structure (under `public/`)

- `index.html` — CRT homepage: logo + nav (Live, Media, Shop, Demos). Has page-specific `<style>` inline (logo flicker etc.). **Boot-up animation was removed.**
- `live/index.html` — Bandsintown widget (artist `id_15540670`).
- `media/index.html` — Spotify / Apple / YouTube / Instagram links.
- `shop/index.html` — merch grid, 3 placeholder products with Stripe Payment Link hrefs (`#stripe-*`, not yet real).
- `demos/index.html` — **password-gated** page (see below). Tracklist + video viewer + per-track guest notes. Has an inline `window.DEMOS` array used **only as fallback** when the CMS/KV isn't reachable.
- `admin/index.html` — **Demos CMS console** (not linked in nav). Server-password login → manage tracks + moderate notes. noindex.
- `404.html`, `_redirects` (Netlify/CF format; Vercel uses `vercel.json`).
- `assets/styles.css` — all shared styles, design tokens at top (`:root`). Font `--font-display` = **PP Mondwest** (self-hosted woff2 in `assets/fonts/`). Includes `.demos*`, `.notes*`, `.admin*` blocks at the end.
- `assets/keynav.js` — two IIFEs: (1) arrow-key JRPG nav (SELECTORS includes `.demo-track`), (2) the RPG dialogue system.
- `assets/demos.js` — Demos page engine: loads tracks from `/api/tracks` (falls back to inline `window.DEMOS`), renders video + per-track notes, posts notes to `/api/notes`.
- `assets/admin.js` — admin console logic (login via `x-admin-key` header, track CRUD, note moderation).

## Demos CMS backend (serverless + Redis) — added v33

The Demos page is backed by **Vercel Serverless Functions** (`/api/*` at repo root, NOT in `public/`) + an **Upstash Redis** store (a.k.a. Vercel KV) + **Vercel Blob** (self-hosted demo videos). The `public/` frontend is still no-build; the **functions now have ONE npm dep** (`@vercel/blob`) declared in the repo-root `package.json`, so Vercel runs `npm install` for the functions on deploy (no build script — `outputDirectory: public` is unchanged).

- `api/_redis.js` — tiny Redis REST client. Reads creds from `KV_REST_API_URL`/`KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN`). Underscore prefix = not routed, but importable.
- `api/tracks.js` — **public** `GET` → published tracklist. Returns `{configured:false}` if no KV, so the page falls back to inline `window.DEMOS`.
- `api/notes.js` — **public**. `GET ?track=<id>` → notes for a track (newest first). `POST {track, body}` → **auto-publishes** the note (201) unless it contains a slur (422). Guardrails: 500-char cap, per-IP rate limit (5/60s via Redis INCR+EXPIRE), 500-note cap per track.
- `api/_filter.js` — slur blocklist used by notes.js. Normalizes leetspeak/accents/spacing to resist evasion; double-g rule avoids the country "Niger"/"Nigeria"; short collision-prone slurs matched whole-word only. Edit the `WORD_SLURS`/`SUBSTRING_RE` lists to tune.
- `api/admin.js` — **password-gated** (`x-admin-key` header, constant-time compared to `ADMIN_PASSWORD` env). Actions: `verify`, `listTracks`, `saveTrack`, `deleteTrack`, `reorder`, `pending`, `approveNote`, `rejectNote`, `deleteNote`.
- **Per-track media:** each track can have a **video** (`src`, shown in the `<video>` player) and a **song** (`audio`, shown under the video as an `<audio>` player + a "download song" link that appends `?download=1` to force a Blob attachment download). Both are uploaded via `/api/upload/` (video → `demos/` prefix, song → `songs/` prefix). Audio accepts mp4/wav/mp3/m4a/aac/ogg/flac.
- `api/upload.js` — **admin-gated** Vercel Blob client-upload token issuer (uses `@vercel/blob` `handleUpload`). The admin password is sent as `clientPayload` and verified in `onBeforeGenerateToken`; allow-list = mp4/webm/mov/ogg, 1 GB cap, random filename suffix. The browser uploads **directly to Blob** (file never hits the function → no 4.5 MB body limit). Returns the public `blob.url`, which the admin saves onto a track's `src`. Needs env `BLOB_READ_WRITE_TOKEN` (auto-injected when a Blob store is connected). Client SDK is lazy-imported in admin.js from `https://esm.sh/@vercel/blob@2/client`.

**Redis keys:** `mb:tracks` (JSON array of `{id,title,description,youtube,vimeo,src,poster}`), `mb:notes:<trackId>` (public notes `{id,body,ts}`, newest first), `mb:pending` (legacy moderation queue — unused now that notes auto-publish), `mb:rl:<ip>` (rate-limit counter).

**Notes auto-publish** (changed from approval-queue at the user's request): a POST goes straight to `mb:notes:<track>`. The only gate is the slur filter. The `/admin` "notes awaiting approval" panel is now vestigial (nothing new lands in `mb:pending`); `deleteNote` is still the way to remove a published note via API.

### Setup status — ✅ DONE (live as of v35, June 2026)
The store and env vars are configured. **Did NOT use Vercel's Storage marketplace** (it hides the free tier) — created the Redis DB **directly at console.upstash.com** (Free Tier, us-east-1, db name "monobloc demos", endpoint `strong-warthog-142859.upstash.io`) and set the REST creds as Vercel env vars manually via CLI:
- `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (all environments)
- `ADMIN_PASSWORD` (all environments) — the `/admin` login. Stored encrypted in Vercel; not recorded here.

`vercel env ls` lists all three. `/api/tracks/` returns `configured:true`. Log in at `monobloc.online/admin/` to add tracks + moderate notes.

**Blob (video hosting) setup — one dashboard step:** Vercel dashboard → project `monobloc-site` → **Storage → Create → Blob** → connect to project. This auto-injects `BLOB_READ_WRITE_TOKEN`. Then redeploy. Until then `/api/upload/` returns 503 and the admin "upload video" button says "blob storage not set up yet." ⚠️ Self-hosted video = metered Blob bandwidth on every play; compress before upload (720p H.264). Blob public URLs are unguessable but not access-controlled (same protection level as the client-side demos gate).

**Note:** all frontend API calls use **trailing-slash** paths (`/api/tracks/`, `/api/notes/`, `/api/admin/`) because `trailingSlash:true` in vercel.json 308-redirects non-slash API paths. Keep the slashes.

`ADMIN_PASSWORD` is server-side only — the admin gate is **real** auth (unlike the client-side `Dean` demos gate). If creds are ever missing, the Demos page still works (inline fallback list) and notes show offline.

## RPG dialogue system (in keynav.js + styles.css)

Reusable `.rpg-dialogue` overlay: black box, **1px white border, no outer glow**, opacity-only CRT flicker, typewriter reveal with a thin `▏` caret. Boxes were **shrunk 20%** (max width 304px, font clamp `0.84–1.12rem`).

- **Shop link** → intercepts click, shows message **"the shop is closed.."** (no navigation). Dismiss on click/Enter/Esc.
- **Demos link** → shows a **password prompt**. Password is **`Dean`** (case-sensitive, constant `DEMO_PASSWORD` in keynav.js).
  - Has an explicit **"Enter" submit button** (right corner, 40px tap target) for mobile/a11y, plus keyboard submit.
  - Correct → `sessionStorage.setItem('demosUnlocked','1')` then navigate to `/demos/`.
  - Wrong → "access denied.." + shake, clears input.
  - `/demos/index.html` has a `<head>` gate script: if `sessionStorage.demosUnlocked !== '1'`, `location.replace('/')`. **This is client-side only — not real security** (password is visible in source). Real protection would need a serverless function.

## Fonts
- `--font-display` = **PP Mondwest** (self-hosted) — site-wide default.
- `--font-mono` = **Proto Mono → IBM Plex Mono** fallback. ⚠️ **Proto Mono is NOT self-hosted** (no woff2 in `assets/fonts/`), so it currently renders as **IBM Plex Mono** (Google Fonts). To use real Proto Mono, drop the `.woff2` into `assets/fonts/` and add an `@font-face` for `'Proto Mono'`.
- **Demos page is all-mono:** `demos/index.html` `<body class="page-demos">` + rule `body.page-demos { --font-display: var(--font-mono); }` remaps every font on that page (title, tracklist, navbar, notes) to the mono stack, scoped to the demos page only. Other pages stay on PP Mondwest.

## Other notable styling

- **Navbar links** (`.navbar__links .btn-ghost`) scaled to **50%** of base nav size; gap tightened. Shop "Buy" buttons (also `.btn-ghost`) intentionally NOT affected.
- **Bandsintown widget** forced to site font via `.bit-widget, .bit-widget * { font-family: var(--font-display) !important; }`. Works because the widget renders **inline DOM** (not sealed in an iframe).

## Local preview (Claude_Preview MCP)

- The preview tool reads `launch.json` from the **working dir** `C:\Users\timot` (NOT the project). A config named **`monobloc-static`** was added to `C:\Users\timot\.claude\launch.json` → `python -m http.server 8765 --directory C:/Users/timot/Skiller/monobloc-site/public`.
- Start: `preview_start` name `monobloc-static`. Note the python server does NOT honor `cleanUrls`/`trailingSlash`, but `/demos/` etc. serve `index.html` fine.

### Gotchas
- `preview_screenshot` sometimes times out because of the infinite CRT flicker animations — retry, or rely on `preview_eval` computed-style checks.
- The dialogue module has a module-scoped `open` flag. If you remove a `.rpg-dialogue` via DOM in `preview_eval` (instead of its own close), `open` stays `true` and further triggers are blocked — **reload the page to reset**.
- Preview occasionally drifts back to `/` — re-navigate explicitly before inspecting.

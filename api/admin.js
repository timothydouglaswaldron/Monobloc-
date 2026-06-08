/* POST /api/admin — all admin actions, behind a server-checked password.
   The admin page sends the password in the `x-admin-key` header; it is
   compared (constant-time) against the ADMIN_PASSWORD env var. Nothing here
   works until ADMIN_PASSWORD is set in the Vercel project.

   Actions (in JSON body { action, ... }):
     verify                         → 200 if the key is valid
     listTracks                     → { tracks } (full objects)
     saveTrack   { track }          → upsert a track (by id; new id if absent)
     deleteTrack { id }             → remove a track + its notes
     reorder     { order:[ids] }    → set tracklist order
     pending                        → { pending } notes awaiting approval
     approveNote { id }             → move a pending note into its track's list
     rejectNote  { id }             → discard a pending note
     deleteNote  { trackId, id }    → remove an already-approved note
*/
const crypto = require('crypto');
const { getJSON, setJSON, configured } = require('./_redis');

const genId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function authed(req) {
  const pw = process.env.ADMIN_PASSWORD || '';
  if (!pw) return false;
  const key = String(req.headers['x-admin-key'] || '');
  const a = Buffer.from(key);
  const b = Buffer.from(pw);
  if (a.length !== b.length) return false;
  try { return crypto.timingSafeEqual(a, b); } catch (_) { return false; }
}

const str = (v, max) => String(v == null ? '' : v).slice(0, max);

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  if (!process.env.ADMIN_PASSWORD) return res.status(503).json({ error: 'admin_not_configured' });
  if (!authed(req)) return res.status(401).json({ error: 'unauthorized' });
  if (!configured()) return res.status(503).json({ error: 'kv_unavailable' });

  const body = req.body || {};
  const action = String(body.action || '');

  try {
    switch (action) {
      case 'verify':
        return res.status(200).json({ ok: true });

      case 'listTracks': {
        const tracks = await getJSON('mb:tracks', []);
        return res.status(200).json({ tracks });
      }

      case 'saveTrack': {
        const t = body.track || {};
        const title = str(t.title, 200).trim();
        if (!title) return res.status(400).json({ error: 'title_required' });
        const clean = {
          id: t.id ? String(t.id) : genId(),
          title,
          description: str(t.description, 4000),
          youtube: str(t.youtube, 300).trim(),
          vimeo: str(t.vimeo, 300).trim(),
          src: str(t.src, 800).trim(),
          audio: str(t.audio, 800).trim(),
          poster: str(t.poster, 500).trim(),
        };
        const tracks = await getJSON('mb:tracks', []);
        const idx = tracks.findIndex((x) => x.id === clean.id);
        if (idx >= 0) tracks[idx] = clean; else tracks.push(clean);
        await setJSON('mb:tracks', tracks);
        return res.status(200).json({ ok: true, track: clean, tracks });
      }

      case 'deleteTrack': {
        const id = String(body.id || '');
        let tracks = await getJSON('mb:tracks', []);
        tracks = tracks.filter((x) => x.id !== id);
        await setJSON('mb:tracks', tracks);
        await setJSON('mb:notes:' + id, []); // drop the deleted track's notes
        return res.status(200).json({ ok: true, tracks });
      }

      case 'reorder': {
        const order = Array.isArray(body.order) ? body.order.map(String) : [];
        const tracks = await getJSON('mb:tracks', []);
        const byId = Object.fromEntries(tracks.map((t) => [t.id, t]));
        const next = order.map((id) => byId[id]).filter(Boolean);
        tracks.forEach((t) => { if (!order.includes(t.id)) next.push(t); });
        await setJSON('mb:tracks', next);
        return res.status(200).json({ ok: true, tracks: next });
      }

      case 'pending': {
        const pending = await getJSON('mb:pending', []);
        const tracks = await getJSON('mb:tracks', []);
        const titles = Object.fromEntries(tracks.map((t) => [t.id, t.title]));
        return res.status(200).json({
          pending: pending.map((n) => ({ ...n, trackTitle: titles[n.trackId] || '(deleted track)' })),
        });
      }

      case 'approveNote': {
        const id = String(body.id || '');
        const pending = await getJSON('mb:pending', []);
        const note = pending.find((n) => n.id === id);
        if (!note) return res.status(404).json({ error: 'not_found' });
        await setJSON('mb:pending', pending.filter((n) => n.id !== id));
        const key = 'mb:notes:' + note.trackId;
        const approved = await getJSON(key, []);
        approved.unshift({ id: note.id, body: note.body, ts: note.ts });
        await setJSON(key, approved);
        return res.status(200).json({ ok: true });
      }

      case 'rejectNote': {
        const id = String(body.id || '');
        const pending = await getJSON('mb:pending', []);
        await setJSON('mb:pending', pending.filter((n) => n.id !== id));
        return res.status(200).json({ ok: true });
      }

      case 'deleteNote': {
        const trackId = String(body.trackId || '');
        const id = String(body.id || '');
        const key = 'mb:notes:' + trackId;
        const approved = await getJSON(key, []);
        await setJSON(key, approved.filter((n) => n.id !== id));
        return res.status(200).json({ ok: true });
      }

      default:
        return res.status(400).json({ error: 'unknown_action' });
    }
  } catch (_) {
    return res.status(500).json({ error: 'server_error' });
  }
};

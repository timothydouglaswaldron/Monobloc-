/* /api/notes — anonymous guest notes, per track.
     GET  ?track=<id>  → public list of notes for that track (newest first)
     POST {track, body} → publishes a note immediately, UNLESS it contains a
                          racial/ethnic slur (then it's rejected, 422).

   Guardrails on POST: 500-char cap, light per-IP rate limit (5 / 60s),
   slur filter (see _filter.js), 500-note cap per track.
   Notes are stored raw; the front-end renders with textContent (no HTML). */
const { getJSON, setJSON, cmd, configured } = require('./_redis');
const { hasSlur } = require('./_filter');

const MAX_LEN = 500;
const MAX_NOTES = 500;   // keep at most this many per track
const RL_MAX = 5;        // submissions
const RL_WINDOW = 60;    // seconds

const clientIp = (req) =>
  String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
  (req.socket && req.socket.remoteAddress) || 'unknown';

const genId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!configured()) return res.status(503).json({ error: 'notes_unavailable' });

  if (req.method === 'GET') {
    const track = String((req.query && req.query.track) || '').slice(0, 64);
    if (!track) return res.status(400).json({ error: 'track_required' });
    const notes = await getJSON('mb:notes:' + track, []);
    return res.status(200).json({ notes: Array.isArray(notes) ? notes : [] });
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    const track = String(body.track || '').slice(0, 64);
    let text = String(body.body || '').trim();
    if (!track) return res.status(400).json({ error: 'track_required' });
    if (!text) return res.status(400).json({ error: 'empty' });
    if (text.length > MAX_LEN) text = text.slice(0, MAX_LEN);

    // hard gate: reject racial / ethnic slurs (auto-publish otherwise)
    if (hasSlur(text)) return res.status(422).json({ error: 'blocked' });

    // light per-IP rate limit
    try {
      const rlKey = 'mb:rl:' + clientIp(req);
      const n = await cmd(['INCR', rlKey]);
      if (n === 1) await cmd(['EXPIRE', rlKey, RL_WINDOW]);
      if (n > RL_MAX) return res.status(429).json({ error: 'rate_limited' });
    } catch (_) { /* never block a note on a rate-limit hiccup */ }

    // publish straight to the track's public list (newest first)
    const key = 'mb:notes:' + track;
    const notes = await getJSON(key, []);
    const list = Array.isArray(notes) ? notes : [];
    const note = { id: genId(), body: text, ts: Date.now() };
    list.unshift(note);
    if (list.length > MAX_NOTES) list.length = MAX_NOTES;
    await setJSON(key, list);
    return res.status(201).json({ ok: true, note });
  }

  return res.status(405).json({ error: 'method_not_allowed' });
};

/* GET /api/tracks — public. Returns the published demo tracklist.
   If the KV store isn't configured yet, returns {configured:false} so the
   front-end can fall back to the inline window.DEMOS list (page never breaks). */
const { getJSON, configured } = require('./_redis');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  if (!configured()) return res.status(200).json({ configured: false, tracks: [] });
  try {
    const tracks = await getJSON('mb:tracks', []);
    const out = (Array.isArray(tracks) ? tracks : []).map((t) => ({
      id: t.id,
      title: t.title || '',
      description: t.description || '',
      youtube: t.youtube || '',
      vimeo: t.vimeo || '',
      src: t.src || '',
      audio: t.audio || '',
      poster: t.poster || '',
    }));
    return res.status(200).json({ configured: true, tracks: out });
  } catch (_) {
    return res.status(200).json({ configured: true, tracks: [], error: 'kv_error' });
  }
};

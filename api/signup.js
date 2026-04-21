import { getStorage } from './_storage.js';

export const config = { api: { bodyParser: { sizeLimit: '4mb' } } };

const USERNAME_RE = /^[A-Za-z0-9_-]{2,20}$/;
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const MAX_MSG = 140;
const MAX_FAV = 40;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method not allowed' });
  }

  try {
    const { username, avatar, message, fav, hp } = req.body || {};

    // honeypot: bots fill this, humans don't see it
    if (hp) return res.status(200).json({ ok: true });

    if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
      return res.status(400).json({ error: 'username must be 2-20 chars, letters/numbers/_/- only' });
    }
    if (message != null && (typeof message !== 'string' || message.length > MAX_MSG)) {
      return res.status(400).json({ error: 'message too long' });
    }

    const storage = await getStorage();

    const fans = await storage.getFans();
    if (fans.some(f => f.username.toLowerCase() === username.toLowerCase())) {
      return res.status(409).json({ error: 'that username is taken' });
    }

    let avatarUrl = '';
    if (avatar) {
      if (typeof avatar !== 'string') {
        return res.status(400).json({ error: 'invalid avatar' });
      }
      const m = avatar.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
      if (!m) return res.status(400).json({ error: 'avatar must be a data URL' });
      const mime = m[1];
      const buf = Buffer.from(m[2], 'base64');
      if (buf.length > MAX_AVATAR_BYTES) {
        return res.status(413).json({ error: 'avatar exceeds 2MB' });
      }
      const ext = (mime.split('/')[1] || 'png').replace('+xml', '').replace('jpeg', 'jpg');
      const safeName = username.toLowerCase().replace(/[^a-z0-9_-]/g, '');
      const result = await storage.putAvatar(`${safeName}.${ext}`, buf, mime);
      avatarUrl = result.url;
    }

    const record = {
      username,
      avatar: avatarUrl,
      fav: typeof fav === 'string' ? fav.slice(0, MAX_FAV) : '',
      message: typeof message === 'string' ? message.slice(0, MAX_MSG) : '',
      joined: new Date().toISOString().slice(0, 10),
    };

    fans.push(record);
    await storage.saveFans(fans);

    return res.status(200).json({ ok: true, fan: record });
  } catch (err) {
    console.error('signup error:', err);
    return res.status(500).json({ error: 'server error' });
  }
}

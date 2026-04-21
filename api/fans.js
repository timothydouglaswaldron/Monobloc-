import { head } from '@vercel/blob';

const FANS_PATH = 'fanbook/fans.json';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method not allowed' });
  }
  try {
    const meta = await head(FANS_PATH).catch(() => null);
    if (!meta) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ fans: [] });
    }
    const r = await fetch(meta.url, { cache: 'no-store' });
    if (!r.ok) return res.status(200).json({ fans: [] });
    const fans = await r.json();
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ fans });
  } catch (err) {
    console.error('fans error:', err);
    return res.status(500).json({ error: 'server error' });
  }
}

import { getStorage } from './_storage.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method not allowed' });
  }
  try {
    const storage = await getStorage();
    const fans = await storage.getFans();
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ fans });
  } catch (err) {
    console.error('fans error:', err);
    return res.status(500).json({ error: 'server error' });
  }
}

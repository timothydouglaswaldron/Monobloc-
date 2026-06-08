/* /api/upload — issues short-lived client-upload tokens for Vercel Blob so the
   admin can upload demo videos straight from the browser to Blob (bypassing the
   4.5 MB serverless body limit). The file NEVER passes through this function.

   Flow (handled by @vercel/blob's handleUpload):
     1. browser asks this route for a token  → we verify the admin password
        (passed as clientPayload) and return an allow-list + size cap
     2. browser PUTs the file directly to Blob with that token
     3. Blob calls this route back (onUploadCompleted) — server-to-server

   Requires env BLOB_READ_WRITE_TOKEN (auto-injected when a Blob store is
   connected to the project). Admin gate reuses ADMIN_PASSWORD. */
const { handleUpload } = require('@vercel/blob/client');
const crypto = require('crypto');

function validKey(provided) {
  const pw = process.env.ADMIN_PASSWORD || '';
  if (!pw || !provided) return false;
  const a = Buffer.from(String(provided));
  const b = Buffer.from(pw);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  if (!process.env.BLOB_READ_WRITE_TOKEN) return res.status(503).json({ error: 'blob_not_configured' });

  try {
    const json = await handleUpload({
      body: req.body,
      request: req,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        // clientPayload carries the admin password — gate token issuance on it.
        if (!validKey(clientPayload)) throw new Error('unauthorized');
        return {
          allowedContentTypes: [
            // video
            'video/mp4', 'video/webm', 'video/quicktime', 'video/ogg',
            // audio (song uploads): mp3, wav, m4a/aac (mp4 container), ogg/flac
            'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/wave',
            'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/ogg', 'audio/flac',
          ],
          maximumSizeInBytes: 1024 * 1024 * 1024, // 1 GB cap per file
          addRandomSuffix: true,                  // avoid name collisions
        };
      },
      // Nothing to persist here — the admin saves the returned blob.url onto the
      // track via the existing saveTrack action. (Won't fire on localhost.)
      onUploadCompleted: async () => {},
    });
    return res.status(200).json(json);
  } catch (e) {
    const unauthorized = e && e.message === 'unauthorized';
    return res.status(unauthorized ? 401 : 400).json({ error: unauthorized ? 'unauthorized' : 'upload_error' });
  }
};

// Storage abstraction: uses Vercel Blob in production, local filesystem in dev.
// Selected by presence of BLOB_READ_WRITE_TOKEN env var.

let cachedImpl = null;

export async function getStorage() {
  if (cachedImpl) return cachedImpl;
  cachedImpl = process.env.BLOB_READ_WRITE_TOKEN
    ? await createBlobStorage()
    : await createLocalStorage();
  return cachedImpl;
}

async function createBlobStorage() {
  const { put, head } = await import('@vercel/blob');
  const FANS_PATH = 'fanbook/fans.json';

  return {
    mode: 'blob',

    async getFans() {
      const meta = await head(FANS_PATH).catch(() => null);
      if (!meta) return [];
      const r = await fetch(meta.url, { cache: 'no-store' });
      if (!r.ok) return [];
      try { return await r.json(); } catch { return []; }
    },

    async saveFans(fans) {
      await put(FANS_PATH, JSON.stringify(fans), {
        access: 'public',
        contentType: 'application/json',
        addRandomSuffix: false,
        allowOverwrite: true,
        cacheControlMaxAge: 0,
      });
    },

    async putAvatar(filename, buffer, mime) {
      const { url } = await put(`avatars/${filename}`, buffer, {
        access: 'public',
        contentType: mime,
        addRandomSuffix: true,
        cacheControlMaxAge: 60 * 60 * 24 * 365,
      });
      return { url };
    },
  };
}

async function createLocalStorage() {
  const { promises: fs } = await import('node:fs');
  const path = await import('node:path');
  const crypto = await import('node:crypto');

  const DATA_DIR = path.join(process.cwd(), '.data');
  const AVATAR_DIR = path.join(DATA_DIR, 'avatars');
  const FANS_FILE = path.join(DATA_DIR, 'fans.json');

  await fs.mkdir(AVATAR_DIR, { recursive: true });

  return {
    mode: 'local',

    async getFans() {
      try {
        const data = await fs.readFile(FANS_FILE, 'utf8');
        return JSON.parse(data);
      } catch (err) {
        if (err.code === 'ENOENT') return [];
        throw err;
      }
    },

    async saveFans(fans) {
      await fs.writeFile(FANS_FILE, JSON.stringify(fans, null, 2), 'utf8');
    },

    async putAvatar(filename, buffer, mime) {
      const rand = crypto.randomBytes(4).toString('hex');
      const finalName = filename.replace(/(\.[^.]+)$/, `-${rand}$1`);
      await fs.writeFile(path.join(AVATAR_DIR, finalName), buffer);
      return { url: `/local-avatars/${finalName}` };
    },
  };
}

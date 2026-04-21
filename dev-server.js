// Minimal dev server: serves static files and routes /api/* to handler modules
// using a Vercel-shaped (req, res) contract. Avatars stored locally are
// served from /local-avatars/.

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, '.data');
const PORT = parseInt(process.env.PORT || '3000', 10);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
};
const mimeFor = (p) => MIME[path.extname(p).toLowerCase()] || 'application/octet-stream';

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (c) => {
      total += c.length;
      if (total > 5 * 1024 * 1024) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function shimRes(res) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (obj) => {
    if (!res.getHeader('Content-Type')) {
      res.setHeader('Content-Type', 'application/json');
    }
    res.end(JSON.stringify(obj));
    return res;
  };
  return res;
}

async function handleApi(req, res, route) {
  const modulePath = pathToFileURL(path.join(ROOT, 'api', `${route}.js`)).href;
  let mod;
  try {
    mod = await import(modulePath);
  } catch (err) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'route not found' }));
    return;
  }
  const handler = mod.default;
  if (typeof handler !== 'function') {
    res.statusCode = 500;
    res.end('no default export');
    return;
  }

  try {
    const body = await readBody(req);
    const ctype = req.headers['content-type'] || '';
    if (body.length && ctype.includes('application/json')) {
      try { req.body = JSON.parse(body.toString('utf8')); } catch { req.body = {}; }
    } else {
      req.body = {};
    }
    shimRes(res);
    await handler(req, res);
  } catch (err) {
    console.error('[api]', err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'dev server error: ' + err.message }));
    }
  }
}

async function serveFile(res, filePath) {
  try {
    const s = await stat(filePath);
    const final = s.isDirectory() ? path.join(filePath, 'index.html') : filePath;
    const data = await readFile(final);
    res.statusCode = 200;
    res.setHeader('Content-Type', mimeFor(final));
    res.setHeader('Cache-Control', 'no-cache');
    res.end(data);
  } catch {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain');
    res.end('Not Found');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const urlPath = decodeURIComponent(url.pathname);

  // block traversal
  if (urlPath.includes('..')) {
    res.statusCode = 400;
    res.end('Bad Request');
    return;
  }

  // api routes
  if (urlPath.startsWith('/api/')) {
    const route = urlPath.slice(5).replace(/\/$/, '');
    if (!/^[a-z0-9_-]+$/i.test(route)) {
      res.statusCode = 404;
      res.end('Not Found');
      return;
    }
    console.log(`[${req.method}] /api/${route}`);
    await handleApi(req, res, route);
    return;
  }

  // local avatars (dev-only)
  if (urlPath.startsWith('/local-avatars/')) {
    const filename = urlPath.slice('/local-avatars/'.length).replace(/[^a-zA-Z0-9._-]/g, '');
    await serveFile(res, path.join(DATA_DIR, 'avatars', filename));
    return;
  }

  // static
  const target = urlPath === '/' ? 'index.html' : urlPath.replace(/^\//, '');
  await serveFile(res, path.join(ROOT, target));
});

server.listen(PORT, () => {
  const mode = process.env.BLOB_READ_WRITE_TOKEN ? 'Vercel Blob' : 'local filesystem (./.data/)';
  console.log(`\n  MONOBLOC fanclub dev server`);
  console.log(`  -> http://localhost:${PORT}`);
  console.log(`  -> storage: ${mode}\n`);
});

/* api/_redis.js — minimal Upstash / Vercel-KV REST client.
   No npm dependencies: talks to the Redis REST endpoint with plain fetch
   (Node 18+ has global fetch on Vercel). Files prefixed with "_" are NOT
   routed by Vercel but are still uploaded and importable by sibling routes.

   Env vars (set whichever your store provides — both namings supported):
     KV_REST_API_URL   / UPSTASH_REDIS_REST_URL
     KV_REST_API_TOKEN / UPSTASH_REDIS_REST_TOKEN
*/
const BASE  = process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL   || '';
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';

const configured = () => Boolean(BASE && TOKEN);

// Run one Redis command, e.g. cmd(['SET','key','value']) → result.
async function cmd(args) {
  if (!configured()) throw new Error('KV_NOT_CONFIGURED');
  const r = await fetch(BASE, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!r.ok) throw new Error('KV_HTTP_' + r.status);
  const j = await r.json();
  if (j && j.error) throw new Error('KV_ERR');
  return j ? j.result : null;
}

async function getJSON(key, fallback) {
  const v = await cmd(['GET', key]);
  if (v == null) return fallback;
  try { return JSON.parse(v); } catch (_) { return fallback; }
}

const setJSON = (key, val) => cmd(['SET', key, JSON.stringify(val)]);

module.exports = { cmd, getJSON, setJSON, configured };

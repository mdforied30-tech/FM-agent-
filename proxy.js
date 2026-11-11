/* Netlify Function: a small CORS proxy for AI APIs.
 *
 * Why it exists:
 *   1. Some APIs (e.g. Cloudflare) block direct calls from a browser (CORS).
 *   2. It lets you keep API keys in Netlify Environment Variables instead of the browser.
 *      In Settings put a key like:  {{ENV:STUDIO_KEY_HF}}
 *      and set STUDIO_KEY_HF in Netlify -> Site settings -> Environment variables.
 *
 * Protection (IMPORTANT for a public site):
 *   - Only hosts in the allow-list can be called.
 *   - Set STUDIO_PASSCODE in Netlify so only you can use the proxy.
 *   - Only env vars named STUDIO_KEY_* can ever be substituted.
 */

const DEFAULT_HOSTS = [
  'image.pollinations.ai', 'text.pollinations.ai', 'gen.pollinations.ai', 'enter.pollinations.ai',
  'router.huggingface.co', 'api-inference.huggingface.co',
  'generativelanguage.googleapis.com',
  'openrouter.ai',
  'api.cloudflare.com'
];

const PRIVATE = /^(localhost$|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[?::1\]?$)/i;

const json = (statusCode, obj) => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(obj)
});

const subst = (s) => String(s).replace(/\{\{ENV:(STUDIO_KEY_[A-Z0-9_]+)\}\}/g, (m, name) => process.env[name] || '');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });

  const pass = process.env.STUDIO_PASSCODE;
  if (pass && (event.headers['x-passcode'] || '') !== pass) return json(401, { error: 'bad passcode' });

  let req;
  try { req = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { error: 'bad json' }); }

  let u;
  try { u = new URL(req.url); } catch (e) { return json(400, { error: 'bad url' }); }
  if (u.protocol !== 'https:') return json(400, { error: 'https only' });
  if (PRIVATE.test(u.hostname)) return json(403, { error: 'private hosts are blocked' });

  const extra = (process.env.EXTRA_ALLOWED_HOSTS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const allowAny = process.env.ALLOW_ANY_HOST === 'true';
  if (!allowAny && !DEFAULT_HOSTS.concat(extra).includes(u.hostname)) {
    return json(403, { error: 'host not allowed: ' + u.hostname + '. Add it to EXTRA_ALLOWED_HOSTS in Netlify.' });
  }

  const headers = {};
  for (const [k, v] of Object.entries(req.headers || {})) {
    if (['host', 'content-length', 'connection'].includes(k.toLowerCase())) continue;
    headers[k] = subst(v);
  }

  let body;
  if (req.bodyBase64) body = Buffer.from(req.bodyBase64, 'base64');
  else if (typeof req.body === 'string') body = subst(req.body);

  const method = (req.method || 'GET').toUpperCase();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Number(process.env.PROXY_TIMEOUT_MS || 25000));

  try {
    const res = await fetch(u.toString(), {
      method,
      headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : body,
      signal: ctrl.signal
    });
    const buf = Buffer.from(await res.arrayBuffer());
    return json(200, {
      status: res.status,
      contentType: res.headers.get('content-type') || '',
      bodyBase64: buf.toString('base64')
    });
  } catch (e) {
    return json(502, { error: e.name === 'AbortError' ? 'upstream timed out' : 'upstream failed: ' + e.message });
  } finally {
    clearTimeout(timer);
  }
};

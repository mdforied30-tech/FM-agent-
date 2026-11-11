/* Networking helpers. Direct fetch first; falls back to the Netlify proxy on CORS errors. */
(function () {
  const PROXY = '/.netlify/functions/proxy';

  class HttpError extends Error {
    constructor(status, msg) { super(msg); this.status = status; }
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function blobToDataUrl(blob) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result));
      r.onerror = () => rej(r.error);
      r.readAsDataURL(blob);
    });
  }
  async function blobToB64(blob) {
    return (await blobToDataUrl(blob)).split(',')[1] || '';
  }
  function b64ToBlob(b64, type) {
    const bin = atob(b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return new Blob([u], { type });
  }

  function usesEnv(opts) {
    const s = JSON.stringify(opts.headers || {}) + (typeof opts.body === 'string' ? opts.body : '');
    return /\{\{ENV:/.test(s);
  }

  async function viaProxy(url, opts = {}) {
    const payload = {
      url,
      method: opts.method || 'GET',
      headers: opts.headers || {}
    };
    if (opts.body instanceof Blob) payload.bodyBase64 = await blobToB64(opts.body);
    else if (typeof opts.body === 'string') payload.body = opts.body;

    let r;
    try {
      r = await fetch(PROXY, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-passcode': Store.cfg.passcode || '' },
        body: JSON.stringify(payload)
      });
    } catch (e) {
      throw new Error('Proxy unreachable (are you on Netlify?): ' + e.message);
    }
    if (r.status === 401) throw new Error('Proxy passcode is wrong. Set it in Settings → Network.');
    if (r.status === 404) throw new Error('Proxy function not found. Deploy on Netlify with the functions folder.');
    let j;
    try { j = await r.json(); } catch (e) { throw new Error('Proxy returned a bad response (' + r.status + ')'); }
    if (j.error) throw new Error('Proxy: ' + j.error);
    const bin = Uint8Array.from(atob(j.bodyBase64 || ''), (c) => c.charCodeAt(0));
    const nullBody = [101, 204, 205, 304].includes(j.status);
    return new Response(nullBody ? null : bin, {
      status: j.status,
      headers: { 'content-type': j.contentType || '' }
    });
  }

  async function smartFetch(url, opts = {}) {
    const pref = Store.cfg.useProxy;
    if (pref === 'always' || usesEnv(opts)) return viaProxy(url, opts);
    try {
      return await fetch(url, opts);
    } catch (e) {
      if (pref === 'never') throw e;
      // Most likely CORS or a blocked request: retry through the proxy.
      return viaProxy(url, opts);
    }
  }

  async function ensureOk(res) {
    if (res.ok) return res;
    let t = '';
    try { t = (await res.text()).slice(0, 300); } catch (e) { /* ignore */ }
    throw new HttpError(res.status, 'HTTP ' + res.status + (t ? ': ' + t : ''));
  }

  async function toMedia(res, kind) {
    const blob = await res.blob();
    const t = blob.type || '';
    const ok = kind === 'image' ? t.startsWith('image/') : t.startsWith('video/');
    if (ok) return blob;
    if (t.includes('octet-stream') || t === '') {
      return new Blob([blob], { type: kind === 'image' ? 'image/png' : 'video/mp4' });
    }
    let txt = '';
    try { txt = (await blob.text()).slice(0, 200); } catch (e) { /* ignore */ }
    throw new Error('Unexpected response (' + t + '): ' + txt);
  }

  window.Net = { HttpError, sleep, blobToDataUrl, blobToB64, b64ToBlob, smartFetch, ensureOk, toMedia };
})();

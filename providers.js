/* Provider system. To add a new built-in provider, add one object to BUILTIN.
   Most people never need that: use Settings → "Add custom provider" instead. */
(function () {
  const { smartFetch, ensureOk, HttpError, sleep, toMedia, b64ToBlob } = Net;

  const KINDS = {
    t2i: 'Text → Image',
    t2v: 'Text → Video',
    i2v: 'Image → Video',
    text: 'Text (prompt helper)'
  };

  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  const ratio = (w, h) => { const g = gcd(w, h); return (w / g) + ':' + (h / g); };

  function fld(prov, id) {
    const f = prov.fields.find((x) => x.id === id);
    return Store.field(prov.id, id, f ? f.def : '');
  }

  /* ---------------- Pollinations (no key needed) ---------------- */
  const pollinations = {
    id: 'pollinations',
    name: 'Pollinations',
    kinds: ['t2i', 'text'],
    needsKey: false,
    note: 'Works without any key. A key is optional (some plans give higher limits).',
    fields: [
      { id: 'imageBase', label: 'Image base URL', def: 'https://image.pollinations.ai/prompt/' },
      { id: 'textBase', label: 'Text base URL', def: 'https://text.pollinations.ai/' },
      { id: 'model', label: 'Image model', def: 'flux' }
    ],
    async t2i(p, key) {
      const url = fld(pollinations, 'imageBase') + encodeURIComponent(p.prompt) +
        '?width=' + p.width + '&height=' + p.height + '&seed=' + p.seed +
        '&model=' + encodeURIComponent(fld(pollinations, 'model')) + '&nologo=true' +
        (key ? '&token=' + encodeURIComponent(key) : '');
      const res = await ensureOk(await smartFetch(url));
      return { type: 'image', blob: await toMedia(res, 'image') };
    },
    async text(p, key) {
      const url = fld(pollinations, 'textBase') + encodeURIComponent(p.prompt) +
        '?system=' + encodeURIComponent(p.system || '') +
        (key ? '&token=' + encodeURIComponent(key) : '');
      const res = await ensureOk(await smartFetch(url));
      return { type: 'text', text: (await res.text()).trim() };
    }
  };

  /* ---------------- Hugging Face ---------------- */
  const huggingface = {
    id: 'huggingface',
    name: 'Hugging Face',
    kinds: ['t2i', 't2v'],
    needsKey: true,
    note: 'Free token from huggingface.co/settings/tokens. Free video models are rare: change the video model if it errors.',
    fields: [
      { id: 'endpoint', label: 'Endpoint base', def: 'https://router.huggingface.co/hf-inference/models/' },
      { id: 'model', label: 'Image model', def: 'black-forest-labs/FLUX.1-schnell' },
      { id: 'videoModel', label: 'Video model', def: 'Lightricks/LTX-Video' }
    ],
    async call(model, body, key, kind) {
      const url = fld(huggingface, 'endpoint') + model;
      for (let attempt = 0; attempt < 3; attempt++) {
        const res = await smartFetch(url, {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        if (res.status === 503 && attempt < 2) {
          let wait = 15;
          try { const j = await res.json(); wait = Math.min(30, Math.ceil(j.estimated_time || 15)); } catch (e) { /* ignore */ }
          await sleep(wait * 1000);
          continue;
        }
        await ensureOk(res);
        return { type: kind, blob: await toMedia(res, kind) };
      }
      throw new Error('Model is still loading, try again in a minute');
    },
    t2i(p, key) {
      return huggingface.call(fld(huggingface, 'model'),
        { inputs: p.prompt, parameters: { width: p.width, height: p.height, seed: p.seed } }, key, 'image');
    },
    t2v(p, key) {
      return huggingface.call(fld(huggingface, 'videoModel'), { inputs: p.prompt }, key, 'video');
    }
  };

  /* ---------------- Google Gemini ---------------- */
  const gemini = {
    id: 'gemini',
    name: 'Google Gemini',
    kinds: ['text', 't2i'],
    needsKey: true,
    note: 'Free key from aistudio.google.com. Text is free; image generation may not be on the free tier.',
    fields: [
      { id: 'base', label: 'API base', def: 'https://generativelanguage.googleapis.com/v1beta/models' },
      { id: 'model', label: 'Text model', def: 'gemini-2.5-flash' },
      { id: 'imageModel', label: 'Image model', def: 'gemini-2.5-flash-image' }
    ],
    async call(model, body, key) {
      const res = await ensureOk(await smartFetch(fld(gemini, 'base') + '/' + model + ':generateContent', {
        method: 'POST',
        headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }));
      return res.json();
    },
    async text(p, key) {
      const body = { contents: [{ parts: [{ text: p.prompt }] }] };
      if (p.system) body.systemInstruction = { parts: [{ text: p.system }] };
      const j = await gemini.call(fld(gemini, 'model'), body, key);
      const parts = (j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
      const text = parts.map((x) => x.text || '').join('').trim();
      if (!text) throw new Error('Empty response from Gemini');
      return { type: 'text', text };
    },
    async t2i(p, key) {
      const body = {
        contents: [{ parts: [{ text: p.prompt + '. Aspect ratio ' + ratio(p.width, p.height) + '.' }] }],
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'] }
      };
      const j = await gemini.call(fld(gemini, 'imageModel'), body, key);
      const parts = (j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
      const img = parts.find((x) => x.inlineData || x.inline_data);
      if (!img) throw new Error('Gemini returned no image');
      const d = img.inlineData || img.inline_data;
      return { type: 'image', blob: b64ToBlob(d.data, d.mimeType || d.mime_type || 'image/png') };
    }
  };

  /* ---------------- OpenRouter (text) ---------------- */
  const openrouter = {
    id: 'openrouter',
    name: 'OpenRouter',
    kinds: ['text'],
    needsKey: true,
    note: 'Free key from openrouter.ai. Model names ending in :free cost nothing. Free model names change, update if one stops working.',
    fields: [
      { id: 'model', label: 'Model', def: 'meta-llama/llama-3.3-70b-instruct:free' }
    ],
    async text(p, key) {
      const messages = [];
      if (p.system) messages.push({ role: 'system', content: p.system });
      messages.push({ role: 'user', content: p.prompt });
      const res = await ensureOk(await smartFetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: fld(openrouter, 'model'), messages })
      }));
      const j = await res.json();
      const text = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
      if (!text) throw new Error('Empty response from OpenRouter');
      return { type: 'text', text: text.trim() };
    }
  };

  /* ---------------- Cloudflare Workers AI ---------------- */
  const cloudflare = {
    id: 'cloudflare',
    name: 'Cloudflare Workers AI',
    kinds: ['t2i'],
    needsKey: true,
    note: 'Needs Account ID + an API token with Workers AI access (free daily allowance). Goes through the Netlify proxy automatically.',
    fields: [
      { id: 'accountId', label: 'Account ID', def: '' },
      { id: 'model', label: 'Model', def: '@cf/black-forest-labs/flux-1-schnell' }
    ],
    async t2i(p, key) {
      const acct = fld(cloudflare, 'accountId');
      if (!acct) throw new Error('Cloudflare Account ID missing');
      const res = await ensureOk(await smartFetch(
        'https://api.cloudflare.com/client/v4/accounts/' + acct + '/ai/run/' + fld(cloudflare, 'model'), {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: p.prompt, steps: 4, width: p.width, height: p.height })
        }));
      const ct = res.headers.get('content-type') || '';
      if (ct.startsWith('image/')) return { type: 'image', blob: await res.blob() };
      const j = await res.json();
      const b64 = j.result && j.result.image;
      if (!b64) throw new Error('Cloudflare returned no image');
      return { type: 'image', blob: b64ToBlob(b64, 'image/jpeg') };
    }
  };

  /* ---------------- Local "Ken Burns" image → video (free, in your browser) ---------------- */
  const kenburns = {
    id: 'local-kenburns',
    name: 'Local motion (in browser)',
    kinds: ['i2v'],
    needsKey: false,
    note: 'Turns an image into a smooth zoom/pan video right in your browser. No API, no limits. Keep this tab open while it records.',
    fields: [],
    async i2v(p) {
      if (!window.MediaRecorder) throw new Error('This browser has no MediaRecorder');
      const img = await createImageBitmap(p.imageBlob);
      const W = p.width, H = p.height;
      const canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d');
      const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
        .find((m) => MediaRecorder.isTypeSupported(m)) || '';
      const rec = new MediaRecorder(canvas.captureStream(30), mime ? { mimeType: mime, videoBitsPerSecond: 6e6 } : undefined);
      const chunks = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      const stopped = new Promise((r) => { rec.onstop = r; });

      const motion = p.motion || 'zoom-in';
      const ease = (t) => t * t * (3 - 2 * t);
      function draw(t) {
        const e = ease(t);
        let z = 1, px = 0.5, py = 0.5;
        if (motion === 'zoom-in') z = 1 + 0.25 * e;
        else if (motion === 'zoom-out') z = 1.25 - 0.25 * e;
        else if (motion === 'pan-left') { z = 1.2; px = e; }
        else if (motion === 'pan-right') { z = 1.2; px = 1 - e; }
        const s = Math.max(W / img.width, H / img.height) * z;
        const dw = img.width * s, dh = img.height * s;
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, W, H);
        ctx.drawImage(img, (W - dw) * px, (H - dh) * py, dw, dh);
      }

      draw(0);
      rec.start(250);
      const dur = (p.duration || 5) * 1000;
      const t0 = performance.now();
      await new Promise((resolve) => {
        function frame(now) {
          const t = Math.min(1, (now - t0) / dur);
          draw(t);
          if (t < 1) requestAnimationFrame(frame); else resolve();
        }
        requestAnimationFrame(frame);
      });
      await sleep(150);
      rec.stop();
      await stopped;
      return { type: 'video', blob: new Blob(chunks, { type: mime || 'video/webm' }) };
    }
  };

  const BUILTIN = [pollinations, huggingface, gemini, openrouter, cloudflare, kenburns];

  /* ---------------- Custom (user-defined) providers ---------------- */
  function getPath(obj, path) {
    if (!path) return obj;
    const toks = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
    let cur = obj;
    for (const t of toks) { if (cur == null) return undefined; cur = cur[t]; }
    return cur;
  }
  const fillStr = (s, vars) => String(s).replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  function fillDeep(v, vars) {
    if (typeof v === 'string') {
      const m = v.match(/^\{\{(\w+)\}\}$/);
      if (m && m[1] in vars) return vars[m[1]];
      return fillStr(v, vars);
    }
    if (Array.isArray(v)) return v.map((x) => fillDeep(x, vars));
    if (v && typeof v === 'object') { const o = {}; for (const k in v) o[k] = fillDeep(v[k], vars); return o; }
    return v;
  }
  function parseHeaders(text, vars) {
    const h = {};
    String(text || '').split('\n').forEach((l) => {
      const i = l.indexOf(':');
      if (i > 0) h[l.slice(0, i).trim()] = fillStr(l.slice(i + 1).trim(), vars);
    });
    return h;
  }
  async function mediaFromValue(v, kind) {
    if (Array.isArray(v)) v = v[0];
    if (v && typeof v === 'object') v = v.url || v.b64_json || v.base64 || '';
    v = String(v || '');
    if (!v) throw new Error('Empty result');
    if (/^(https?:|data:)/.test(v)) {
      const res = await ensureOk(await smartFetch(v));
      return { type: kind, blob: await toMedia(res, kind) };
    }
    return { type: kind, blob: b64ToBlob(v, kind === 'image' ? 'image/png' : 'video/mp4') };
  }

  async function runCustom(d, kind, p, key) {
    const vars = {
      prompt: p.prompt || '', width: p.width || 1024, height: p.height || 1024, seed: p.seed || 0,
      duration: p.duration || 5, image_base64: p.imageB64 || '', image_data_url: p.imageDataUrl || '',
      key: key || '', motion: p.motion || ''
    };
    const method = d.method || 'POST';
    const headers = parseHeaders(d.headers, vars);
    let body;
    if (method !== 'GET' && d.body) {
      try { body = JSON.stringify(fillDeep(JSON.parse(d.body), vars)); }
      catch (e) { throw new Error('Body template is not valid JSON: ' + e.message); }
      if (!Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) headers['Content-Type'] = 'application/json';
    }
    if (!d.url) throw new Error('URL is empty');
    const kindOut = kind === 't2i' ? 'image' : 'video';
    const res = await ensureOk(await smartFetch(fillStr(d.url, vars), { method, headers, body }));
    if (d.mode === 'binary') return { type: kindOut, blob: await toMedia(res, kindOut) };

    let j = await res.json();
    if (d.pollUrl) {
      const id = getPath(j, d.idPath || 'id');
      if (!id) throw new Error('Job id not found at "' + (d.idPath || 'id') + '": ' + JSON.stringify(j).slice(0, 200));
      vars.id = id;
      const t0 = Date.now();
      let out;
      while (Date.now() - t0 < 6 * 60 * 1000) {
        await sleep(5000);
        const r = await ensureOk(await smartFetch(fillStr(d.pollUrl, vars), { method: 'GET', headers: parseHeaders(d.headers, vars) }));
        j = await r.json();
        out = getPath(j, d.resultPath);
        if (out) break;
      }
      if (!out) throw new Error('Timed out waiting for the result');
      return mediaFromValue(out, kindOut);
    }
    const v = getPath(j, d.resultPath);
    if (!v) throw new Error('Nothing at result path "' + d.resultPath + '": ' + JSON.stringify(j).slice(0, 200));
    return mediaFromValue(v, kindOut);
  }

  function adaptCustom(d) {
    return {
      id: d.id, name: d.name || 'Custom provider', kinds: d.kinds || [], custom: true, def: d, fields: [],
      needsKey: /\{\{key\}\}/.test((d.headers || '') + (d.url || '') + (d.body || ''))
    };
  }

  /* ---------------- Registry + runner ---------------- */
  const all = () => BUILTIN.concat(Store.cfg.custom.map(adaptCustom));
  const get = (id) => all().find((p) => p.id === id);

  function order(kind) {
    const ids = all().filter((p) => p.kinds.includes(kind)).map((p) => p.id);
    const saved = (Store.cfg.order[kind] || []).filter((id) => ids.includes(id));
    return saved.concat(ids.filter((id) => !saved.includes(id)));
  }
  function setOrder(kind, ids) { Store.cfg.order[kind] = ids; Store.save(); }

  const exec = (prov, kind, p, key) => (prov.custom ? runCustom(prov.def, kind, p, key) : prov[kind](p, key));

  const rot = {};
  async function runOne(prov, kind, p) {
    const keys = Store.keys(prov.id);
    if (!keys.length) {
      if (prov.needsKey) throw new Error('No API key set');
      return exec(prov, kind, p, '');
    }
    const start = rot[prov.id] || 0;
    let last;
    for (let i = 0; i < keys.length; i++) {
      const idx = (start + i) % keys.length;
      try {
        const r = await exec(prov, kind, p, keys[idx]);
        rot[prov.id] = idx;
        return r;
      } catch (e) {
        last = e;
        const limited = [401, 402, 403, 429].includes(e.status) || /quota|rate.?limit|exceed/i.test(e.message);
        if (limited) continue; // try the next key
        throw e;
      }
    }
    throw last;
  }

  async function generate(kind, p, hooks = {}) {
    const ids = order(kind).filter((id) => Store.isEnabled(id));
    const errs = [];
    for (const id of ids) {
      const prov = get(id);
      if (!prov) continue;
      if (prov.needsKey && !Store.keys(id).length) { errs.push(prov.name + ': no API key set'); continue; }
      try {
        if (hooks.status) hooks.status(prov.name);
        const r = await runOne(prov, kind, p);
        r.provider = prov.name;
        return r;
      } catch (e) {
        errs.push(prov.name + ': ' + e.message);
      }
    }
    throw new Error(errs.length ? errs.join('\n') : 'No provider is enabled for this task. Open Settings and enable or add one.');
  }

  window.Providers = { KINDS, all, get, order, setOrder, generate, runOne, HttpError };
})();

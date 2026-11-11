/* UI: tabs for Image, Thumbnail, Video, Bulk and Settings. */
(function () {
  'use strict';
  const { sleep } = Net;

  const SIZES = {
    '1:1': [1024, 1024],
    '16:9': [1280, 720],
    '9:16': [720, 1280],
    '4:3': [1024, 768],
    '3:4': [768, 1024]
  };
  const rand = () => Math.floor(Math.random() * 1e9);
  const firstLine = (s) => String(s).split('\n')[0].slice(0, 160);

  /* ---------- tiny DOM helpers ---------- */
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    let value;
    for (const [k, v] of Object.entries(props || {})) {
      if (k === 'class') el.className = v;
      else if (k === 'value') value = v;
      else if (k === 'checked') el.checked = !!v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else if (v !== false && v != null) el.setAttribute(k, v);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    if (value !== undefined) el.value = value;
    return el;
  }
  const select = (opts, val, props) =>
    h('select', Object.assign({ value: val }, props || {}), opts.map(([v, l]) => h('option', { value: v }, l)));
  const field = (label, ...ctrl) => h('label', { class: 'field' }, h('span', {}, label), ...ctrl);
  const sizeSelect = (def) => select(Object.keys(SIZES).map((k) => [k, k + '  (' + SIZES[k].join('×') + ')']), def);

  let toastTimer;
  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 4000);
  }
  function busy(btn, on, label) {
    if (on) { btn.dataset.label = btn.textContent; btn.disabled = true; if (label) btn.textContent = label; }
    else { btn.disabled = false; if (btn.dataset.label) btn.textContent = btn.dataset.label; }
  }
  function saveBlob(blob, name) {
    const a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  function extOf(mime) {
    return ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/webm': 'webm' })[(mime || '').split(';')[0]] || 'bin';
  }
  const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9ঀ-৿]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'item';

  /* ---------- shared UI pieces ---------- */
  const ctl = {}; // cross-tab controllers, filled in init

  function mediaCard(r, label) {
    const url = URL.createObjectURL(r.blob);
    const media = r.type === 'video'
      ? h('video', { src: url, controls: true, loop: true, playsinline: true })
      : h('img', { src: url, alt: '' });
    const acts = h('div', { class: 'row' },
      h('button', { class: 'btn small', onclick: () => saveBlob(r.blob, 'studio-' + (label ? slug(label) + '-' : '') + Date.now() + '.' + extOf(r.blob.type)) }, '⬇ Download'));
    if (r.type === 'image') {
      acts.append(
        h('button', { class: 'btn small', onclick: () => { ctl.video.setSource(r.blob); ctl.go('video'); } }, '→ Video'),
        h('button', { class: 'btn small', onclick: () => { ctl.thumb.setBg(r.blob); ctl.go('thumb'); } }, '→ Thumbnail')
      );
    }
    return h('figure', { class: 'card' }, media, h('figcaption', {}, r.provider || ''), acts);
  }
  const errorCard = (msg) => h('figure', { class: 'card err' }, msg);

  async function enhance(ta, btn) {
    const t = ta.value.trim();
    if (!t) return toast('Write a short idea first');
    busy(btn, true, 'Enhancing…');
    try {
      const r = await Providers.generate('text', {
        prompt: t,
        system: 'You turn short ideas into one detailed prompt for an AI image/video generator. Keep the original meaning. Output only the prompt, in English, max 80 words.'
      });
      ta.value = r.text;
    } catch (e) { toast('Enhance failed: ' + firstLine(e.message)); }
    busy(btn, false);
  }

  /* =====================================================================
     IMAGE TAB
     ===================================================================== */
  function buildImageTab() {
    const prompt = h('textarea', { rows: 4, placeholder: 'Describe the image you want…' });
    const size = sizeSelect('1:1');
    const count = select([1, 2, 3, 4].map((n) => [n, n + (n > 1 ? ' images' : ' image')]), 1);
    const seed = h('input', { type: 'number', placeholder: 'random' });
    const status = h('div', { class: 'status' });
    const grid = h('div', { class: 'grid' });
    const gen = h('button', { class: 'btn primary', onclick: run }, 'Generate');
    const enh = h('button', { class: 'btn', onclick: () => enhance(prompt, enh) }, '✨ Enhance prompt');

    async function run() {
      const text = prompt.value.trim();
      if (!text) return toast('Write a prompt first');
      const n = +count.value;
      const [w, ht] = SIZES[size.value];
      busy(gen, true, 'Generating…');
      for (let i = 0; i < n; i++) {
        const tag = 'Image ' + (i + 1) + '/' + n;
        status.textContent = tag + '…';
        try {
          const r = await Providers.generate('t2i',
            { prompt: text, width: w, height: ht, seed: seed.value ? +seed.value + i : rand() },
            { status: (name) => { status.textContent = tag + ' · ' + name + '…'; } });
          grid.prepend(mediaCard(r, text));
        } catch (e) { grid.prepend(errorCard(e.message)); }
      }
      status.textContent = '';
      busy(gen, false);
    }

    const el = h('section', { class: 'view' },
      h('div', { class: 'panel' },
        h('h2', {}, 'Text → Image'),
        field('Prompt', prompt),
        h('div', { class: 'cols' }, field('Size', size), field('How many', count), field('Seed (optional)', seed)),
        h('div', { class: 'row' }, gen, enh),
        status, grid));
    return { el };
  }

  /* =====================================================================
     THUMBNAIL TAB
     ===================================================================== */
  const STYLES = [
    ['YouTube bright', 'vibrant saturated colors, high contrast, dramatic lighting, expressive, sharp focus, eye-catching'],
    ['Cinematic', 'cinematic lighting, shallow depth of field, moody atmosphere, ultra detailed'],
    ['Minimal', 'clean minimal composition, simple background, modern, soft light'],
    ['Gaming', 'neon glow, energetic dynamic action, bold colors, digital art'],
    ['Tech', 'futuristic, dark background with glowing blue accents, sleek, high detail'],
    ['Photo real', 'realistic photo, natural lighting, high resolution'],
    ['None', '']
  ];
  const FONTS = [
    ['Anton', '400'], ['Bebas Neue', '400'], ['Poppins', '800'], ['Hind Siliguri', '700'], ['Impact', '400']
  ];

  function buildThumbTab() {
    let bg = null;
    let seq = 0;

    const topic = h('textarea', { rows: 3, placeholder: 'Thumbnail idea, e.g. shocked man holding a glowing phone, city at night' });
    const style = select(STYLES.map((s) => [s[0], s[0]]), 'YouTube bright');
    const space = h('input', { type: 'checkbox', checked: true });
    const count = select([1, 2, 3, 4].map((n) => [n, n + (n > 1 ? ' options' : ' option')]), 2);
    const status = h('div', { class: 'status' });
    const cands = h('div', { class: 'grid small' });
    const genBtn = h('button', { class: 'btn primary', onclick: generate }, 'Generate backgrounds');
    const upload = h('input', {
      type: 'file', accept: 'image/*',
      onchange: () => { if (upload.files[0]) setBg(upload.files[0]); }
    });

    const title = h('textarea', { rows: 2, placeholder: 'Title text (Bangla works too)', oninput: schedule }, '');
    const sub = h('input', { type: 'text', placeholder: 'Small second line (optional)', oninput: schedule });
    const fontSel = select(FONTS.map((f) => [f[0], f[0]]), 'Anton', { onchange: schedule });
    const sizeR = h('input', { type: 'range', min: 40, max: 240, value: 120, oninput: schedule });
    const color = h('input', { type: 'color', value: '#ffe600', oninput: schedule });
    const strokeC = h('input', { type: 'color', value: '#000000', oninput: schedule });
    const strokeW = h('input', { type: 'range', min: 0, max: 24, value: 10, oninput: schedule });
    const posV = select([['top', 'Top'], ['middle', 'Middle'], ['bottom', 'Bottom']], 'bottom', { onchange: schedule });
    const posH = select([['left', 'Left'], ['center', 'Center'], ['right', 'Right']], 'left', { onchange: schedule });
    const dim = h('input', { type: 'range', min: 0, max: 70, value: 15, oninput: schedule });
    const shadow = h('input', { type: 'checkbox', checked: true, onchange: schedule });
    const upper = h('input', { type: 'checkbox', checked: true, onchange: schedule });
    const fmt = select([['png', 'PNG'], ['jpg', 'JPG']], 'png');
    const ideas = h('div', { class: 'chips' });
    const ideasBtn = h('button', { class: 'btn small', onclick: titleIdeas }, '✨ Title ideas');
    const canvas = h('canvas', { width: 1280, height: 720, class: 'thumb-canvas' });

    function schedule() { requestAnimationFrame(draw); }

    function setBg(blob) {
      const img = new Image();
      img.onload = () => { bg = img; draw(); };
      img.src = URL.createObjectURL(blob);
    }

    function wrap(ctx, text, maxW) {
      const out = [];
      text.split('\n').forEach((line) => {
        let cur = '';
        line.split(/\s+/).filter(Boolean).forEach((w) => {
          const t = cur ? cur + ' ' + w : w;
          if (ctx.measureText(t).width > maxW && cur) { out.push(cur); cur = w; } else cur = t;
        });
        if (cur) out.push(cur);
      });
      return out;
    }

    async function draw() {
      const my = ++seq;
      const ctx = canvas.getContext('2d');
      const W = 1280, H = 720, M = 56;
      const font = fontSel.value;
      const weight = (FONTS.find((f) => f[0] === font) || [0, '700'])[1];
      let t = title.value, st = sub.value;
      if (upper.checked) { t = t.toUpperCase(); st = st.toUpperCase(); }
      try { await document.fonts.load(weight + ' 64px "' + font + '"', t + st + 'A'); } catch (e) { /* ignore */ }
      if (my !== seq) return;

      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#14161c';
      ctx.fillRect(0, 0, W, H);
      if (bg) {
        const s = Math.max(W / bg.width, H / bg.height);
        const dw = bg.width * s, dh = bg.height * s;
        ctx.drawImage(bg, (W - dw) / 2, (H - dh) / 2, dw, dh);
      }
      if (+dim.value > 0) { ctx.fillStyle = 'rgba(0,0,0,' + (dim.value / 100) + ')'; ctx.fillRect(0, 0, W, H); }

      const blocks = [];
      const mk = (txt, sz) => {
        if (!txt.trim()) return;
        ctx.font = weight + ' ' + sz + 'px "' + font + '", Impact, sans-serif';
        blocks.push({ lines: wrap(ctx, txt, W - M * 2), sz });
      };
      mk(t, +sizeR.value);
      mk(st, Math.round(+sizeR.value * 0.45));
      const gap = 14;
      const total = blocks.reduce((a, b) => a + b.lines.length * b.sz * 1.12, 0) + gap * Math.max(0, blocks.length - 1);
      let y = posV.value === 'top' ? M : posV.value === 'middle' ? (H - total) / 2 : H - M - total;
      const align = posH.value;
      const x = align === 'left' ? M : align === 'right' ? W - M : W / 2;

      ctx.textAlign = align;
      ctx.textBaseline = 'top';
      ctx.lineJoin = 'round';
      blocks.forEach((b, bi) => {
        ctx.font = weight + ' ' + b.sz + 'px "' + font + '", Impact, sans-serif';
        b.lines.forEach((line) => {
          const sw = +strokeW.value;
          ctx.shadowColor = 'transparent';
          if (shadow.checked) { ctx.shadowColor = 'rgba(0,0,0,.65)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 6; }
          if (sw > 0) {
            ctx.lineWidth = sw * 2;
            ctx.strokeStyle = strokeC.value;
            ctx.strokeText(line, x, y);
            ctx.shadowColor = 'transparent';
          }
          ctx.fillStyle = bi === 0 ? color.value : '#ffffff';
          ctx.fillText(line, x, y);
          ctx.shadowColor = 'transparent';
          y += b.sz * 1.12;
        });
        y += gap;
      });
    }

    async function generate() {
      const t = topic.value.trim();
      if (!t) return toast('Describe the thumbnail first');
      const st = STYLES.find((s) => s[0] === style.value)[1];
      const full = [t, st, space.checked ? 'composition with empty space on one side for title text' : '',
        '16:9 YouTube thumbnail, no text, no watermark'].filter(Boolean).join(', ');
      const n = +count.value;
      busy(genBtn, true, 'Generating…');
      for (let i = 0; i < n; i++) {
        const tag = 'Option ' + (i + 1) + '/' + n;
        status.textContent = tag + '…';
        try {
          const r = await Providers.generate('t2i', { prompt: full, width: 1280, height: 720, seed: rand() },
            { status: (name) => { status.textContent = tag + ' · ' + name + '…'; } });
          const card = mediaCard(r, 'thumb');
          card.classList.add('pick');
          card.querySelector('img').addEventListener('click', () => {
            cands.querySelectorAll('.sel').forEach((c) => c.classList.remove('sel'));
            card.classList.add('sel');
            setBg(r.blob);
          });
          cands.prepend(card);
          if (!bg) setBg(r.blob);
        } catch (e) { cands.prepend(errorCard(e.message)); }
      }
      status.textContent = 'Click an option to use it as the background.';
      busy(genBtn, false);
    }

    async function titleIdeas() {
      const t = topic.value.trim() || title.value.trim();
      if (!t) return toast('Write the idea first');
      busy(ideasBtn, true, 'Thinking…');
      try {
        const r = await Providers.generate('text', {
          prompt: 'Give 6 short, punchy YouTube thumbnail titles (max 5 words each) for this video idea: "' + t +
            '". One per line, no numbering, no quotes. Use the same language as the idea.'
        });
        ideas.replaceChildren(...r.text.split('\n').map((s) => s.replace(/^[-*\d.\s"]+|["\s]+$/g, '')).filter(Boolean).slice(0, 8)
          .map((s) => h('span', { class: 'chip', onclick: () => { title.value = s; draw(); } }, s)));
      } catch (e) { toast('Failed: ' + firstLine(e.message)); }
      busy(ideasBtn, false);
    }

    function download() {
      canvas.toBlob((b) => saveBlob(b, 'thumbnail-' + Date.now() + '.' + fmt.value),
        fmt.value === 'jpg' ? 'image/jpeg' : 'image/png', 0.92);
    }

    const el = h('section', { class: 'view' },
      h('div', { class: 'two' },
        h('div', { class: 'panel' },
          h('h2', {}, '1 · Background'),
          field('Idea', topic),
          h('div', { class: 'cols' }, field('Style', style), field('Options', count)),
          h('label', { class: 'field inline' }, space, h('span', {}, 'Leave empty space for the title')),
          h('div', { class: 'row' }, genBtn),
          status, cands,
          h('h3', {}, 'Or upload your own'), upload),
        h('div', { class: 'panel' },
          h('h2', {}, '2 · Text'),
          field('Title', title), ideasBtn, ideas,
          field('Second line', sub),
          h('div', { class: 'cols' }, field('Font', fontSel), field('Text color', color), field('Outline color', strokeC)),
          h('div', { class: 'cols' }, field('Text size', sizeR), field('Outline width', strokeW), field('Darken background', dim)),
          h('div', { class: 'cols' }, field('Vertical', posV), field('Horizontal', posH)),
          h('div', { class: 'row' },
            h('label', { class: 'field inline' }, shadow, h('span', {}, 'Shadow')),
            h('label', { class: 'field inline' }, upper, h('span', {}, 'UPPERCASE')))
        )),
      h('div', { class: 'panel' },
        h('h2', {}, 'Preview (1280×720)'),
        canvas,
        h('div', { class: 'row', style: 'margin-top:10px' }, fmt, h('button', { class: 'btn primary', onclick: download }, '⬇ Download thumbnail'))));

    draw();
    return { el, setBg };
  }

  /* =====================================================================
     VIDEO TAB
     ===================================================================== */
  function buildVideoTab() {
    let mode = 't2v';
    let src = null;
    const modeSel = select([['t2v', 'Text → Video'], ['i2v', 'Image → Video']], 't2v', { onchange: () => { mode = modeSel.value; sync(); } });
    const prompt = h('textarea', { rows: 3, placeholder: 'Describe the video or the motion…' });
    const file = h('input', { type: 'file', accept: 'image/*', onchange: () => { if (file.files[0]) setSource(file.files[0]); } });
    const preview = h('img', { class: 'preview', style: 'display:none' });
    const size = sizeSelect('16:9');
    const dur = select([[3, '3 sec'], [5, '5 sec'], [8, '8 sec'], [10, '10 sec']], 5);
    const motion = select([['zoom-in', 'Zoom in'], ['zoom-out', 'Zoom out'], ['pan-left', 'Pan left'], ['pan-right', 'Pan right']], 'zoom-in');
    const status = h('div', { class: 'status' });
    const grid = h('div', { class: 'grid' });
    const gen = h('button', { class: 'btn primary', onclick: run }, 'Create video');
    const imgBox = h('div', {}, field('Source image', file), preview);
    const motionBox = h('div', { class: 'cols' }, field('Motion (local engine)', motion));
    const note = h('p', { class: 'muted' });

    function setSource(blob) {
      src = blob;
      preview.src = URL.createObjectURL(blob);
      preview.style.display = 'block';
      modeSel.value = 'i2v';
      mode = 'i2v';
      sync();
    }
    function sync() {
      imgBox.style.display = mode === 'i2v' ? '' : 'none';
      motionBox.style.display = mode === 'i2v' ? '' : 'none';
      note.textContent = mode === 'i2v'
        ? 'Image → Video uses the first provider that works. Out of the box that is the local in-browser motion engine; add a custom provider in Settings for AI video.'
        : 'Free text-to-video is limited. Add a Hugging Face key or a custom video API in Settings.';
    }

    async function run() {
      const [w, ht] = SIZES[size.value];
      const p = { prompt: prompt.value.trim(), width: w, height: ht, duration: +dur.value, motion: motion.value, seed: rand() };
      if (mode === 't2v' && !p.prompt) return toast('Write a prompt first');
      if (mode === 'i2v') {
        if (!src) return toast('Choose an image first');
        p.imageBlob = src;
        p.imageB64 = await Net.blobToB64(src);
        p.imageDataUrl = await Net.blobToDataUrl(src);
      }
      busy(gen, true, 'Working…');
      status.textContent = 'Starting…';
      try {
        const r = await Providers.generate(mode, p, { status: (n) => { status.textContent = n + ' is working… keep this tab open.'; } });
        grid.prepend(mediaCard(r, p.prompt || 'video'));
      } catch (e) { grid.prepend(errorCard(e.message)); }
      status.textContent = '';
      busy(gen, false);
    }

    const el = h('section', { class: 'view' },
      h('div', { class: 'panel' },
        h('h2', {}, 'Video'),
        field('Mode', modeSel),
        imgBox,
        field('Prompt', prompt),
        h('div', { class: 'cols' }, field('Size', size), field('Length', dur)),
        motionBox, note,
        h('div', { class: 'row' }, gen), status, grid));
    sync();
    return { el, setSource };
  }

  /* =====================================================================
     BULK TAB
     ===================================================================== */
  function buildBulkTab() {
    let stop = false;
    let results = [];
    const modeSel = select([['t2i', 'Text → Image'], ['t2v', 'Text → Video'], ['i2v', 'Image → Video']], 't2i', { onchange: sync });
    const prompts = h('textarea', { rows: 8, placeholder: 'One prompt per line…' });
    const files = h('input', { type: 'file', accept: 'image/*', multiple: true });
    const per = select([1, 2, 3, 4, 5].map((n) => [n, n + ' per prompt']), 1);
    const conc = select([[1, '1 at a time (safest)'], [2, '2 at a time'], [3, '3 at a time']], 1);
    const delay = h('input', { type: 'number', min: 0, value: 3 });
    const size = sizeSelect('16:9');
    const dur = select([[3, '3 sec'], [5, '5 sec'], [8, '8 sec']], 5);
    const motion = select([['zoom-in', 'Zoom in'], ['zoom-out', 'Zoom out'], ['pan-left', 'Pan left'], ['pan-right', 'Pan right']], 'zoom-in');
    const promptBox = field('Prompts', prompts);
    const fileBox = field('Images', files);
    const motionBox = h('div', { class: 'cols' }, field('Length', dur), field('Motion (local engine)', motion));
    const startBtn = h('button', { class: 'btn primary', onclick: start }, 'Start');
    const stopBtn = h('button', { class: 'btn', onclick: () => { stop = true; status.textContent = 'Stopping after the current jobs…'; } }, 'Stop');
    const zipBtn = h('button', { class: 'btn', onclick: zipAll }, '⬇ Download all (ZIP)');
    const status = h('div', { class: 'status' });
    const barIn = h('i');
    const bar = h('div', { class: 'bar' }, barIn);
    const grid = h('div', { class: 'grid' });

    function sync() {
      const m = modeSel.value;
      promptBox.style.display = m === 'i2v' ? 'none' : '';
      fileBox.style.display = m === 'i2v' ? '' : 'none';
      motionBox.style.display = m === 'i2v' ? '' : 'none';
      per.parentElement.style.display = m === 'i2v' ? 'none' : '';
    }

    async function start() {
      const m = modeSel.value;
      const jobs = [];
      if (m === 'i2v') {
        [...files.files].forEach((f) => jobs.push({ label: f.name, file: f }));
      } else {
        prompts.value.split('\n').map((s) => s.trim()).filter(Boolean)
          .forEach((t) => { for (let i = 0; i < +per.value; i++) jobs.push({ label: t, prompt: t }); });
      }
      if (!jobs.length) return toast(m === 'i2v' ? 'Choose some images' : 'Add at least one prompt');

      stop = false;
      results = [];
      grid.replaceChildren();
      busy(startBtn, true, 'Running…');
      const [w, ht] = SIZES[size.value];
      const slots = jobs.map((j) => {
        const s = h('figure', { class: 'card' }, h('div', { class: 'ph' }, 'Queued · ' + j.label.slice(0, 40)));
        grid.append(s);
        return s;
      });

      let next = 0, done = 0;
      const delayMs = Math.max(0, +delay.value || 0) * 1000;
      const setProgress = () => {
        barIn.style.width = (done / jobs.length * 100) + '%';
        status.textContent = done + ' / ' + jobs.length + ' finished';
      };
      setProgress();

      async function worker() {
        while (!stop && next < jobs.length) {
          const idx = next++;
          const job = jobs[idx];
          slots[idx].replaceChildren(h('div', { class: 'ph' }, 'Working…'));
          try {
            const p = { prompt: job.prompt || '', width: w, height: ht, seed: rand(), duration: +dur.value, motion: motion.value };
            if (job.file) {
              p.imageBlob = job.file;
              p.imageB64 = await Net.blobToB64(job.file);
              p.imageDataUrl = await Net.blobToDataUrl(job.file);
            }
            const r = await Providers.generate(m, p);
            results.push({ label: job.label, r });
            slots[idx].replaceWith(slots[idx] = mediaCard(r, job.label));
          } catch (e) {
            const c = errorCard(job.label.slice(0, 40) + '\n' + e.message);
            slots[idx].replaceWith(slots[idx] = c);
          }
          done++;
          setProgress();
          if (next < jobs.length && !stop && delayMs) await sleep(delayMs);
        }
      }
      await Promise.all(Array.from({ length: +conc.value }, worker));
      status.textContent = (stop ? 'Stopped. ' : 'Finished. ') + results.length + ' of ' + jobs.length + ' succeeded.';
      busy(startBtn, false);
    }

    async function zipAll() {
      if (!results.length) return toast('Nothing to download yet');
      if (!window.JSZip) return toast('ZIP library did not load. Download items one by one.');
      const z = new JSZip();
      results.forEach((x, i) => z.file(String(i + 1).padStart(3, '0') + '_' + slug(x.label) + '.' + extOf(x.r.blob.type), x.r.blob));
      saveBlob(await z.generateAsync({ type: 'blob' }), 'bulk-' + Date.now() + '.zip');
    }

    const el = h('section', { class: 'view' },
      h('div', { class: 'panel' },
        h('h2', {}, 'Bulk generate'),
        field('Type', modeSel),
        promptBox, fileBox,
        h('div', { class: 'cols' }, field('Size', size), h('label', { class: 'field' }, h('span', {}, 'Repeat'), per),
          field('Parallel jobs', conc), field('Pause between jobs (sec)', delay)),
        motionBox,
        h('p', { class: 'muted' }, 'Tip: free APIs have rate limits. Keep parallel at 1 and pause at 3+ seconds. If one key hits its limit, the next key in Settings is used automatically.'),
        h('div', { class: 'row' }, startBtn, stopBtn, zipBtn),
        status, bar, grid));
    sync();
    return { el };
  }

  /* =====================================================================
     SETTINGS TAB
     ===================================================================== */
  function buildSettingsTab() {
    const el = h('section', { class: 'view' });

    function inputFor(def, get, set, tag = 'input', extra = {}) {
      const c = h(tag, Object.assign({ value: get() }, extra, { onchange: () => set(c.value) }));
      return c;
    }

    function providerCard(prov, open) {
      const enabled = h('input', { type: 'checkbox', checked: Store.isEnabled(prov.id), onchange: () => { Store.setEnabled(prov.id, enabled.checked); render(); } });
      const keys = h('textarea', {
        rows: 3, value: Store.keys(prov.id).join('\n'),
        placeholder: prov.needsKey
          ? 'One API key per line. The next key is used when one hits its limit.'
          : 'Optional. One key per line.',
        onchange: () => Store.setKeys(prov.id, keys.value.split('\n').map((s) => s.trim()).filter(Boolean))
      });
      const body = h('div', { class: 'body' },
        prov.note ? h('p', { class: 'muted' }, prov.note) : null,
        h('label', { class: 'field inline' }, enabled, h('span', {}, 'Enabled')),
        prov.custom ? customForm(prov.def) : null,
        (prov.needsKey || prov.custom || prov.fields.length || prov.id === 'pollinations')
          ? field('API keys  (tip: ' + '{{ENV:STUDIO_KEY_NAME}}' + ' reads a key from Netlify)', keys) : null,
        prov.fields.map((f) => field(f.label,
          inputFor(prov, () => Store.field(prov.id, f.id, f.def), (v) => Store.setField(prov.id, f.id, v.trim()), 'input', { type: 'text' }))),
        h('div', { class: 'row' }, prov.kinds.includes('text') || prov.kinds.includes('t2i')
          ? h('button', { class: 'btn small', onclick: (e) => test(prov, e.target) }, 'Test') : null,
          prov.custom ? h('button', { class: 'btn small danger', onclick: () => remove(prov) }, 'Delete provider') : null));
      return h('details', Object.assign({ class: 'prov' }, open ? { open: true } : {}),
        h('summary', {}, h('strong', {}, prov.name),
          prov.kinds.map((k) => h('span', { class: 'badge' }, Providers.KINDS[k])),
          h('span', { class: 'badge ' + (Store.isEnabled(prov.id) ? 'on' : '') }, Store.isEnabled(prov.id) ? 'on' : 'off'),
          Store.keys(prov.id).length ? h('span', { class: 'badge' }, Store.keys(prov.id).length + ' key(s)') : null),
        body);
    }

    function customForm(d) {
      const save = () => Store.save();
      const kindsRow = h('div', { class: 'row' }, ['t2i', 't2v', 'i2v', 'text'].map((k) => {
        const cb = h('input', {
          type: 'checkbox', checked: (d.kinds || []).includes(k),
          onchange: () => { d.kinds = ['t2i', 't2v', 'i2v', 'text'].filter((x) => x === k ? cb.checked : (d.kinds || []).includes(x)); save(); }
        });
        return h('label', { class: 'field inline' }, cb, h('span', {}, Providers.KINDS[k]));
      }));
      const bind = (prop, tag, extra) => {
        const c = h(tag, Object.assign({ value: d[prop] || '' }, extra || {}, { onchange: () => { d[prop] = c.value; save(); } }));
        return c;
      };
      return h('div', {},
        field('Name', bind('name', 'input', { type: 'text' })),
        h('p', { class: 'muted' }, 'Works for tasks (Settings → priority list decides which provider goes first):'),
        kindsRow,
        field('Request URL', bind('url', 'input', { type: 'text', placeholder: 'https://api.example.com/v1/images/generations' })),
        h('div', { class: 'cols' },
          field('Method', (() => { const s = select([['POST', 'POST'], ['GET', 'GET']], d.method || 'POST'); s.onchange = () => { d.method = s.value; save(); }; return s; })()),
          field('Response type', (() => { const s = select([['json', 'JSON (url or base64 inside)'], ['binary', 'Raw image/video file']], d.mode || 'json'); s.onchange = () => { d.mode = s.value; save(); }; return s; })())),
        field('Headers (one per line)', bind('headers', 'textarea', { rows: 3 })),
        field('JSON body template', bind('body', 'textarea', { rows: 5 })),
        h('p', { class: 'muted' }, 'Placeholders: {{prompt}} {{width}} {{height}} {{seed}} {{duration}} {{motion}} {{image_base64}} {{image_data_url}} {{key}}'),
        field('Result path in the JSON', bind('resultPath', 'input', { type: 'text', placeholder: 'data[0].url   or   data[0].b64_json' })),
        h('h3', {}, 'Async jobs (optional, for video APIs)'),
        field('Status URL  (leave empty if the first response already has the result)', bind('pollUrl', 'input', { type: 'text', placeholder: 'https://api.example.com/v1/jobs/{{id}}' })),
        field('Job id path in the first response', bind('idPath', 'input', { type: 'text', placeholder: 'id' })));
    }

    function remove(prov) {
      if (!confirm('Delete "' + prov.name + '"?')) return;
      Store.cfg.custom = Store.cfg.custom.filter((c) => c.id !== prov.id);
      delete Store.cfg.keys[prov.id];
      Store.save();
      render();
    }

    async function test(prov, btn) {
      busy(btn, true, 'Testing…');
      try {
        if (prov.kinds.includes('text')) {
          const r = await Providers.runOne(prov, 'text', { prompt: 'Reply with just the word: ready' });
          toast('✅ ' + prov.name + ' works: ' + r.text.slice(0, 60));
        } else {
          const r = await Providers.runOne(prov, 't2i', { prompt: 'a red apple on a table', width: 512, height: 512, seed: 1 });
          toast('✅ ' + prov.name + ' works (' + Math.round(r.blob.size / 1024) + ' KB image)');
        }
      } catch (e) { toast('❌ ' + prov.name + ': ' + firstLine(e.message)); }
      busy(btn, false);
    }

    function addCustom() {
      const d = {
        id: 'c_' + Date.now(), name: 'My custom API', kinds: ['t2i'], method: 'POST', mode: 'json',
        url: '', headers: 'Authorization: Bearer {{key}}\nContent-Type: application/json',
        body: '{\n  "model": "MODEL-NAME",\n  "prompt": "{{prompt}}",\n  "size": "{{width}}x{{height}}",\n  "response_format": "b64_json"\n}',
        resultPath: 'data[0].b64_json', pollUrl: '', idPath: 'id'
      };
      Store.cfg.custom.push(d);
      Store.save();
      render(d.id);
    }

    function priority() {
      const wrap = h('div', { class: 'order' });
      ['t2i', 'text', 't2v', 'i2v'].forEach((kind) => {
        const ids = Providers.order(kind);
        wrap.append(h('h3', {}, Providers.KINDS[kind] + ' — tried in this order'),
          h('ul', {}, ids.map((id, i) => {
            const p = Providers.get(id);
            const move = (d) => { const a = ids.slice(); const j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; Providers.setOrder(kind, a); render(); };
            return h('li', {},
              h('button', { class: 'btn small', onclick: () => move(-1) }, '↑'),
              h('button', { class: 'btn small', onclick: () => move(1) }, '↓'),
              h('span', {}, (i + 1) + '. ' + p.name),
              Store.isEnabled(id) ? null : h('span', { class: 'badge' }, 'off'));
          })));
      });
      return wrap;
    }

    function network() {
      const proxy = select([['auto', 'Auto (direct first, proxy if blocked)'], ['always', 'Always use proxy'], ['never', 'Never use proxy']], Store.cfg.useProxy,
        { onchange: () => { Store.cfg.useProxy = proxy.value; Store.save(); } });
      const pass = h('input', { type: 'password', value: Store.cfg.passcode || '', placeholder: 'Same as STUDIO_PASSCODE in Netlify',
        onchange: () => { Store.cfg.passcode = pass.value; Store.save(); } });
      return h('div', { class: 'cols' }, field('Proxy mode', proxy), field('Proxy passcode', pass));
    }

    function backup() {
      const imp = h('input', { type: 'file', accept: 'application/json', onchange: async () => {
        try { Store.importJSON(await imp.files[0].text()); toast('Settings imported'); render(); } catch (e) { toast('Import failed: ' + e.message); }
      } });
      return h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => saveBlob(new Blob([Store.exportJSON()], { type: 'application/json' }), 'ai-studio-settings.json') }, 'Export settings'),
        imp,
        h('button', { class: 'btn danger', onclick: () => { if (confirm('Erase all saved settings and keys in this browser?')) { Store.reset(); render(); } } }, 'Erase everything'));
    }

    function render(openId) {
      el.replaceChildren(
        h('div', { class: 'panel' },
          h('h2', {}, 'Providers & API keys'),
          h('p', { class: 'muted' }, 'Keys are saved only in this browser (localStorage). Do not use this on a shared computer. To keep keys off the browser, use {{ENV:STUDIO_KEY_NAME}} and set that variable in Netlify.'),
          Providers.all().map((p) => providerCard(p, p.id === openId)),
          h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: addCustom }, '+ Add custom provider'))),
        h('div', { class: 'panel' }, h('h2', {}, 'Priority'), h('p', { class: 'muted' }, 'If a provider fails or has no key, the next one in the list is tried.'), priority()),
        h('div', { class: 'panel' }, h('h2', {}, 'Network'), network()),
        h('div', { class: 'panel' }, h('h2', {}, 'Backup'), backup()));
    }

    render();
    return { el, render };
  }

  /* =====================================================================
     INIT
     ===================================================================== */
  function init() {
    const TABS = [['image', '🖼 Image'], ['thumb', '🎯 Thumbnail'], ['video', '🎬 Video'], ['bulk', '📦 Bulk'], ['settings', '⚙ Settings']];
    const views = {
      image: buildImageTab(),
      thumb: buildThumbTab(),
      video: buildVideoTab(),
      bulk: buildBulkTab(),
      settings: buildSettingsTab()
    };
    ctl.thumb = views.thumb;
    ctl.video = views.video;

    const tabs = document.getElementById('tabs');
    const main = document.getElementById('view');
    const btns = {};
    TABS.forEach(([id, label]) => {
      btns[id] = h('button', { onclick: () => go(id) }, label);
      tabs.append(btns[id]);
      main.append(views[id].el);
    });

    function go(id) {
      TABS.forEach(([t]) => {
        views[t].el.classList.toggle('active', t === id);
        btns[t].classList.toggle('active', t === id);
      });
      if (id === 'settings') views.settings.render();
      try { history.replaceState(null, '', '#' + id); } catch (e) { /* ignore */ }
    }
    ctl.go = go;
    const start = (location.hash || '').slice(1);
    go(views[start] ? start : 'image');
  }

  document.addEventListener('DOMContentLoaded', init);
})();

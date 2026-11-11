/* Settings store: everything lives in this browser's localStorage. */
(function () {
  const KEY = 'aistudio.config.v1';
  const DEF = {
    keys: {},        // providerId -> [api keys]
    fields: {},      // providerId -> {fieldId: value}
    enabled: {},     // providerId -> bool
    order: {},       // kind -> [providerIds]
    custom: [],      // user-defined providers
    passcode: '',    // passcode for the Netlify proxy (optional)
    useProxy: 'auto' // auto | always | never
  };
  const clone = (o) => JSON.parse(JSON.stringify(o));

  function load() {
    let o = {};
    try { o = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { /* ignore */ }
    return Object.assign(clone(DEF), o);
  }

  let cfg = load();

  const api = {
    get cfg() { return cfg; },
    save() {
      try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) { console.warn('save failed', e); }
    },
    keys(id) { return (cfg.keys[id] || []).map((s) => String(s).trim()).filter(Boolean); },
    setKeys(id, arr) { cfg.keys[id] = arr; api.save(); },
    field(id, f, def) {
      const v = cfg.fields[id] && cfg.fields[id][f];
      return v === undefined || v === '' ? def : v;
    },
    setField(id, f, v) { (cfg.fields[id] = cfg.fields[id] || {})[f] = v; api.save(); },
    isEnabled(id) { return cfg.enabled[id] !== false; },
    setEnabled(id, v) { cfg.enabled[id] = !!v; api.save(); },
    exportJSON() { return JSON.stringify(cfg, null, 2); },
    importJSON(text) {
      const o = JSON.parse(text);
      cfg = Object.assign(clone(DEF), o);
      api.save();
    },
    reset() { cfg = clone(DEF); api.save(); }
  };

  window.Store = api;
})();

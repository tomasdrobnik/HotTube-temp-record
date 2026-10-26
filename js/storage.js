/* Úložiště: data/state.json v GitHub repu přes Contents API. localStorage = cache + fronta, nikdy jediné úložiště.
   Token žije jen v localStorage zařízení (klíč TOKEN_KEY) a nikdy se nelogguje ani nedává do URL. */

export const SCHEMA = 1;
export const TOKEN_KEY = 'hottube.token';
export const CACHE_KEY = 'hottube.cache';
export const REPO_KEY = 'hottube.repo';
export const DEFAULT_REPO = { owner: 'tomasdrobnik', repo: 'HotTube-temp-record', path: 'data/state.json', branch: 'main' };

const clone = o => JSON.parse(JSON.stringify(o));
export const newId = () => 'm_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function defaultState() {
  return {
    schema: SCHEMA, gen: 0, updated: 0, updatedBy: '',
    session: { mode: 'heat', target: 40, coolStart: null, coolThr: 4, coolTa: null },
    csv: [], manual: [],
    stoke: { interval: 30, next: null, log: [] },
    filt: { factor: 1.5, windows: [{ h: 1, m: 20, d: 30 }, { h: 3, m: 40, d: 30 }, { h: 5, m: 40, d: 30 }, { h: 10, m: 0, d: 120 }] },
    archive: [],
  };
}

/* ===== Migrace (včetně plochého formátu prototypu) ===== */
export function migrate(raw) {
  if (!raw || typeof raw !== 'object') return defaultState();
  const d = defaultState();
  if (raw.schema >= 1 && raw.session) { // aktuální formát – doplnit chybějící pole
    const s = { ...d, ...clone(raw) };
    s.session = { ...d.session, ...(raw.session || {}) };
    s.stoke = { ...d.stoke, ...(raw.stoke || {}), log: [...(raw.stoke?.log || [])] };
    s.filt = { ...d.filt, ...(raw.filt || {}) };
    s.manual = (s.manual || []).map(m => ({ ...m, id: m.id || 'm_p' + Math.round(m.t).toString(36) }));
    s.csv = s.csv || []; s.archive = s.archive || []; s.schema = SCHEMA; s.gen = s.gen || 0;
    return s;
  }
  // prototyp: csvText, csvName, manual[{t,T,amb,ambSrc,src,mix,bath}], mode, coolStart, coolTa, coolThr, filt[], filtF, stoke, updated
  const s = clone(d);
  if (typeof raw.csvText === 'string' && raw.csvText.trim()) s.csv = [{ name: raw.csvName || 'import', importedAt: raw.updated || 0, text: raw.csvText }];
  s.manual = (raw.manual || []).map(m => {
    const o = { id: 'm_p' + Math.round(m.t).toString(36), t: m.t, T: m.T, mix: !!m.mix, bath: !!m.bath, stoke: !!m.stoke, note: m.note || '' };
    if (m.amb != null) { o.amb = m.amb; o.ambSrc = m.ambSrc || 'man'; }
    return o;
  });
  s.session = { mode: raw.mode === 'cool' ? 'cool' : 'heat', target: raw.target ?? 40, coolStart: raw.coolStart ?? null, coolThr: raw.coolThr ?? 4, coolTa: raw.coolTa ?? null };
  if (raw.stoke) s.stoke = { interval: raw.stoke.interval || 30, next: raw.stoke.next ?? null, log: [...(raw.stoke.log || [])] };
  if (Array.isArray(raw.filt)) s.filt.windows = raw.filt.map(w => ({ h: w.h, m: w.m, d: w.d }));
  if (raw.filtF) s.filt.factor = raw.filtF;
  s.updated = raw.updated || 0;
  return s;
}

/* ===== Sloučení lokálního a vzdáleného stavu (bez tiché ztráty) ===== */
export function mergeStates(local, remote, now = 0) {
  local = migrate(local); remote = migrate(remote);
  if (local.gen !== remote.gen) { // „Nový ohřev“ proběhl jinde: vyšší generace vyhrává, nesesynchronizované ruční body druhé strany jdou do archivu
    const [win, lose] = local.gen > remote.gen ? [local, remote] : [remote, local];
    const out = clone(win);
    const orphans = (lose === local ? local.manual : []).filter(m => !m.deleted);
    if (orphans.length) out.archive.push({ closedAt: now, summary: { orphaned: true, count: orphans.length }, manual: orphans });
    return out;
  }
  const out = clone(remote);
  out.session = clone(local.session); out.filt = clone(local.filt);
  out.stoke = { ...clone(local.stoke), log: [...new Set([...remote.stoke.log, ...local.stoke.log])].sort((a, b) => a - b) };
  const byId = new Map();
  for (const m of remote.manual) byId.set(m.id, m);
  for (const m of local.manual) {
    const r = byId.get(m.id);
    if (!r) { byId.set(m.id, m); continue; }
    const win = (m.mod || 0) >= (r.mod || 0) ? m : r; // novější úprava vyhrává, shoda = lokální
    byId.set(m.id, { ...win, deleted: !!(m.deleted || r.deleted) || undefined });
  }
  out.manual = [...byId.values()].sort((a, b) => a.t - b.t);
  const csvKey = c => c.name + '|' + c.importedAt;
  const csv = new Map(); for (const c of [...remote.csv, ...local.csv]) csv.set(csvKey(c), c);
  out.csv = [...csv.values()].sort((a, b) => a.importedAt - b.importedAt);
  const arc = new Map(); for (const a of [...remote.archive, ...local.archive]) arc.set(a.closedAt + '|' + (a.summary?.start ?? ''), a);
  out.archive = [...arc.values()].sort((a, b) => a.closedAt - b.closedAt);
  return out;
}

/* ===== Base64 UTF-8 ===== */
export function toB64(str) { const b = new TextEncoder().encode(str); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); }
export function fromB64(b64) { const s = atob(b64.replace(/\s/g, '')); const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return new TextDecoder().decode(b); }

/* ===== Store ===== */
const API = 'https://api.github.com';

export class Store {
  /** opts: {fetch, kv (getItem/setItem/removeItem), now:()=>ms, device, debounceMs, repo} */
  constructor(opts = {}) {
    this.fetch = opts.fetch || ((...a) => globalThis.fetch(...a));
    this.kv = opts.kv || globalThis.localStorage;
    this.now = opts.now || Date.now;
    this.device = opts.device || 'zařízení';
    this.debounceMs = opts.debounceMs ?? 1500;
    this.repo = { ...DEFAULT_REPO, ...(opts.repo || this._kvGet(REPO_KEY) || {}) };
    this.state = defaultState();
    this.sha = null; this.etag = null;
    this.rev = 0; this.savedRev = 0; this.msg = '';
    this.status = { kind: 'init', text: 'načítám…' };
    this.listeners = new Set(); this.statusListeners = new Set();
    this.chain = Promise.resolve(); this.timer = null; this.lastSync = null;
  }
  /* --- pomocné --- */
  _kvGet(k) { try { return JSON.parse(this.kv.getItem(k)); } catch { return null; } }
  _kvSet(k, v) { try { this.kv.setItem(k, JSON.stringify(v)); return true; } catch { return false; } }
  get token() { try { return this.kv.getItem(TOKEN_KEY) || ''; } catch { return ''; } }
  setToken(t) { try { t ? this.kv.setItem(TOKEN_KEY, t.trim()) : this.kv.removeItem(TOKEN_KEY); } catch { /* bez úložiště nelze */ } this.status = { kind: 'idle', text: '' }; this._emitStatus(); }
  get pending() { return this.rev - this.savedRev; }
  onChange(cb) { this.listeners.add(cb); return () => this.listeners.delete(cb); }
  onStatus(cb) { this.statusListeners.add(cb); return () => this.statusListeners.delete(cb); }
  _emit() { this.listeners.forEach(cb => cb(this.state)); }
  _setStatus(kind, text) { this.status = { kind, text }; this.statusListeners.forEach(cb => cb(this.status)); }
  _emitStatus() { // odvozený stav, když se nic neděje
    if (this.status.kind === 'error') return; // chyba zůstane viditelná, dokud se něco nepodaří
    if (this.pending > 0) this._setStatus(this.token ? 'pending' : 'readonly', this.token ? `čeká ${this.pending} ${this.pending === 1 ? 'změna' : this.pending < 5 ? 'změny' : 'změn'}` : `jen čtení – chybí token · neuloženo: ${this.pending}`);
    else if (!this.token) this._setStatus('readonly', 'jen čtení – chybí token');
    else if (this.lastSync) this._setStatus('ok', 'synchronizováno ' + this.lastSync);
  }
  _persist() { this._kvSet(CACHE_KEY, { state: this.state, sha: this.sha, pending: this.pending, msg: this.msg }); }
  _headers(write) {
    const h = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    if (this.token) h.Authorization = 'Bearer ' + this.token;
    if (write) h['Content-Type'] = 'application/json';
    return h;
  }
  get _url() { const r = this.repo; return `${API}/repos/${r.owner}/${r.repo}/contents/${r.path}`; }
  _hm() { return new Date(this.now()).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Prague' }); }

  /* --- veřejné API --- */
  /** Načte cache (okamžité první vykreslení) a pak data z GitHubu. */
  async init() {
    const c = this._kvGet(CACHE_KEY);
    if (c && c.state) {
      this.state = migrate(c.state); this.sha = c.sha || null;
      this.rev = c.pending || 0; this.savedRev = 0; this.msg = c.msg || '';
      this._emit(); this._emitStatus();
    }
    return this.refresh();
  }
  /** Změna stavu: fn dostane kopii, vrátí nic (upraví ji). Okamžitě do cache, commit po debounce. */
  mutate(fn, msg) {
    const draft = clone(this.state); fn(draft);
    draft.schema = SCHEMA; this.state = draft;
    this.rev++; this.msg = msg || this.msg || 'úprava dat';
    this._persist(); this._emit(); this._emitStatus();
    clearTimeout(this.timer);
    if (this.token) this.timer = setTimeout(() => this.flush(), this.debounceMs);
  }
  _queue(job) { const p = this.chain.then(job, job); this.chain = p.catch(() => {}); return p; }
  flush() { clearTimeout(this.timer); return this._queue(() => this._save()); }
  refresh() { return this._queue(() => this._refresh()); }
  /** Ověří token: GET /repos/{o}/{r}. → {ok, push, msg} */
  async verify() {
    try {
      const r = await this.fetch(`${API}/repos/${this.repo.owner}/${this.repo.repo}`, { headers: this._headers(), cache: 'no-store' });
      if (r.status === 401) return { ok: false, msg: 'Token je neplatný nebo vypršel (401).' };
      if (r.status === 404) return { ok: false, msg: this.token ? 'Repo nenalezeno – token nemá přístup, nebo je špatný název (404).' : 'Repo nenalezeno (404).' };
      if (!r.ok) return { ok: false, msg: 'GitHub vrátil ' + r.status };
      const j = await r.json(); const push = !!(j.permissions && j.permissions.push);
      return { ok: true, push, msg: push ? 'Token funguje, zápis povolen.' : 'Repo je čitelné, ale token nemá oprávnění k zápisu (Contents: Read and write).' };
    } catch { return { ok: false, msg: 'Bez připojení k api.github.com.' }; }
  }

  /* --- vnitřní operace --- */
  async _get(useEtag) {
    const h = this._headers(); if (useEtag && this.etag) h['If-None-Match'] = this.etag;
    const r = await this.fetch(`${this._url}?ref=${encodeURIComponent(this.repo.branch)}`, { headers: h, cache: 'no-store' });
    if (r.status === 304) return { notModified: true };
    if (r.status === 404) return { missing: true };
    if (!r.ok) throw Object.assign(new Error('GET ' + r.status), { status: r.status });
    const j = await r.json();
    if (!j.content && j.size > 0) throw Object.assign(new Error('Soubor je větší než 1 MB – Contents API ho nevrátí. Archivuj starší data.'), { status: 413 });
    return { sha: j.sha, etag: r.headers.get('etag'), state: migrate(JSON.parse(fromB64(j.content || ''))) };
  }
  _fail(e) {
    const s = e.status;
    if (s === 401) this._setStatus('error', 'chyba: token neplatný nebo vypršel – vlož nový v sekci Synchronizace');
    else if (s === 403) this._setStatus('error', 'chyba: 403 – token nemá oprávnění Contents: Read and write, nebo je vyčerpán limit API');
    else if (s === 404) this._setStatus('error', 'chyba: repo/soubor nenalezen – zkontroluj název repa a přístup tokenu');
    else if (s) this._setStatus('error', 'chyba: ' + (e.message || s));
    else this._setStatus(this.pending > 0 ? 'pending' : 'offline', this.pending > 0 ? `čeká ${this.pending} změn (offline)` : 'offline – zobrazena uložená kopie');
  }
  async _refresh() {
    if (this.status.kind !== 'error' && !this.lastSync) this._setStatus('loading', 'načítám…');
    try {
      const g = await this._get(this.pending === 0);
      this.status = { kind: 'idle', text: '' };
      if (g.notModified) { this.lastSync = this._hm(); this._emitStatus(); return false; }
      if (g.missing) { if (this.pending === 0 && !this.sha) { this.lastSync = this._hm(); } this._emitStatus(); return false; }
      const changed = g.sha !== this.sha;
      this.etag = g.etag || null;
      if (this.pending === 0) { this.state = g.state; this.sha = g.sha; }
      else { this.state = mergeStates(this.state, g.state, this.now()); this.sha = g.sha; }
      this.lastSync = this._hm(); this._persist();
      if (changed) this._emit();
      this._emitStatus();
      if (this.pending > 0 && this.token) await this._save();
      return changed;
    } catch (e) { this._fail(e); return false; }
  }
  async _save() {
    if (this.pending === 0 || !this.token) { this._emitStatus(); return; }
    this._setStatus('saving', 'ukládám…');
    for (let attempt = 0; attempt < 3; attempt++) {
      const rev0 = this.rev, snap = clone(this.state);
      snap.updated = this.now(); snap.updatedBy = this.device;
      const body = { message: `${this.msg} (${this.device})`, content: toB64(JSON.stringify(snap, null, 2) + '\n'), branch: this.repo.branch };
      if (this.sha) body.sha = this.sha;
      let r;
      try { r = await this.fetch(this._url, { method: 'PUT', headers: this._headers(true), body: JSON.stringify(body) }); }
      catch (e) { this._fail({ message: String(e) }); return; }
      if (r.ok) {
        const j = await r.json(); this.sha = j.content.sha; this.etag = null; this.savedRev = rev0;
        this.state.updated = snap.updated; this.state.updatedBy = snap.updatedBy;
        this.lastSync = this._hm(); this._persist(); this.status = { kind: 'idle', text: '' }; this._emitStatus();
        if (this.pending > 0) { attempt = -1; continue; } // během ukládání přišla další změna
        return;
      }
      if (r.status === 409 || r.status === 422) { // sha neodpovídá → načíst, sloučit, znovu
        try {
          const g = await this._get(false);
          if (g.missing) { this.sha = null; continue; }
          this.state = mergeStates(this.state, g.state, this.now()); this.sha = g.sha; this._persist(); this._emit();
        } catch (e) { this._fail(e); return; }
        continue;
      }
      this._fail({ status: r.status, message: 'PUT ' + r.status });
      return;
    }
    this._setStatus('error', `chyba: konflikt se nepodařilo vyřešit (3 pokusy) – ${this.pending} změn čeká, zkusím znovu`);
  }
}

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Store, migrate, mergeStates, defaultState, toB64, fromB64, TOKEN_KEY, CACHE_KEY, SCHEMA } from '../js/storage.js';
import { parseAllCSV } from '../js/analysis.js';

const kvOf = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), _m: m }; };
const proto = () => JSON.parse(fs.readFileSync(new URL('../fixtures/state-prototype.json', import.meta.url), 'utf8'));

/** Falešný GitHub Contents API: jeden soubor, sha se mění s každým PUT, špatné sha → 409. */
function fakeGithub(initial) {
  const g = { content: initial == null ? null : JSON.stringify(initial), n: 1, puts: [], gets: 0, offline: false, status: null, log: [] };
  g.sha = () => 'sha' + g.n;
  const res = (status, body, headers = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body, headers: { get: k => headers[k.toLowerCase()] ?? null } });
  g.fetch = async (url, opt = {}) => {
    g.log.push({ url, opt });
    if (g.offline) throw new TypeError('Failed to fetch');
    if (g.status) return res(g.status, {});
    const method = opt.method || 'GET';
    if (!url.includes('/contents/')) return res(200, { permissions: { push: true } });
    if (method === 'GET') {
      g.gets++;
      if (g.content == null) return res(404, {});
      if (opt.headers['If-None-Match'] === 'W/"' + g.sha() + '"') return res(304, {});
      return res(200, { sha: g.sha(), size: g.content.length, content: toB64(g.content) }, { etag: 'W/"' + g.sha() + '"' });
    }
    const body = JSON.parse(opt.body);
    if (g.content != null && body.sha !== g.sha()) return res(409, { message: 'sha does not match' });
    if (g.content == null && body.sha) return res(422, {});
    g.content = fromB64(body.content); g.n++; g.puts.push(body);
    return res(200, { content: { sha: g.sha() } });
  };
  g.state = () => JSON.parse(g.content);
  return g;
}
const mk = (g, device, kv = kvOf(), withToken = true) => { if (withToken) kv.setItem(TOKEN_KEY, 'ghp_TESTTOKEN'); return new Store({ fetch: g.fetch, kv, device, debounceMs: 0, now: () => 1792990000000 }); };

test('migrace prototypového formátu (fixtures/state-prototype.json = state.json ze startovního balíku)', () => {
  const s = migrate(proto());
  assert.equal(s.schema, SCHEMA);
  assert.equal(s.csv.length, 1); assert.match(s.csv[0].text, /^Time\tTemperature/);
  assert.equal(parseAllCSV(s.csv, 0).pts.length > 100, true);
  assert.equal(s.manual.length, 2); assert.ok(s.manual.every(m => /^m_/.test(m.id)));
  assert.equal(s.manual[1].bath, true); assert.equal(s.manual[1].mix, true); assert.equal(s.manual[0].ambSrc, 'pred');
  assert.deepEqual(s.session, { mode: 'cool', target: 40, coolStart: 1792954260000, coolThr: 4, coolTa: null });
  assert.equal(s.filt.factor, 1.5); assert.equal(s.filt.windows.length, 4);
  assert.deepEqual(s.stoke, { interval: 30, next: null, log: [] });
  assert.deepEqual(migrate(proto()).manual.map(m => m.id), s.manual.map(m => m.id)); // ID deterministická → dvě zařízení = stejná data
  assert.deepEqual(migrate(s), s); // idempotentní
  assert.deepEqual(migrate(null), defaultState());
});

test('merge: ruční body podle id, tombstone, stoke.log sjednocen, lokální session', () => {
  const base = defaultState();
  const a = { id: 'm_1', t: 1, T: 30 }, b = { id: 'm_2', t: 2, T: 31 }, c = { id: 'm_3', t: 3, T: 32 };
  const remote = { ...base, manual: [a, b], stoke: { interval: 30, next: 5, log: [1, 2] } };
  const local = { ...base, manual: [{ ...a, deleted: true }, c], stoke: { interval: 20, next: 9, log: [2, 3] }, session: { ...base.session, target: 38 } };
  const m = mergeStates(local, remote);
  assert.deepEqual(m.manual.map(x => x.id), ['m_1', 'm_2', 'm_3']);
  assert.equal(m.manual[0].deleted, true);
  assert.deepEqual(m.stoke.log, [1, 2, 3]); assert.equal(m.stoke.interval, 20); assert.equal(m.session.target, 38);
  // tombstone ze vzdálené strany nelze oživit starou lokální kopií
  const m2 = mergeStates({ ...base, manual: [a] }, { ...base, manual: [{ ...a, deleted: true }] });
  assert.equal(m2.manual[0].deleted, true);
  // novější úprava vyhrává
  const m3 = mergeStates({ ...base, manual: [{ ...a, T: 99, mod: 5 }] }, { ...base, manual: [{ ...a, T: 50, mod: 9 }] });
  assert.equal(m3.manual[0].T, 50);
});

test('merge: jiná generace („Nový ohřev“ jinde) – body z poražené strany jdou do archivu, ne do ztracena', () => {
  const l = { ...defaultState(), gen: 0, manual: [{ id: 'm_x', t: 7, T: 36 }] };
  const r = { ...defaultState(), gen: 1, manual: [] };
  const m = mergeStates(l, r, 123);
  assert.equal(m.gen, 1); assert.equal(m.manual.length, 0);
  assert.equal(m.archive.length, 1); assert.equal(m.archive[0].manual[0].id, 'm_x');
});

test('Store: zápis = jeden commit po debounce, token není v těle ani v cache', async () => {
  const g = fakeGithub(defaultState()); const kv = kvOf(); const s = mk(g, 'iPhone', kv);
  await s.init();
  s.mutate(d => d.manual.push({ id: 'm_1', t: 1, T: 37.9 }), 'zápis 21:30 37,9 °C');
  s.mutate(d => d.manual.push({ id: 'm_2', t: 2, T: 38 }), 'zápis 21:40 38 °C');
  assert.equal(s.pending, 2);
  await s.flush();
  assert.equal(g.puts.length, 1); assert.equal(g.state().manual.length, 2); assert.equal(g.state().updatedBy, 'iPhone');
  assert.match(g.puts[0].message, /iPhone/); assert.equal(s.pending, 0); assert.equal(s.status.kind, 'ok');
  assert.ok(!JSON.stringify(g.puts).includes('TESTTOKEN')); assert.ok(!kv.getItem(CACHE_KEY).includes('TESTTOKEN'));
  assert.ok(!g.log.some(l => l.url.includes('TESTTOKEN'))); // token nikdy v URL
  assert.equal(g.log.find(l => l.opt.method === 'PUT').opt.headers.Authorization, 'Bearer ghp_TESTTOKEN');
});

test('Store: soubor v prototypovém formátu se načte, zmigruje a při prvním zápisu přepíše novým schématem', async () => {
  const g = fakeGithub(proto()); const s = mk(g, 'Mac');
  await s.init(); assert.equal(s.state.schema, 1); assert.equal(s.state.manual.length, 2);
  s.mutate(d => { d.session.coolThr = 37; }, 'hranice 37');
  await s.flush(); assert.equal(g.state().schema, 1); assert.equal(g.state().session.coolThr, 37); assert.equal(g.state().manual.length, 2);
});

test('Akceptace 4: současný zápis ze dvou zařízení neztratí ani jeden bod (409 → sloučit → znovu)', async () => {
  const g = fakeGithub(defaultState()); const A = mk(g, 'iPhone'), B = mk(g, 'Mac');
  await A.init(); await B.init();
  A.mutate(d => d.manual.push({ id: 'm_a', t: 10, T: 36 }), 'A');
  B.mutate(d => d.manual.push({ id: 'm_b', t: 20, T: 37 }), 'B');
  await A.flush(); await B.flush(); // B má zastaralé sha → 409
  assert.deepEqual(g.state().manual.map(m => m.id), ['m_a', 'm_b']);
  assert.deepEqual(B.state.manual.map(m => m.id), ['m_a', 'm_b']);
  assert.equal(B.pending, 0);
  // A si vyzvedne B při pollingu (akceptace 1)
  await A.refresh(); assert.deepEqual(A.state.manual.map(m => m.id), ['m_a', 'm_b']);
});

test('Akceptace 3: offline zápis zůstane ve frontě, přežije reload a odešle se po připojení', async () => {
  const g = fakeGithub(defaultState()); const kv = kvOf(); const s = mk(g, 'iPhone', kv);
  await s.init(); g.offline = true;
  s.mutate(d => d.manual.push({ id: 'm_1', t: 1, T: 36 }), 'offline zápis');
  await s.flush();
  assert.equal(s.pending, 1); assert.equal(s.status.kind, 'pending'); assert.match(s.status.text, /čeká 1/);
  // reload stránky: nový Store nad stejným localStorage
  const s2 = mk(g, 'iPhone', kv); await s2.init();
  assert.equal(s2.pending, 1); assert.equal(s2.state.manual.length, 1);
  g.offline = false; await s2.flush();
  assert.equal(s2.pending, 0); assert.equal(g.state().manual.length, 1);
});

test('Akceptace 2: po smazání dat prohlížeče a zadání tokenu jsou data zpět', async () => {
  const g = fakeGithub(defaultState()); const s = mk(g, 'iPhone');
  await s.init(); s.mutate(d => d.manual.push({ id: 'm_1', t: 1, T: 36 })); await s.flush();
  const fresh = new Store({ fetch: g.fetch, kv: kvOf(), device: 'iPhone', debounceMs: 0 });
  await fresh.init(); assert.equal(fresh.state.manual.length, 1); // čtení bez tokenu
});

test('Akceptace 6: bez tokenu jen čtení – zápis se nikam neposílá, ale je vidět ve frontě', async () => {
  const g = fakeGithub(defaultState()); const s = mk(g, 'iPhone', kvOf(), false);
  await s.init(); assert.equal(s.status.kind, 'readonly'); assert.match(s.status.text, /chybí token/);
  assert.equal(g.log.find(l => l.opt.headers && l.opt.headers.Authorization), undefined);
  s.mutate(d => d.manual.push({ id: 'm_1', t: 1, T: 36 })); await s.flush();
  assert.equal(g.puts.length, 0); assert.equal(s.pending, 1); assert.match(s.status.text, /neuloženo: 1/);
  s.setToken('ghp_TESTTOKEN'); await s.flush(); assert.equal(g.puts.length, 1); assert.equal(s.pending, 0);
});

test('Chyby: 401 → viditelná chyba s návodem, změny zůstanou ve frontě; chybějící soubor se vytvoří', async () => {
  const g = fakeGithub(defaultState()); const s = mk(g, 'iPhone');
  await s.init(); g.status = 401;
  s.mutate(d => d.manual.push({ id: 'm_1', t: 1, T: 36 })); await s.flush();
  assert.equal(s.status.kind, 'error'); assert.match(s.status.text, /token/); assert.equal(s.pending, 1);
  g.status = null; s.setToken('ghp_NEW'); await s.flush(); assert.equal(s.pending, 0);
  const g2 = fakeGithub(null); const s2 = mk(g2, 'Mac'); await s2.init();
  s2.mutate(d => d.manual.push({ id: 'm_1', t: 1, T: 36 })); await s2.flush();
  assert.equal(g2.puts.length, 1); assert.equal(g2.puts[0].sha, undefined); assert.equal(g2.state().manual.length, 1);
});

test('Polling: 304 nic nepřerenderuje; změna sha ano; lokální nezapsané změny se při poll slučují', async () => {
  const g = fakeGithub(defaultState()); const A = mk(g, 'iPhone'), B = mk(g, 'Mac');
  await A.init(); await B.init();
  let renders = 0; A.onChange(() => renders++);
  assert.equal(await A.refresh(), false); assert.equal(renders, 0);
  B.mutate(d => d.manual.push({ id: 'm_b', t: 20, T: 37 })); await B.flush();
  assert.equal(await A.refresh(), true); assert.equal(renders, 1);
  g.offline = true; A.mutate(d => d.manual.push({ id: 'm_a', t: 10, T: 36 })); await A.flush(); g.offline = false;
  B.mutate(d => d.manual.push({ id: 'm_c', t: 30, T: 38 })); await B.flush();
  await A.refresh(); assert.deepEqual(g.state().manual.map(m => m.id).sort(), ['m_a', 'm_b', 'm_c']);
});

test('base64 UTF-8 round-trip (diakritika, ℃)', () => {
  const s = 'Kyselovice – žluťoučký kůň ℃ 😀'; assert.equal(fromB64(toB64(s)), s);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '../js/analysis.js';
import { H, MIN } from '../js/analysis.js';
import { NOW, MANUAL, FILT, fixtureCsv, allPts, hourlySeries } from './helpers.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b} ±${tol}`);

test('Praha: epoch ↔ nástěnný čas, DST', () => {
  assert.equal(A.zonedToEpoch(2026, 10, 25, 18, 16), 1792948560000);
  assert.equal(A.hmOf(1792948560000), '18:16');
  assert.equal(A.hmOf(Date.parse('2026-07-01T10:00:00Z')), '12:00'); // letní čas
  // 25. 10. 2026 02:30 je nejednoznačné → první výskyt (CEST)
  assert.equal(A.zonedToEpoch(2026, 10, 25, 2, 30), Date.parse('2026-10-25T00:30:00Z'));
});

test('resolveHM: dnes; > 60 min v budoucnu → včera (oprava chyby prototypu)', () => {
  const now = A.zonedToEpoch(2026, 10, 26, 7, 30);
  assert.equal(A.hmOf(A.resolveHM('07:10', now)), '07:10');
  assert.equal(A.resolveHM('07:10', now), A.zonedToEpoch(2026, 10, 26, 7, 10));
  assert.equal(A.resolveHM('21:30', now), A.zonedToEpoch(2026, 10, 25, 21, 30)); // večerní zápis ráno = včera
  assert.equal(A.resolveHM('08:20', now), A.zonedToEpoch(2026, 10, 26, 8, 20));   // do 60 min v budoucnu = dnes
  assert.equal(A.resolveHM('8:61', now), null);
  assert.equal(A.resolveHM('abc', now), null);
});

test('parseCSV: formáty, oddělovače, desetinná čárka', () => {
  const r = A.parseCSV('Time;Temp\n25.10.2026 10:00:00;12,5\n2026-10-25 10:10;13.0\n"10/25/2026 10:20:00","14.5"\nšpatný řádek', NOW);
  assert.equal(r.pts.length, 3);
  assert.deepEqual(r.pts.map(p => p.T), [12.5, 13, 14.5]);
  assert.deepEqual(r.pts.map(p => A.hmOf(p.t)), ['10:00', '10:10', '10:20']);
});

test('DST: duplicity 25. 10. 02:10–02:50 sloučeny bez chyby', () => {
  const r = A.parseCSV(fixtureCsv()[0].text, NOW);
  assert.equal(r.dup, 3);
  const keys = r.pts.map(p => p.t); assert.equal(new Set(keys).size, keys.length);
  assert.deepEqual(r.pts.filter(p => A.hmOf(p.t) >= '02:00' && A.hmOf(p.t) < '03:00').map(p => A.hmOf(p.t)), ['02:00', '02:10', '02:20', '02:30', '02:40', '02:50']);
  assert.deepEqual(A.findGaps(r.pts), []); // duplicita netvoří falešnou mezeru
  assert.equal(A.hmOf(r.pts.at(-1).t), '18:10');
});

test('mergePts: ruční má přednost při shodném čase, tombstone se přeskočí', () => {
  const t = 1000 * 60 * 60;
  const out = A.mergePts([{ t, T: 10, src: 'csv' }, { t: t + MIN * 10, T: 11, src: 'csv' }], [{ t, T: 12, id: 'a' }, { t: t + 5, T: 9, id: 'b', deleted: true }]);
  assert.equal(out.length, 2); assert.equal(out[0].T, 12); assert.equal(out[0].src, 'man');
});

test('6.5 Ohřev do 18:16 (okno 60 min): rychlost ≈ 5,3 °C/h, ETA ≈ 19:13, pauza 15:00–15:50', () => {
  const pts = A.mergePts(A.parseAllCSV(fixtureCsv(), NOW).pts.filter(p => p.t < A.zonedToEpoch(2026, 10, 26)), MANUAL.slice(0, 1));
  const R = A.analyze(pts, { target: 40, winMin: 60 });
  assert.ok(R.ok);
  near(R.rate, 5.3, 0.2, 'rychlost');
  near(R.eta, A.zonedToEpoch(2026, 10, 25, 19, 13), 5 * MIN, 'ETA');
  assert.equal(R.pauses.done.length, 1);
  assert.equal(A.hmOf(R.pauses.done[0].a), '15:00'); assert.equal(A.hmOf(R.pauses.done[0].b), '15:50');
  // stav „Stojí / slabý ohřev“: probíhající zpomalení + varování weak
  assert.ok(R.pauses.ongoing);
  assert.equal(A.warnState(R, FILT).key, 'weak');
  assert.ok(R.etaCons > R.eta);
});

test('Ohřev: málo bodů → předběžná ETA bez pravděpodobnosti; dosaženo cíle', () => {
  const t0 = A.zonedToEpoch(2026, 10, 26, 12, 0);
  const R3 = A.analyze([{ t: t0, T: 10 }, { t: t0 + 30 * MIN, T: 12 }, { t: t0 + 60 * MIN, T: 14 }], { manualOnly: true });
  assert.ok(R3.prelim); assert.ok(R3.eta); assert.equal(R3.sigma, null); assert.equal(A.probBy(R3, R3.eta), null);
  const R = A.analyze([0, 1, 2, 3, 4, 5].map(i => ({ t: t0 + i * 10 * MIN, T: 38 + i * 0.5 })), { manualOnly: true });
  assert.ok(R.reached); assert.equal(R.rate > 0, true);
});

test('Pravděpodobnost: monotónní a 50 % v ETA', () => {
  const t0 = 0, pts = [0, 1, 2, 3, 4, 5, 6].map(i => ({ t: t0 + i * 10 * MIN, T: 20 + i * 1 + (i % 2 ? 0.1 : -0.1) }));
  const R = A.analyze(pts, { manualOnly: true });
  near(A.probBy(R, R.eta), 0.5, 1e-6);
  assert.ok(A.probBy(R, R.eta + R.sigma) > A.probBy(R, R.eta) && A.probBy(R, R.eta - R.sigma) < 0.5);
});

test('Varování: pokles = bad; pokles ve filtraci nebo po zamíchání = jen informativní', () => {
  const t0 = A.zonedToEpoch(2026, 10, 26, 12, 0);
  const mk = (extra, dT = -0.4, dt = 10) => {
    const pts = [0, 1, 2, 3, 4].map(i => ({ t: t0 + i * 10 * MIN, T: 30 + i })); // 30..34
    pts.push({ t: t0 + (40 + dt) * MIN, T: 34 + dT, ...extra }); return A.analyze(pts, { manualOnly: true });
  };
  assert.equal(A.warnState(mk({}), FILT).lvl, 'bad');
  assert.equal(A.warnState(mk({ mix: true }), FILT).key, 'mix');
  assert.equal(A.warnState(mk({ bath: true }), FILT).key, 'bath');
  // okno filtrace 12:00 + 30 min (+15 min) potlačí
  const filt = [{ h: 12, m: 0, d: 30 }];
  assert.equal(A.warnState(mk({}), filt).key, 'filt');
});

test('Filtrace: okna a +15 min', () => {
  const a = A.zonedToEpoch(2026, 10, 26, 0, 0), b = A.zonedToEpoch(2026, 10, 27, 0, 0);
  const w = A.filtWins(FILT, a, b);
  assert.deepEqual(w.map(x => A.hmOf(x.a) + '+' + (x.b - x.a) / MIN), ['01:20+30', '03:40+30', '05:40+30', '10:00+120']);
  assert.ok(A.inFilt(FILT, A.zonedToEpoch(2026, 10, 26, 1, 40) - 1));
  assert.ok(!A.inFilt(FILT, A.zonedToEpoch(2026, 10, 26, 1, 51)));
  assert.ok(A.nearFilt(FILT, A.zonedToEpoch(2026, 10, 26, 1, 52), A.zonedToEpoch(2026, 10, 26, 1, 58)));   // do +15 min
  assert.ok(!A.nearFilt(FILT, A.zonedToEpoch(2026, 10, 26, 2, 10), A.zonedToEpoch(2026, 10, 26, 2, 20)));
  // okno přes půlnoc z předchozího dne
  const late = A.filtWins([{ h: 23, m: 30, d: 60 }], A.zonedToEpoch(2026, 10, 26, 0, 10), A.zonedToEpoch(2026, 10, 26, 0, 20));
  assert.equal(late.length, 1);
});

test('Okolí: interpolace, ruční měření má přednost, fallback přiznán', () => {
  const S = hourlySeries();
  const amb = A.makeAmbient(S, []);
  assert.equal(amb.src, 'předpověď'); assert.equal(amb.fallback, false);
  const t = S[10].t + 30 * MIN; near(amb(t), (S[10].T + S[11].T) / 2, 1e-9);
  const m = A.makeAmbient(S, [{ t: S[10].t, amb: 3, ambSrc: 'man' }]);
  near(m(S[10].t), 3, 1e-9);
  assert.equal(A.makeAmbient(S, [], 7)(0), 7);
  const none = A.makeAmbient([], []); assert.equal(none.fallback, true); assert.match(none.src, /neověřeno/);
  assert.equal(A.makeAmbient(S, [{ t: S[10].t, amb: 3, ambSrc: 'pred' }]).src, 'předpověď'); // 'pred' se za měření nepočítá
});

test('6.5 Chladnutí od 21:30 (37,9 °C, koupání) do 06:30 (34,7 °C): k ≈ 0,013 /h', () => {
  const amb = A.makeAmbient(hourlySeries(), MANUAL);
  const C = A.analyzeCool(allPts(), { coolStart: MANUAL[1].t, amb, thr: 30, F: 1.5, filt: FILT });
  assert.ok(C.ok); near(C.k, 0.013, 0.004, 'k');
  assert.equal(A.hmOf(C.last.t), '06:30'); assert.equal(C.last.T, 34.7);
  assert.equal(C.base, MANUAL[1].t);
  assert.ok(C.Fest > 1.2 && C.Fest < 1.9, 'faktor filtrace z dat ≈ 1,5: ' + C.Fest);
  assert.ok(C.tThr > C.last.t && C.sigma > 0);
  assert.ok(C.in1h < C.last.T);
});

test('Chladnutí: čidlo po filtraci/zamíchání nevolá „vyhasíná“, křivka začíná od maxima (dohřívá)', () => {
  const amb = A.makeAmbient(hourlySeries(), []);
  const t0 = A.zonedToEpoch(2026, 10, 26, 12, 0);
  const rising = [{ t: t0, T: 38 }, { t: t0 + 10 * MIN, T: 38.4 }];
  const C = A.analyzeCool(rising, { coolStart: t0, amb, thr: 37, filt: [] });
  assert.ok(C.rising); assert.equal(C.peak.T, 38.4);
  const afterMix = [...rising, { t: t0 + 20 * MIN, T: 37.5, mix: true }];
  const C2 = A.analyzeCool(afterMix, { coolStart: t0, amb, thr: 30, filt: [] });
  assert.equal(C2.mixAt, t0 + 20 * MIN); assert.ok(C2.lastIsMix); assert.equal(C2.fit, undefined);
});

test('Syntetická data k = 0,020 /h, proměnné okolí: odhad k ± 5 %', () => {
  const kTrue = 0.020, t0 = A.zonedToEpoch(2026, 10, 27, 0, 0);
  const ambF = t => 5 + 6 * Math.sin((t - t0) / H / 24 * 2 * Math.PI);
  const amb = Object.assign(ambF, { src: 'syntetické' });
  let T = 40, t = t0; const pts = [{ t, T }];
  for (let i = 1; i <= 6 * 24; i++) { // 24 h po 10 min, jemná integrace po 1 min
    for (let s = 0; s < 10; s++) { T += -kTrue * (T - ambF(t)) * MIN / H; t += MIN; }
    pts.push({ t, T: Math.round(T * 10) / 10 });
  }
  const C = A.analyzeCool(pts, { coolStart: t0, amb, thr: 20, filt: [] });
  assert.ok(C.ok); near(C.k, kTrue, kTrue * 0.05, 'k');
});

test('summarize: souhrn relace pro archiv', () => {
  const s = A.summarize(allPts().slice(0, 130), { target: 40, coolStart: null, k: null, now: NOW });
  assert.equal(s.target, 40); assert.ok(s.max >= 34); assert.equal(s.closedAt, NOW); assert.equal(s.count, 2);
});

test('dedupeCsv: nové / existující / změněné řádky; opakovaný import nic nepřidá', () => {
  const [c25, c26] = fixtureCsv();
  const existing = A.parseCSV(c25.text, NOW).pts;
  const again = A.dedupeCsv(c25.text, existing, NOW);
  assert.equal(again.fresh, 0); assert.equal(again.changed, 0); assert.ok(again.same > 100);
  const next = A.dedupeCsv(c26.text, existing, NOW);
  assert.equal(next.same, 0); assert.equal(next.fresh, 40);
  // částečný překryv + změněná hodnota
  const extra = 'Time\tTemperature\tUnit\n10/25/2026 00:00:00\t7.8\t℃\n10/25/2026 00:10:00\t9.9\t℃\n10/27/2026 00:00:00\t5.0\t℃\n';
  const d = A.dedupeCsv(extra, existing, NOW);
  assert.deepEqual([d.same, d.changed, d.fresh], [1, 1, 1]);
  assert.equal(A.parseCSV(d.text, NOW).pts.length, 2); // hlavička + jen změněný a nový řádek
});

test('priorRate: medián tempa z archivních souhrnů, ignoruje nesmyslné', () => {
  const mk = (rate, h = 4) => ({ summary: { start: 0, startT: 10, max: 10 + rate * h, maxAt: h * H } });
  assert.equal(A.priorRate([]), null);
  near(A.priorRate([{ ...mk(4) }, mk(6), mk(5)]), 5, 1e-9);
  assert.equal(A.priorRate([{ summary: { start: 0, startT: 10, max: 11, maxAt: H } }, { summary: { orphaned: true } }]), null);
});

test('Prior z předchozích ohřevů: jeden bod = čistě prior; 2–3 body mix; od 4 bodů rozhoduje jen aktuální trend', () => {
  const t0 = A.zonedToEpoch(2026, 10, 27, 12, 0), prior = 4;
  const at = (i, T) => ({ t: t0 + i * 10 * MIN, T });
  const R1 = A.analyze([at(0, 20)], { manualOnly: true, prior });
  assert.ok(R1.ok && R1.fromPrior && R1.prelim); near(R1.eta, t0 + 5 * H, 1, 'ETA = 20 °C / 4 °C/h');
  assert.equal(A.analyze([at(0, 20)], { manualOnly: true }).ok, false); // bez priorů beze změny
  const pts3 = [at(0, 20), at(1, 21), at(2, 22)]; // skutečně 6 °C/h
  const R3 = A.analyze(pts3, { manualOnly: true, prior }), R3n = A.analyze(pts3, { manualOnly: true });
  assert.ok(R3.rate > prior && R3.rate < R3n.rate, 'mix leží mezi priorem a aktuálním trendem: ' + R3.rate);
  assert.ok(R3.priorW >= 0.5, 'aktuální trend má váhu ≥ 50 %');
  const pts5 = [0, 1, 2, 3, 4].map(i => at(i, 20 + i)), R5 = A.analyze(pts5, { manualOnly: true, prior }), R5n = A.analyze(pts5, { manualOnly: true });
  assert.equal(R5.eta, R5n.eta); assert.equal(R5.rate, R5n.rate); assert.ok(R5.etaPrior); assert.equal(R5.fromPrior, undefined);
});

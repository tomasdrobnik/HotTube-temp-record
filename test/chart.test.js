import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '../js/analysis.js';
import { buildChart } from '../js/chart.js';
import { MANUAL, FILT, NOW, allPts, fixtureCsv, hourlySeries } from './helpers.js';

const colors = { line: '#ddd', muted: '#888', water: '#06c', heat: '#c60', bad: '#c00', pause: '#eee', panel: '#fff', fg: '#000' };
const amb = A.makeAmbient(hourlySeries(), MANUAL);

test('graf: datum pod osou času, každý den jednou; hover prvky v SVG', () => {
  const pts = allPts();
  const C = A.analyzeCool(pts, { coolStart: MANUAL[1].t, amb, thr: 4, F: 1.5, filt: FILT });
  const { svg } = buildChart({ W: 900, pts, mode: 'cool', C, filt: FILT, amb, thr: 4, target: 40, coolStart: MANUAL[1].t, colors, rangeH: 0 });
  const dates = [...svg.matchAll(/>(\d+)\. (\d+)\.<\/text>/g)].map(m => m[0].slice(1, -7));
  assert.deepEqual(dates, ['25. 10.', '26. 10.']);
  assert.match(svg, /id="hv-line"/); assert.match(svg, /id="hv-dot"/);
});

test('hover ohřev: změřený bod má trend a ETA, za posledním bodem predikce', () => {
  const pts = A.mergePts(A.parseAllCSV(fixtureCsv(), NOW).pts.filter(p => p.t < A.zonedToEpoch(2026, 10, 26)), MANUAL.slice(0, 1));
  const R = A.analyze(pts, { target: 40 });
  const ch = buildChart({ W: 900, pts, mode: 'heat', R, filt: FILT, amb, target: 40, thr: 4, colors });
  const mid = pts[pts.length - 10].t, i = ch.info(mid);
  assert.equal(i.kind, 'měřeno'); assert.equal(i.T, pts[pts.length - 10].T); assert.ok(i.trend.rate > 4 && i.trend.rate < 6); assert.ok(i.pred.eta);
  const f = ch.info(R.eta - 10 * A.MIN);
  assert.equal(f.kind, 'predikce'); assert.ok(f.T > 38 && f.T < 40.5);
  assert.equal(ch.info(ch.geom.x1 + A.H), null);
});

test('hover pokles: měřený bod má rychlost poklesu a predikci za 1 h, za koncem dat křivka', () => {
  const pts = allPts();
  const C = A.analyzeCool(pts, { coolStart: MANUAL[1].t, amb, thr: 4, F: 1.5, filt: FILT });
  const ch = buildChart({ W: 900, pts, mode: 'cool', C, filt: FILT, amb, thr: 4, target: 40, coolStart: MANUAL[1].t, colors, aheadMs: 24 * A.H });
  const i = ch.info(pts.at(-1).t - 30 * A.MIN);
  assert.equal(i.kind, 'měřeno'); assert.ok(i.trend.rate < 0); assert.ok(i.pred.inH < i.T); assert.match(i.pred.label, /za 1 h/);
  const ch8 = buildChart({ W: 900, pts, mode: 'cool', C, filt: FILT, amb, thr: 4, target: 40, coolStart: MANUAL[1].t, colors, aheadMs: 24 * A.H, horizonH: 8, horizonLabel: '8 h' });
  const i8 = ch8.info(pts.at(-1).t - 30 * A.MIN); assert.match(i8.pred.label, /za 8 h/); assert.ok(i8.pred.inH < i.pred.inH);
  assert.match(ch8.svg, /\+8 h \d+,\d °C/); // značka bodu horizontu na křivce
  const f8 = ch8.info(pts.at(-1).t + 2 * A.H); assert.ok(f8.pred.inH < f8.T);
  const f = ch.info(pts.at(-1).t + 6 * A.H);
  assert.equal(f.kind, 'predikce'); assert.ok(f.T < pts.at(-1).T); assert.ok(f.trend.rate < 0);
});

test('okolí ≤ 0 °C je zvýrazněno (úsek, body, čára 0 °C); při kladném okolí nic', () => {
  const pts = allPts();
  const C = A.analyzeCool(pts, { coolStart: MANUAL[1].t, amb, thr: 4, F: 1.5, filt: FILT });
  const base = { W: 900, pts, mode: 'cool', C, filt: FILT, thr: 4, target: 40, coolStart: MANUAL[1].t, colors: { ...colors, frost: '#0aa' }, aheadMs: 24 * A.H };
  const { svg } = buildChart({ ...base, amb });
  assert.match(svg, /okolí ≤ 0 °C \(mráz\)/); assert.match(svg, /stroke="#0aa" stroke-width="3"/); assert.match(svg, />0 °C</);
  const warm = buildChart({ ...base, amb: A.makeAmbient([], [], 8) }).svg;
  assert.doesNotMatch(warm, /mráz/);
  assert.doesNotMatch(buildChart({ ...base, amb, show: { amb: false } }).svg, /mráz/);
});

test('graf natápění: kužel nejistoty trendu a rozptyl času dosažení cíle (95 % / 1σ)', () => {
  const pts = A.mergePts(A.parseAllCSV(fixtureCsv(), NOW).pts.filter(p => p.t < A.zonedToEpoch(2026, 10, 26)), MANUAL.slice(0, 1));
  const R = A.analyze(pts, { target: 40 });
  const ch = buildChart({ W: 900, pts, mode: 'heat', R, filt: FILT, amb, target: 40, thr: 4, colors });
  assert.match(ch.svg, /<polygon [^>]*>/); assert.match(ch.svg, /95 % pásmo trendu/);
  assert.match(ch.svg, /Natopeno: \d\d:\d\d \(±\d+ min 1σ; 95 % \d\d:\d\d–\d\d:\d\d\)/);
  const f = ch.info(R.eta - 10 * A.MIN); assert.ok(f.band && f.band[0] < f.T && f.band[1] > f.T);
  assert.doesNotMatch(buildChart({ W: 900, pts, mode: 'heat', R, filt: FILT, amb, target: 40, thr: 4, colors, show: { model: false } }).svg, /<polygon/);
});

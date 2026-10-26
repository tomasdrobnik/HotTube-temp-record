import fs from 'node:fs';
import { parseAllCSV, mergePts, H } from '../js/analysis.js';

export const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
export const NOW = Date.parse('2026-10-26T08:00:00Z');

/** Kotvy předpovědi staženy 25. 10. 2026 19:46 (z prototypu); mezi nimi kosinová interpolace, vzorkováno po hodině. */
const ANCHORS = [
  ['2026-10-25T07:00:00+01:00', 1.0], ['2026-10-25T14:00:00+01:00', 11.4], ['2026-10-25T19:46:00+01:00', 8.0],
  ['2026-10-26T07:00:00+01:00', -0.8], ['2026-10-26T14:00:00+01:00', 12.1], ['2026-10-27T07:00:00+01:00', -1.2],
  ['2026-10-27T14:00:00+01:00', 13.1], ['2026-10-28T07:00:00+01:00', -1.2], ['2026-10-28T14:00:00+01:00', 11.6],
].map(([t, T]) => ({ t: Date.parse(t), T }));
function cosInterp(S, t) {
  if (t <= S[0].t) return S[0].T; if (t >= S.at(-1).t) return S.at(-1).T;
  let i = 1; while (S[i].t < t) i++;
  const a = S[i - 1], b = S[i], f = (t - a.t) / (b.t - a.t);
  return a.T + (b.T - a.T) * (1 - Math.cos(Math.PI * f)) / 2;
}
export function hourlySeries(from = ANCHORS[0].t, to = ANCHORS.at(-1).t) {
  const out = []; for (let t = Math.ceil(from / H) * H; t <= to; t += H) out.push({ t, T: cosInterp(ANCHORS, t) });
  return out;
}

export const FILT = [{ h: 1, m: 20, d: 30 }, { h: 3, m: 40, d: 30 }, { h: 5, m: 40, d: 30 }, { h: 10, m: 0, d: 120 }];
export const MANUAL = [
  { id: 'm_a', t: 1792948560000, T: 34.4, amb: 8, ambSrc: 'pred' },
  { id: 'm_b', t: 1792960200000, T: 37.9, bath: true, mix: true },
];
export function fixtureCsv() {
  return [
    { name: 'k25', text: read('fixtures/kuchyne_2026-10-25.csv') },
    { name: 'k26', text: read('fixtures/kuchyne_2026-10-26.csv') },
  ];
}
export const allPts = (manual = MANUAL) => mergePts(parseAllCSV(fixtureCsv(), NOW).pts, manual);

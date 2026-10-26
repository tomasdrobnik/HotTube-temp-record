/* Čisté funkce: parser, ohřev, chladnutí, filtrace, okolí. Bez DOM, bez Date.now() (čas se předává jako parametr).
   Algoritmy převzaty z prototype/natopeni-kade.html. Prahy jsou návrh, NEOVĚŘENO na této kádi. */

export const H = 3.6e6, MIN = 6e4;
export const TZ = 'Europe/Prague';

export const CONFIG = {
  sensorRes: 0.15,        // °C, minimální σ reziduí (rozlišení čidla 0,1 °C)
  minSigmaMin: 3,         // min. nejistota ETA [min]
  minRise: 0.3,           // °C/h – pod tím se ETA nepočítá
  dropRate: -0.5,         // °C/h – krátkodobý pokles = „oheň vyhasíná“
  dropStep: -0.2,         // °C – pokles proti předchozímu bodu
  weakFrac: 0.4,          // podíl rychlosti trendu pro „slabý ohřev“
  weakAbs: 2,             // °C/h
  pauseRate: 2,           // °C/h – pod tím je pauza
  pauseMinDur: 20,        // min
  pauseOngoingMin: 5,     // min
  filtPad: 15,            // min po okně filtrace
  probGreen: 0.8, probOrange: 0.5,
  coolWarnMin: 30,        // min do hranice → oranžová
  coolStepMin: 5,         // min – krok simulace
  defaultTa: 10,          // °C, když nejsou žádná data o okolí (předpoklad!)
  defaultFiltFactor: 1.5,
  stokeInterval: 30,
};

/* ===== Časové pásmo Europe/Prague (nezávislé na TZ stroje) ===== */
const dtf = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
  hour: 'numeric', minute: 'numeric', second: 'numeric',
});
export function pragueParts(t) {
  const o = {};
  for (const p of dtf.formatToParts(new Date(t))) if (p.type !== 'literal') o[p.type] = +p.value;
  return { y: o.year, mo: o.month, d: o.day, h: o.hour, mi: o.minute, s: o.second };
}
const offsetAt = t => { const p = pragueParts(t); return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(t / 1000) * 1000; };
/** Nástěnný čas Prahy → epoch ms. Při nejednoznačnosti (zimní čas) první výskyt. */
export function zonedToEpoch(y, mo, d, h = 0, mi = 0, s = 0) {
  const wall = Date.UTC(y, mo - 1, d, h, mi, s);
  for (const o of [2 * H, 1 * H]) { const t = wall - o; if (offsetAt(t) === o) return t; }
  return wall - H; // neexistující čas (jarní přechod)
}
export const dayStart = t => { const p = pragueParts(t); return zonedToEpoch(p.y, p.mo, p.d); };
const addDays = (y, mo, d, n) => { const x = new Date(Date.UTC(y, mo - 1, d + n)); return [x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate()]; };
export const hmOf = t => { const p = pragueParts(t); return String(p.h).padStart(2, '0') + ':' + String(p.mi).padStart(2, '0'); };

/** „HH:MM“ → epoch; vztaženo k dnešku, je-li > 60 min v budoucnu, bere se včerejšek. */
export function resolveHM(hm, now) {
  const m = String(hm).trim().match(/^(\d{1,2})[:.](\d{2})$/);
  if (!m) return null;
  const h = +m[1], mi = +m[2];
  if (h > 23 || mi > 59) return null;
  const p = pragueParts(now);
  let t = zonedToEpoch(p.y, p.mo, p.d, h, mi);
  if (t > now + 60 * MIN) { const [y, mo, d] = addDays(p.y, p.mo, p.d, -1); t = zonedToEpoch(y, mo, d, h, mi); }
  return t;
}

/* ===== Parser CSV ===== */
export function parseTime(s, now) {
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) return zonedToEpoch(+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] || 0));
  m = s.match(/^(\d{1,2})([\/.\-])(\d{1,2})\2(\d{2,4})[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    let y = +m[4]; if (y < 100) y += 2000;
    const us = m[2] === '/', mo = us ? +m[1] : +m[3], d = us ? +m[3] : +m[1];
    return zonedToEpoch(y, mo, d, +m[5], +m[6], +(m[7] || 0));
  }
  m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (m && now != null) { const p = pragueParts(now); return zonedToEpoch(p.y, p.mo, p.d, +m[1], +m[2], +(m[3] || 0)); }
  return null;
}
/** → {pts:[{t,T,src:'csv'}] seřazené, dup: počet sloučených duplicitních časů, rows: počet platných řádků} */
export function parseCSV(text, now) {
  const map = new Map(); let dup = 0, rows = 0;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim(); if (!line) continue;
    const parts = line.includes('\t') ? line.split('\t') : line.includes(';') ? line.split(';') : line.split(',');
    if (parts.length < 2) continue;
    const unq = x => x.trim().replace(/^"|"$/g, '');
    const t = parseTime(unq(parts[0]), now);
    const T = parseFloat(unq(parts[1]).replace(',', '.'));
    if (t == null || !isFinite(T)) continue;
    rows++;
    const k = Math.round(t / 1000);
    if (map.has(k)) dup++;
    map.set(k, { t, T, src: 'csv' }); // poslední vyhrává
  }
  return { pts: [...map.values()].sort((a, b) => a.t - b.t), dup, rows };
}
/** Sloučí body ze všech CSV importů (poslední import vyhrává při shodě času). */
export function parseAllCSV(csvList, now) {
  const map = new Map(); let dup = 0, rows = 0;
  for (const c of csvList || []) {
    const r = parseCSV(c.text || '', now); dup += r.dup; rows += r.rows;
    for (const p of r.pts) map.set(Math.round(p.t / 1000), p);
  }
  return { pts: [...map.values()].sort((a, b) => a.t - b.t), dup, rows };
}
/** Ruční body (bez tombstones) mají přednost při shodném čase. */
export function mergePts(base, manual) {
  const map = new Map();
  for (const p of base) map.set(Math.round(p.t / 1000), p);
  for (const p of manual || []) if (!p.deleted) map.set(Math.round(p.t / 1000), { ...p, src: 'man' });
  return [...map.values()].sort((a, b) => a.t - b.t);
}
/** Porovná nový CSV text s už uloženými body (duplicity uvnitř souboru se nejdřív sloučí).
 *  → {fresh, same, changed, total, text}; `text` = hlavička + jen nové/změněné body v normalizovaném tvaru. */
export function dedupeCsv(text, existing, now) {
  const have = new Map(); for (const p of existing) have.set(Math.round(p.t / 1000), p.T);
  const { pts } = parseCSV(text, now); const keep = []; let fresh = 0, same = 0, changed = 0;
  const z = n => String(n).padStart(2, '0');
  for (const p of pts) {
    const k = Math.round(p.t / 1000);
    if (have.has(k)) { if (Math.abs(have.get(k) - p.T) < 1e-9) { same++; continue; } changed++; } else fresh++;
    const w = pragueParts(p.t);
    keep.push(`${w.y}-${z(w.mo)}-${z(w.d)} ${z(w.h)}:${z(w.mi)}:${z(w.s)}\t${p.T}\t℃`);
  }
  return { fresh, same, changed, total: pts.length, text: ['Time\tTemperature\tUnit', ...keep].join('\n') + '\n' };
}
/** Mezery > minMin (v nástěnném čase, aby DST duplicita netvořila falešnou mezeru). */
export function findGaps(pts, minMin = 30) {
  const out = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pragueParts(pts[i - 1].t), b = pragueParts(pts[i].t);
    const wall = (Date.UTC(b.y, b.mo - 1, b.d, b.h, b.mi) - Date.UTC(a.y, a.mo - 1, a.d, a.h, a.mi)) / MIN;
    if (wall > minMin && (pts[i].t - pts[i - 1].t) / MIN > minMin) out.push({ a: pts[i - 1].t, b: pts[i].t });
  }
  return out;
}

/* ===== Statistika ===== */
export function linfit(P, t0) {
  const n = P.length, xs = P.map(p => (p.t - t0) / H), ys = P.map(p => p.T);
  const xm = xs.reduce((a, b) => a + b, 0) / n, ym = ys.reduce((a, b) => a + b, 0) / n;
  let Sxx = 0, Sxy = 0, Syy = 0;
  for (let i = 0; i < n; i++) { Sxx += (xs[i] - xm) ** 2; Sxy += (xs[i] - xm) * (ys[i] - ym); Syy += (ys[i] - ym) ** 2; }
  const b = Sxx > 0 ? Sxy / Sxx : 0, a = ym - b * xm;
  let sse = 0; for (let i = 0; i < n; i++) sse += (ys[i] - a - b * xs[i]) ** 2;
  const sRaw = n > 2 ? Math.sqrt(sse / (n - 2)) : 0, s = Math.max(sRaw, CONFIG.sensorRes);
  return {
    n, a, b, s, sRaw, xm, Sxx, r2: Syy > 0 ? 1 - sse / Syy : 1, t0,
    pred: x => a + b * x, se: x => s * Math.sqrt(1 + 1 / n + (Sxx > 0 ? (x - xm) ** 2 / Sxx : 0)),
  };
}
export function erf(x) {
  const s = Math.sign(x); x = Math.abs(x); const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}
export const Phi = z => 0.5 * (1 + erf(z / Math.SQRT2));

/* ===== Prior z předchozích ohřevů ===== */
/** Medián tempa ohřevu (°C/h) z archivních souhrnů {start,startT,max,maxAt}; null, když není dost dat. */
export function priorRate(archive) {
  const r = [];
  for (const a of archive || []) {
    const m = a && a.summary; if (!m || m.start == null || m.maxAt == null) continue;
    const h = (m.maxAt - m.start) / H;
    if (h >= 0.25 && m.max - m.startT >= 3) r.push((m.max - m.startT) / h);
  }
  if (!r.length) return null;
  r.sort((a, b) => a - b); const i = r.length >> 1;
  return r.length % 2 ? r[i] : (r[i - 1] + r[i]) / 2;
}

/* ===== Ohřev ===== */
/** Klidová hladina = medián prvních 20 % (min. 3); start = poslední bod před prvním překročením o 0,5 °C. */
export function findStart(pts) {
  if (pts.length < 4) return 0;
  const k = Math.max(3, Math.floor(pts.length * 0.2));
  const base = pts.slice(0, k).map(p => p.T).sort((a, b) => a - b)[Math.floor(k / 2)];
  const i = pts.findIndex(p => p.T > base + 0.5);
  return i <= 0 ? 0 : i - 1;
}
export function findPauses(P, thr = CONFIG.pauseRate, minDur = CONFIG.pauseMinDur) {
  const runs = []; let cur = null;
  for (let i = 1; i < P.length; i++) {
    const r = (P[i].T - P[i - 1].T) / ((P[i].t - P[i - 1].t) / H);
    if (r < thr) { if (!cur) cur = { a: P[i - 1].t, b: P[i].t }; else cur.b = P[i].t; }
    else if (cur) { runs.push(cur); cur = null; }
  }
  const ongoing = cur; if (cur) runs.push(cur);
  return {
    done: runs.filter(r => r !== ongoing && (r.b - r.a) / MIN >= minDur),
    ongoing: ongoing && (ongoing.b - ongoing.a) / MIN >= CONFIG.pauseOngoingMin ? ongoing : null,
    all: runs,
  };
}
export function analyze(pts, { target = 40, winMin = 60, manualOnly = false, prior = null } = {}) {
  const R = { target, ok: false, prior };
  if (pts.length === 1 && prior > CONFIG.minRise && manualOnly) { // jediný bod: jen odhad z předchozích ohřevů
    const p = pts[0]; R.start = R.last = p; R.heat = [p]; R.prelim = true; R.fromPrior = true; R.priorW = 0;
    R.rate = R.rateAvg = R.rateShort = prior; R.rateShortFrom = p.t; R.pauses = { done: [], ongoing: null }; R.ok = true;
    if (p.T >= target) { R.reached = p.t; return R; }
    R.eta = p.t + (target - p.T) / prior * H; R.sigma = null; return R;
  }
  if (pts.length < 2) { R.msg = pts.length ? 'Zapiš další teplotu – odhad potřebuje alespoň 2 body.' : 'Žádná data. Zapiš teplotu nebo importuj CSV.'; return R; }
  const si = manualOnly ? 0 : findStart(pts), start = pts[si], heat = pts.slice(si), last = pts[pts.length - 1];
  R.start = start; R.last = last; R.heat = heat;
  if (heat.length < 2) { R.msg = 'Ohřev zatím nezačal.'; return R; }
  if (heat.length < 4) {
    const h = (last.t - start.t) / H; if (h <= 0) { R.msg = 'Zapiš další teplotu.'; return R; }
    R.prelim = true; R.rate = R.rateAvg = R.rateShort = (last.T - start.T) / h; R.rateShortFrom = start.t;
    if (prior > CONFIG.minRise) { // aktuální trend má přednost: váha n/4 (n = počet bodů), zbytek prior
      const w = Math.min(1, heat.length / 4); R.priorW = w; R.fromPrior = true;
      R.rate = R.rateAvg = R.rateShort = w * R.rate + (1 - w) * prior;
    }
    R.pauses = { done: [], ongoing: null }; R.ok = true;
    if (last.T >= target) { R.reached = heat.find(p => p.T >= target).t; return R; }
    if (R.rate < CONFIG.minRise) { R.msg = 'Teplota neroste – čas nelze odhadnout.'; R.noEta = true; return R; }
    R.eta = last.t + (target - last.T) / R.rate * H; R.sigma = null; return R;
  }
  const pick = P => { const tl = P[P.length - 1].t; let w = winMin > 0 ? P.filter(p => p.t >= tl - winMin * MIN) : P.slice(); if (w.length < 4) w = P.slice(-4); return w; };
  const win = pick(heat); R.win = win;
  const f = linfit(win, last.t); R.fit = f; R.rate = f.b;
  const recent = heat.filter(p => p.t >= last.t - 15 * MIN); const r0 = recent.length >= 2 ? recent[0] : heat[heat.length - 2];
  R.rateShort = (last.T - r0.T) / ((last.t - r0.t) / H); R.rateShortFrom = r0.t;
  const priorWin = pick(heat.slice(0, -1));
  if (priorWin.length >= 3) { const fp = linfit(priorWin, last.t); const pr = fp.pred(0), se = fp.se(0); R.check = { pred: pr, se, z: (last.T - pr) / se, dev: last.T - pr }; }
  R.pauses = findPauses(heat);
  R.rateAvg = (last.T - start.T) / ((last.t - start.t) / H);
  if (last.T >= target) { R.reached = pts.find((p, i) => i >= si && p.T >= target).t; R.ok = true; return R; }
  if (f.b < CONFIG.minRise) {
    R.msg = 'Teplota v okně trendu neroste – čas nelze odhadnout.'; R.ok = true; R.noEta = true;
    if (R.rateAvg > CONFIG.minRise) R.etaCons = last.t + (target - last.T) / R.rateAvg * H;
    return R;
  }
  let x = (target - f.a) / f.b; if (x < 0) x = 0;
  R.eta = last.t + x * H; R.sigma = Math.max(f.se(x) / f.b * H, CONFIG.minSigmaMin * MIN);
  if (R.rateAvg > CONFIG.minRise) R.etaCons = last.t + (target - last.T) / R.rateAvg * H;
  if (prior > CONFIG.minRise) R.etaPrior = last.t + (target - last.T) / prior * H;
  R.ok = true; return R;
}
export const probBy = (R, t) => R.eta && R.sigma ? Phi((t - R.eta) / R.sigma) : (R.reached && t >= R.reached ? 1 : null);

/* ===== Filtrace ===== */
/** Okna filtrace {a,b} (epoch) překrývající <a,b>. filt = [{h,m,d}] denně v čase Prahy. */
export function filtWins(filt, a, b) {
  const out = []; const p0 = pragueParts(a);
  let [y, mo, d] = addDays(p0.y, p0.mo, p0.d, -1);
  for (let i = 0; i < 400; i++) {
    const day0 = zonedToEpoch(y, mo, d); if (day0 > b) break;
    for (const w of filt || []) {
      const st = zonedToEpoch(y, mo, d, w.h, w.m), en = st + w.d * MIN;
      if (en > a && st < b) out.push({ a: st, b: en });
    }
    [y, mo, d] = addDays(y, mo, d, 1);
  }
  return out.sort((p, q) => p.a - q.a);
}
export const inFilt = (filt, t) => filtWins(filt, t - 1, t + 1).some(w => t >= w.a && t < w.b);
export const nearFilt = (filt, a, b, pad = CONFIG.filtPad * MIN) => filtWins(filt, a - pad, b).some(w => w.a < b && w.b + pad > a);

/* ===== Teplota okolí ===== */
/** Lineární interpolace hodinové řady [{t,T}] (mimo rozsah poslední známá hodnota). */
export function interpLin(S, t) {
  if (!S.length) return null;
  if (t <= S[0].t) return S[0].T; if (t >= S[S.length - 1].t) return S[S.length - 1].T;
  let lo = 0, hi = S.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m].t <= t) lo = m; else hi = m; }
  const a = S[lo], b = S[hi]; return a.T + (b.T - a.T) * (t - a.t) / (b.t - a.t);
}
/** Funkce Ta(t). Priorita: konstanta → ruční měření (±90 min) + předpověď → předpověď → výchozí předpoklad.
 *  Výsledek nese `.src` (popis zdroje pro UI) a `.fallback` (true, když se nepoužila předpověď). */
export function makeAmbient(series, manualPts, constTa) {
  if (constTa != null) return Object.assign(() => constTa, { src: 'ručně (konstanta)', fallback: true });
  const meas = (manualPts || []).filter(p => !p.deleted && p.ambSrc === 'man' && isFinite(p.amb)).map(p => ({ t: p.t, T: p.amb }));
  const base = (series || []).filter(a => !meas.some(m => Math.abs(m.t - a.t) < 90 * MIN));
  const S = base.concat(meas).sort((a, b) => a.t - b.t);
  if (!S.length) return Object.assign(() => CONFIG.defaultTa, { src: `bez dat o okolí – předpoklad ${CONFIG.defaultTa} °C (neověřeno)`, fallback: true });
  return Object.assign(t => interpLin(S, t), { src: (series || []).length ? (meas.length ? 'předpověď + ruční měření' : 'předpověď') : 'ruční měření', fallback: !(series || []).length });
}

/* ===== Chladnutí ===== */
/** Newton s proměnným okolím: dT/dt = −k·f(t)·(T − Ta(t)); k z párů sousedních bodů (regrese přes počátek). */
export function analyzeCool(pts, { coolStart, amb, thr, F = CONFIG.defaultFiltFactor, filt = [] }) {
  const Rc = { cool: true, thr, ok: false, amb };
  const nearF = (a, b) => nearFilt(filt, a, b), inF = t => inFilt(filt, t);
  let C = pts.filter(p => p.t >= coolStart); const anchor = pts.filter(p => p.t <= coolStart).pop();
  if (anchor && (!C.length || C[0].t !== anchor.t)) C = [anchor, ...C];
  Rc.C = C; Rc.last = C[C.length - 1] || pts[pts.length - 1]; if (Rc.last) Rc.Ta = amb(Rc.last.t);
  if (C.length < 2) { Rc.msg = 'Zapiš teplotu – sledování poklesu potřebuje alespoň 2 body od konce natápění.'; return Rc; }
  const last = C[C.length - 1]; Rc.ok = true;
  Rc.peak = C.reduce((m, p) => p.T >= m.T ? p : m, C[0]);
  const rec = C.filter(p => p.t >= last.t - 30 * MIN), r0 = rec.length >= 2 ? rec[0] : C[C.length - 2];
  Rc.rateShort = (last.T - r0.T) / ((last.t - r0.t) / H); Rc.rateShortFrom = r0.t;
  if (last.T <= thr) Rc.below = (C.find(p => p.t >= Rc.peak.t && p.T <= thr) || last).t;
  const mixes = C.filter(p => p.mix || p.bath); Rc.mixAt = mixes.length ? mixes[mixes.length - 1].t : null;
  Rc.lastIsMix = !!(last.mix || last.bath); Rc.lastIsBath = !!last.bath;
  const base = Rc.mixAt && Rc.mixAt > Rc.peak.t ? Rc.mixAt : Rc.peak.t; Rc.base = base;
  const D = C.filter(p => p.t >= base && p.T - amb(p.t) > 0.3);
  if (D.length < 2 || last.t === base) {
    if (last.t === Rc.peak.t || !Rc.mixAt) { Rc.rising = true; Rc.msg = 'Teplota zatím neklesá.'; }
    else Rc.msg = 'Po zamíchání/koupání – křivka se vyhodnotí z dalších zápisů.';
    return Rc;
  }
  const kfit = (P, mode) => {
    let sxx = 0, sxy = 0; const pr = [];
    for (let i = 1; i < P.length; i++) {
      const a = P[i - 1], b = P[i], dt = (b.t - a.t) / H, nf_ = nearF(a.t, b.t);
      if (mode === 'norm' && nf_) continue; if (mode === 'filt' && !nf_) continue;
      const X = dt * ((a.T + b.T) / 2 - (amb(a.t) + amb(b.t)) / 2), Y = b.T - a.T; pr.push([X, Y]); sxx += X * X; sxy += X * Y;
    }
    const k = sxx > 0 ? -sxy / sxx : 0; let sse = 0; pr.forEach(([X, Y]) => sse += (Y + k * X) ** 2); const m = pr.length;
    return { k, m, sd: m > 1 ? Math.sqrt(sse / (m - 1)) : 0, se: m > 1 && sxx > 0 ? Math.sqrt(sse / (m - 1) / sxx) : null };
  };
  let f = kfit(D, 'norm'); if (f.m < 1) f = kfit(D); f.n = D.length; Rc.fit = f; Rc.k = f.k;
  const ff = kfit(D, 'filt'); Rc.Fest = ff.m >= 1 && f.k > 0.0005 && ff.k > 0 ? ff.k / f.k : null; Rc.F = F;
  Rc.lastInFilt = nearF(C[C.length - 2].t, last.t);
  if (Rc.k <= 0.0005) { Rc.rising = true; Rc.msg = 'Teplota neklesá.'; return Rc; }
  const step = CONFIG.coolStepMin * MIN;
  const sim = (k, t0, T0, tEnd, stopBelow) => {
    let t = t0, T = T0; const path = [[t, T]];
    while (t < tEnd) {
      const dt = Math.min(step, tEnd - t), tm = t + dt / 2;
      T += -k * (inF(tm) ? F : 1) * (T - amb(tm)) * dt / H; t += dt; path.push([t, T]);
      if (stopBelow != null && T <= stopBelow) return { t, T, path, hit: true };
    }
    return { t, T, path, hit: false };
  };
  Rc.sim = tEnd => sim(Rc.k, last.t, last.T, tEnd).path;
  Rc.rateNow = -Rc.k * (last.T - amb(last.t)); Rc.in1h = sim(Rc.k, last.t, last.T, last.t + H).T;
  if (!Rc.below) {
    const r = sim(Rc.k, last.t, last.T, last.t + 48 * H, thr);
    if (!r.hit) Rc.in48h = r.T; // do 48 h hranice nehrozí
    if (r.hit) {
      Rc.tThr = r.t;
      if (f.se) {
        const a = sim(Rc.k + f.se, last.t, last.T, last.t + 48 * H, thr), b = sim(Math.max(Rc.k - f.se, 1e-4), last.t, last.T, last.t + 96 * H, thr);
        const sK = b.hit && a.hit ? Math.abs(b.t - a.t) / 2 : Infinity, sR = CONFIG.sensorRes / Math.max(Math.abs(Rc.rateNow), 0.05) * H;
        Rc.sigma = Math.max(Math.sqrt(sK * sK + sR * sR), CONFIG.minSigmaMin * MIN); if (!isFinite(Rc.sigma)) Rc.sigma = null;
      }
    }
  }
  if (D.length >= 4 && !Rc.lastInFilt) {
    let fp = kfit(D.slice(0, -1), 'norm'); if (fp.m < 1) fp = kfit(D.slice(0, -1));
    const pv = D[D.length - 2]; const pr = sim(fp.k, pv.t, pv.T, last.t).T; const se = Math.max(fp.sd, CONFIG.sensorRes);
    Rc.check = { pred: pr, se, dev: last.T - pr, z: (last.T - pr) / se };
  }
  return Rc;
}

/* ===== Varování (natápění) ===== */
/** → {lvl:'bad'|'warn', key, kind, ...data} nebo null. Zprávy skládá UI. */
export function warnState(R, filt = []) {
  if (!R || !R.ok || R.reached || !R.heat || R.heat.length < 2) return null;
  const h = R.heat, last = h[h.length - 1], prev = h[h.length - 2], d = last.T - prev.T;
  if (d < 0 && nearFilt(filt, prev.t, last.t)) return { lvl: 'warn', key: 'filt', d };
  if (d < 0 && last.bath) return { lvl: 'warn', key: 'bath', d };
  if (d < 0 && last.mix) return { lvl: 'warn', key: 'mix', d };
  if (R.rateShort < CONFIG.dropRate || d <= CONFIG.dropStep) return { lvl: 'bad', key: 'cool', d, prevT: prev.t };
  const stall = R.pauses && R.pauses.ongoing;
  if (stall || (R.rate > 0 && R.rateShort < CONFIG.weakFrac * R.rate && R.rateShort < CONFIG.weakAbs)) return { lvl: 'warn', key: 'weak', d };
  return null;
}

/** Souhrn relace pro archiv. */
export function summarize(pts, { target, coolStart, k, now }) {
  if (!pts.length) return { count: 0 };
  const R = analyze(pts, { target });
  const max = pts.reduce((m, p) => p.T > m.T ? p : m, pts[0]);
  return {
    start: R.start ? R.start.t : pts[0].t, startT: R.start ? R.start.T : pts[0].T,
    max: max.T, maxAt: max.t, target, reachedAt: R.reached || null,
    endedAt: coolStart || null, k: k ?? null, count: pts.filter(p => p.src === 'man').length, closedAt: now,
  };
}

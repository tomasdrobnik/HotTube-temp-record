/* SVG graf jako řetězec (bez DOM, barvy dodá volající z CSS proměnných). Heat i cool režim. */
import { MIN, H, hmOf, dayStart, filtWins, inFilt, pragueParts } from './analysis.js';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const dayKey = t => { const p = pragueParts(t); return p.y * 10000 + p.mo * 100 + p.d; };
const nf = (v, d = 1) => v.toLocaleString('cs-CZ', { minimumFractionDigits: d, maximumFractionDigits: d });

const ALL_ON = { sensor: true, manual: true, model: true, filt: true, zones: true, amb: true, ref: true, bath: true };
/** o: {baths ([{a,b,active}], koupání = víko pryč), horizonH (predikce poklesu, h), horizonLabel, aheadMs (>0 = osa končí o tolik za posledním bodem, trend/predikce se extrapoluje), rangeH (undefined = auto, 0 = vše, N = posledních N h), show:{sensor,manual,model,filt,zones,amb,ref}, W, pts, mode:'heat'|'cool', R, C, filt, amb, target, thr, coolStart, colors:{line,muted,water,heat,bad,pause,panel}} → {svg, info(t), geom} */
export const chartSvg = o => buildChart(o).svg;
export function buildChart(o) {
  const { pts, mode, R, C, filt, amb, colors: c } = o;
  const show = { ...ALL_ON, ...(o.show || {}) };
  if (!pts.length) return { svg: '', info: () => null, geom: null };
  const W = Math.max(300, o.W || 600), Hh = Math.round(Math.max(240, Math.min(560, W * (W > 700 ? 0.36 : 0.62))));
  const L = 40, Rr = 12, T = 14, B = 42, iw = W - L - Rr, ih = Hh - T - B;
  const last = pts[pts.length - 1];
  let x0, x1;
  if (mode === 'cool') {
    x0 = Math.max(pts[0].t, o.coolStart - 90 * MIN); x1 = Math.max(last.t, o.coolStart) + 60 * MIN;
    if (C && C.tThr) x1 = Math.max(x1, Math.min(C.tThr + (C.sigma ? 2 * C.sigma : 0), last.t + 12 * H));
  } else {
    x0 = (R && R.start ? R.start.t : pts[0].t) - 20 * MIN; x1 = last.t + 40 * MIN;
    if (R && R.eta) x1 = Math.max(x1, R.eta + (R.sigma ? 2 * R.sigma : 20 * MIN));
  }
  x1 += 10 * MIN;
  if (o.rangeH === 0) x0 = pts[0].t - 10 * MIN; else if (o.rangeH > 0) x0 = last.t - o.rangeH * H;
  if (mode === 'cool' && o.horizonH > 1 && !(o.aheadMs > 0)) x1 = Math.max(x1, last.t + o.horizonH * H + 10 * MIN); // bod horizontu predikce má být vidět
  if (o.aheadMs > 0) x1 = last.t + o.aheadMs;
  if (x1 - x0 < 30 * MIN) x1 = x0 + 30 * MIN;
  const vis = pts.filter(p => p.t >= x0 && (p.src === 'man' ? show.manual : show.sensor));
  const ambS = []; if (amb && show.amb) { const n = Math.max(48, Math.min(400, Math.round((x1 - x0) / (30 * MIN)))); for (let i = 0; i <= n; i++) { const t = x0 + (x1 - x0) * i / n; ambS.push([t, amb(t)]); } }
  const refY = mode === 'cool' ? o.thr : o.target;
  const simAtEarly = t => { if (!simPath) return null; for (let i = 1; i < simPath.length; i++) if (simPath[i][0] >= t) { const a = simPath[i - 1], b = simPath[i]; return a[1] + (b[1] - a[1]) * (t - a[0]) / (b[0] - a[0]); } return simPath[simPath.length - 1][1]; };
  const simPath = mode === 'cool' && show.model && C && C.k > 0 && C.sim ? C.sim(x1) : null;
  const histPath = mode === 'cool' && show.model && C && C.hist && C.hist.sim ? C.hist.sim(x1) : null;
  let y0 = Math.min(...vis.map(p => p.T), refY, ...ambS.map(a => a[1]), ...(simPath ? simPath.map(q => q[1]) : []), ...(histPath ? histPath.map(q => q[1]) : []));
  let y1 = Math.max(...vis.map(p => p.T), refY);
  y0 = Math.floor((y0 - 1) / 5) * 5; y1 = Math.ceil((y1 + 1) / 5) * 5;
  const X = t => L + (t - x0) / (x1 - x0) * iw, Y = v => T + (1 - (v - y0) / (y1 - y0)) * ih;
  let s = `<svg viewBox="0 0 ${W} ${Hh}" width="${W}" height="${Hh}" role="img" aria-label="Graf teploty" font-family="ui-monospace, Menlo, monospace" font-size="11">`;
  if (mode === 'cool' && show.zones) s += `<rect x="${X(Math.max(o.coolStart, x0))}" y="${T}" width="${Math.max(0, X(x1) - X(Math.max(o.coolStart, x0)))}" height="${ih}" fill="${c.pause}"/>`;
  const step = Math.max(1, Math.round((y1 - y0) / 6 / 5)) * 5;
  for (let v = y0; v <= y1; v += step) s += `<line x1="${L}" x2="${L + iw}" y1="${Y(v)}" y2="${Y(v)}" stroke="${c.line}"/><text x="${L - 6}" y="${Y(v) + 4}" text-anchor="end" fill="${c.muted}">${v}</text>`;
  const span = (x1 - x0) / MIN, steps = [10, 15, 30, 60, 120, 180, 240, 360];
  const st = steps.find(m => span / m <= iw / 56) || 720;
  let tt = dayStart(x0); while (tt < x0) tt += st * MIN;
  let prevDay = null;
  for (; tt <= x1; tt += st * MIN) {
    const p = pragueParts(tt), mid = p.h === 0 && p.mi === 0, dk = dayKey(tt), tx = X(tt);
    s += mid ? `<line x1="${tx}" x2="${tx}" y1="${T}" y2="${T + ih}" stroke="${c.muted}" stroke-width="1"/>` : `<line x1="${tx}" x2="${tx}" y1="${T}" y2="${T + ih}" stroke="${c.line}" stroke-dasharray="2 3"/>`;
    s += `<text x="${tx}" y="${T + ih + 15}" text-anchor="middle" fill="${c.muted}">${hmOf(tt)}</text>`;
    if (dk !== prevDay) { prevDay = dk; s += `<text x="${tx}" y="${T + ih + 31}" text-anchor="${tx < L + 26 ? 'start' : 'middle'}" fill="${c.fg || c.muted}" font-weight="600">${p.d}. ${p.mo}.</text>`; }
  }
  s += `<text x="${L - 6}" y="${T - 3}" text-anchor="end" fill="${c.muted}">°C</text>`;
  if (show.filt) for (const w of filtWins(filt, x0, x1)) { const a = Math.max(w.a, x0), b = Math.min(w.b, x1); s += `<rect x="${X(a)}" y="${T}" width="${Math.max(1, X(b) - X(a))}" height="${ih}" fill="${c.water}" opacity=".16"><title>filtrace ${hmOf(w.a)}–${hmOf(w.b)}</title></rect>`; }
  if (mode === 'heat' && show.zones && R && R.pauses) for (const p of R.pauses.done.concat(R.pauses.ongoing ? [R.pauses.ongoing] : [])) s += `<rect x="${X(p.a)}" y="${T}" width="${Math.max(1, X(p.b) - X(p.a))}" height="${ih}" fill="${c.pause}"><title>pauza ohřevu ${hmOf(p.a)}–${hmOf(p.b)}</title></rect>`;
  if (show.bath) for (const b of o.baths || []) { // koupání: víko sejmuto (od prvního zápisu „koupání“ po „koupání ukončeno“)
    const a = Math.max(b.a, x0), e = Math.min(b.b ?? last.t, x1); if (e < x0 || b.a > x1) continue;
    s += `<rect x="${X(a)}" y="${T}" width="${Math.max(3, X(e) - X(a))}" height="${ih}" fill="${c.heat}" opacity=".13"><title>koupání (víko pryč) ${hmOf(b.a)}–${b.active ? 'probíhá' : hmOf(b.b)}</title></rect><text x="${X(a) + 3}" y="${T + ih - 6}" fill="${c.heat}" font-weight="600">koupání${b.active ? ' …' : ''}</text>`;
  }
  const ry = Y(refY), rc = mode === 'cool' ? c.bad : c.heat;
  if (show.ref) s += `<line x1="${L}" x2="${L + iw}" y1="${ry}" y2="${ry}" stroke="${rc}" stroke-width="1.2" stroke-dasharray="6 4"/><text x="${L + 4}" y="${ry + (mode === 'cool' ? 14 : -4)}" fill="${rc}">${mode === 'cool' ? 'hranice' : 'cíl'} ${nf(refY, refY % 1 ? 1 : 0)} °C</text>`;
  if (ambS.length) s += `<polyline points="${ambS.map(a => X(a[0]) + ',' + Y(a[1])).join(' ')}" fill="none" stroke="${c.muted}" stroke-width="1.3" stroke-dasharray="1 3"/>`;
  if (ambS.length) { // mráz: okolí ≤ 0 °C zvýrazněno (úseky křivky, hodinové body, čára 0 °C)
    const fc = c.frost || c.water, runs = []; let cur = null;
    for (let i = 0; i < ambS.length; i++) {
      const [t, v] = ambS[i], frost = v <= 0;
      if (frost && !cur) { cur = []; if (i > 0 && ambS[i - 1][1] > 0) { const [pt, pv] = ambS[i - 1]; cur.push([pt + (t - pt) * pv / (pv - v), 0]); } }
      if (frost) cur.push([t, v]);
      if (!frost && cur) { const [pt, pv] = ambS[i - 1]; cur.push([pt + (t - pt) * pv / (pv - v), 0]); runs.push(cur); cur = null; }
    }
    if (cur) runs.push(cur);
    if (y0 < 0 && y1 > 0) s += `<line x1="${L}" x2="${L + iw}" y1="${Y(0)}" y2="${Y(0)}" stroke="${fc}" stroke-width="1" stroke-dasharray="1 4" opacity=".8"/><text x="${L + iw - 3}" y="${Y(0) - 3}" text-anchor="end" fill="${fc}">0 °C</text>`;
    for (const r of runs) {
      if (r.length > 1) s += `<polyline points="${r.map(q => X(q[0]) + ',' + Y(q[1])).join(' ')}" fill="none" stroke="${fc}" stroke-width="3" stroke-linecap="round"><title>okolí ≤ 0 °C (mráz) ${hmOf(r[0][0])}–${hmOf(r[r.length - 1][0])}</title></polyline>`;
    }
    const step = Math.max(1, Math.ceil(((x1 - x0) / H) / 40)) * H; // nejvýš ~40 bodů
    for (let t = Math.ceil(x0 / step) * step; t <= x1; t += step) { const v = amb(t); if (v <= 0) s += `<circle cx="${X(t)}" cy="${Y(v)}" r="3.5" fill="${fc}" stroke="${c.panel}" stroke-width="1"><title>${hmOf(t)} okolí ${nf(v)} °C (mráz)</title></circle>`; }
  }
  if (mode === 'heat' && show.model && R && R.fit && R.eta) { // trend: přímka z okna až do ETA
    const f = R.fit, tA = R.win[0].t, tB = o.aheadMs > 0 ? x1 : Math.min(R.eta, x1);
    const yy = t => f.pred((t - f.t0) / H), yc = t => Y(Math.max(y0, Math.min(y1, yy(t)))), yc2 = v => Y(Math.max(y0, Math.min(y1, v)));
    const tB2 = o.aheadMs > 0 && f.b > 0 && yy(tB) > y1 ? f.t0 + ((y1 - f.a) / f.b) * H : tB; // přímka končí na horním okraji
    s += `<line x1="${X(tA)}" y1="${yc(tA)}" x2="${X(tB2)}" y2="${yc(tB2)}" stroke="${c.water}" stroke-width="2" stroke-dasharray="5 4"/>`;
    if (R.sigma && f.se) { // kužel nejistoty trendu od posledního bodu (95 % predikční interval)
      const tS = last.t, tE = o.aheadMs > 0 ? x1 : Math.min(x1, R.eta + 1.96 * R.sigma + 10 * MIN), up = [], lo = [];
      for (let i = 0; i <= 24; i++) { const t = tS + (tE - tS) * i / 24, m = yy(t), w = 1.96 * f.se((t - f.t0) / H); up.push([t, m + w]); lo.push([t, m - w]); }
      if (tE > tS) {
        const edge = arr => `<polyline points="${arr.map(q => X(q[0]) + ',' + yc2(q[1])).join(' ')}" fill="none" stroke="${c.water}" stroke-width="1.2" stroke-dasharray="3 3" opacity=".85"/>`;
        s += `<polygon points="${up.concat(lo.slice().reverse()).map(q => X(q[0]) + ',' + yc2(q[1])).join(' ')}" fill="${c.water}" opacity=".28"><title>95 % pásmo trendu od posledního bodu</title></polygon>` + edge(up) + edge(lo);
      }
    }
    if (R.sigma) { const a = Math.max(R.eta - 1.96 * R.sigma, x0), b = Math.min(R.eta + 1.96 * R.sigma, x1); s += `<rect x="${X(a)}" y="${T}" width="${Math.max(2, X(b) - X(a))}" height="${ih}" fill="${c.heat}" opacity=".14"><title>95% interval ${hmOf(R.eta - 1.96 * R.sigma)}–${hmOf(R.eta + 1.96 * R.sigma)}</title></rect>`; }
  }
  if (histPath) { // historický trend chladnutí pro srovnání
    const hp = histPath.filter(q => q[1] >= y0).map(q => X(q[0]) + ',' + Y(Math.min(q[1], y1)));
    s += `<polyline points="${hp.join(' ')}" fill="none" stroke="${c.heat}" stroke-width="1.8" stroke-dasharray="2 4" stroke-linecap="round"><title>historický trend chladnutí (k = ${nf(C.hist.k, 3)} /h)</title></polyline>`;
  }
  if (simPath) {
    const pl = simPath.filter(q => q[1] >= y0).map(q => X(q[0]) + ',' + Y(Math.min(q[1], y1)));
    s += `<polyline points="${pl.join(' ')}" fill="none" stroke="${c.water}" stroke-width="2" stroke-dasharray="5 4"/>`;
  }
  if (simPath && o.horizonH > 0 && last.t + o.horizonH * H >= x0 && last.t + o.horizonH * H <= x1) {
    const th = last.t + o.horizonH * H, q = simAtEarly(th);
    if (q != null) s += `<circle cx="${X(th)}" cy="${Y(Math.max(y0, Math.min(y1, q)))}" r="5" fill="${c.panel}" stroke="${c.water}" stroke-width="2"><title>${esc(o.horizonLabel || '')}: ${nf(q)} °C</title></circle><text x="${X(th) + (X(th) > L + iw - 90 ? -8 : 8)}" y="${Y(Math.max(y0, Math.min(y1, q))) - 8}" text-anchor="${X(th) > L + iw - 90 ? 'end' : 'start'}" fill="${c.water}" font-weight="600">${esc(o.horizonLabel || '')} ${nf(q)} °C</text>`;
  }
  const whisker = (tc, sg, yv, col, what) => { // rozptyl času dosažení: 95 % (tenká) a 1σ (tlustá) úsečka na hladině cíle/hranice
    if (!(sg > 0) || yv < y0 || yv > y1) return;
    const a95 = tc - 1.96 * sg, b95 = tc + 1.96 * sg, yy = Y(yv), xa = X(Math.max(a95, x0)), xb = X(Math.min(b95, x1));
    s += `<g><title>${what}: ${hmOf(tc)} (±${Math.round(sg / MIN)} min 1σ; 95 % ${hmOf(a95)}–${hmOf(b95)})</title>` +
      `<line x1="${xa}" x2="${xb}" y1="${yy}" y2="${yy}" stroke="${col}" stroke-width="2"/>` +
      `<line x1="${X(Math.max(tc - sg, x0))}" x2="${X(Math.min(tc + sg, x1))}" y1="${yy}" y2="${yy}" stroke="${col}" stroke-width="6" stroke-linecap="round"/>` +
      (a95 >= x0 ? `<line x1="${xa}" x2="${xa}" y1="${yy - 6}" y2="${yy + 6}" stroke="${col}" stroke-width="2"/>` : '') + (b95 <= x1 ? `<line x1="${xb}" x2="${xb}" y1="${yy - 6}" y2="${yy + 6}" stroke="${col}" stroke-width="2"/>` : '') +
      `<text x="${(xa + xb) / 2}" y="${yy + 20}" text-anchor="middle" fill="${col}" font-weight="600">${hmOf(Math.max(a95, x0))}–${hmOf(Math.min(b95, x1))}</text></g>`;
  };
  if (mode === 'heat' && show.model && R && R.fit && R.eta && R.sigma) whisker(R.eta, R.sigma, o.target, c.heat, 'Natopeno');
  if (mode === 'cool' && show.model && C && C.tThr && C.sigma) whisker(C.tThr, C.sigma, o.thr, c.bad, 'Pod hranicí');
  const dot = p => {
    if (p.src === 'man') return `<circle cx="${X(p.t)}" cy="${Y(p.T)}" r="5" fill="${c.heat}" stroke="${c.panel}" stroke-width="1.5"><title>${hmOf(p.t)} ${nf(p.T)} °C (ručně${p.mix ? ', zamícháno' : ''}${p.bath ? ', koupání – víko pryč' : ''}${p.bathEnd ? ', koupání ukončeno – víko zpět' : ''})</title></circle>`;
    return `<circle cx="${X(p.t)}" cy="${Y(p.T)}" r="2.6" fill="${c.water}"><title>${hmOf(p.t)} ${nf(p.T)} °C</title></circle>`;
  };
  for (const p of vis) s += dot(p);
  const mark = (t, lbl, col, dash, dy) => {
    if (t < x0 || t > x1) return;
    s += `<line x1="${X(t)}" x2="${X(t)}" y1="${T}" y2="${T + ih}" stroke="${col}" stroke-width="1.4" ${dash ? 'stroke-dasharray="3 3"' : ''}/>`;
    const right = X(t) > L + iw - 120; s += `<text x="${X(t) + (right ? -5 : 5)}" y="${T + 12 + dy}" text-anchor="${right ? 'end' : 'start'}" fill="${col}" font-weight="600">${esc(lbl)}</text>`;
  };
  if (mode === 'cool') {
    if (show.zones) mark(o.coolStart, 'konec natápění ' + hmOf(o.coolStart), c.muted, true, 0);
    if (show.model && C && C.tThr) mark(C.tThr, 'pod ' + nf(o.thr, o.thr % 1 ? 1 : 0) + ' °C ' + hmOf(C.tThr), c.bad, false, Math.abs(X(C.tThr) - X(o.coolStart)) < 130 ? 16 : 0);
    if (C && C.below) mark(C.below, 'pod hranicí ' + hmOf(C.below), c.bad, false, 16);
  } else if (R) {
    if (show.model && R.eta) mark(R.eta, 'ETA ' + hmOf(R.eta), c.heat, false, 0);
    if (R.reached) mark(R.reached, 'natopeno ' + hmOf(R.reached), c.heat, false, 0);
  }
  /* ===== hover ===== */
  const fit = mode === 'heat' && R && R.fit ? R.fit : null;
  const heatRate = mode === 'heat' && R ? (fit ? fit.b : R.rate) : null;
  const trendAt = t => fit ? fit.pred((t - fit.t0) / H) : (heatRate != null && R.last ? R.last.T + heatRate * (t - R.last.t) / H : null);
  const k = mode === 'cool' && C && C.k > 0 ? C.k : null, kh = mode === 'cool' && C && C.hist ? C.hist.k : null;
  const fac = t => inFilt(filt, t) ? (C.F || 1) : 1;
  const rateCool = (t, Tv) => k ? -k * fac(t) * (Tv - amb(t)) : null;
  const project = (t, Tv, hours, kk = k) => { if (!kk) return null; let q = t, TT = Tv; const end = t + hours * H; while (q < end) { const dt = Math.min(5 * MIN, end - q), tm = q + dt / 2; TT += -kk * fac(tm) * (TT - amb(tm)) * dt / H; q += dt; } return TT; };
  const simAt = t => { if (!simPath) return null; for (let i = 1; i < simPath.length; i++) if (simPath[i][0] >= t) { const a = simPath[i - 1], b = simPath[i]; return a[1] + (b[1] - a[1]) * (t - a[0]) / (b[0] - a[0]); } return simPath[simPath.length - 1][1]; };
  const nearest = t => {
    if (!vis.length) return null; let lo = 0, hi = vis.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (vis[m].t <= t) lo = m; else hi = m; }
    return Math.abs(vis[lo].t - t) <= Math.abs(vis[hi].t - t) ? vis[lo] : vis[hi];
  };
  const hz = o.horizonH > 0 ? o.horizonH : 1, hzLabel = o.horizonLabel || 'za 1 h';
  const histAt = t => { if (!histPath) return null; for (let i = 1; i < histPath.length; i++) if (histPath[i][0] >= t) { const a = histPath[i - 1], b = histPath[i]; return a[1] + (b[1] - a[1]) * (t - a[0]) / (b[0] - a[0]); } return histPath[histPath.length - 1][1]; };
  const clampY = v => Y(Math.max(y0, Math.min(y1, v)));
  const info = t => {
    if (t <= last.t + 5 * MIN) { // změřený bod
      const p = nearest(t); if (!p) return null;
      const o2 = { t: p.t, T: p.T, kind: 'měřeno', src: p.src === 'man' ? 'ruční zápis' : 'čidlo', flags: [p.stoke && 'přiloženo', p.mix && 'zamícháno', p.bath && 'koupání (víko pryč)', p.bathEnd && 'koupání ukončeno (víko zpět)'].filter(Boolean), sx: X(p.t), sy: clampY(p.T), amb: amb ? amb(p.t) : null };
      if (mode === 'heat') {
        const tv = trendAt(p.t);
        if (tv != null) o2.trend = { rate: heatRate, value: tv, dev: p.T - tv };
        o2.pred = { eta: R && R.eta ? R.eta : null, inH: tv != null ? trendAt(p.t + H) : null, label: 'za 1 h podle trendu' };
      } else {
        o2.trend = { rate: rateCool(p.t, p.T) };
        o2.pred = { inH: project(p.t, p.T, hz), label: `${hzLabel} podle křivky`, histH: kh ? project(p.t, p.T, hz, kh) : null, tThr: C && C.tThr ? C.tThr : null };
      }
      return o2;
    }
    if (t > x1) return null;
    const Tp = mode === 'cool' ? simAt(t) : (show.model ? trendAt(t) : null);
    if (Tp == null) return { t, kind: 'bez dat', sx: X(t), sy: null, amb: amb ? amb(t) : null };
    return {
      t, T: Tp, kind: 'predikce', flags: [], sx: X(t), sy: clampY(Tp), amb: amb ? amb(t) : null,
      band: fit && mode === 'heat' ? [Tp - 1.96 * fit.se((t - fit.t0) / H), Tp + 1.96 * fit.se((t - fit.t0) / H)] : null,
      trend: { rate: mode === 'cool' ? rateCool(t, Tp) : heatRate },
      pred: mode === 'cool' ? { inH: project(t, Tp, hz), label: `${hzLabel} podle křivky`, histH: kh ? project(t, Tp, hz, kh) : null, histAt: histAt(t), tThr: C && C.tThr ? C.tThr : null } : { eta: R && R.eta ? R.eta : null },
    };
  };
  s += `<g id="hv" visibility="hidden"><line id="hv-line" x1="0" x2="0" y1="${T}" y2="${T + ih}" stroke="${c.fg || c.muted}" stroke-width="1"/><circle id="hv-dot" cx="0" cy="0" r="6" fill="none" stroke="${c.fg || c.muted}" stroke-width="2"/></g>`;
  return { svg: s + '</svg>', info, geom: { W, Hh, L, iw, x0, x1 } };
}

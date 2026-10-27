/* UI: render, události. Všechna data jdou přes Store (GitHub + cache + fronta). Žádné alert/confirm/prompt. */
import * as A from './analysis.js';
import { H, MIN, CONFIG, hmOf } from './analysis.js';
import { Store, newId, REPO_KEY, DEFAULT_REPO } from './storage.js';
import { getWeather, loadCache, REFRESH_MS } from './weather.js';
import { buildChart } from './chart.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nf = (v, d = 1) => v.toLocaleString('cs-CZ', { minimumFractionDigits: d, maximumFractionDigits: d });
const nt = v => nf(v, v % 1 ? 1 : 0);
const pn = s => parseFloat(String(s).trim().replace(',', '.'));
const fmt = hmOf;
const fmtD = (t, ref) => { const a = A.pragueParts(t), b = A.pragueParts(ref); return fmt(t) + (a.d === b.d && a.mo === b.mo ? '' : ` (${a.d}. ${a.mo}.)`); };
const rnd5 = t => Math.ceil(t / (5 * MIN)) * 5 * MIN;

/* ===== lokální (per zařízení) nastavení UI ===== */
const UI_KEY = 'hottube.ui', DEV_KEY = 'hottube.device';
const kvGet = k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const kvSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* UI nastavení je nepovinné */ } };
const ui = { open: {}, winMin: 60, sound: false, range: 'auto', ahead: 0, show: {}, ...(kvGet(UI_KEY) || {}) };
const saveUi = () => kvSet(UI_KEY, ui);

function deviceName() {
  const s = kvGet(DEV_KEY); if (s) return s;
  const ua = navigator.userAgent;
  return /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : 'počítač';
}

const store = new Store({ device: deviceName() });
let weather = { series: [], fetchedAt: null, stale: false, error: null };
let D = null;              // poslední odvozená data
let deadlineTouched = false, manTimeTouched = false, pendingImport = null;
let lastWarnKey = null, beeped = null, audio = null;

/* ===== odvození dat ===== */
let csvKey = '', csvCache = { pts: [], dup: 0, rows: 0 };
function basePts(csv) {
  const k = csv.map(c => c.name + '|' + c.importedAt + '|' + c.text.length).join(';');
  if (k !== csvKey) { csvKey = k; csvCache = A.parseAllCSV(csv, Date.now()); }
  return csvCache;
}
function derive() {
  const st = store.state, now = Date.now();
  const base = basePts(st.csv), manual = st.manual.filter(m => !m.deleted);
  const pts = A.mergePts(base.pts, manual), filt = st.filt.windows, ss = st.session;
  const amb = A.makeAmbient(weather.series, manual, ss.coolTa);
  const d = { st, now, base, manual, pts, filt, ss, amb, cool: ss.mode === 'cool' && ss.coolStart != null };
  d.prior = A.priorRate(st.archive);
  d.R = A.analyze(pts, { target: ss.target, winMin: ui.winMin, manualOnly: base.pts.length === 0, prior: d.prior });
  if (d.cool) d.C = A.analyzeCool(pts, { coolStart: ss.coolStart, amb, thr: ss.coolThr, F: st.filt.factor, filt });
  return d;
}

/* ===== zvuk ===== */
function beep() {
  try {
    if (!audio || !ui.sound) return;
    const g = audio.createGain(); g.gain.value = 0.15; g.connect(audio.destination);
    [0, 0.4].forEach(dt => { const o = audio.createOscillator(); o.frequency.value = 880; o.connect(g); o.start(audio.currentTime + dt); o.stop(audio.currentTime + dt + 0.25); });
  } catch { /* zvuk je nepovinný */ }
}

/* ===== dlaždice ===== */
function setTile(id, cls, label, v, sub) {
  $(id).className = 'tile' + (cls ? ' ' + cls : '');
  if (label != null) $(id + 'L').textContent = label;
  $(id + 'V').textContent = v; $(id + 'S').textContent = sub || '';
}
function showAlert(lvl, html, key) {
  const al = $('alert');
  if (!lvl) { al.hidden = true; lastWarnKey = null; return; }
  al.hidden = false; al.className = 'alert ' + lvl; al.innerHTML = html;
  if (key !== lastWarnKey) { lastWarnKey = key; beep(); }
}
function warnHtml(w, R) {
  const last = R.heat[R.heat.length - 1];
  switch (w.key) {
    case 'filt': return `<b>Probíhá filtrace</b> – pokles ${nf(w.d)} °C je promíchání vody, ne vyhasínání.`;
    case 'bath': return `<b>Pokles po koupání / bez víka</b> (${nf(w.d)} °C) – očekávaný, ne vyhasínání.`;
    case 'mix': return `<b>Pokles po zamíchání</b> (${nf(w.d)} °C) – vyrovnání vrstev vody, ne vyhasínání. Sleduj další zápis.`;
    case 'cool': return `<b>Teplota klesá – oheň vyhasíná</b> (${nf(R.rateShort)} °C/h, od ${fmt(w.prevT)} ${w.d >= 0 ? '+' : ''}${nf(w.d)} °C). Přilož.`;
    default: return `<b>Slabý ohřev</b>: posledních ${Math.round((last.t - R.rateShortFrom) / MIN)} min jen ${nf(R.rateShort)} °C/h (trend ${nf(R.rate)} °C/h). Zkontroluj oheň.`;
  }
}
function probTile(R, t, dl) {
  const p = A.probBy(R, t);
  if (p == null) return setTile('tProb', R.prelim ? 'warn' : '', 'Pravděpodobnost', '–', R.prelim ? 'od 4 zápisů' : '');
  setTile('tProb', p >= CONFIG.probGreen ? 'ok' : p >= CONFIG.probOrange ? 'warn' : 'bad', 'Pravděpodobnost', p > 0.99 ? '>99 %' : p < 0.01 ? '<1 %' : Math.round(p * 100) + ' %', 'do ' + dl);
}

/* ===== režim NATÁPĚNÍ ===== */
function renderHeat(d) {
  const { R, filt } = d, tg = R.target;
  const w = A.warnState(R, filt), notes = [];
  const tl = 'Natopeno ' + nt(tg) + ' °C';
  if (!R.ok) {
    setTile('tEta', '', tl, '–', 'zapiš teplotu'); setTile('tTrend', '', 'Trend', '–'); setTile('tProb', '', 'Pravděpodobnost', '–');
    showAlert(null); $('entryFb').innerHTML = `<span class="small">${esc(R.msg || 'Zapiš teplotu.')}</span>`;
    $('notes').innerHTML = `<div>${esc(R.msg || '')}</div>`; return;
  }
  const ref = R.last.t, stall = R.pauses && R.pauses.ongoing;
  let tc = '', tt = 'Málo dat';
  if (R.reached) { tc = 'ok'; tt = 'Hotovo'; }
  else if (w && w.key === 'cool') { tc = 'bad'; tt = 'Chladne'; }
  else if (stall || (R.check && R.check.z < -2 && R.rateShort < 1) || R.noEta) { tc = 'bad'; tt = 'Stojí'; }
  else if (R.check) { const z = R.check.z; tc = z >= -2 ? 'ok' : 'warn'; tt = Math.abs(z) <= 2 ? 'Sleduje' : z > 2 ? 'Rychleji' : 'Zpomaluje'; }
  else if (R.prelim) tc = 'warn';
  setTile('tTrend', tc, 'Trend', tt, R.rate != null ? nf(R.rate) + ' °C/h' : '');
  if (R.reached) setTile('tEta', 'ok', tl, fmt(R.reached), 'dosaženo');
  else if (R.eta) setTile('tEta', R.prelim ? 'warn' : tc, tl, (R.prelim ? '≈ ' : '') + fmt(R.eta), R.prelim ? (R.fromPrior ? 'předběžně, předchozí ohřevy' : 'předběžně') : '± ' + Math.round(R.sigma / MIN) + ' min');
  else setTile('tEta', 'bad', tl, '–', 'neroste');
  // pravděpodobnost do zvoleného času
  if (R.eta && !deadlineTouched && document.activeElement !== $('deadline')) $('deadline').value = hmOf(rnd5(R.eta + 30 * MIN));
  const dl = $('deadline').value;
  if (dl && ((R.eta && R.sigma) || R.reached)) {
    const [h, m] = dl.split(':').map(Number), p0 = A.pragueParts(ref);
    let t = A.zonedToEpoch(p0.y, p0.mo, p0.d, h, m); if (t < ref - 6 * H) t += 24 * H;
    probTile(R, t, dl);
  } else setTile('tProb', R.prelim ? 'warn' : '', 'Pravděpodobnost', '–', R.prelim ? 'od 4 zápisů' : '');
  // varování
  let mixcheck = false;
  if (w) showAlert(w.lvl, warnHtml(w, R), w.key + '@' + ref);
  else if (R.reached && !R.last.mix) { mixcheck = true; showAlert('warn', `<b>Na čidle je ${nf(R.last.T)} °C.</b> Čidlo je u teplejší hladiny – zamíchej vodu a zapiš teplotu znovu se značkou „zamícháno“.`, 'mixcheck@' + ref); }
  else showAlert(null);
  // hodnocení zápisu
  let tag, cls, txt;
  if (R.check) {
    const z = R.check.z, dv = R.check.dev;
    if (Math.abs(z) <= 2) { tag = 'Na trendu'; cls = 'ok'; } else if (z > 2) { tag = 'Nad trendem'; cls = 'ok'; } else { tag = 'Pod trendem'; cls = R.rateShort < 1 ? 'bad' : 'warn'; }
    txt = `${dv >= 0 ? '+' : ''}${nf(dv)} °C proti trendu (čekáno ${nf(R.check.pred)} °C, ${nf(z, 1)}σ)`;
  } else { tag = 'Málo dat'; cls = 'warn'; txt = 'trend se vyhodnotí od 4 zápisů'; }
  if (w) { cls = w.lvl; tag = { cool: 'Chladne', filt: 'Filtrace', mix: 'Po zamíchání', bath: 'Po koupání', weak: 'Slabý ohřev' }[w.key]; }
  if (mixcheck) { tag = 'Zamíchej'; cls = 'warn'; }
  $('entryFb').innerHTML = `<span>Poslední ${fmt(R.last.t)} <b class="num">${nf(R.last.T)} °C</b></span><span class="tag ${cls}">${tag}</span><span class="small">${txt}</span>`;
  // podrobnosti
  if (R.eta && R.sigma) notes.push(`<div><b>ETA</b> ${fmtD(R.eta, ref)} ± ${Math.round(R.sigma / MIN)} min (1σ), 95% interval ${fmt(R.eta - 1.96 * R.sigma)}–${fmt(R.eta + 1.96 * R.sigma)}. Za ${Math.round((R.eta - ref) / MIN)} min od posledního bodu.</div>`);
  if (R.check) notes.push(`<div>Poslední bod: ${(R.check.dev >= 0 ? '+' : '')}${nf(R.check.dev)} °C proti trendu (${nf(R.check.z, 1)}σ).</div>`);
  notes.push(`<div>Rychlost: okno trendu ${nf(R.rate)} °C/h · posledních ${Math.round((ref - R.rateShortFrom) / MIN)} min ${nf(R.rateShort)} °C/h · průměr od startu ${nf(R.rateAvg)} °C/h.</div>`);
  if (R.eta && R.etaCons) notes.push(`<div><b>Scénáře:</b> trend → ${fmtD(R.eta, ref)}; konzervativně (průměr od startu vč. pauz ${nf(R.rateAvg)} °C/h) → ${fmtD(R.etaCons, ref)}.</div>`);
  else if (R.noEta && R.etaCons) notes.push(`<div><b>Konzervativní odhad</b> (průměr od startu): ${fmtD(R.etaCons, ref)} – platí jen pokud se ohřev obnoví.</div>`);
  if (R.fromPrior) notes.push(`<div><b>Předchozí ohřevy:</b> typické tempo ${nf(R.prior)} °C/h. ${R.priorW ? `Předběžný odhad = ${Math.round(R.priorW * 100)} % aktuální trend + ${Math.round((1 - R.priorW) * 100)} % předchozí ohřevy` : 'Zatím jen jeden bod, odhad je čistě z předchozích ohřevů'}; od 4 bodů platí jen aktuální trend.</div>`);
  else if (R.etaPrior) notes.push(`<div>Pro srovnání – podle předchozích ohřevů (${nf(R.prior)} °C/h) by bylo ${fmtD(R.etaPrior, ref)}. Rozhoduje aktuální trend.</div>`);
  if (R.prelim) notes.push(`<div>Předběžné: start ${fmtD(R.start.t, ref)} při ${nf(R.start.T)} °C. Kontrola trendu a pravděpodobnost od 4 zápisů.</div>`);
  if (R.pauses.ongoing) notes.push(`<div><b>Probíhá zpomalení/zastavení</b> od ${fmt(R.pauses.ongoing.a)} (${Math.round((R.pauses.ongoing.b - R.pauses.ongoing.a) / MIN)} min). Pravděpodobnost platí jen pro nepřerušený ohřev.</div>`);
  if (R.pauses.done.length) notes.push(`<div>Dřívější pauzy: ${R.pauses.done.map(p => `${fmt(p.a)}–${fmt(p.b)} (${Math.round((p.b - p.a) / MIN)} min)`).join(', ')}.</div>`);
  if (R.fit) notes.push(`<div>Start ${fmtD(R.start.t, ref)} při ${nf(R.start.T)} °C · trend z ${R.fit.n} bodů, R² ${nf(R.fit.r2, 3)}, σ ${nf(R.fit.sRaw, 2)} °C.</div>`);
  $('notes').innerHTML = notes.join('');
}

/* ===== režim POKLES ===== */
function renderCool(d) {
  const { C, ss } = d, thr = ss.coolThr, tl = 'Pod ' + nt(thr) + ' °C';
  let chk = null;
  if (C.check) { const z = C.check.z; chk = Math.abs(z) <= 2 ? ['Na křivce', 'ok'] : z < -2 ? ['Chladne rychleji', 'warn'] : ['Chladne pomaleji', 'ok']; }
  if (!C.ok) { setTile('tEta', '', tl, '–', 'zapiš teplotu'); setTile('tTrend', '', 'Pokles', '–'); setTile('tProb', '', 'Za 1 h', '–'); }
  else {
    const now = C.last.t;
    if (C.below) setTile('tEta', 'bad', tl, fmt(C.below), 'už pod hranicí');
    else if (C.tThr) { const left = (C.tThr - now) / MIN; setTile('tEta', left > 60 ? 'ok' : left > 15 ? 'warn' : 'bad', tl, fmt(C.tThr), C.sigma ? '± ' + Math.round(C.sigma / MIN) + ' min' : 'za ' + Math.round(left) + ' min · předběžně'); }
    else if (C.in48h != null) setTile('tEta', 'ok', tl, '> 48 h', `za 48 h ${nf(C.in48h)} °C`);
    else setTile('tEta', 'ok', tl, '–', C.rising ? 'zatím neklesá' : C.mixAt && !C.fit ? 'po zamíchání' : 'hranice pod okolím');
    const r = C.rateNow != null ? -C.rateNow : -C.rateShort;
    const st = C.lastInFilt ? 'Filtrace' : C.rising ? 'Dohřívá z ohniště' : C.lastIsBath ? 'Po koupání' : C.lastIsMix ? 'Po zamíchání' : chk ? chk[0] : C.fit && !C.check ? 'Málo bodů' : '';
    setTile('tTrend', C.rising || C.lastInFilt || C.lastIsMix ? 'ok' : chk ? chk[1] : '', 'Pokles', (r > 0 ? '−' : '+') + nf(Math.abs(r)), '°C/h' + (st ? ' · ' + st : ''));
    if (C.in1h != null) setTile('tProb', C.in1h > thr ? 'ok' : 'warn', 'Za 1 h', nf(C.in1h) + ' °C', 'podle křivky'); else setTile('tProb', '', 'Za 1 h', '–');
  }
  let a = null;
  if (C.ok && C.below) a = ['bad', `<b>Teplota pod hranicí ${nt(thr)} °C</b> od ${fmt(C.below)} (teď ${nf(C.last.T)} °C).`];
  else if (C.ok && C.tThr && C.tThr - C.last.t < CONFIG.coolWarnMin * MIN) a = ['warn', `<b>Za ~${Math.max(1, Math.round((C.tThr - C.last.t) / MIN))} min</b> klesne teplota pod ${nt(thr)} °C.`];
  else if (chk && chk[1] === 'warn' && !C.lastIsMix && !C.lastInFilt) a = ['warn', `<b>Chladne rychleji</b> než podle dosavadního průběhu (${nf(C.check.dev)} °C proti křivce).`];
  if (a) showAlert(a[0], a[1], a[0] + (C.below || '') + (C.last && C.last.t)); else showAlert(null);
  // hodnocení zápisu
  if (!C.ok) $('entryFb').innerHTML = `<span class="small">${esc(C.msg)}</span>`;
  else {
    let tag, cls, txt;
    if (C.lastInFilt && C.rateShort < 0) { tag = 'Filtrace'; cls = 'ok'; txt = 'pokles během filtrace je očekávaný (promíchání + rychlejší chladnutí)'; }
    else if (C.lastIsBath) { tag = 'Po koupání'; cls = 'ok'; txt = 'rychlejší pokles bez víka je očekávaný; křivka se počítá od tohoto bodu'; }
    else if (C.lastIsMix) { tag = 'Po zamíchání'; cls = 'ok'; txt = 'pokles po zamíchání je očekávaný; křivka se počítá od tohoto bodu'; }
    else if (C.rising) { tag = 'Dohřívá'; cls = 'ok'; txt = 'teplota po ukončení stoupá – dohřívání z ohniště'; }
    else if (chk) { tag = chk[0]; cls = chk[1]; txt = `${C.check.dev >= 0 ? '+' : ''}${nf(C.check.dev)} °C proti křivce (čekáno ${nf(C.check.pred)} °C)`; }
    else { tag = 'Málo dat'; cls = 'warn'; txt = 'porovnání s křivkou od 4 bodů poklesu'; }
    if (C.below) { tag = 'Pod hranicí'; cls = 'bad'; }
    $('entryFb').innerHTML = `<span>Poslední ${fmt(C.last.t)} <b class="num">${nf(C.last.T)} °C</b></span><span class="tag ${cls}">${tag}</span><span class="small">${txt}</span>`;
  }
  const n = [], amb = d.amb;
  n.push(`<div>Konec natápění ${fmt(ss.coolStart)}${C.peak ? ` · maximum ${nf(C.peak.T)} °C v ${fmt(C.peak.t)}` : ''}${C.mixAt ? ` · poslední zamíchání/koupání ${fmt(C.mixAt)} (křivka od něj)` : ''}.</div>`);
  if (C.last) n.push(`<div>Okolí: ${esc(amb.src)} – teď ${nf(C.Ta)} °C${C.in1h != null ? `, za 1 h ${nf(amb(C.last.t + H))} °C` : ''}.${amb.fallback ? ' <b>Pozor: není předpověď, odhad je méně spolehlivý.</b>' : ''}</div>`);
  if (C.fit) n.push(`<div>Křivka chladnutí: k = ${nf(C.k, 3)} /h (poločas rozdílu proti okolí ${nf(Math.log(2) / C.k, 1)} h), z ${C.fit.n} bodů.${C.tThr ? ` Pod ${nt(thr)} °C v ${fmtD(C.tThr, C.last.t)}${C.sigma ? ` (95% ${fmt(C.tThr - 1.96 * C.sigma)}–${fmt(C.tThr + 1.96 * C.sigma)})` : ''}.` : ''}</div>`);
  const nx = A.filtWins(d.filt, d.now, d.now + 24 * H)[0];
  n.push(`<div>Filtrace: zrychlení ×${nf(d.st.filt.factor)}${C.Fest ? ` (z dat ×${nf(C.Fest)})` : ''}${nx ? ` · další ${fmt(nx.a)}–${fmt(nx.b)}` : ''}.</div>`);
  if (C.ok) n.push(`<div>Posledních ${Math.round((C.last.t - C.rateShortFrom) / MIN)} min: ${nf(C.rateShort)} °C/h.</div>`); else n.push(`<div>${esc(C.msg)}</div>`);
  $('notes').innerHTML = n.join('');
}

/* ===== přikládání ===== */
function renderStoke() {
  if (!D || D.cool) return;
  const { R, st } = D, stoke = st.stoke, now = Date.now(), card = $('stokeCard');
  if (document.activeElement !== $('stokeInt')) $('stokeInt').value = stoke.interval;
  if (document.activeElement !== $('stokeNextIn')) $('stokeNextIn').value = stoke.next ? hmOf(stoke.next) : '';
  const set = (cls, big, sub, sum, plan = '') => { card.classList.toggle('due', cls === 'due'); $('stokeNext').textContent = big; $('stokeSub').textContent = sub; $('sumStoke').textContent = sum; $('stokePlan').innerHTML = plan; };
  if (R && R.reached) return set('', 'Natopeno', 'Další přikládání jen pro udržení teploty.', 'natopeno');
  if (!stoke.next) return set('', 'Plán přikládání nenastaven', 'Zaškrtni „přiloženo“ u zápisu nebo stiskni Přiloženo teď.', '');
  const diff = stoke.next - now, m = Math.round(Math.abs(diff) / MIN), stall = R && R.pauses && R.pauses.ongoing;
  const parts = [];
  if (stall) parts.push(`<b>Teplota stojí od ${fmt(stall.a)}.</b> Zkontroluj oheň; pokud je slabý, přilož hned a nečekej na plán.`);
  const end = R && (R.eta || R.etaCons);
  if (R && R.eta) {
    const plan = []; for (let t = stoke.next; t < R.eta && plan.length < 24; t += stoke.interval * MIN) plan.push(t);
    parts.push(`Do odhadu natopení (${fmt(R.eta)}) ještě ${plan.length}× přiložit${plan.length ? ': ' + plan.map(fmt).join(', ') : ''}.`);
    const lp = plan[plan.length - 1]; if (lp && R.eta - lp < 15 * MIN) parts.push(`<i>Můj názor, neověřeno: přiložení v ${fmt(lp)} je méně než 15 min před odhadem; zbytkový žár může stačit.</i>`);
  } else if (!end) parts.push('');
  if (diff <= 0) {
    set('due', 'Přilož teď', `plán ${fmt(stoke.next)}${m ? ' · ' + m + ' min po termínu' : ''}`, 'přilož teď', parts.join(' '));
    if (ui.sound && beeped !== stoke.next) { beeped = stoke.next; beep(); }
  } else set('', 'Další přiložení ' + fmt(stoke.next), `za ${m < 1 ? 'méně než minutu' : m + ' min'}${stoke.log.length ? ' · naposledy ' + fmt(stoke.log[stoke.log.length - 1]) : ''}`, `přiložit ${fmt(stoke.next)} (za ${m} min)`, parts.join(' '));
}
function addStoke(d, t) {
  d.stoke.log = [...new Set([...d.stoke.log, t])].sort((a, b) => a - b);
  d.stoke.next = d.stoke.log[d.stoke.log.length - 1] + d.stoke.interval * MIN;
}

/* ===== graf ===== */
let chartCtx = null;
function hideTip() { $('tip').hidden = true; const g = $('hv'); if (g) g.setAttribute('visibility', 'hidden'); }
function tipHtml(i) {
  const p = A.pragueParts(i.t), r = [];
  r.push(`<b>${p.d}. ${p.mo}. ${p.y} · ${fmt(i.t)}</b>`);
  if (i.T != null) r.push(`${i.kind === 'predikce' ? 'Predikce' : 'Teplota'}: <b>${nf(i.T)} °C</b>${i.kind === 'měřeno' ? ` <span class="small">(${i.src}${i.flags.length ? ', ' + i.flags.join(', ') : ''})</span>` : ''}`);
  else r.push('<span class="small">Mimo změřená data a bez predikce (zapni „trend / predikce“).</span>');
  const tr = i.trend;
  if (tr) {
    const rate = tr.rate != null ? `${tr.rate >= 0 ? '+' : '−'}${nf(Math.abs(tr.rate))} °C/h` : '–';
    r.push(`Trend: ${rate}${tr.value != null ? ` · na trendu ${nf(tr.value)} °C (${tr.dev >= 0 ? '+' : ''}${nf(tr.dev)})` : ''}`);
  }
  const pr = i.pred;
  if (pr) {
    if (pr.in1h != null) r.push(`Predikce: ${pr.label} ${nf(pr.in1h)} °C`);
    if (pr.eta) r.push(`Predikce: natopeno ${fmtD(pr.eta, i.t)}`);
    if (pr.tThr) r.push(`Predikce: pod hranicí ${fmtD(pr.tThr, i.t)}`);
  }
  if (i.amb != null) r.push(`<span class="small">okolí ${nf(i.amb)} °C</span>`);
  return r.map(x => `<div>${x}</div>`).join('');
}
function onChartMove(e) {
  if (!chartCtx || !chartCtx.geom) return;
  const svg = $('chart').querySelector('svg'); if (!svg) return;
  const rc = svg.getBoundingClientRect(), g = chartCtx.geom, sc = rc.width / g.W, px = (e.clientX - rc.left) / sc;
  if (px < g.L || px > g.L + g.iw) return hideTip();
  const tH = g.x0 + (px - g.L) / g.iw * (g.x1 - g.x0); if (!isFinite(tH)) return hideTip();
  const i = chartCtx.info(tH); if (!i) return hideTip();
  const hv = $('hv'), tip = $('tip');
  hv.setAttribute('visibility', 'visible'); $('hv-line').setAttribute('x1', i.sx); $('hv-line').setAttribute('x2', i.sx);
  const dot = $('hv-dot'); if (i.sy != null) { dot.setAttribute('cx', i.sx); dot.setAttribute('cy', i.sy); dot.setAttribute('visibility', 'visible'); } else dot.setAttribute('visibility', 'hidden');
  tip.innerHTML = tipHtml(i); tip.hidden = false;
  const wr = $('chart').parentElement.getBoundingClientRect(), x = e.clientX - wr.left;
  let left = x + 14; if (left + tip.offsetWidth > wr.width) left = Math.max(0, x - tip.offsetWidth - 14);
  tip.style.left = left + 'px'; tip.style.top = '6px';
}
function renderChart() {
  const open = $('secChart').open; if (!open || !D || !D.pts.length) { chartCtx = null; $('chart').innerHTML = D && D.pts.length ? '' : '<span class="small">Žádná data.</span>'; return; }
  const cs = getComputedStyle(document.documentElement), c = {};
  for (const k of ['line', 'muted', 'water', 'heat', 'bad', 'pause', 'panel', 'fg']) c[k] = cs.getPropertyValue('--' + k).trim();
  chartCtx = buildChart({ W: $('chart').clientWidth, rangeH: ui.range === 'auto' ? undefined : +ui.range, aheadMs: (ui.ahead || 0) * H, show: ui.show, pts: D.pts, mode: D.cool ? 'cool' : 'heat', R: D.R, C: D.C, filt: D.filt, amb: D.amb, target: D.ss.target, thr: D.ss.coolThr, coolStart: D.ss.coolStart, colors: c });
  $('chart').innerHTML = chartCtx.svg; hideTip();
  $('legend').innerHTML = '<span><i class="lg-water"></i>čidlo</span><span><i class="lg-heat"></i>ruční zápis</span><span><i class="lg-water dash"></i>' + (D.cool ? 'predikce' : 'trend') + '</span><span>modré pruhy = filtrace</span>' + (D.cool ? '<span>šedá zóna = od konce natápění</span>' : '<span>šedé pruhy = pauzy ohřevu</span>');
}

function syncChartCtl() {
  const presets = [...document.querySelectorAll('[data-ahead]')].map(b => +b.dataset.ahead);
  document.querySelectorAll('[data-ahead]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.ahead === (ui.ahead || 0))));
  if (document.activeElement !== $('aheadVal') && document.activeElement !== $('aheadUnit')) {
    const custom = ui.ahead > 0 && !presets.includes(ui.ahead), d = custom && ui.ahead % 24 === 0;
    $('aheadVal').value = custom ? nf(d ? ui.ahead / 24 : ui.ahead, ui.ahead % 1 && !d ? 1 : 0) : ''; $('aheadUnit').value = d ? 'd' : 'h';
  }
  document.querySelectorAll('[data-range]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.range === String(ui.range))));
  document.querySelectorAll('[data-show]').forEach(cb => { cb.checked = ui.show[cb.dataset.show] !== false; });
  const all = document.querySelectorAll('[data-show]'), on = [...all].filter(c => c.checked).length;
  $('showCount').textContent = on === all.length ? '· vše' : `· ${on}/${all.length}`;
}

/* ===== seznamy ===== */
function renderFilt() {
  const fs = D.filt.slice().sort((a, b) => a.h * 60 + a.m - (b.h * 60 + b.m)), tb = $('filtList'); tb.innerHTML = '';
  const hm = w => String(w.h).padStart(2, '0') + ':' + String(w.m).padStart(2, '0');
  $('sumFilt').textContent = fs.map(hm).join(', ') || 'žádná';
  if (document.activeElement !== $('fiFactor')) $('fiFactor').value = nf(D.st.filt.factor, 2);
  if (!fs.length) tb.innerHTML = '<tr><td colspan="3" class="small">Žádná filtrace.</td></tr>';
  fs.forEach(w => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="num">${hm(w)}</td><td class="num">${w.d} min</td><td class="r"><button type="button">Smazat</button></td>`;
    tr.querySelector('button').onclick = () => store.mutate(d => { d.filt.windows = d.filt.windows.filter(x => !(x.h === w.h && x.m === w.m && x.d === w.d)); }, 'filtrace: smazáno okno ' + hm(w));
    tb.appendChild(tr);
  });
  $('fiEst').textContent = D.C && D.C.Fest ? `z aktuálních dat ×${nf(D.C.Fest)}` : '';
}
let armedDel = null;
function renderManual() {
  const tb = $('manList'); tb.innerHTML = '';
  const rows = D.st.manual.filter(m => !m.deleted).sort((a, b) => b.t - a.t);
  $('sumMan').textContent = rows.length + ' zápisů';
  if (!rows.length) tb.innerHTML = '<tr><td colspan="5" class="small">Zatím žádné ruční zápisy.</td></tr>';
  for (const m of rows) {
    const tags = [m.stoke && 'přiloženo', m.mix && 'zamícháno', m.bath && 'koupání'].filter(Boolean).join(', ');
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="num">${fmtD(m.t, D.now)}</td><td class="num">${nf(m.T)}</td><td class="num">${m.amb != null ? nf(m.amb) + (m.ambSrc === 'man' ? ' ✎' : '') : '–'}</td><td class="small">${esc(tags)}</td><td class="r"><button type="button">${armedDel === m.id ? 'Opravdu smazat?' : 'Smazat'}</button></td>`;
    tr.querySelector('button').onclick = () => {
      if (armedDel !== m.id) { armedDel = m.id; renderManual(); setTimeout(() => { if (armedDel === m.id) { armedDel = null; if (D) renderManual(); } }, 4000); return; }
      armedDel = null; store.mutate(d => { const x = d.manual.find(y => y.id === m.id); if (x) { x.deleted = true; x.mod = Date.now(); } }, `zápis ${fmt(m.t)} smazán`);
    };
    tb.appendChild(tr);
  }
}

/* ===== import ===== */
function previewImport(name, text) {
  const r = A.parseCSV(text, Date.now());
  if (!r.pts.length) { pendingImport = null; $('importPrev').innerHTML = '<span class="msg bad">V souboru nejsou žádné použitelné řádky (čas + teplota).</span>'; $('importAct').hidden = true; return; }
  const gaps = A.findGaps(r.pts), a = r.pts[0].t, b = r.pts[r.pts.length - 1].t;
  const dd = A.dedupeCsv(text, D.base.pts, Date.now());
  const head = `<b>${esc(name)}</b>: ${r.rows} řádků, ${fmtD(a, b)} – ${fmtD(b, b)}${r.dup ? `, ${r.dup} duplicitních časů v souboru sloučeno (typicky přechod na zimní čas)` : ''}.`;
  const gp = gaps.length ? '<br>Mezery &gt; 30 min: ' + gaps.slice(0, 6).map(g => `${fmtD(g.a, b)}–${fmtD(g.b, b)}`).join(', ') + (gaps.length > 6 ? ` … (+${gaps.length - 6})` : '') : '';
  const cmp = `<br>Oproti uloženým datům: <b>${dd.fresh} nových</b>, ${dd.same} už existuje${dd.changed ? `, <b>${dd.changed} se stejným časem a jinou hodnotou</b> (nová hodnota přepíše starou)` : ''}.`;
  if (dd.fresh + dd.changed === 0) { pendingImport = null; $('importPrev').innerHTML = head + gp + cmp + '<br><span class="msg ok">Nic nového – import se nepřidá.</span>'; $('importAct').hidden = true; return; }
  pendingImport = { name, text: dd.text, fresh: dd.fresh };
  $('importPrev').innerHTML = head + gp + cmp + (dd.same ? '<br>Přidají se jen nové a změněné řádky.' : '');
  $('importAct').hidden = false;
}
function renderImport() {
  const csv = D.st.csv;
  $('sumImport').textContent = csv.length ? csv.length + '× · ' + D.base.pts.length + ' bodů' : 'bez importu';
  $('importInfo').innerHTML = csv.length ? `Uloženo: ${csv.map(c => esc(c.name)).join(', ')} – ${D.base.pts.length} bodů${D.base.dup ? `, ${D.base.dup} duplicitních časů sloučeno` : ''}. Okolí se pro každý bod bere z hodinové řady (${weather.series.length ? 'pokrývá ' + fmtD(weather.series[0].t, weather.series.at(-1).t) + ' – ' + fmtD(weather.series.at(-1).t, weather.series.at(-1).t) : 'zatím nic'}); mimo ni se použije nejbližší známá hodnota.` : 'Bez importu – odhad jen z ručních zápisů.';
}

/* ===== synchronizace ===== */
function renderSync() {
  const s = store.status, el = $('sync');
  el.className = 'sync ' + s.kind; el.textContent = s.text || '…';
  $('sumSync').textContent = s.text || '';
  $('syncState').className = 'msg ' + (s.kind === 'error' ? 'bad' : s.kind === 'ok' ? 'ok' : '');
  $('syncState').textContent = s.text + (s.kind === 'readonly' ? ' – zápisy se ukládají jen v tomto prohlížeči, dokud nevložíš token.' : '');
  $('token').placeholder = store.token ? 'token je uložen (skrytý)' : 'github_pat_…';
  if (document.activeElement !== $('repoIn')) $('repoIn').value = store.repo.owner + '/' + store.repo.repo;
  if (document.activeElement !== $('devIn')) $('devIn').value = store.device;
  const w = weather.fetchedAt ? `předpověď z ${new Date(weather.fetchedAt).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit', timeZone: A.TZ })}${weather.stale ? ' (neaktuální: ' + esc(weather.error || '') + ')' : ''}` : 'předpověď okolí není k dispozici' + (weather.error ? ' (' + esc(weather.error) + ')' : '');
  $('syncState').innerHTML += `<br><span class="small">${w}</span>`;
}

/* ===== hlavní render ===== */
let rt = null;
const scheduleRender = () => { clearTimeout(rt); rt = setTimeout(render, 0); };
function render() {
  D = derive();
  const d = D, cool = d.cool;
  $('modeChip').textContent = cool ? 'Pokles od ' + fmt(d.ss.coolStart) : 'Natápění'; $('modeChip').className = 'chip' + (cool ? ' cool' : '');
  $('endOpen').hidden = cool; $('secStoke').hidden = cool; $('manStokeL').hidden = cool;
  $('heatCtl').hidden = cool; $('coolCtl').hidden = !cool;
  if (document.activeElement !== $('target')) $('target').value = nt(d.ss.target);
  if (document.activeElement !== $('coThr')) $('coThr').value = nt(d.ss.coolThr);
  if (document.activeElement !== $('coTa')) $('coTa').value = d.ss.coolTa ?? '';
  if (document.activeElement !== $('coStart') && cool) $('coStart').value = hmOf(d.ss.coolStart);
  document.querySelectorAll('[data-win]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.win === ui.winMin)));
  const fa = A.makeAmbient(weather.series, []);
  $('manAmb').placeholder = 'auto ' + (fa.fallback ? '–' : nf(fa(d.now)));
  if (!manTimeTouched && document.activeElement !== $('manTime')) $('manTime').value = hmOf(d.now);
  if (cool) renderCool(d); else renderHeat(d);
  $('sumDetail').textContent = cool ? (d.C.tThr ? 'pod hranicí ' + fmt(d.C.tThr) : '') : (d.R.eta ? 'ETA ' + fmt(d.R.eta) : '');
  $('sumEntry').textContent = d.pts.length ? `poslední ${fmt(d.pts.at(-1).t)} · ${nf(d.pts.at(-1).T)} °C` : '';
  $('sumChart').textContent = d.pts.length + ' bodů';
  renderStoke(); renderChart(); renderFilt(); renderManual(); renderImport(); renderSync();
}

/* ===== události ===== */
function bind() {
  // sekce: pamatovat rozbalení
  document.querySelectorAll('details.sec').forEach(el => {
    const k = el.dataset.key; if (k in ui.open) el.open = ui.open[k]; else if (k === 'chart' && window.innerWidth >= 900) el.open = true;
    el.addEventListener('toggle', () => { ui.open[k] = el.open; saveUi(); if (k === 'chart') renderChart(); });
  });
  if (!store.token) $('secSync').open = true;

  const todayHM = () => hmOf(Date.now());
  // zápis
  $('manTime').addEventListener('input', () => { manTimeTouched = true; });
  $('entryForm').addEventListener('submit', e => {
    e.preventDefault();
    const now = Date.now(), err = $('entryErr');
    const t = A.resolveHM($('manTime').value, now), T = pn($('manT').value);
    if (t == null || !isFinite(T) || T < -20 || T > 110) { err.hidden = false; err.textContent = 'Zadej čas a teplotu 0–100 °C (čárka i tečka).'; return; }
    err.hidden = true;
    const rec = { id: newId(), t, T: Math.round(T * 10) / 10, mix: $('manMix').checked, bath: $('manBath').checked, stoke: $('manStoke').checked && !D.cool, note: '', mod: now };
    const aIn = pn($('manAmb').value);
    if (isFinite(aIn)) { rec.amb = aIn; rec.ambSrc = 'man'; }
    else { const fa = A.makeAmbient(weather.series, []); if (!fa.fallback) { rec.amb = Math.round(fa(t) * 10) / 10; rec.ambSrc = 'pred'; } }
    store.mutate(d => { d.manual.push(rec); if (rec.stoke) addStoke(d, t); }, `zápis ${fmt(t)} ${nf(rec.T)} °C`);
    $('manT').value = ''; $('manAmb').value = ''; $('manMix').checked = $('manBath').checked = $('manStoke').checked = false;
    manTimeTouched = false; $('manTime').value = todayHM(); $('manT').focus();
  });
  // detail: cíl, okno, čas pro pravděpodobnost
  $('target').addEventListener('change', () => { const v = pn($('target').value); if (v > 0 && v < 100) store.mutate(d => { d.session.target = v; }, `cíl ${nt(v)} °C`); });
  document.querySelectorAll('[data-win]').forEach(b => b.addEventListener('click', () => { ui.winMin = +b.dataset.win; saveUi(); render(); }));
  $('deadline').addEventListener('input', () => { deadlineTouched = true; render(); });
  $('coThr').addEventListener('change', () => { const v = pn($('coThr').value); if (isFinite(v)) store.mutate(d => { d.session.coolThr = v; }, `hranice poklesu ${nt(v)} °C`); });
  $('coTa').addEventListener('change', () => { const v = pn($('coTa').value); store.mutate(d => { d.session.coolTa = isFinite(v) ? v : null; }, 'okolí ' + (isFinite(v) ? nt(v) + ' °C' : 'auto')); });
  $('coStart').addEventListener('change', () => { const t = A.resolveHM($('coStart').value, Date.now()); if (t != null) store.mutate(d => { d.session.coolStart = t; }, 'konec natápění ' + fmt(t)); });
  // přikládání
  $('stokeNow').addEventListener('click', () => { const t = Date.now(); store.mutate(d => addStoke(d, t), 'přiloženo ' + fmt(t)); });
  $('stokeInt').addEventListener('change', () => { const v = parseInt($('stokeInt').value, 10); if (v > 0) store.mutate(d => { d.stoke.interval = v; if (d.stoke.log.length) d.stoke.next = d.stoke.log.at(-1) + v * MIN; }, 'interval přikládání ' + v + ' min'); });
  $('stokeNextIn').addEventListener('change', () => { const hm = $('stokeNextIn').value; if (!hm) return; const [h, m] = hm.split(':').map(Number), p = A.pragueParts(Date.now()); let t = A.zonedToEpoch(p.y, p.mo, p.d, h, m); if (t < Date.now() - 12 * H) t += 24 * H; store.mutate(d => { d.stoke.next = t; }, 'další přiložení ' + hm); });
  $('sound').checked = ui.sound;
  $('sound').addEventListener('change', () => { ui.sound = $('sound').checked; saveUi(); if (ui.sound) { try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); audio.resume(); beep(); } catch { /* bez zvuku */ } } });
  // filtrace
  $('filtForm').addEventListener('submit', e => { e.preventDefault(); const [h, m] = $('fiTime').value.split(':').map(Number), dur = parseInt($('fiDur').value, 10); if (!(dur > 0) || isNaN(h)) return; store.mutate(d => { d.filt.windows.push({ h, m, d: dur }); }, `filtrace: přidáno okno ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`); });
  $('fiFactor').addEventListener('change', () => { const v = pn($('fiFactor').value); if (v >= 1 && v <= 10) store.mutate(d => { d.filt.factor = v; }, 'faktor filtrace ' + nf(v, 2)); });
  // Ukončit natápění
  $('endOpen').addEventListener('click', () => { $('newPanel').hidden = true; $('endTime').value = todayHM(); $('endThr').value = nt(D.ss.coolThr); $('endTa').value = ''; $('endPanel').hidden = false; $('endTime').focus(); });
  $('endCancel').addEventListener('click', () => { $('endPanel').hidden = true; });
  $('endPanel').addEventListener('submit', e => {
    e.preventDefault(); const t = A.resolveHM($('endTime').value, Date.now()), thr = pn($('endThr').value), ta = pn($('endTa').value);
    if (t == null || !isFinite(thr)) return;
    store.mutate(d => { d.session.mode = 'cool'; d.session.coolStart = t; d.session.coolThr = thr; d.session.coolTa = isFinite(ta) ? ta : null; }, `konec natápění ${fmt(t)}`);
    $('endPanel').hidden = true;
  });
  // Nový ohřev
  $('newOpen').addEventListener('click', () => { $('endPanel').hidden = true; $('newTime').value = todayHM(); $('newT').value = ''; $('newStoke').checked = false; $('newPanel').hidden = false; $('newTime').focus(); });
  $('newCancel').addEventListener('click', () => { $('newPanel').hidden = true; });
  $('newPanel').addEventListener('submit', e => {
    e.preventDefault(); const now = Date.now(), t = A.resolveHM($('newTime').value, now), T0 = pn($('newT').value), stk = $('newStoke').checked;
    if (t == null) return;
    const k = D.C && D.C.k, hadData = D.pts.length > 0;
    store.mutate(d => {
      const live = d.manual.filter(m => !m.deleted), pts = A.mergePts(A.parseAllCSV(d.csv, now).pts, live);
      if (pts.length || d.csv.length) d.archive.push({ closedAt: now, summary: A.summarize(pts, { target: d.session.target, coolStart: d.session.coolStart, k: k || null, now }), data: { session: d.session, csv: d.csv, manual: live, stoke: d.stoke } });
      d.gen = (d.gen || 0) + 1; d.csv = []; d.manual = []; d.stoke = { interval: d.stoke.interval, next: null, log: [] };
      d.session = { ...d.session, mode: 'heat', coolStart: null, coolTa: null };
      if (isFinite(T0)) { d.manual.push({ id: newId(), t, T: Math.round(T0 * 10) / 10, mix: false, bath: false, stoke: stk, note: 'start ohřevu', mod: now }); }
      if (stk) addStoke(d, t);
    }, `nový ohřev ${fmt(t)}${hadData ? ' (předchozí data archivována)' : ''}`);
    deadlineTouched = false; $('newPanel').hidden = true;
    if (!isFinite(T0)) { $('secImport').open = true; $('secImport').scrollIntoView({ block: 'start' }); }
  });
  // import
  const readFile = f => { const r = new FileReader(); r.onload = () => previewImport(f.name, String(r.result)); r.readAsText(f); };
  $('file').addEventListener('change', () => { if ($('file').files[0]) readFile($('file').files[0]); });
  const drop = $('drop');
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) readFile(f); });
  $('importNo').addEventListener('click', () => { pendingImport = null; $('importPrev').textContent = ''; $('importAct').hidden = true; $('file').value = ''; });
  $('importOk').addEventListener('click', () => {
    if (!pendingImport) return; const p = pendingImport;
    store.mutate(d => { d.csv.push({ name: p.name, importedAt: Date.now(), text: p.text }); }, 'import ' + p.name);
    pendingImport = null; $('importAct').hidden = true; $('importPrev').innerHTML = `<span class="msg ok">Import přidán (${p.fresh} nových bodů).${store.token ? '' : ' Zatím jen v tomto prohlížeči – pro uložení do GitHubu vlož token v sekci Synchronizace.'}</span>`; $('file').value = '';
  });
  // synchronizace
  $('tokSave').addEventListener('click', async () => { const v = $('token').value.trim(); if (!v) { $('tokMsg').textContent = 'Vlož token.'; return; } store.setToken(v); $('token').value = ''; $('tokMsg').className = 'msg'; $('tokMsg').textContent = 'Token uložen v tomto prohlížeči. Synchronizuji…'; await store.flush(); await store.refresh(); $('tokMsg').textContent = 'Token uložen.'; });
  $('tokCheck').addEventListener('click', async () => { $('tokMsg').className = 'msg'; $('tokMsg').textContent = 'Ověřuji…'; const r = await store.verify(); $('tokMsg').className = 'msg ' + (r.ok && r.push ? 'ok' : 'bad'); $('tokMsg').textContent = r.msg; });
  $('tokDel').addEventListener('click', () => { store.setToken(''); $('tokMsg').className = 'msg'; $('tokMsg').textContent = 'Token odebrán z tohoto zařízení.'; });
  $('repoSave').addEventListener('click', () => {
    const m = $('repoIn').value.trim().match(/^([\w.-]+)\/([\w.-]+)$/); const dev = $('devIn').value.trim();
    if (dev) kvSet(DEV_KEY, dev);
    if (m) { kvSet(REPO_KEY, { ...DEFAULT_REPO, owner: m[1], repo: m[2] }); location.reload(); } else if (dev) location.reload(); else { $('tokMsg').className = 'msg bad'; $('tokMsg').textContent = 'Repo zadej jako vlastník/název.'; }
  });
  $('syncNow').addEventListener('click', async () => { await store.flush(); await store.refresh(); getWeather({ force: true }).then(w => { weather = w; scheduleRender(); }); });
  const download = (name, mime, text) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: mime })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
  const stamp = () => new Date().toISOString().slice(0, 10);
  $('dlJson').addEventListener('click', () => download(`hottube-${stamp()}.json`, 'application/json', JSON.stringify(store.state, null, 2)));
  $('dlCsv').addEventListener('click', () => {
    const q = s => '"' + String(s ?? '').replace(/"/g, '""') + '"';
    const rows = store.state.manual.filter(m => !m.deleted).sort((a, b) => a.t - b.t).map(m => [new Date(m.t).toISOString(), `${A.pragueParts(m.t).d}.${A.pragueParts(m.t).mo}.${A.pragueParts(m.t).y} ${fmt(m.t)}`, m.T, m.amb ?? '', m.ambSrc ?? '', m.mix ? 1 : 0, m.bath ? 1 : 0, m.stoke ? 1 : 0, q(m.note)].join(';'));
    download(`hottube-zapisy-${stamp()}.csv`, 'text/csv', ['iso_utc;cas_praha;teplota_c;okoli_c;okoli_zdroj;zamichano;koupani;prilozeno;poznamka', ...rows].join('\n') + '\n');
  });
  $('chart').addEventListener('pointermove', onChartMove); $('chart').addEventListener('pointerdown', onChartMove); $('chart').addEventListener('pointerleave', hideTip);
  // graf: rozsah a viditelnost
  document.querySelectorAll('[data-range]').forEach(b => b.addEventListener('click', () => { ui.range = b.dataset.range; saveUi(); syncChartCtl(); renderChart(); }));
  document.querySelectorAll('[data-ahead]').forEach(b => b.addEventListener('click', () => { ui.ahead = +b.dataset.ahead; saveUi(); syncChartCtl(); renderChart(); }));
  const customAhead = () => { const v = pn($('aheadVal').value); ui.ahead = isFinite(v) && v > 0 ? Math.min(v * ($('aheadUnit').value === 'd' ? 24 : 1), 14 * 24) : 0; saveUi(); renderChart(); document.querySelectorAll('[data-ahead]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.ahead === ui.ahead))); };
  $('aheadVal').addEventListener('input', customAhead); $('aheadUnit').addEventListener('change', customAhead);
  document.querySelectorAll('[data-show]').forEach(cb => cb.addEventListener('change', () => { ui.show = { ...ui.show, [cb.dataset.show]: cb.checked }; saveUi(); syncChartCtl(); renderChart(); }));
  document.addEventListener('click', e => { const m = $('showMenu'); if (m.open && !m.contains(e.target)) m.open = false; });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') $('showMenu').open = false; });
  syncChartCtl();
  // téma grafu
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', renderChart);
  window.addEventListener('resize', () => { clearTimeout(bind.rz); bind.rz = setTimeout(renderChart, 150); });
}

/* ===== start ===== */
async function loadWeather(force) { weather = await getWeather({ force }); scheduleRender(); }
async function main() {
  bind();
  store.onChange(scheduleRender); store.onStatus(renderSync);
  weather = { ...weather, ...(loadCache() || {}) };
  render();                       // první vykreslení z cache
  await store.init();             // GitHub
  render();
  loadWeather(false);
  // polling: viditelná stránka 60 s (bez tokenu 5 min kvůli limitu 60 req/h), fronta se opakuje
  let tick = 0;
  setInterval(() => {
    tick++;
    if (store.pending > 0 && store.token) store.flush();
    else if (document.visibilityState === 'visible' && (store.token || tick % 5 === 0)) store.refresh();
  }, 60000);
  setInterval(() => { if (document.visibilityState === 'visible') loadWeather(false); }, Math.min(REFRESH_MS, 10 * MIN));
  setInterval(() => { if (D) { render(); } }, 15000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { store.refresh(); render(); } });
  window.addEventListener('online', () => { store.flush().then(() => store.refresh()); });
}
main();

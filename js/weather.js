/* Open-Meteo: hodinová teplota 2 m pro Kyselovice. Cache v localStorage; když API nejde, použije se poslední cache
   a UI to přizná (fetchedAt + stale). Bez klíče, volané přímo z prohlížeče (CORS je u Open-Meteo povolen – neověřeno v produkci). */

export const PLACE = { name: 'Kyselovice', lat: 49.3772, lon: 17.4019 };
export const WEATHER_KEY = 'hottube.weather';
export const REFRESH_MS = 3 * 3.6e6;
const HOST = 'https://api.open-meteo.com/v1/forecast';

export function weatherUrl({ lat, lon } = PLACE) {
  return `${HOST}?latitude=${lat}&longitude=${lon}&hourly=temperature_2m&timezone=Europe%2FPrague&timeformat=unixtime&past_days=2&forecast_days=3`;
}
/** Odpověď Open-Meteo (timeformat=unixtime, sekundy) → [{t (ms), T}] */
export function parseWeather(json) {
  const h = json && json.hourly; if (!h || !Array.isArray(h.time) || !Array.isArray(h.temperature_2m)) throw new Error('neočekávaná odpověď Open-Meteo');
  const out = [];
  for (let i = 0; i < h.time.length; i++) { const T = h.temperature_2m[i]; if (T != null && isFinite(T)) out.push({ t: h.time[i] * 1000, T }); }
  return out;
}
export function loadCache(kv = globalThis.localStorage) {
  try { const c = JSON.parse(kv.getItem(WEATHER_KEY)); return c && Array.isArray(c.series) ? c : null; } catch { return null; }
}
/** → {series, fetchedAt, stale, error?}. Při selhání vrátí cache se stale=true; bez cache series=[]. */
export async function getWeather({ fetch: f = (...a) => globalThis.fetch(...a), kv = globalThis.localStorage, now = Date.now(), force = false } = {}) {
  const cached = loadCache(kv);
  if (cached && !force && now - cached.fetchedAt < REFRESH_MS) return { ...cached, stale: false };
  try {
    const r = await f(weatherUrl(), { cache: 'no-store' });
    if (!r.ok) throw new Error('Open-Meteo ' + r.status);
    const series = parseWeather(await r.json());
    // starší historii z cache zachovat (past_days pokrývá jen ~2 dny)
    const keep = cached ? cached.series.filter(p => p.t < (series[0] ? series[0].t : Infinity)) : [];
    const fresh = { series: keep.concat(series), fetchedAt: now };
    try { kv.setItem(WEATHER_KEY, JSON.stringify(fresh)); } catch { /* cache je nepovinná */ }
    return { ...fresh, stale: false };
  } catch (e) {
    if (cached) return { ...cached, stale: true, error: String(e.message || e) };
    return { series: [], fetchedAt: null, stale: true, error: String(e.message || e) };
  }
}

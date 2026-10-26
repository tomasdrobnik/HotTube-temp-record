import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWeather, getWeather, weatherUrl, WEATHER_KEY, REFRESH_MS } from '../js/weather.js';

const kvOf = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };
const ok = json => async () => ({ ok: true, status: 200, json: async () => json });
const sample = { hourly: { time: [1792900000, 1792903600, 1792907200], temperature_2m: [5.1, null, 6.3] } };

test('URL: souřadnice Kyselovic, hodinová teplota, Praha', () => {
  const u = weatherUrl(); assert.match(u, /latitude=49\.3772/); assert.match(u, /longitude=17\.4019/); assert.match(u, /past_days=2/); assert.match(u, /forecast_days=3/); assert.match(u, /Europe%2FPrague/);
});
test('parseWeather: unixtime → ms, vynechá null', () => {
  assert.deepEqual(parseWeather(sample), [{ t: 1792900000000, T: 5.1 }, { t: 1792907200000, T: 6.3 }]);
  assert.throws(() => parseWeather({}));
});
test('getWeather: cache 3 h, fallback na starou cache s příznakem stale', async () => {
  const kv = kvOf(); let calls = 0;
  const f = async () => { calls++; return ok(sample)(); };
  const a = await getWeather({ fetch: f, kv, now: 1000 }); assert.equal(a.stale, false); assert.equal(calls, 1);
  await getWeather({ fetch: f, kv, now: 1000 + REFRESH_MS - 1 }); assert.equal(calls, 1);
  const bad = await getWeather({ fetch: async () => { throw new Error('offline'); }, kv, now: 1000 + REFRESH_MS + 1 });
  assert.equal(bad.stale, true); assert.equal(bad.series.length, 2); assert.equal(bad.fetchedAt, 1000);
  const none = await getWeather({ fetch: async () => { throw new Error('offline'); }, kv: kvOf(), now: 5 });
  assert.deepEqual(none.series, []); assert.ok(none.error);
  assert.ok(kv.getItem(WEATHER_KEY));
});

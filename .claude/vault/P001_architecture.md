# Architecture – HotTube temp record

**ID:** P001
**Last updated:** 2026-10-26
**Status:** Active

---

## Current Understanding

Static GitHub Pages site (vanilla ES modules, no build, no runtime deps). UI in Czech. Single source of truth is `data/state.json` in the repo; localStorage is only cache + queue of unsent changes. SPEC.md is the authority, CLAUDE.md the working rules.

## Key Details

- `js/analysis.js` pure functions only (parser, heating ETA, cooling Newton model, filtration windows, ambient, warnings, `priorRate`, `dedupeCsv`); `CONFIG` holds all unverified thresholds.
- `js/storage.js` Store class (GET/PUT Contents API, debounce 1.5 s, queue, merge, polling by app.js); `js/weather.js` Open-Meteo hourly + cache; `js/chart.js` SVG string; `js/app.js` UI.
- Time zone Europe/Prague handled explicitly via Intl (`zonedToEpoch`), tests independent of machine TZ.
- CSP meta: connect-src only api.github.com + api.open-meteo.com; no inline styles/scripts.
- Cooling threshold default is **4 °C** = freeze risk of water in filtration (user-confirmed), not 37.
- Layout: CSS grid 1/2/3/4 columns at 760/1280/1900 px, header/alert/tiles/details/chart span full width. Chart has range (Auto/3/6/12/24 h/Vše) and forward horizon (+6 h/+12 h/+1 d/+3 d/custom x h|d, max 14 d, extrapolates trend/prediction) and per-series visibility toggles in a collapsible menu, stored per device in `hottube.ui`.
- Chart: date under time axis, hover tooltip (temp, date/time, trend, prediction) via `buildChart().info(t)`.
- Cooling prediction horizon (default 1 h; 3 h/8 h/12 h/1 d/2 d/custom up to 14 d, per device `ui.coolHorizon`) drives ribbon tile "Za X", details note, hover and a marker on the chart.
- Gotcha: GitHub Pages caches JS ~10 min, so right after a deploy modules can be mixed old/new (errors like undefined field); hard reload fixes. Local dev: use a no-store server and a fresh origin.
- Tests: `node --test test/*.test.js` (37 tests incl. SPEC 6.5 reference values).

## Related Topics

- See also: P002_sync_and_data_model.md, P003_heating_prior_and_import.md

## History

- 2026-10-26: Chart range/visibility controls, full-width responsive grid
- 2026-10-26: Initial implementation M1–M5 from SPEC v1.0

---

**Lines: ~30 / 100 max**

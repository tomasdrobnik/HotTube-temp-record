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
- Layout: CSS grid 1/2/3/4 columns at 760/1280/1900 px, header/alert/tiles/details/chart span full width. Chart has range (Auto/3/6/12/24 h/Vše) and per-series visibility toggles, stored per device in `hottube.ui`.
- Tests: `node --test test/*.test.js` (33 tests incl. SPEC 6.5 reference values).

## Related Topics

- See also: P002_sync_and_data_model.md, P003_heating_prior_and_import.md

## History

- 2026-10-26: Chart range/visibility controls, full-width responsive grid
- 2026-10-26: Initial implementation M1–M5 from SPEC v1.0

---

**Lines: ~30 / 100 max**

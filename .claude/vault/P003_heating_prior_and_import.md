# Heating prior and CSV import dedupe

**ID:** P003
**Last updated:** 2026-10-26
**Status:** Active

---

## Current Understanding

- **Prior from previous heatings:** `priorRate(archive)` = median °C/h from archive summaries ((max−startT)/(maxAt−start), needs ≥3 °C and ≥15 min). Used only in preliminary phase: 1 point = pure prior ETA; 2–3 points blend weight n/4 actual trend (actual ≥ 50 %); from 4 points only actual regression decides, prior shown as informational `etaPrior`. User rule: actual trend always has priority.
- **Import dedupe:** `dedupeCsv(text, existing, now)` merges in-file duplicates (DST), compares with stored CSV points by time; reports fresh / same / changed. Only fresh+changed rows are stored (normalized ISO lines); nothing new = import refused. Changed value at same time overwrites (last wins).

## Cooling: historical trend (2026-10-29)

- `historicalCool(sessions)` = weighted mean k (weight = pairs) from archived sessions (`archive[].data`) + current data before `heatStart`; passed as `kHist` to `analyzeCool`.
- Current cooling has priority: weight w = min(1, pairs / `CONFIG.coolMinPairs`=6) → k = w·k_cur + (1−w)·k_hist; 0 pairs (e.g. right after `bathEnd`) = pure history (`kSrc` 'historie'), ≥6 = pure current. History is always shown for comparison (`C.hist`: dashed chart line, hover "Historie", details note).
- "Kdy" target: `parseWhen` (+12 h, +1 d 4 h, zítra 17:00, 30.10. 07:30) or datetime field → `ui.predAt` (absolute) / `ui.coolHorizon` (relative from now); tile/details/hover/marker use it. Historical ambient before the cached forecast falls back to nearest value (k from history unverified).

## Key Details

- Prior is empty until first "Nový ohřev" archives a session.
- Import without token stays local; UI tells user to add token in Synchronizace.

## Related Topics

- See also: P001_architecture.md, P002_sync_and_data_model.md

## History

- 2026-10-26: Added prior and import dedupe on user request

---

**Lines: ~25 / 100 max**

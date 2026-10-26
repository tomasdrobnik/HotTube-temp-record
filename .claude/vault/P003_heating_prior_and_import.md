# Heating prior and CSV import dedupe

**ID:** P003
**Last updated:** 2026-10-26
**Status:** Active

---

## Current Understanding

- **Prior from previous heatings:** `priorRate(archive)` = median °C/h from archive summaries ((max−startT)/(maxAt−start), needs ≥3 °C and ≥15 min). Used only in preliminary phase: 1 point = pure prior ETA; 2–3 points blend weight n/4 actual trend (actual ≥ 50 %); from 4 points only actual regression decides, prior shown as informational `etaPrior`. User rule: actual trend always has priority.
- **Import dedupe:** `dedupeCsv(text, existing, now)` merges in-file duplicates (DST), compares with stored CSV points by time; reports fresh / same / changed. Only fresh+changed rows are stored (normalized ISO lines); nothing new = import refused. Changed value at same time overwrites (last wins).

## Key Details

- Prior is empty until first "Nový ohřev" archives a session.
- Import without token stays local; UI tells user to add token in Synchronizace.

## Related Topics

- See also: P001_architecture.md, P002_sync_and_data_model.md

## History

- 2026-10-26: Added prior and import dedupe on user request

---

**Lines: ~25 / 100 max**

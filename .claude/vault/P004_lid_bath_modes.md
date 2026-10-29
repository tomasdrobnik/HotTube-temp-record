# Lid / bath modes (víko ano / ne)

**ID:** P004
**Last updated:** 2026-10-29
**Status:** Active

---

## Current Understanding

Three physical modes: **natápění** (lid on) · **koupání** (lid off) · **chladnutí** (lid on). Bathing is an overlay derived from manual records, not a `session.mode` value.

- Manual flags: `bath` = reading taken during bathing (lid off), `bathEnd` = bathing ended, lid back on, `mix` = mixed. All editable per record in "Ruční zápisy" (select "Typ zápisu") or set at entry time / by header button "Koupání (víko pryč)" ↔ "Koupání ukončeno (víko zpět)".
- `bathIntervals(pts)`: interval from first `bath` point to next `bathEnd`; unmatched = active (bathing now). A single point with both `bath` and `bathEnd` = zero-length interval (legacy / reference tests).
- While bathing: cooling prediction paused (tiles "Koupání", alert), header chip "Koupání od … · víko pryč". At `bathEnd` a **new cooling curve starts** from that point (needs ≥ 2 later points); bath readings are never used for k.
- Chart: shaded band "koupání"; stats: bath count = intervals, total hours without lid, pairs inside bath excluded from daily drop.

## Gotchas

- Without `bathEnd` a bath stays "active" forever (explicit marker by design; user's last record 22:40 on 2026-10-29 had to be set to bathEnd).
- Bath end point itself belongs to the new curve (`inBath` excludes `t == b`).

## Related Topics

- See also: P001_architecture.md, P002_sync_and_data_model.md

## History

- 2026-10-29: Added bathEnd + intervals on user request (3 modes)

---

**Lines: ~30 / 100 max**

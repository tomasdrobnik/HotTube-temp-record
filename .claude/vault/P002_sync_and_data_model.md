# Sync and data model

**ID:** P002
**Last updated:** 2026-10-26
**Status:** Active

---

## Current Understanding

State schema 1 (`schema, gen, session, csv[], manual[], stoke, filt{factor,auto,windows}, archive[]`). Prototype flat format is migrated on load (`migrate`), deterministic manual ids `m_p<t base36>` so two devices migrate identically. `data/state.json` in repo is still prototype format until first write.

## Key Details

- Conflict 409/422: reload, `mergeStates` (manual by id, newer `mod` wins, tombstone sticky, `stoke.log` union, local session/filt/stoke), retry max 3.
- "Nový ohřev" increments `gen`; unsynced manual points of the older generation go to `archive` as orphaned, never lost.
- Archive stores summary + full session data inside state.json (Contents API limit 1 MB per file – export and prune when near).
- No token = read-only; edits queue locally, header shows `neuloženo: N`. Token only in localStorage key `hottube.token`, header `Authorization: Bearer`, never in URL/body/cache.
- Polling 60 s with token (ETag 304), 5 min without (60 req/h unauth limit, unverified).

- Heating start: `session.heatStart` (set by "Nový ohřev", editable in Podrobnosti); fallback = manual point with note "start ohřevu"; null = auto-detect. `analyze({heatStart})` ignores all points before it (CSV exports contain older days, auto-detect picked 27. 10. 00:00 on 29. 10. 2026).

## Related Topics

- See also: P001_architecture.md

## History

- 2026-10-26: Initial documentation

---

**Lines: ~25 / 100 max**

# Session Handoff

**Last Updated:** 2026-10-26 (po 2. zadání)
**Session Focus:** Založení git repa a implementace HotTube temp record podle SPEC.md (M1–M5)

---

## Completed This Session

- Git repo (`main`, 5 commitů): starter balík + implementace
- `js/analysis.js`: parser (DST duplicity sloučeny), ohřev, chladnutí, filtrace, okolí; čisté funkce, čas Prahy bez závislosti na TZ stroje
- `js/storage.js`: GitHub Contents API, cache + fronta, merge (id, tombstones, `gen`), migrace prototypu
- `js/weather.js` (Open-Meteo + cache), `js/chart.js` (SVG), `js/app.js`, `index.html`, `css/app.css`
- 30 testů (`node --test test/*.test.js`) prochází, včetně SPEC 6.5
- Prohlédnuto v prohlížeči: 375 px bez horizontálního scrollu, light/dark, zápis, konec natápění, nový ohřev, filtrace

---

## Added After Review (2. zadání)

- Import CSV: kontrola duplicit (`dedupeCsv`) – přidají se jen nové/změněné řádky, nic nového = zamítnuto
- Nový ohřev: prior z předchozích ohřevů (`priorRate`), aktuální trend má vždy přednost (1 bod = prior, 2–3 mix n/4, 4+ jen aktuální)
- Vault projektu (P001–P003) je commitován do repa; `.gitignore` už `.claude/vault` neignoruje

## In Progress

- Push na GitHub (repo tomasdrobnik/HotTube-temp-record) – viz poslední commit; Pages a token zbývají
  - Next action: uživatel vybere složku (nabídnuto přesunutí), vytvoří public repo, push, zapnout Pages, token

---

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| Hranice poklesu výchozí 4 °C | Uživatel: kritická hranice zamrznutí vody ve filtraci, 37 °C nemá význam |
| Archiv přímo ve `state.json` | Storage řeší jen jeden soubor; limit Contents API 1 MB |
| `data/state.json` ponechán v prototypovém formátu | Migrace při načtení, přepis při prvním zápisu |
| `node --test test/*.test.js` | `node --test test/` selhává na Node 24 |
| Okolí starší než cache | Nejbližší známá hodnota, archivní API se nevolá |

---

## Blockers / Issues

- Synchronizace s GitHubem neověřena naostro (repo neexistuje, 404 v konzoli)
- Neověřeno: Open-Meteo CORS, Lighthouse a11y ≥ 90, přenos mezi 2 zařízeními
- Prahy varování a faktor filtrace 1,5 jsou návrh bez ověření na kádi

---

## Next Steps

1. [ ] Vytvořit public repo `tomasdrobnik/HotTube-temp-record`, push `main`, zapnout Pages
2. [ ] Vytvořit fine-grained token, vložit v sekci Synchronizace, ověřit akceptační kritéria 1–3
3. [ ] Změřit Lighthouse mobile
4. [ ] Otevřené: doplnit data čidla 25. 10. 18:10–24:00; filtrace jako skok (v2)

---

## Files Modified This Session

- `js/*.js`, `index.html`, `css/app.css`, `test/*.test.js`, `README.md`, `package.json`, `CLAUDE.md` (příkaz testů), `.gitignore`

---

## Notes for Next Session

Přečti `SPEC.md`, `CLAUDE.md` a vault index. Vault je v repu (`.claude/vault/`), lokální `.claude/launch.json` se ignoruje.

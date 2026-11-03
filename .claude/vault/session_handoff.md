# Session Handoff

**Last Updated:** 2026-11-03
**Session Focus:** HotTube temp record – implementace podle SPEC, následná rozšíření, přesun do /Users/home/GitHub/hottube_temp_analysis

---

## Completed This Session

- Aplikace dle SPEC M1–M5: analýza, GitHub sync (cache, fronta, merge), počasí, graf, archiv, export
- Import CSV s kontrolou duplicit; prior z předchozích ohřevů (aktuální trend má přednost)
- Začátek natápění = čas „Nový ohřev“ (`session.heatStart`); kužel nejistoty a rozptyl ETA na grafu
- Režimy víka: natápění / koupání (`bath`…`bathEnd`) / chladnutí; úprava typu zápisu v seznamu
- Historický trend chladnutí (priorita aktuálnímu), cílový čas „kdy“ (absolutně i +x h/d), tooltip při stisku
- Statistiky, ≤ 0 °C zvýrazněno, automatický faktor filtrace z dat, datum u časů
- Repo veřejné na GitHubu, vše pushnuto; 47 testů prochází; složka přesunuta a `.git` obnoven z origin

---

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| Hranice poklesu 4 °C | riziko zamrznutí vody ve filtraci (uživatel) |
| Bath = explicitní konec (`bathEnd`) | predikce se pozastaví, dokud není víko zpět |
| Tooltip jen při stisku a držení | na mobilu dlouhý stisk kopíruje text |
| Data se mění jen přes stránku (výjimka: jednorázová úprava na žádost, záloha) | CLAUDE.md pravidlo 5 |

---

## Open / Unverified

- Lighthouse mobile a11y ≥ 90 neměřen; test na dvou skutečných zařízeních a skutečném dotyku neproveden
- Prahy varování, faktor filtrace a historické k jsou odhady (okolí před cache předpovědi = nejbližší hodnota)
- Z SPEC 10: chybějící data čidla 25. 10. 18:10–24:00; filtrace jako skok (v2); notifikace mimo stránku mimo rozsah

---

## Notes for Next Session

- Přečti `SPEC.md`, `CLAUDE.md`, vault index. Testy: `node --test test/*.test.js`
- Lokální náhled: no-cache server, testovat na jiném originu (127.0.0.1) kvůli cache modulů; neukládat do živého repa (nenastavovat token)
- `.claude/launch.json` se negit-uje; po přesunu session se nekopíruje `.git` ani `.claude` (viz G006)

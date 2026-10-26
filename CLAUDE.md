# CLAUDE.md – HotTube temp record

Instrukce pro Claude Code v tomto repu. **Zdroj pravdy je `SPEC.md`** – před každou větší změnou si přečti relevantní sekci.

## Projekt v jedné větě
Statická stránka (GitHub Pages) pro záznam natápění a chladnutí kádě; data v `data/state.json` přes GitHub Contents API; UI česky.

## Komunikace s uživatelem
- Piš **česky**, stručně, nejdřív výsledek/příkaz.
- Kód a příkazy do kopírovatelných bloků.
- **Neověřené tvrzení vždy označ** („neověřeno“, „můj odhad“). Fyzikální prahy a koeficienty nejsou ověřené na této kádi – nepředstírej opak.
- Když chybí informace nutná pro správné řešení, polož **jednu** otázku a počkej.

## Tvrdá pravidla
1. **Data se nesmí tiše ztratit.** Každá změna = commit do `data/state.json`, nebo viditelně ve frontě. `localStorage` je jen cache/fronta, nikdy jediné úložiště.
2. **Nikdy necommituj token** ani ho nelogni / nedávej do URL. Token žije jen v `localStorage` zařízení.
3. **Žádný build krok, žádný framework, žádné runtime závislosti.** Vanilla ES moduly. Dev závislosti jen pokud nezbytně nutné (preferuj `node --test`).
4. **`js/analysis.js` = jen čisté funkce** (žádný DOM, `Date.now()` jen jako parametr). Každá změna algoritmu = test v `test/`.
5. **`data/state.json` neměň ručně skriptem bez zálohy**; při změně schématu zvyš `schema` a doplň migraci v `storage.js` (musí umět i formát prototypu – ploché pole `csvText`, `filt` jako pole, `filtF`).
6. **`prototype/natopeni-kade.html` neupravuj** – je to referenční implementace algoritmů a UI.
7. Minimální footprint: měň jen to, co úkol vyžaduje; nepřidávej funkce mimo SPEC bez dotazu.
8. Žádné `alert/confirm/prompt` – potvrzení stavěj do stránky.
9. Barvy jen přes CSS proměnné, light i dark téma.

## Příkazy
```bash
# testy
node --test test/*.test.js

# lokální náhled (GitHub API funguje i z localhostu)
python3 -m http.server 8080
# → http://localhost:8080
```

## Struktura
```
index.html  css/app.css  js/{app,analysis,storage,weather,chart}.js
data/state.json  fixtures/*.csv  test/*.test.js  prototype/  SPEC.md
```

## Klíčové detaily, na které je snadné zapomenout
- Časy v datech = epoch ms; zobrazení Europe/Prague. CSV čidla má lokální čas bez offsetu → při DST duplicity (25. 10. 2026 02:10–02:50) sloučit.
- Čidlo je **u hladiny** → po zamíchání/filtraci/koupání skokový pokles je normální, nesmí spustit „oheň vyhasíná“.
- Po ukončení natápění může teplota stoupat (ohniště) → „Dohřívá“, ne chyba; křivka chladnutí začíná od maxima / posledního zamíchání / koupání.
- Okno filtrace + 15 min = potlačit varování, vyloučit z odhadu k.
- Ruční zápis času `HH:MM`: vztahuj k **dnešku**; je-li > 60 min v budoucnu, ber včerejšek (chyba z prototypu – ranní zápis padal ke včerejšku).
- Teplota okolí: Open-Meteo hodinová (Kyselovice 49.3772, 17.4019), ruční hodnota má přednost; fallback přiznat v UI.
- GitHub PUT vyžaduje aktuální `sha`; 409/422 → načíst, sloučit (manual podle `id`, tombstones `deleted`), znovu uložit (max 3×).
- Debounce zápisů 1,5 s; polling 60 s jen když `document.visibilityState === 'visible'`.

## Definice hotového úkolu
- [ ] `node --test test/*.test.js` prochází (včetně referenčních výsledků SPEC 6.5)
- [ ] Stránka funguje na šířce 375 px bez horizontálního scrollu, light i dark
- [ ] Žádné chyby v konzoli; žádný token v kódu / logu / commitu
- [ ] Pokud se měnila data/schéma: migrace + test
- [ ] Krátké shrnutí uživateli: co se změnilo, co není ověřené

## Commity
- Kód: `feat: …`, `fix: …`, `test: …` (anglicky nebo česky, konzistentně v rámci PR).
- Data zapisuje stránka sama (`zápis HH:MM …`) – do `data/` necommituj ručně, pokud to uživatel nežádá.

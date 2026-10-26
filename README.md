# HotTube temp record

Záznam natápění a chladnutí dřevem vytápěné kádě (Kyselovice). Statická stránka bez build kroku, data v `data/state.json` přes GitHub Contents API. Specifikace: [SPEC.md](SPEC.md) · pravidla pro Claude Code: [CLAUDE.md](CLAUDE.md).

## Nasazení (jednorázově)

1. Vytvoř **public** repo `tomasdrobnik/HotTube-temp-record` a nahraj sem obsah (`git remote add origin … && git push -u origin main`).
2. **Settings → Pages → Deploy from a branch → `main` / `/ (root)`.** Stránka poběží na `https://tomasdrobnik.github.io/HotTube-temp-record/`.
3. **Token:** GitHub → Settings → Developer settings → *Fine-grained personal access tokens* → Generate.
   Repository access: *Only select repositories* → toto repo · Permissions: **Contents: Read and write** · Expiration: 1 rok.
4. Na každém zařízení otevři stránku → sekce **Synchronizace** → vlož token → *Uložit token* → *Ověřit*.
   Token zůstává jen v `localStorage` toho zařízení; do repa, adresy ani konzole se neposílá.

Bez tokenu je stránka jen pro čtení; zápisy se ukládají do fronty v prohlížeči (viditelná v hlavičce) a odešlou se po zadání tokenu.

## Vývoj

```bash
node --test test/*.test.js      # testy (Node ≥ 20; `node --test test/` na Node 24 nefunguje)
python3 -m http.server 8080     # → http://localhost:8080
```

Struktura: `index.html`, `css/app.css`, `js/{app,analysis,storage,weather,chart}.js`, `data/state.json`, `fixtures/`, `test/`, `prototype/` (jen ke čtení).

## Poznámky k implementaci

- `data/state.json` je zatím v **prototypovém formátu**; stránka ho při načtení zmigruje (`storage.js → migrate`) a při prvním zápisu přepíše schématem 1. ID ručních zápisů z prototypu jsou deterministická, takže dvě zařízení migrují na stejná data.
- Konflikt při zápisu (409/422): načíst → sloučit (ruční zápisy podle `id`, tombstone `deleted`, `stoke.log` sjednocen, `session`/`filt`/`stoke` lokální) → znovu, max 3×. „Nový ohřev“ zvyšuje `gen`; nesesynchronizované body ze starší generace končí v `archive`, ne ve ztracenu.
- Archiv (`archive[]`) obsahuje souhrn i plná data relace přímo ve `state.json` (nepoužívá se `data/archive/*.json`). Contents API vrací soubor jen do 1 MB – při jeho přiblížení je třeba archiv vyvézt (JSON export) a odmazat.
- Okolí starší než ~2 dny (mimo `past_days`) se doplňuje z cache hodinové řady; kde chybí, použije se nejbližší známá hodnota (archivní API se nevolá).
- Polling: 60 s při viditelné stránce s tokenem; bez tokenu 5 min (neověřený limit 60 req/h/IP).
- Prahy varování, barev pravděpodobnosti a faktor filtrace 1,5 jsou **návrh, neověřeno na této kádi**; konstanty jsou v `CONFIG` v `js/analysis.js`.

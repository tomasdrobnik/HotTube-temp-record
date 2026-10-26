# HotTube temp record – specifikace projektu

Verze: 1.0 · 26. 10. 2026 · autor zadání: Tomáš Drobník
Stav: návrh k implementaci (Claude Code)

---

## 1. Účel

Webová stránka pro záznam a vyhodnocení teploty vody v dřevem vytápěné kádi (hot tub) v Kyselovicích (okres Kroměříž).

Stránka:
1. **Natápění** – z naměřených bodů čas/teplota odhaduje, kdy voda dosáhne cílové teploty (výchozí 40 °C), zda ohřev sleduje trend, s jakou pravděpodobností bude natopeno do zvoleného času, a připomíná přikládání.
2. **Pokles** – po ručním ukončení natápění sleduje chladnutí vody, odhaduje čas poklesu pod zvolenou hranici a varuje.
3. **Ukládá data spolehlivě a sdíleně mezi zařízeními** (telefon, počítač) – do souboru v GitHub repu.

Důvod vzniku: prototyp v Claude Artifactu ukládal data do `localStorage` a večerní zápisy z 25. 10. 2026 se ztratily. **Spolehlivé uložení dat je požadavek č. 1.**

## 2. Uživatel a kontext použití

- Jeden uživatel (vlastník), 1–3 zařízení (iPhone, Mac). Stránka se používá venku u kádě, často v telefonu, ve tmě, mokrýma rukama → velké ovládací prvky, minimum psaní.
- Jazyk UI: **čeština**. Časy 24h, desetinná čárka v zobrazení (vstup přijímá čárku i tečku).
- Časové pásmo: **Europe/Prague** (pozor na přechod letní/zimní čas – viz 6.1).

### Fyzické reálie (důležité pro algoritmy)

| Fakt | Dopad |
|---|---|
| Káď je **izolovaná + nové izolační víko** | chladnutí je velmi pomalé (naměřeno k ≈ 0,013 /h) |
| Ohřev dřevem, přikládání **každých 30 min** | ohřev má pauzy, když oheň dohořívá |
| Po ukončení natápění může teplota **ještě stoupat** z rozžhaveného ohniště | nesmí se hlásit jako chyba |
| **Čidlo je u hladiny** (teplejší vrstva) | bez zamíchání ukazuje víc, než je průměr; po zamíchání teplota skokově klesne |
| **Filtrace** běží v nastavených časech (cca 01:20, 03:40, 05:40 po 30 min; 10:00 na 2 h; další doplní uživatel) | filtrace promíchá vodu → skokový pokles na čidle |
| **Koupání** = otevřené víko | rychlejší chladnutí, nový začátek křivky |
| Čidlo exportuje CSV s krokem 10 min, rozlišení 0,1 °C | viz formát v 6.1 |

## 3. Architektura

### 3.1 Rozhodnutí

| Oblast | Rozhodnutí | Zdůvodnění |
|---|---|---|
| Hosting | **GitHub Pages** z větve `main`, složka `/` (nebo `/docs`) | zdarma pro veřejné repo, bez serveru |
| Repo | `tomasdrobnik/HotTube-temp-record` (GitHub nepovoluje mezery v názvu; zobrazované jméno „HotTube temp record“) | |
| Viditelnost | **public** (GitHub Pages zdarma jen pro public repo; private vyžaduje placený plán) | data obsahují jen teploty a obec Kyselovice – uživatel potvrdí |
| Frontend | **Vanilla HTML/CSS/JS, ES moduly, bez build kroku a bez frameworku** | minimální footprint, prototyp už existuje |
| Úložiště dat | **`data/state.json` v repu**, čtení/zápis přes **GitHub REST Contents API** | uživatelova volba; historie změn = git historie |
| Autentizace zápisu | **Fine-grained Personal Access Token** – jen toto repo, oprávnění *Contents: Read and write*; vložen jednou na zařízení, uložen v `localStorage` | ztráta tokenu ≠ ztráta dat |
| Čtení bez tokenu | GitHub API bez autentizace (limit 60 req/h/IP) → režim jen pro čtení | |
| Předpověď počasí | **Open-Meteo** forecast API, hodinová `temperature_2m`, volané přímo z prohlížeče | bez klíče; ⚠️ CORS a podmínky ověřit při implementaci |
| Offline | `localStorage` jako **cache a fronta neodeslaných změn**, nikdy jako jediné úložiště | |
| Testy | `node --test` nad čistými funkcemi (analýza, parser, merge) | bez závislostí |

### 3.2 Struktura repa

```
/
├── index.html              # stránka (markup + odkaz na css/js)
├── css/app.css             # tokeny, light/dark, layout
├── js/
│   ├── app.js              # UI, render, události
│   ├── analysis.js         # ČISTÉ funkce: parseCSV, analyze (ohřev), analyzeCool, filtWins, interp…
│   ├── storage.js          # GitHub Contents API, cache, fronta, merge
│   ├── weather.js          # Open-Meteo + fallback
│   └── chart.js            # SVG graf
├── data/
│   └── state.json          # JEDINÝ zdroj pravdy pro data
├── fixtures/               # reálné CSV pro testy
│   ├── kuchyne_2026-10-25.csv
│   └── kuchyne_2026-10-26.csv
├── test/*.test.js          # node --test
├── prototype/natopeni-kade.html   # referenční prototyp (neupravovat, jen číst)
├── SPEC.md
├── CLAUDE.md
└── README.md               # jak nastavit token a Pages
```

## 4. Datový model – `data/state.json`

```json
{
  "schema": 1,
  "updated": 1792995934646,
  "updatedBy": "iPhone",
  "session": {
    "mode": "heat | cool",
    "target": 40,
    "coolStart": null,
    "coolThr": 37,
    "coolTa": null
  },
  "csv": [
    { "name": "Kuchyně 25. 10. 2026", "importedAt": 0, "text": "Time\tTemperature\tUnit\n…" }
  ],
  "manual": [
    { "id": "m_…", "t": 1792948560000, "T": 34.4, "amb": 8.0, "ambSrc": "pred|man",
      "mix": false, "bath": false, "stoke": false, "note": "" }
  ],
  "stoke": { "interval": 30, "next": null, "log": [1792948800000] },
  "filt": { "factor": 1.5, "windows": [ { "h": 1, "m": 20, "d": 30 } ] },
  "archive": [ { "closedAt": 0, "summary": { } } ]
}
```

Pravidla:
- Všechny časy = **epoch ms (UTC)**; zobrazení v Europe/Prague.
- `manual[].id` – stabilní ID (`m_` + náhodný řetězec), merge podle ID, ne podle času.
- `csv[]` – více importů; parsuje se při načtení, duplicitní časy se slučují (poslední vyhrává).
- `coolTa = null` → teplota okolí automaticky z předpovědi; číslo → konstanta.
- `schema` – při změně struktury zvýšit a doplnit migraci v `storage.js`.
- **Nový ohřev** = aktuální data se přesunou do `archive[]` (souhrn + volitelně plná data do `data/archive/YYYY-MM-DD.json`), pak se vyčistí. Nic se nemaže natrvalo bez potvrzení.
- Migrace z prototypu: prototyp měl ploché pole (`csvText`, `mode`, `coolStart`, `filt` jako pole, `filtF`, …) – `storage.js` musí umět načíst i tento tvar (viz `data/state.json` dodaný v startovním balíku).

## 5. Funkční požadavky

### 5.1 Rozložení stránky (pořadí shora)

| # | Sekce | Výchozí stav |
|---|---|---|
| 0 | Hlavička: název, stav synchronizace, štítek režimu, tlačítka **Ukončit natápění** / **Nový ohřev** | vždy viditelná |
| 1 | **Varování** (pruh) + **3 barevné dlaždice** + „Podrobnosti“ | dlaždice vždy viditelné, Podrobnosti **sbalené** |
| 2 | **Aktuální zápis** (čas, °C, okolí, přiloženo, zamícháno, koupání) + hodnocení proti trendu | **rozbalená** |
| 3 | **Přikládání** (jen režim ohřev) | rozbalená |
| 4 | Graf | sbalená |
| 5 | Filtrace | sbalená |
| 6 | Ruční zápisy (soupis) | sbalená |
| 7 | Import dat | sbalená |
| 8 | Synchronizace (token, repo, stav) | sbalená; **rozbalená, když chybí token** |
| 9 | Jak se počítá | sbalená |

Stav rozbalení si pamatuje `localStorage` (per zařízení – to je v pořádku).
Sbalená sekce ukazuje v záhlaví krátký souhrn (např. „přiložit 18:50 (za 8 min)“).

### 5.2 Režim NATÁPĚNÍ

**Dlaždice:**

| Dlaždice | Hodnota | Barva |
|---|---|---|
| Natopeno 40 °C | čas ETA, „± N min“; při < 4 bodech „≈ HH:MM předběžně“ | barva trendu; předběžně = oranžová |
| Trend | Sleduje / Rychleji / Zpomaluje / Stojí / Chladne / Hotovo + °C/h | zelená / zelená / oranžová / červená / červená / zelená |
| Pravděpodobnost | % natopení do zvoleného času | ≥ 80 % zelená, 50–80 % oranžová, < 50 % červená *(prahy = návrh, nastavitelné)* |

**Podrobnosti:** ETA s 95% intervalem, odchylka posledního bodu proti trendu (°C, σ), rychlost (okno / 15 min / průměr od startu), volba času pro pravděpodobnost, scénáře (trend vs. konzervativní), zjištěné pauzy ohřevu, cíl °C, okno trendu (30 / 60 / 90 min / od startu).

**Přikládání:** interval (výchozí 30 min), další termín (editovatelný), odpočet, tlačítko **Přiloženo teď**, zaškrtávátko „přiloženo“ u zápisu, plán přiložení do ETA, zvukové upozornění (Web Audio, zapíná se klikem). Při probíhajícím zastavení ohřevu výzva „přilož hned“.

**Hodnocení zápisu** (hned pod formulářem): štítek Na trendu / Nad trendem / Pod trendem / Chladne / Filtrace / Po zamíchání / Po koupání / Málo dat + odchylka.

**Varování (pruh nahoře):**
- 🔴 *Teplota klesá – oheň vyhasíná*: krátkodobá rychlost < −0,5 °C/h **nebo** pokles ≥ 0,2 °C proti předchozímu bodu.
- 🟠 *Slabý ohřev*: rychlost za posledních ~15 min < 40 % rychlosti trendu a zároveň < 2 °C/h, nebo probíhá pauza ohřevu.
- 🟠 *Na čidle je ≥ cíl – zamíchej a změř znovu* (čidlo je u hladiny), dokud není zápis se „zamícháno“.
- Potlačení: pokles v okně filtrace (+15 min), u zápisu „zamícháno“ nebo „koupání“ → jen informativní oranžová, ne „vyhasíná“.
- Prahy jsou **návrh bez ověření na této kádi** → konstanty v jednom místě (`analysis.js`, `CONFIG`).

### 5.3 Režim POKLES

Spouští se tlačítkem **Ukončit natápění** (čas konce, hranice °C, okolí volitelně). Trvá, dokud uživatel nestiskne **Nový ohřev**. Přikládání se skryje.

**Dlaždice:** „Pod {hranice} °C“ (čas ± min / už pod hranicí), „Pokles“ (−°C/h + stav Na křivce / Chladne rychleji / Chladne pomaleji / Dohřívá z ohniště / Filtrace / Po koupání), „Za 1 h“ (°C).

**Chování:**
- Stoupání po konci natápění = **„Dohřívá z ohniště“** (zelená, žádné varování). Křivka začíná od **maxima**.
- Zápis „zamícháno“ nebo „koupání“ = **nový začátek křivky**, bez varování.
- Okno filtrace = bez varování; páry bodů z filtrace se nepoužijí pro základní k.
- Varování: 🔴 pod hranicí; 🟠 do 30 min pod hranici; 🟠 chladne rychleji než křivka (mimo filtraci/zamíchání).
- Graf: šedá zóna od konce natápění, modré pruhy filtrace, tečkovaná teplota okolí, čárkovaná predikce, hranice.

### 5.4 Teplota okolí

- Zdroj: Open-Meteo, souřadnice **49,3772 N, 17,4019 E** (Kyselovice, zdroj: Wikipedie), hodinová `temperature_2m`, `timezone=Europe/Prague`, `past_days=2`, `forecast_days=3`.
- Načíst při startu a pak každé **3 h**; cache v `localStorage` (+ čas stažení, zobrazit „předpověď z HH:MM“).
- Mezi hodinovými body lineární interpolace; mimo rozsah poslední známá hodnota.
- **Ruční zápis**: pole „okolí °C“ se předvyplní z předpovědi (placeholder „auto X,X“); ruční hodnota má přednost a je označena ✎.
- **Import CSV**: každý bod dostane okolí z předpovědi/historie pro svůj čas (`past_days` pokryje až ~2 dny zpět; starší → Open-Meteo *archive/historical* API nebo nechat bez okolí – rozhodnout při implementaci, ⚠️ ověřit dostupnost).
- Fallback, když API nejde: konstanta zadaná uživatelem, jinak poslední cache; UI to musí přiznat.

### 5.5 Filtrace

- Seznam denních oken `{h, m, d}`; přidat / smazat; výchozí 01:20, 03:40, 05:40 (30 min) a 10:00 (120 min).
  *(Uživatel uvedl „cca 2, 4, 6 h“; v datech 26. 10. jsou skoky v 01:30, 03:50, 05:50 → okna posunuta podle dat. Uživatel může upravit.)*
- Faktor zrychlení chladnutí při filtraci (výchozí 1,5 – odhad z dat 26. 10.), zobrazit i odhad z aktuálních dat.
- ⚠️ Pozorování z dat: filtrace se projevuje **skokem** (promíchání vrstev), ne trvale rychlejším chladnutím. Volitelné vylepšení v2: modelovat filtraci jako skok ΔT místo faktoru k.

### 5.6 Import CSV

- Soubor (výběr / drag & drop); oddělovač tab / `;` / `,`; desetinná čárka i tečka.
- Datum `M/D/YYYY HH:MM:SS` (formát čidla), `D.M.YYYY`, `YYYY-MM-DD`, ISO.
- **Přechod na zimní čas**: CSV čidla obsahuje lokální čas bez offsetu; 25. 10. 2026 jsou řádky 02:10–02:50 dvakrát → sloučit duplicity, nehlásit chybu, zobrazit „N duplicitních časů sloučeno“.
- Import **přidává** k existujícím CSV (sloučení podle času), nepřepisuje.
- Ukázat: počet řádků, rozsah, mezery > 30 min (např. „chybí 25. 10. 18:10–24:00“).

### 5.7 Nový ohřev / archiv

- Formulář: čas startu, počáteční °C (volitelné – když chybí, otevřít Import), „přiloženo při startu“.
- Před vymazáním uložit relaci do archivu (souhrn: start, max, čas dosažení cíle, ukončení, k, počet zápisů).
- Potvrzení přímo na stránce (žádné `confirm()`).

### 5.8 Synchronizace (storage.js)

- **Načtení**: `GET /repos/{owner}/{repo}/contents/data/state.json` (`Accept: application/vnd.github+json`), dekódovat base64 → UTF-8 → JSON, uložit `sha`.
- **Uložení**: `PUT` stejný endpoint s `{message, content (base64 UTF-8), sha}`; zpráva např. `zápis 21:30 37,9 °C (iPhone)`.
- **Debounce** 1,5 s – série kliknutí = 1 commit.
- **Konflikt** (HTTP 409/422 kvůli sha): znovu načíst, **sloučit** (manual podle `id` – lokální příznaky vyhrávají; `stoke.log` sjednotit; skaláry `session`/`filt` = lokální, protože je uživatel právě změnil), uložit znovu; max 3 pokusy.
- **Mazání** zápisu: tombstone `deleted: true` (merge pak nevrací smazané body), fyzicky odstranit až při archivaci.
- **Offline / chyba**: změny do fronty v `localStorage`, stav „neuloženo – X změn čeká“, opakovat při `online` události a každých 60 s.
- **Polling**: když je stránka viditelná, každých 60 s `GET` (jen při změně `sha` přerenderovat) → druhé zařízení vidí změny do ~1 min.
- **Stav v hlavičce** (vždy viditelný): `synchronizováno HH:MM` (zelená) · `ukládám…` · `čeká N změn` (oranžová) · `jen čtení – chybí token` · `chyba: …` (červená s návodem).
- **Token**: pole + „Uložit token“ + „Ověřit“ (test `GET /repos/{o}/{r}`); token nikdy do repa, URL ani konzole.

### 5.9 Export / záloha

- Tlačítko **Stáhnout data (JSON)** a **Stáhnout zápisy (CSV)** – druhá pojistka mimo GitHub.

## 6. Algoritmy (převzít z prototypu, `prototype/natopeni-kade.html`)

### 6.1 Parser
viz 5.6; výstup `[{t, T, src:'csv'}]` seřazený, sloučený s `manual` (ruční má přednost při shodném čase).

### 6.2 Začátek ohřevu
Klidová hladina = medián prvních 20 % bodů (min. 3); start = poslední bod před prvním překročením klidu o 0,5 °C. V ručním režimu bez CSV = první zápis.

### 6.3 Trend a ETA (natápění)
- Lineární regrese bodů v okně (výchozí 60 min, min. 4 body) → rychlost b [°C/h], σ reziduí, **σ ≥ 0,15 °C** (rozlišení čidla).
- ETA = inverzní predikce `(cíl − a)/b`; nejistota z predikčního intervalu, min. 3 min.
- 2–3 body: předběžná ETA z průměrné rychlosti, bez pravděpodobnosti.
- Kontrola trendu: fit bez posledního bodu → predikce posledního → z = (naměřeno − predikce)/se; |z| ≤ 2 = sleduje.
- Pravděpodobnost = Φ((t_deadline − ETA)/σ_ETA). Platí jen pro nepřerušený ohřev – uvést v UI.
- Konzervativní ETA = průměrná rychlost od startu vč. pauz.
- Pauza ohřevu = úsek s rychlostí < 2 °C/h trvající ≥ 20 min (probíhající ≥ 5 min).

### 6.4 Chladnutí
Newtonův zákon s proměnným okolím: `dT/dt = −k·f(t)·(T − Ta(t))`, kde `f(t) = faktor filtrace` v okně filtrace, jinak 1.
- k z párů sousedních bodů od začátku křivky (max / poslední zamíchání / koupání), regrese přes počátek: `ΔT = −k·Δt·(T̄ − T̄a)`; páry v okně filtrace (+15 min) vyloučit z k, použít pro odhad faktoru.
- Predikce = numerická integrace krokem 5 min.
- Čas pod hranicí = první překročení v simulaci (max 48 h); σ z k ± se(k) a rozlišení čidla.
- Kontrola „na křivce“: od 4 bodů, mimo filtraci.

### 6.5 Referenční výsledky (pro testy)
Z `fixtures/` (25.–26. 10. 2026) a stavu v `data/state.json`:

| Test | Očekávání (tolerance) |
|---|---|
| Ohřev, data do 18:16 (vč. ručního 34,4 °C), okno 60 min | rychlost ≈ 5,3 °C/h (±0,2), ETA 40 °C ≈ 19:13 (±5 min), stav „Stojí/slabý ohřev“ |
| Pauza ohřevu | detekována 15:00–15:50 |
| Duplicity DST | 25. 10. 02:10–02:50 sloučeny bez chyby |
| Chladnutí od 21:30 (37,9 °C, koupání) do 06:30 (34,7 °C), okolí z předpovědi | k ≈ 0,013 /h (±0,004) |
| Syntetická data k = 0,020 /h, proměnné okolí | odhad k ± 5 % |

## 7. Nefunkční požadavky

- **Spolehlivost dat**: žádná akce nesmí data ztratit tiše; každá změna buď commit, nebo viditelně ve frontě.
- **Výkon**: první vykreslení z cache < 1 s, data z GitHubu < 3 s na 4G.
- **Mobil**: šířka 360–430 px bez horizontálního scrollu, ovládací prvky ≥ 44 px, `inputmode="decimal"` pro teploty.
- **Témata**: světlé i tmavé (`prefers-color-scheme`), barvy jen přes CSS proměnné.
- **Přístupnost**: viditelný focus, `aria-live` pro varování a dlaždice, `prefers-reduced-motion`.
- **Bezpečnost**: token jen v `localStorage` daného zařízení; doporučit expiraci tokenu 1 rok; žádné třetí strany kromě `api.github.com` a `api.open-meteo.com`; CSP meta tag.
- **Bez závislostí** za běhu (žádné CDN knihovny); fonty systémové.

## 8. Akceptační kritéria

1. Zápis na iPhonu se do 60 s objeví na Macu a naopak.
2. Po smazání dat prohlížeče (Safari → Vymazat data webů) a zadání tokenu jsou všechna data zpět.
3. Offline zápis se po připojení odešle; stav ukazuje frontu.
4. Současný zápis ze dvou zařízení nevede ke ztrátě ani jednoho bodu.
5. Import obou fixture CSV + ruční zápisy reprodukuje výsledky z 6.5.
6. Bez tokenu stránka zobrazí data jen pro čtení a jasnou výzvu k nastavení.
7. Všechny testy `node --test` prochází.
8. Lighthouse mobile: Accessibility ≥ 90.

## 9. Postup implementace (milníky)

1. **M1 – Kostra + data**: repo, Pages, `index.html` z prototypu rozdělený do modulů, `analysis.js` s testy (6.5).
2. **M2 – Úložiště**: `storage.js` (GET/PUT, sha, debounce, fronta, merge, tombstones, polling), sekce Synchronizace, migrace z prototypového formátu.
3. **M3 – Počasí**: `weather.js` (Open-Meteo hodinová, cache, fallback), okolí u zápisů a importu.
4. **M4 – UI dokončení**: archiv/Nový ohřev, export, zvuk, varování, mobilní ladění.
5. **M5 – Ověření**: akceptační kritéria 1–8, README s návodem na token.

## 10. Otevřené body (rozhodne uživatel)

- [ ] Public repo OK? (podmínka GitHub Pages zdarma)
- [ ] Prahy barev pravděpodobnosti (80/50 %) a varování – ponechat?
- [ ] Hranice poklesu: výchozí 37 °C (v datech je teď nastaveno 4 °C – ověřit, zda záměr).
- [ ] Chybějící data čidla 25. 10. 18:10–24:00 – doplnit exportem, pokud existují.
- [ ] Filtrace jako skok místo faktoru (v2)?
- [ ] Notifikace mimo otevřenou stránku (Web Push / kalendář) – mimo rozsah v1.

## 11. Mimo rozsah v1

Více uživatelů a oprávnění, přímé čtení čidla (Bluetooth/Wi-Fi), push notifikace, nativní aplikace.

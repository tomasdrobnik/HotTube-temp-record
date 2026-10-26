# HotTube temp record

Záznam natápění a chladnutí kádě. Specifikace: [SPEC.md](SPEC.md) · instrukce pro Claude Code: [CLAUDE.md](CLAUDE.md).

## Start s Claude Code
```bash
git clone https://github.com/tomasdrobnik/HotTube-temp-record.git
cd HotTube-temp-record
claude "Přečti SPEC.md a CLAUDE.md a implementuj milník M1."
```

Obsah startovního balíku: `data/state.json` (aktuální data z prototypu, formát prototypu – migrace dle SPEC 4), `fixtures/` (CSV čidla 25.–26. 10. 2026), `prototype/natopeni-kade.html` (referenční implementace).

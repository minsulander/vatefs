# ESSA SID → APP/DEP sector confirmation table

Generated from data/essa-sid-prefs.json (current code). Confirm against Appendix A/B.

## How routing works (code)

- **Normal SID**: exit from FPL/route → pref `nextSector` (DEP-W / DEP-E / ARR-W / ARR-E).
- **Slow / LÅGFART**: uses `slowPrefs` per-exit `nextSector` when present; else config `slowNextSector`.
- **Missed approach / G/A (default)**: config `mapNextSector` (+ `mapHeading` / altitude for delivery). Dual-ARR configs (1, 2) may use `mapByArr[arrRwy]`. MAP rows below are that default.
- **G/A opposite-TMA AHD flip (01L/R, 19L/R only)**: not a general SID override. Flip **ARR-E ↔ ARR-W** only when **all** of:
  1. Aircraft is on a missed approach / G/A
  2. An **assigned heading (AHD)** is set (`flight.ahdg`)
  3. That heading mainly points into the **opposite** TMA half from Appendix `mapNextSector`
     - **001–179** → East → **ARR-E**; **181–359** → West → **ARR-W**
     - **000/360** and **180** (due N/S): ambiguous — keep MAP sector
  4. Shortest angular delta vs Appendix **`mapHeading`** is **≥ 90°** (small tweaks / near-MAP headings do **not** flip)
  - Appendix heading is sourced from `resolveMapDelivery` → `essa-sid-prefs.json` `mapHeading` / `mapByArr` (only when flight ARR matches config ARR or a `mapByArr` key; otherwise no MAP heading → no flip)
  - Runways **08 / 26**: no flip (parallel 01/19 only)
  - Implemented in `resolveOppositeTmaArrSector` / `resolveAppDepNextSector` (`backend/src/essa-sid-prefs.ts`), fed `flight.ahdg` from `essa-next-si`

| Check | Config | DEP RWY | Exit / SID | Mode | Sector | Notes |
|---|---|---|---|---|---|---|
| [ ] | 1 | 01L | ARS (ARSC) | normal | DEP-W | |
| [ ] | 1 | 01L | PETEV (PETEVC) | normal | DEP-W | |
| [ ] | 1 | 01L | NOSLI (NOSLIC) | normal | DEP-W | |
| [ ] | 1 | 01L | INWIQ (INWIQC) | normal | DEP-W | |
| [ ] | 1 | 01L | RESNA (RESNAC) | normal | DEP-W | |
| [ ] | 1 | 01L | KOGAV (KOGAVC) | normal | DEP-W | |
| [ ] | 1 | 01L | TOVRI (TOVRIC) | normal | DEP-E | |
| [ ] | 1 | 01L | BABAP (BABAPC) | normal | DEP-E | |
| [ ] | 1 | 01L | PETEV, NOSLI, INWIQ (240·…) | slow | ARR-W | slowFollowSid=N |
| [ ] | 1 | 01L | ARS, KOGAV, RESNA (330·…) | slow | DEP-W | slowFollowSid=N |
| [ ] | 1 | 01L | BABAP, TOVRI (360·120·…) | slow | DEP-E | slowFollowSid=N |
| [ ] | 1 | 01L | *(fallback)* | slow | ARR-W | when exit has no slow pref sector |
| [x] | 1 | 01L | MAP / G/A 01R | go-around | ARR-E | H90 /4000FT (primary ARR) |
| [x] | 1 | 01L | MAP / G/A 01L | go-around | ARR-W | H270 /4000FT (dual-ARR / mapByArr) |
| [ ] | 2 | 19R | RESNA (RESNAG) | normal | DEP-W | |
| [ ] | 2 | 19R | KOGAV (KOGAVG) | normal | DEP-W | |
| [ ] | 2 | 19R | ARS (ARSG) | normal | DEP-W | |
| [ ] | 2 | 19R | PETEV (PETEVG) | normal | DEP-W | |
| [ ] | 2 | 19R | NOSLI (NOSLIG) | normal | DEP-W | |
| [ ] | 2 | 19R | INWIQ (INWIQG) | normal | DEP-W | |
| [ ] | 2 | 19R | TOVRI (TOVRIG) | normal | DEP-E | |
| [ ] | 2 | 19R | BABAP (BABAPG) | normal | DEP-E | |
| [x] | 2 | 19R | KOGAV, RESNA (HAPZI) | slow | ARR-W | slowFollowSid=N; exit-specific on HAPZI |
| [x] | 2 | 19R | ARS, PETEV, NOSLI, INWIQ (HAPZI) | slow | DEP-W | slowFollowSid=N; exit-specific on HAPZI |
| [x] | 2 | 19R | BABAP, TOVRI (190·120·…) | slow | DEP-E | slowFollowSid=N |
| [ ] | 2 | 19R | *(fallback)* | slow | ARR-W | when exit has no slow pref sector |
| [x] | 2 | 19R | MAP / G/A 19L | go-around | ARR-E | H90 /4000FT (primary ARR) |
| [x] | 2 | 19R | MAP / G/A 19R | go-around | ARR-W | H270 /4000FT (dual-ARR / mapByArr) |
| [ ] | 3 | 01L | ARS (ARSC) | normal | DEP-W | |
| [ ] | 3 | 01L | PETEV (PETEVC) | normal | DEP-W | |
| [ ] | 3 | 01L | NOSLI (NOSLIC) | normal | DEP-W | |
| [ ] | 3 | 01L | INWIQ (INWIQC) | normal | DEP-W | |
| [ ] | 3 | 01L | RESNA (RESNAC) | normal | DEP-W | |
| [ ] | 3 | 01L | KOGAV (KOGAVC) | normal | DEP-W | |
| [ ] | 3 | 01L | TOVRI (TOVRIC) | normal | DEP-E | |
| [ ] | 3 | 01L | BABAP (BABAPC) | normal | DEP-E | |
| [ ] | 3 | 01L | PETEV, NOSLI, INWIQ (240·…) | slow | ARR-W | slowFollowSid=N — **not covered by user** |
| [ ] | 3 | 01L | ARS, KOGAV, RESNA (270·330·…) | slow | DEP-W | slowFollowSid=N — **not covered by user** |
| [ ] | 3 | 01L | BABAP, TOVRI (120·…) | slow | DEP-E | slowFollowSid=N — **not covered by user** |
| [ ] | 3 | 01L | *(fallback)* | slow | ARR-W | when exit has no slow pref sector |
| [ ] | 3 | 01L | MAP / G/A | go-around | ARR-W | H270 /4000FT — **not covered by user** |
| [ ] | 4 | 08 | ARS (ARSL) | normal | DEP-W | |
| [ ] | 4 | 08 | PETEV (PETEVL) | normal | DEP-W | |
| [ ] | 4 | 08 | NOSLI (NOSLIL) | normal | DEP-W | |
| [ ] | 4 | 08 | INWIQ (INWIQL) | normal | DEP-W | |
| [ ] | 4 | 08 | RESNA (RESNAL) | normal | DEP-W | |
| [ ] | 4 | 08 | KOGAV (KOGAVL) | normal | DEP-W | |
| [ ] | 4 | 08 | TOVRI (TOVRIL) | normal | DEP-E | |
| [ ] | 4 | 08 | BABAP (BABAPL) | normal | DEP-E | |
| [ ] | 4 | 08 | ARS, PETEV, NOSLI, INWIQ (040·250·…) | slow | ARR-W | slowFollowSid=N — unlisted; kept prior fallback |
| [x] | 4 | 08 | RESNA, KOGAV (040·330·…) | slow | DEP-W | slowFollowSid=N |
| [x] | 4 | 08 | BABAP, TOVRI (120·…) | slow | DEP-E | slowFollowSid=N |
| [ ] | 4 | 08 | *(fallback)* | slow | ARR-W | when exit has no slow pref sector |
| [ ] | 4 | 08 | MAP / G/A | go-around | ARR-W | H270 /4000FT |
| [ ] | 5 | 08 | ARS, PETEV, NOSLI, INWIQ (KOGAVL) | normal | DEP-W | |
| [ ] | 5 | 08 | RESNA (RESNAL) | normal | DEP-W | |
| [ ] | 5 | 08 | KOGAV (KOGAVL) | normal | DEP-W | |
| [ ] | 5 | 08 | TOVRI (TOVRIL) | normal | DEP-E | |
| [ ] | 5 | 08 | BABAP (BABAPL) | normal | DEP-E | |
| [ ] | 5 | 08 | ARS, PETEV, NOSLI, INWIQ (040·250·…) | slow | ARR-W | slowFollowSid=N — unlisted; kept prior fallback |
| [x] | 5 | 08 | RESNA, KOGAV (040·330·…) | slow | DEP-W | slowFollowSid=N |
| [x] | 5 | 08 | BABAP, TOVRI (080·120·…) | slow | DEP-E | slowFollowSid=N |
| [ ] | 5 | 08 | *(fallback)* | slow | ARR-W | when exit has no slow pref sector |
| [ ] | 5 | 08 | MAP / G/A | go-around | ARR-W | H270 /4000FT |
| [ ] | 6 | 01R | ARS (ARSB) | normal | DEP-W | |
| [ ] | 6 | 01R | PETEV (PETEVB) | normal | DEP-W | |
| [ ] | 6 | 01R | NOSLI (NOSLIB) | normal | DEP-W | |
| [ ] | 6 | 01R | INWIQ (INWIQB) | normal | DEP-W | |
| [ ] | 6 | 01R | RESNA (RESNAB) | normal | DEP-W | |
| [ ] | 6 | 01R | KOGAV (KOGAVB) | normal | DEP-W | |
| [ ] | 6 | 01R | TOVRI (TOVRIB) | normal | DEP-E | |
| [ ] | 6 | 01R | BABAP (BABAPB) | normal | DEP-E | |
| [x] | 6 | 01R | PETEV, NOSLI, INWIQ (240·…) | slow | ARR-W | slowFollowSid=N |
| [x] | 6 | 01R | ARS, RESNA, KOGAV (330·…) | slow | DEP-W | slowFollowSid=N; ARS moved onto 330 group |
| [x] | 6 | 01R | BABAP, TOVRI (120·…) | slow | DEP-E | slowFollowSid=N |
| [ ] | 6 | 01R | *(fallback)* | slow | ARR-W | when exit has no slow pref sector |
| [ ] | 6 | 01R | MAP / G/A | go-around | ARR-E | H90 /4000FT |
| [ ] | 7 | 08 | ARS (ROKNIR) | normal | DEP-W | |
| [ ] | 7 | 08 | PETEV (ABENIR) | normal | DEP-W | |
| [ ] | 7 | 08 | NOSLI (DIGLIR) | normal | DEP-W | |
| [ ] | 7 | 08 | INWIQ (GALNUR) | normal | DEP-W | |
| [ ] | 7 | 08 | RESNA (RESNAL) | normal | DEP-W | |
| [ ] | 7 | 08 | KOGAV (KOGAVL) | normal | DEP-W | |
| [ ] | 7 | 08 | TOVRI (TOVRIR) | normal | DEP-E | |
| [ ] | 7 | 08 | BABAP (BABAPR) | normal | DEP-E | |
| [x] | 7 | 08 | ARS, PETEV, NOSLI, INWIQ (160·250·…) | slow | DEP-W | slowFollowSid=N |
| [x] | 7 | 08 | RESNA, KOGAV (330·…) | slow | ARR-W | slowFollowSid=N |
| [x] | 7 | 08 | BABAP, TOVRI (120·…) | slow | DEP-E | slowFollowSid=N |
| [ ] | 7 | 08 | *(fallback)* | slow | ARR-W | when exit has no slow pref sector |
| [ ] | 7 | 08 | MAP / G/A | go-around | ARR-E | H360 /4000FT |
| [ ] | 8 | 19L | RESNA (LUMAXQ) | normal | DEP-W | |
| [ ] | 8 | 19L | KOGAV (TALEKQ) | normal | DEP-W | |
| [ ] | 8 | 19L | ARS (ROKNIQ) | normal | DEP-W | |
| [ ] | 8 | 19L | PETEV (ABENIQ) | normal | DEP-W | |
| [ ] | 8 | 19L | NOSLI (DIGLIQ) | normal | DEP-W | |
| [ ] | 8 | 19L | INWIQ (GALNUQ) | normal | DEP-W | |
| [ ] | 8 | 19L | TOVRI (TOVRIE) | normal | DEP-E | |
| [ ] | 8 | 19L | BABAP (BABAPE) | normal | DEP-E | |
| [x] | 8 | 19L | ARS, PETEV (190·240·…) | slow | DEP-W | slowFollowSid=N |
| [x] | 8 | 19L | NOSLI, INWIQ (160·…) | slow | DEP-W | slowFollowSid=N |
| [x] | 8 | 19L | RESNA, KOGAV (090·010·…) | slow | DEP-E | slowFollowSid=N |
| [x] | 8 | 19L | BABAP, TOVRI (120·…) | slow | DEP-E | slowFollowSid=N |
| [ ] | 8 | 19L | *(fallback)* | slow | DEP-W | when exit has no slow pref sector |
| [ ] | 8 | 19L | MAP / G/A | go-around | ARR-E | H360 /4000FT |
| [ ] | 10 | 08 | RESNA (LUMAXR) | normal | DEP-W | |
| [ ] | 10 | 08 | KOGAV (TALEKR) | normal | DEP-W | |
| [ ] | 10 | 08 | ARS (ROKNIR) | normal | DEP-W | |
| [ ] | 10 | 08 | PETEV (ABENIR) | normal | DEP-W | |
| [ ] | 10 | 08 | NOSLI (DIGLIR) | normal | DEP-W | |
| [ ] | 10 | 08 | INWIQ (GALNUR) | normal | DEP-W | |
| [ ] | 10 | 08 | TOVRI (TOVRIR) | normal | DEP-E | |
| [ ] | 10 | 08 | BABAP (BABAPR) | normal | DEP-E | |
| [x] | 10 | 08 | ARS, PETEV, NOSLI, INWIQ (160·250·…) | slow | DEP-W | slowFollowSid=N |
| [x] | 10 | 08 | RESNA, KOGAV (160·270·…) | slow | ARR-W | slowFollowSid=N |
| [x] | 10 | 08 | BABAP, TOVRI (070·120·…) | slow | DEP-E | slowFollowSid=N |
| [ ] | 10 | 08 | *(fallback)* | slow | ARR-W | when exit has no slow pref sector |
| [ ] | 10 | 08 | MAP / G/A | go-around | ARR-W | H270 /4000FT |
| [ ] | 11 | 19L | RESNA, KOGAV (ARSE) | normal | DEP-W | |
| [ ] | 11 | 19L | ARS (ARSE) | normal | DEP-W | |
| [ ] | 11 | 19L | PETEV (PETEVE) | normal | DEP-W | |
| [ ] | 11 | 19L | NOSLI (NOSLIE) | normal | DEP-W | |
| [ ] | 11 | 19L | INWIQ (INWIQE) | normal | DEP-W | |
| [ ] | 11 | 19L | TOVRI (TOVRIE) | normal | DEP-E | |
| [ ] | 11 | 19L | BABAP (BABAPE) | normal | DEP-E | |
| [x] | 11 | 19L | ARS, PETEV, NOSLI, INWIQ (150·270·…) | slow | DEP-W | slowFollowSid=N |
| [x] | 11 | 19L | RESNA, KOGAV (150·290·…) | slow | ARR-W | slowFollowSid=N |
| [x] | 11 | 19L | BABAP, TOVRI (090·120·…) | slow | DEP-E | slowFollowSid=N |
| [ ] | 11 | 19L | *(fallback)* | slow | ARR-W | when exit has no slow pref sector |
| [ ] | 11 | 19L | MAP / G/A | go-around | ARR-W | H270 /4000FT |
| [ ] | 12 | 19R | RESNA (RESNAG) | normal | DEP-W | |
| [ ] | 12 | 19R | KOGAV (KOGAVG) | normal | DEP-W | |
| [ ] | 12 | 19R | ARS (ARSG) | normal | DEP-W | |
| [ ] | 12 | 19R | PETEV (PETEVG) | normal | DEP-W | |
| [ ] | 12 | 19R | NOSLI (NOSLIG) | normal | DEP-W | |
| [ ] | 12 | 19R | INWIQ (INWIQG) | normal | DEP-W | |
| [ ] | 12 | 19R | TOVRI (TOVRIG) | normal | DEP-E | |
| [ ] | 12 | 19R | BABAP (BABAPG) | normal | DEP-E | |
| [x] | 12 | 19R | ARS, PETEV, NOSLI, INWIQ (HAPZI) | slow | DEP-W | slowFollowSid=N |
| [x] | 12 | 19R | RESNA, KOGAV (HAPZI) | slow | ARR-W | slowFollowSid=N |
| [x] | 12 | 19R | BABAP, TOVRI (120·…) | slow | DEP-E | slowFollowSid=N |
| [ ] | 12 | 19R | *(fallback)* | slow | ARR-W | when exit has no slow pref sector |
| [ ] | 12 | 19R | MAP / G/A | go-around | ARR-W | H270 /4000FT |
| [ ] | 13 | 01L | ARS (ARSC) | normal | DEP-W | |
| [ ] | 13 | 01L | PETEV (PETEVC) | normal | DEP-W | |
| [ ] | 13 | 01L | NOSLI (NOSLIC) | normal | DEP-W | |
| [ ] | 13 | 01L | INWIQ (INWIQC) | normal | DEP-W | |
| [ ] | 13 | 01L | RESNA (RESNAC) | normal | DEP-W | |
| [ ] | 13 | 01L | KOGAV (KOGAVC) | normal | DEP-W | |
| [ ] | 13 | 01L | TOVRI (TOVRIC) | normal | DEP-E | |
| [ ] | 13 | 01L | BABAP (BABAPC) | normal | DEP-E | |
| [x] | 13 | 01L | ARS, PETEV, NOSLI, INWIQ, TOVRI, BABAP (010·240·…) | slow | DEP-W | slowFollowSid=N; BABAP/TOVRI DEP-W (unusual) |
| [x] | 13 | 01L | RESNA, KOGAV (010·330·…) | slow | ARR-W | slowFollowSid=N |
| [ ] | 13 | 01L | *(fallback)* | slow | ARR-W | when exit has no slow pref sector |
| [ ] | 13 | 01L | MAP / G/A | go-around | ARR-W | H180 /4000FT |
| [ ] | 14 | 19R | RESNA (RESNAG) | normal | DEP-W | |
| [ ] | 14 | 19R | KOGAV (KOGAVG) | normal | DEP-W | |
| [ ] | 14 | 19R | ARS (ARSG) | normal | DEP-W | |
| [ ] | 14 | 19R | PETEV (PETEVG) | normal | DEP-W | |
| [ ] | 14 | 19R | NOSLI (NOSLIG) | normal | DEP-W | |
| [ ] | 14 | 19R | INWIQ (INWIQG) | normal | DEP-W | |
| [ ] | 14 | 19R | TOVRI (TOVRIG) | normal | DEP-E | |
| [ ] | 14 | 19R | BABAP (BABAPG) | normal | DEP-E | |
| [x] | 14 | 19R | ARS, PETEV, NOSLI, INWIQ (HAPZI) | slow | DEP-W | slowFollowSid=N |
| [x] | 14 | 19R | RESNA, KOGAV (HAPZI) | slow | ARR-W | slowFollowSid=N |
| [x] | 14 | 19R | BABAP, TOVRI (190·120·…) | slow | DEP-E | slowFollowSid=N |
| [ ] | 14 | 19R | *(fallback)* | slow | ARR-W | when exit has no slow pref sector |
| [ ] | 14 | 19R | MAP / G/A | go-around | ARR-W | H300 /4000FT |
| [ ] | 16 | 26 | ARS (ARSK) | normal | DEP-W | |
| [ ] | 16 | 26 | PETEV (PETEVK) | normal | DEP-W | |
| [ ] | 16 | 26 | NOSLI (NOSLIK) | normal | DEP-W | |
| [ ] | 16 | 26 | INWIQ (INWIQK) | normal | DEP-W | |
| [ ] | 16 | 26 | RESNA (RESNAK) | normal | DEP-W | |
| [ ] | 16 | 26 | KOGAV (KOGAVK) | normal | DEP-W | |
| [ ] | 16 | 26 | TOVRI (TOVRIK) | normal | DEP-E | |
| [ ] | 16 | 26 | BABAP (BABAPK) | normal | DEP-E | |
| [x] | 16 | 26 | ARS, RESNA, KOGAV (300·…) | slow | ARR-W | slowFollowSid=N; ARS with KOGAV/RESNA |
| [x] | 16 | 26 | PETEV, NOSLI, INWIQ, BABAP (230·…) | slow | DEP-W | slowFollowSid=N |
| [x] | 16 | 26 | TOVRI (300·040·…) | slow | DEP-E | slowFollowSid=N |
| [ ] | 16 | 26 | *(fallback)* | slow | ARR-W | when exit has no slow pref sector |
| [ ] | 16 | 26 | MAP / G/A | go-around | ARR-W | H180 /4000FT |
| [ ] | 9A | 19L | RESNA (LUMAXQ) | normal | DEP-W | |
| [ ] | 9A | 19L | KOGAV (TALEKQ) | normal | DEP-W | |
| [ ] | 9A | 19L | ARS (ROKNIQ) | normal | DEP-W | |
| [ ] | 9A | 19L | PETEV (ABENIQ) | normal | DEP-W | |
| [ ] | 9A | 19L | NOSLI (DIGLIQ) | normal | DEP-W | |
| [ ] | 9A | 19L | INWIQ (GALNUQ) | normal | DEP-W | |
| [ ] | 9A | 19L | TOVRI (TOVRIE) | normal | DEP-E | |
| [ ] | 9A | 19L | BABAP (BABAPE) | normal | DEP-E | |
| [x] | 9A | 19L | ARS, PETEV, NOSLI, INWIQ (270·…) | slow | DEP-W | slowFollowSid=N |
| [x] | 9A | 19L | RESNA, KOGAV (290·…) | slow | ARR-W | slowFollowSid=N |
| [x] | 9A | 19L | BABAP, TOVRI (090·120·…) | slow | DEP-E | slowFollowSid=N |
| [ ] | 9A | 19L | *(fallback)* | slow | ARR-W | when exit has no slow pref sector |
| [ ] | 9A | 19L | MAP / G/A | go-around | ARR-E | H90 /4000FT |
| [ ] | 9B | 19L | RESNA (LUMAXQ) | normal | DEP-W | |
| [ ] | 9B | 19L | KOGAV (TALEKQ) | normal | DEP-W | |
| [ ] | 9B | 19L | ARS (ROKNIQ) | normal | DEP-W | |
| [ ] | 9B | 19L | PETEV (PETEVE) | normal | DEP-W | |
| [ ] | 9B | 19L | NOSLI (NOSLIE) | normal | DEP-W | |
| [ ] | 9B | 19L | INWIQ (INWIQE) | normal | DEP-W | |
| [ ] | 9B | 19L | TOVRI (TOVRIE) | normal | DEP-E | |
| [ ] | 9B | 19L | BABAP (BABAPE) | normal | DEP-E | |
| [x] | 9B | 19L | *(all exits)* | slow | *(follow SID)* | slowFollowSid=Y; CFL 5000 as SID |
| [ ] | 9B | 19L | MAP / G/A | go-around | ARR-E | H90 /4000FT |
| [ ] | 9C | 19L | RESNA, KOGAV (ARSE) | normal | DEP-W | |
| [ ] | 9C | 19L | ARS (ARSE) | normal | DEP-W | |
| [ ] | 9C | 19L | PETEV (PETEVE) | normal | DEP-W | |
| [ ] | 9C | 19L | NOSLI (NOSLIE) | normal | DEP-W | |
| [ ] | 9C | 19L | INWIQ (INWIQE) | normal | DEP-W | |
| [ ] | 9C | 19L | TOVRI (TOVRIE) | normal | DEP-E | |
| [ ] | 9C | 19L | BABAP (BABAPE) | normal | DEP-E | |
| [x] | 9C | 19L | ARS, PETEV, NOSLI, INWIQ (290·…) | slow | DEP-W | slowFollowSid=N |
| [x] | 9C | 19L | RESNA, KOGAV (290·…) | slow | ARR-W | slowFollowSid=N |
| [x] | 9C | 19L | BABAP, TOVRI (090·120·…) | slow | DEP-E | slowFollowSid=N |
| [ ] | 9C | 19L | *(fallback)* | slow | ARR-W | when exit has no slow pref sector |
| [ ] | 9C | 19L | MAP / G/A | go-around | ARR-E | H90 /4000FT |
| [ ] | 15A | 19L | RESNA (LUMAXQ) | normal | DEP-W | |
| [ ] | 15A | 19L | KOGAV (TALEKQ) | normal | DEP-W | |
| [ ] | 15A | 19L | ARS (ROKNIQ) | normal | DEP-W | |
| [ ] | 15A | 19L | PETEV (ABENIQ) | normal | DEP-W | |
| [ ] | 15A | 19L | NOSLI (DIGLIQ) | normal | DEP-W | |
| [ ] | 15A | 19L | INWIQ (GALNUQ) | normal | DEP-W | |
| [ ] | 15A | 19L | TOVRI (TOVRIE) | normal | DEP-E | |
| [ ] | 15A | 19L | BABAP (BABAPE) | normal | DEP-E | |
| [x] | 15A | 19L | ARS, PETEV, NOSLI, INWIQ (250·270·…) | slow | DEP-W | slowFollowSid=N |
| [x] | 15A | 19L | RESNA, KOGAV (250·290·…) | slow | ARR-W | slowFollowSid=N |
| [x] | 15A | 19L | BABAP, TOVRI (120·…) | slow | DEP-E | slowFollowSid=N |
| [ ] | 15A | 19L | *(fallback)* | slow | ARR-W | when exit has no slow pref sector |
| [ ] | 15A | 19L | MAP / G/A | go-around | ARR-W | H300 /4000FT |
| [ ] | 15B | 19L | RESNA (LUMAXQ) | normal | DEP-W | |
| [ ] | 15B | 19L | KOGAV (TALEKQ) | normal | DEP-W | |
| [ ] | 15B | 19L | ARS (ROKNIQ) | normal | DEP-W | |
| [ ] | 15B | 19L | PETEV (PETEVE) | normal | DEP-W | |
| [ ] | 15B | 19L | NOSLI (NOSLIE) | normal | DEP-W | |
| [ ] | 15B | 19L | INWIQ (INWIQE) | normal | DEP-W | |
| [ ] | 15B | 19L | TOVRI (TOVRIE) | normal | DEP-E | |
| [ ] | 15B | 19L | BABAP (BABAPE) | normal | DEP-E | |
| [x] | 15B | 19L | *(all exits)* | slow | *(follow SID)* | slowFollowSid=Y; CFL 5000 as SID |
| [ ] | 15B | 19L | MAP / G/A | go-around | ARR-W | H300 /4000FT |
| [ ] | 15C | 19L | RESNA, KOGAV (ARSE) | normal | DEP-W | |
| [ ] | 15C | 19L | ARS (ARSE) | normal | DEP-W | |
| [ ] | 15C | 19L | PETEV (PETEVE) | normal | DEP-W | |
| [ ] | 15C | 19L | NOSLI (NOSLIE) | normal | DEP-W | |
| [ ] | 15C | 19L | INWIQ (INWIQE) | normal | DEP-W | |
| [ ] | 15C | 19L | TOVRI (TOVRIE) | normal | DEP-E | |
| [ ] | 15C | 19L | BABAP (BABAPE) | normal | DEP-E | |
| [x] | 15C | 19L | ARS, PETEV, NOSLI, INWIQ (190·210·…) | slow | DEP-W | slowFollowSid=N; CFL 4000 |
| [x] | 15C | 19L | RESNA, KOGAV (190·210·…) | slow | ARR-W | slowFollowSid=N; CFL 4000 |
| [x] | 15C | 19L | BABAP, TOVRI (120·…) | slow | DEP-E | slowFollowSid=N; CFL 3000 |
| [ ] | 15C | 19L | *(fallback)* | slow | ARR-W | when exit has no slow pref sector |
| [ ] | 15C | 19L | MAP / G/A | go-around | ARR-W | H300 /4000FT |

## Clarifying questions

1. ~~Opposite-direction AHD~~ — implemented as G/A + opposite TMA half + ≥90° from Appendix `mapHeading` (01/19 only). Confirm Appendix MAP headings in the MAP rows below.
2. ~~Night configs `slowFollowSid`~~ — confirmed for 9B / 15B (SLOW follows normal SID handover + CFL 5000).
3. Confirm G/A delivery sectors/headings match current Appendix MAP tables for each config (configs other than 1 & 2 still unchecked).
4. **Config 3** — user did not list; left unchanged.
5. ~~**Config 16 ARS slow**~~ — corrected: ARS with KOGAV/RESNA (300·…) → ARR-W.
6. **Configs 4 & 5** — user listed only KOGAV/RESNA and BABAP/TOVRI; ARS/PETEV/NOSLI/INWIQ kept prior ARR-W fallback.

## Summary

- Add `/efs/sync/:realm/:airport[/:stripKey]` REST API for VatEFS (EFS stays local on each controller PC)
- Syncs **scribble strokes** + **bay order** (`bayId` / `sectionId` / `position`) + **EFS-only** strip fields
- Does **not** sync EuroScope status (groundstate, CFTO, runways, ownership) — IRIS esdata already has that; join by callsign
- Does **not** invent flight strips — those still come from EuroScope on each PC
- Auth: `X-Vatsim-Cid` + CID must exist in `useraccount` (no OAuth), as agreed
- Postgres table + ~1h TTL; rate limits / payload caps
- Airport meta: `GET/PUT /efs/sync/:realm/:airport/meta` with `{ essaSep: { sep, dlv, depGap } }`
- Strip TV layout (branch `efs-sync/stripview`): VatEFS also `PUT /efs/ESSA/DEP` with ordered `TWR-W`/`TWR-E` callsigns + SEP; transferred-to-APP strips drop out of columns
- Closed-beta tested via Cloudflare Tunnel + allowlist host

## Test plan

- [ ] Migration applies cleanly (`efs_scribble` + `efs_airport_meta`)
- [ ] GET/PUT/DELETE with valid CID in useraccount
- [ ] 403 when CID has no useraccount
- [ ] Room isolation: live vs sweatbox, ESGG vs ESSA
- [ ] Strokes sync for an existing flight strip; missing flights are not created
- [ ] Drag placement converges for two controllers who both have the strip
- [ ] PUT/GET `…/ESSA/meta` stores and returns `essaSep`; WS/SSE fans out `type: "meta"`
- [ ] Strip TV: `PUT /efs/ESSA/DEP` columns exclude callsigns moved to CTR DEP / APP
- [ ] VatEFS Settings custom URL → `https://backend.vatiris.se` (or leave custom for self-host)

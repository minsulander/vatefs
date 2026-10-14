## Summary

- Add `/efs/sync/:realm/:airport[/:stripKey]` REST API for VatEFS (EFS stays local on each controller PC)
- Syncs **scribble strokes** + **bay placement** for strip keys that already exist locally
- Does **not** invent flight strips — those still come from EuroScope on each PC
- Auth: `X-Vatsim-Cid` + CID must exist in `useraccount` (no OAuth), as agreed
- Postgres table + ~1h TTL; rate limits / payload caps
- Closed-beta tested via Cloudflare Tunnel + allowlist host

## Test plan

- [ ] Migration applies cleanly
- [ ] GET/PUT/DELETE with valid CID in useraccount
- [ ] 403 when CID has no useraccount
- [ ] Room isolation: live vs sweatbox, ESGG vs ESSA
- [ ] Strokes sync for an existing flight strip; missing flights are not created
- [ ] Drag placement converges for two controllers who both have the strip
- [ ] VatEFS Settings custom URL → `https://backend.vatiris.se` (or leave custom for self-host)

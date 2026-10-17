## Summary

- `/efs/sync` single write set for VatEFS: `/:stripKey`, `/order`, `/meta`, optional `/heartbeat`, `/ws`
- **No** `/sep`, `/strips/:stripKey`, or `PUT /efs/:airport/:view`
- Order + scribbles + EFS-only fields + SEP/`essaConfig` — not EuroScope status
- `cfto` (boolean) and `atd` (`"HHmm"` or `null`) are allowed on order entries and strip bodies. `groundstate`, `clearedForTakeoff`, `sid`, and the other ES fields stay rejected.
- Meta: `{ essaSep, essaConfig? }` — bankonfig id (`9A`, …), not UTC hour
- ESSA Strip TV: `/order` canonical (`TWR-W`/`TWR-E` + `TAXI`|`LINEUP`|`DEPA`); transfer = absent from order
- WS: `order` · `meta` · `strip` · `stripDeleted` · `heartbeat` · `snapshot`
- Auth: `X-Vatsim-Cid` + allowlist / useraccount

## Test plan

- [ ] PUT/GET `/meta` with `{ essaSep, essaConfig: "9A" }`
- [ ] PUT/DELETE bare `/:stripKey` (not `/strips/`)
- [ ] Strip PUT accepts `cfto` / `atd` (`"HHmm"` or `null`); rejected for `groundstate` / `clearedForTakeoff` / `sid`
- [ ] PUT `/order`; transferred callsign absent after TWR→APP
- [ ] Optional `/heartbeat`; TTL refreshed by any write
- [ ] WS fanout types match IRIS consumer

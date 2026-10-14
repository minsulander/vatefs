## Summary

- `/efs/sync` single write set for VatEFS: `/:stripKey`, `/order`, `/meta`, optional `/heartbeat`, `/ws`
- **No** `/sep`, `/strips/:stripKey`, or `PUT /efs/:airport/:view`
- Order + scribbles + EFS-only fields + SEP — not EuroScope status
- ESSA Strip TV: `/order` canonical (`TWR-W`/`TWR-E` + `TAXI`|`LINEUP`|`DEPA`); transfer = absent from order
- WS: `order` · `meta` · `strip` · `stripDeleted` · `heartbeat` · `snapshot`
- Auth: `X-Vatsim-Cid` + allowlist / useraccount

## Test plan

- [ ] PUT/GET `/meta` with `{ essaSep }` only
- [ ] PUT/DELETE bare `/:stripKey` (not `/strips/`)
- [ ] PUT `/order`; transferred callsign absent after TWR→APP
- [ ] Optional `/heartbeat`; TTL refreshed by any write
- [ ] WS fanout types match IRIS consumer

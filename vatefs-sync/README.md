# VatEFS Sync (IRIS-compatible)

Standalone REST API matching the **single allowed VatIRIS write set**.

## Allowed writes only

| Method | Path | Body |
|--------|------|------|
| PUT/DELETE | `/efs/sync/:realm/:airport/:stripKey` | `{ strip?, strokes? }` |
| PUT | `/efs/sync/:realm/:airport/order` | `{ revision?, entries: [{ stripKey, bayId, sectionId, position, cfto, atd }] }` |
| PUT/GET | `/efs/sync/:realm/:airport/meta` | `{ essaSep: { sep, dlv, depGap }, essaSepOverrides?, essaConfig? }` (bare SEP + optional TWR overrides; bankonfig id e.g. `"9A"`) |
| PUT | `/efs/sync/:realm/:airport/heartbeat` | `{}` (optional; any write refreshes 5 min TTL) |
| WS | `/efs/sync/:realm/:airport/ws?cid=` | fanout |

**Not used:** `…/sep`, `…/strips/:stripKey`, `PUT /efs/:airport/:view`.

Realms: `live` | `sweatbox` | `playback` | `local`  
Auth: `X-Vatsim-Cid` on writes.

## Contract notes

- EFS-owned only (order, scribbles, EFS-only strip fields, SEP + bankonfig). No ES status — IRIS joins esdata by callsign.
- `essaConfig` = ESSA bankonfig id (`1`–`8`, `9A`/`9B`/`9C`, `10`–`14`, `15A`/`15B`/`15C`, `16`), not UTC hour.
- ESSA Strip TV: `/order` is canonical. `bayId` `TWR-W`\|`TWR-E` from dep RWY; `sectionId` `TAXI`\|`LINEUP`\|`DEPA`. Transfer → stripKey **absent** from order.
- Per-strip PUT still carries `bayId`/`sectionId`/`position` for APP/consistency.
- `cfto` (boolean) and `atd` (`"HHmm"` or `null` to clear) are allowed EFS-owned fields on **order entries and strip bodies**. Stripview must use these instead of its own ground-speed track. `false` / `null` clears (RTO). Notes and vehicles omit them.
- Strip bodies must **not** include other ES fields (`groundstate`, `clearedForTakeoff`, `depRwy`, `sid`, `stand`, `cfl`, …) — rejected with 400. `cfto` and `atd` are not in that forbidden list.
- WS events (IRIS): `order` · `meta` · `strip` · `stripDeleted` · `heartbeat` · `snapshot` (on connect) · `reassertAssumed` (peer flag rewrite).
- WS client → server: `{ "type": "reassertAssumed" }` — fanout to other CIDs in the room (`.efs refresh` late-joiner path).
- Writers: any allowlisted CID; VatEFS gates TWR→SEP, TWR+GND→order/strips.

## Run

```bash
cd vatefs-sync
npm install
set ALLOWED_CIDS=1157125,1234567   # optional
npm start
```

Default: `http://127.0.0.1:17880` — point VatEFS via `VATEFS_SYNC_URL`.

`GET /health`

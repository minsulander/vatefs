# VatEFS Sync (IRIS-compatible)

Standalone REST API matching the **single allowed VatIRIS write set**.

## Allowed writes only

| Method | Path | Body |
|--------|------|------|
| PUT/DELETE | `/efs/sync/:realm/:airport/:stripKey` | `{ strip?, strokes? }` |
| PUT | `/efs/sync/:realm/:airport/order` | `{ revision?, entries: [{ stripKey, bayId, sectionId, position }] }` |
| PUT/GET | `/efs/sync/:realm/:airport/meta` | `{ essaSep: { sep, dlv, depGap } }` (bare values e.g. `"2.5"`) |
| PUT | `/efs/sync/:realm/:airport/heartbeat` | `{}` (optional; any write refreshes 5 min TTL) |
| WS | `/efs/sync/:realm/:airport/ws?cid=` | fanout |

**Not used:** `…/sep`, `…/strips/:stripKey`, `PUT /efs/:airport/:view`.

Realms: `live` | `sweatbox` | `playback` | `local`  
Auth: `X-Vatsim-Cid` on writes.

## Contract notes

- EFS-owned only (order, scribbles, EFS-only strip fields, SEP). No ES status — IRIS joins esdata by callsign.
- ESSA Strip TV: `/order` is canonical. `bayId` `TWR-W`\|`TWR-E` from dep RWY; `sectionId` `TAXI`\|`LINEUP`\|`DEPA`. Transfer → stripKey **absent** from order.
- Per-strip PUT still carries `bayId`/`sectionId`/`position` for APP/consistency.
- WS events (IRIS): `order` · `meta` · `strip` · `stripDeleted` · `heartbeat` · `snapshot` (on connect).
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

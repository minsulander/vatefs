# VatEFS Sync (closed beta)

Standalone REST API compatible with the future VatIRIS `/efs/sync` routes.

## Run (dev PC)

```bash
cd vatefs-sync
npm install
# Optional: restrict testers
set ALLOWED_CIDS=1157125,1234567
npm start
```

Default: `http://127.0.0.1:17880`

## Cloudflare Tunnel

```bash
cloudflared tunnel --url http://127.0.0.1:17880
```

Point VatEFS at the tunnel with backend env **`VATEFS_SYNC_URL`** (no Settings URL field). Production default is `https://backend.vatiris.se`.

See `BETA.md` for the tester checklist.

## Auth

Send header `X-Vatsim-Cid: <number>` on every request.

- `ALLOWED_CIDS` unset → any positive CID (local smoke only)
- `ALLOWED_CIDS=1,2,3` → allowlist for closed beta

## API

EFS sync is **order + scribbles + EFS-only fields + SEP**. Do **not** expect EuroScope status here (groundstate, CFTO, runways, ownership) — IRIS already has that from its own plugin; consumers join by callsign.

- `GET /efs/sync/:realm/:airport?since=<iso>`
- `PUT /efs/sync/:realm/:airport/:stripKey` body `{ "strokes"?: [...], "strip"?: {...} }`  
  `strip` = bay order (`bayId`, `sectionId`, `position`) + EFS-only flags (`clearanceRead`, `qnhGiven`, `atisGiven`, note text, …).  
  Omit `strokes` or `strip` to leave the previous value unchanged (partial update).
- `DELETE /efs/sync/:realm/:airport/:stripKey`
- `GET /efs/sync/:realm/:airport/meta` — airport-scoped meta (e.g. ESSA SEP/DLV/DEP GAP)
- `PUT /efs/sync/:realm/:airport/meta` body `{ "essaSep": { "sep", "dlv", "depGap" } }`  
  Fanout: WS/SSE event `meta`.
- `WS /efs/sync/:realm/:airport/ws?cid=…` (live fanout)
- `GET /health`

### Strip TV layout (VatIRIS `efs-sync/stripview`)

VatEFS also publishes an airport/view snapshot for Strip TV / APP bay mirror:

- `PUT /efs/:airport/:view` e.g. `PUT /efs/ESSA/DEP`  
  body `{ "source": "efs", "columns": [{ "id": "TWR-W"|"TWR-E", "callsigns": [...] }], "sep": { "sep", "dlv", "depGap", "info" } }`  
- Callsigns = strips still on TWR/GND taxi-out / runway sections only. After TWR→APP/DEP transfer (`ctr_dep`), the callsign is omitted so Strip TV drops it.  
- SEP values are bare (no `nm`); `info` is empty while EFS is live. IRIS TTL ≈ 5 min — VatEFS keepalives every 2 min.  
- Dual-write with `/efs/sync/.../meta` until IRIS merges into one `/efs/sync` surface.

Realms: `live` | `sweatbox` | `playback` | `local`

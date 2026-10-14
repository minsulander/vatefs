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

- `GET /efs/sync/:realm/:airport?since=<iso>`
- `PUT /efs/sync/:realm/:airport/:stripKey` body `{ "strokes"?: [...], "strip"?: {...} }`  
  Omit `strokes` or `strip` to leave the previous value unchanged (partial update).
- `DELETE /efs/sync/:realm/:airport/:stripKey`
- `GET /efs/sync/:realm/:airport/meta` — airport-scoped meta (e.g. ESSA SEP/DLV/DEP GAP)
- `PUT /efs/sync/:realm/:airport/meta` body `{ "essaSep": { "sep", "dlv", "depGap" } }`  
  Fanout: WS/SSE event `meta`. Used by VatIRIS Stripview (ESOS APP/DEP).
- `WS /efs/sync/:realm/:airport/ws?cid=…` (live fanout)
- `GET /health`

Realms: `live` | `sweatbox` | `playback` | `local`

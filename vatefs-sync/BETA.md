# Closed-beta tester guide

## Host (dev PC)

1. Start sync service: `cd vatefs-sync && set ALLOWED_CIDS=1157125,1599365 && npm start`
2. Expose: `.\scripts\run-tunnel.ps1` (or `cloudflared tunnel --url http://127.0.0.1:17880`)
3. On the **VatEFS backend host**, set env so clients use the tunnel instead of production:
   `set VATEFS_SYNC_URL=https://….trycloudflare.com`
   (no Settings URL field — default is `https://backend.vatiris.se`)
4. Keep the PC awake during the test window (tunnel dies on sleep/offline)

## Testers

1. Install/run VatEFS as usual (local EFS on each PC — EuroScope plugin starts the backend).
2. On first load, enter **VATSIM CID** when prompted (or `.efs cid` in EuroScope).
3. Settings → **VatEFS sync**:
   - **Enable scribble sync** — freehand strokes
   - **Enable IRIS strip sync** — bay placement / notes / EFS-only flags
   - **Sync realm** — leave **Auto** unless you need to force sweatbox/live/local
4. Draw on a strip in zoom, then **close zoom** → peers get a **WebSocket push** (near-instant).  
   Safety net: ~15s poll, or immediately when you press the top-bar **reload** button.
5. Status menu → **IRIS Sync** shows Off / Connected / CID required / Sign in to VatIRIS.

## Online-only feeds

On realm **Sweatbox** or **Local** (forced or Auto from ES), Hoppie DCL, vIFF, VATSIM ATIS, and AFV transceiver polling are disabled (live VATSIM only).

## `.efs refresh` (peer flag reassert)

Late joiner types `.efs refresh` in EuroScope → local FP dump, plus sync WS `{type:"reassertAssumed"}` to peers. Each peer re-writes CLR/CFL/CTL/GS/HS/DepC/EFSGA/SID/HDG/DCT into ES for traffic **they** track so VATSIM rebroadcasts to the joiner. Requires sync enabled + CID + open WS room. Needs sync host with the WS inbound handler (standalone `vatefs-sync` or updated VatIRIS).

## Checks

- Two controllers, same airport + realm (live/sweatbox)
- Late joiner `.efs refresh` → peer logs `[reassertAssumed]` and joiner ES picks up peer CLR/CTL
- TWR cycles SEP/DLV/DEP GAP → peers update within ~1s (WS `meta`); late joiner GETs `/meta` on sync connect
- Paper note create-on-receive
- Flight strip must exist on both sides from ES before placement/scribbles sync
- Drag BCS… on TWR → same section on GND
- Realm isolation (live ≠ sweatbox)
- 401/403 → one-shot “Sign in to VatIRIS” prompt; allowlist hosts update `ALLOWED_CIDS`

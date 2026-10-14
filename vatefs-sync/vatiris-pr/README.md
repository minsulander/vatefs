# VatIRIS PR package — EFS scribble (+ placement) sync

Drop-in Express routes matching the closed-beta `vatefs-sync` service.
Intended for [minsulander/vatiris](https://github.com/minsulander/vatiris) backend.

## Scope (aligned with Martin)

- **EFS stays local** on each controller PC — not a hosted multiplayer EFS
- Sync carries **scribble strokes** and **bay placement** for strip keys that already exist locally
- **Flight strips are never invented** by sync — they appear from EuroScope on each PC; sync only aligns section/order once both have the strip
- Auth: CID + `useraccount` (no OAuth)

Optional `strip` metadata on PUT:

| kind | Meaning |
|------|---------|
| `note` / `vehicle` | Create-on-receive + placement (paper empties / vehicles — not ES) |
| `flight` | Placement only (`bayId` / `sectionId` / `position` / `bottom`) |

## Auth

- Header: `X-Vatsim-Cid: <number>`
- Accept only if a `useraccount` row exists for that CID
- Closed beta used an allowlist; production uses the VatIRIS user table

## Routes

Base: `/efs/sync`

**Contract:** order + scribbles + EFS-only strip fields + SEP. No ES-native status (IRIS plugin).  
Strip TV also consumes `PUT /efs/:airport/:view` from VatEFS (see main [README](../README.md)).

| Method | Path | Body / query |
|--------|------|----------------|
| GET | `/:realm/:airport` | `?since=<iso>` |
| PUT | `/:realm/:airport/:stripKey` | `{ strokes, strip? }` |
| DELETE | `/:realm/:airport/:stripKey` | |
| GET | `/:realm/:airport/meta` | airport meta |
| PUT | `/:realm/:airport/meta` | `{ essaSep: { sep, dlv, depGap } }` |

Realms: `live` \| `sweatbox` \| `playback` \| `local`  
Airport: ICAO. Strip keys: `CALLSIGN@ICAO`, `note:<uuid>`, `veh:<uuid>`.

**Airport meta (`…/meta`)** — ESSA SEP / DLV / DEP GAP (effective strings from VatEFS TWR).  
Stripview (ESOS APP/DEP) should `GET` or subscribe to WS/SSE event `type: "meta"`.  
Table: `efs_airport_meta` (see `migration.sql`).

Caps: JSON body ≤256kb, rate limits, ~1h TTL (see `migration.sql` + `routes.ts`).

## Integration steps

1. Apply `migration.sql` (Postgres) — includes `efs_airport_meta`
2. Mount `createScribbleRouter({ userExists, store, publishRoom? })` under `/efs`
3. Optional: set VatEFS default sync URL to `https://backend.vatiris.se` when ready

## Client behaviour (VatEFS)

- Push on zoom close (strokes + placement meta); push on drag (placement)
- TWR role: push ESSA SEP/DLV/DEP GAP to `PUT …/ESSA/meta` when values change
- SSE fanout + ~15s poll safety net
- Manual/synced placement is sticky until groundstate / ownership / airborne / CLR changes

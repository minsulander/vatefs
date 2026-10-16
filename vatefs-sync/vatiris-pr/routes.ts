/**
 * Express router for VatIRIS — mount at `/efs`.
 *
 *   import { createScribbleRouter } from './efs-sync'
 *   app.use('/efs', createScribbleRouter({
 *     userExists: async (cid) => !!(await db.useraccount.findUnique({ where: { cid } })),
 *     // pool: pg Pool with migration.sql applied
 *   }))
 *
 * Auth: X-Vatsim-Cid + CID must exist in useraccount (no OAuth).
 */

import { Router, type Request, type Response, type NextFunction } from "express"

export type StripMeta = {
  kind?: string
  paperInfoKind?: string
  airport?: string
  callsign?: string
  aircraftType?: string
  adep?: string
  ades?: string
  flightRules?: string
  bayId?: string
  sectionId?: string
  position?: number
  bottom?: boolean
  clearanceRead?: boolean
  qnhGiven?: number | null
  atisGiven?: string | null
  noteText?: string
  std?: string
}

/** ESSA SEP/DLV/DEP GAP (and future airport-scoped fields) for Stripview. */
export type EssaSepMeta = {
  sep: string
  dlv: string
  depGap: string
}

export type AirportMetaPayload = {
  essaSep?: EssaSepMeta
  /** ESSA bankonfig id (QuickRef / Strip TV), e.g. "9A". */
  essaConfig?: string
}

export type ScribbleDeps = {
  /** Return true if CID may use VatEFS Sync (VatIRIS: useraccount exists). */
  userExists: (cid: number) => boolean | Promise<boolean>
  /** Optional: inject Postgres helpers; if omitted, use in-memory (tests only). */
  store?: ScribbleStore
  /** Optional live fanout (VatIRIS WS/SSE). */
  publishRoom?: (
    realm: string,
    airport: string,
    update: {
      type: "meta"
      meta: AirportMetaPayload
      updatedAt: string
      updatedByCid: number | null
    },
    exceptCid?: number | null,
  ) => void
}

export type ScribbleStore = {
  listSince: (
    realm: string,
    airport: string,
    since?: string,
  ) => Promise<
    Array<{
      stripKey: string
      strokes: unknown[]
      stripMeta: StripMeta | null
      updatedAt: string
      updatedByCid: number | null
    }>
  >
  upsert: (
    realm: string,
    airport: string,
    stripKey: string,
    /** undefined = keep previous strokes */
    strokes: unknown[] | undefined,
    /** undefined = keep previous strip meta */
    stripMeta: StripMeta | null | undefined,
    cid: number,
  ) => Promise<{ stripKey: string; updatedAt: string; updatedByCid: number | null }>
  remove: (realm: string, airport: string, stripKey: string, cid: number) => Promise<void>
  getAirportMeta: (
    realm: string,
    airport: string,
  ) => Promise<{
    meta: AirportMetaPayload
    updatedAt: string
    updatedByCid: number | null
  } | null>
  upsertAirportMeta: (
    realm: string,
    airport: string,
    meta: AirportMetaPayload,
    cid: number,
  ) => Promise<{
    meta: AirportMetaPayload
    updatedAt: string
    updatedByCid: number | null
  }>
}

/** ES-native / ops fields — stay on esdata; reject if present on sync strip bodies. */
export const FORBIDDEN_SYNC_STRIP_KEYS = [
  "groundstate",
  "clearedForTakeoff",
  "cfto",
  "atd",
  "depRwy",
  "arrRwy",
  "sid",
  "stand",
  "cfl",
  "temporaryAltitude",
  "squawk",
] as const

export function findForbiddenSyncStripKeys(strip: unknown): string[] {
  if (!strip || typeof strip !== "object" || Array.isArray(strip)) return []
  return Object.keys(strip as object).filter((k) =>
    (FORBIDDEN_SYNC_STRIP_KEYS as readonly string[]).includes(k),
  )
}

export function validateAirportMeta(
  raw: unknown,
): { ok: true; meta: AirportMetaPayload } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "meta must be an object" }
  }
  const body = raw as { essaSep?: unknown; essaConfig?: unknown }
  const out: AirportMetaPayload = {}
  if (body.essaSep !== undefined) {
    if (!body.essaSep || typeof body.essaSep !== "object" || Array.isArray(body.essaSep)) {
      return { ok: false, error: "essaSep must be an object" }
    }
    const s = body.essaSep as Record<string, unknown>
    if (typeof s.sep !== "string" || typeof s.dlv !== "string" || typeof s.depGap !== "string") {
      return { ok: false, error: "essaSep requires sep, dlv, depGap strings" }
    }
    if (s.sep.length > 32 || s.dlv.length > 32 || s.depGap.length > 32) {
      return { ok: false, error: "essaSep field too long" }
    }
    out.essaSep = { sep: s.sep, dlv: s.dlv, depGap: s.depGap }
  }
  if (body.essaConfig !== undefined) {
    if (
      typeof body.essaConfig !== "string" ||
      !/^(?:[1-8]|9[ABC]|1[0-4]|15[ABC]|16)$/.test(body.essaConfig.trim())
    ) {
      return { ok: false, error: "essaConfig must be a known bankonfig id" }
    }
    out.essaConfig = body.essaConfig.trim()
  }
  if (!out.essaSep) {
    return { ok: false, error: "essaSep required" }
  }
  return { ok: true, meta: out }
}

const REALMS = new Set(["live", "sweatbox", "playback", "local"])
const MAX_STROKES = 40
const MAX_POINTS_CHARS = 8000

function getCidHeader(req: Request): number | null {
  const raw = req.header("x-vatsim-cid") || req.header("X-Vatsim-Cid")
  const cid = raw != null ? Number(String(raw).trim()) : NaN
  if (!Number.isInteger(cid) || cid <= 0) return null
  return cid
}

function validateStrokes(raw: unknown): { ok: true; strokes: unknown[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: "strokes must be an array" }
  if (raw.length > MAX_STROKES) return { ok: false, error: `max ${MAX_STROKES} strokes per strip` }
  for (const s of raw) {
    if (!s || typeof s !== "object") return { ok: false, error: "invalid stroke" }
    const points = (s as { points?: unknown }).points
    if (typeof points !== "string" || !points) return { ok: false, error: "stroke.points required" }
    if (points.length > MAX_POINTS_CHARS) {
      return { ok: false, error: `stroke.points max ${MAX_POINTS_CHARS} chars` }
    }
  }
  return { ok: true, strokes: raw }
}

/** Minimal in-memory store for local tests — replace with Postgres in VatIRIS. */
function memoryStore(): ScribbleStore {
  const rows = new Map<
    string,
    {
      stripKey: string
      strokes: unknown[]
      stripMeta: StripMeta | null
      updatedAt: string
      updatedByCid: number | null
    }
  >()
  const airportMeta = new Map<
    string,
    { meta: AirportMetaPayload; updatedAt: string; updatedByCid: number | null }
  >()
  const k = (realm: string, airport: string, stripKey: string) => `${realm}|${airport}|${stripKey}`
  const mk = (realm: string, airport: string) => `${realm}|${airport}`
  return {
    async listSince(realm, airport, since) {
      const out = []
      for (const [key, row] of rows) {
        if (!key.startsWith(`${realm}|${airport}|`)) continue
        if (since && row.updatedAt <= since) continue
        out.push(row)
      }
      return out.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
    },
    async upsert(realm, airport, stripKey, strokes, stripMeta, cid) {
      const key = k(realm, airport, stripKey)
      const prev = rows.get(key)
      const row = {
        stripKey,
        strokes: strokes !== undefined ? strokes : (prev?.strokes ?? []),
        stripMeta:
          stripMeta !== undefined ? (stripMeta ?? prev?.stripMeta ?? null) : (prev?.stripMeta ?? null),
        updatedAt: new Date().toISOString(),
        updatedByCid: cid,
      }
      rows.set(key, row)
      return row
    },
    async remove(realm, airport, stripKey, cid) {
      await this.upsert(realm, airport, stripKey, [], null, cid)
    },
    async getAirportMeta(realm, airport) {
      return airportMeta.get(mk(realm, airport)) ?? null
    },
    async upsertAirportMeta(realm, airport, meta, cid) {
      const row = {
        meta,
        updatedAt: new Date().toISOString(),
        updatedByCid: cid,
      }
      airportMeta.set(mk(realm, airport), row)
      return row
    },
  }
}

export function createScribbleRouter(deps: ScribbleDeps): Router {
  const store = deps.store ?? memoryStore()
  const router = Router()

  async function requireUser(req: Request, res: Response, next: NextFunction) {
    const cid = getCidHeader(req)
    if (cid == null) {
      res.status(401).json({ error: "Missing or invalid X-Vatsim-Cid" })
      return
    }
    try {
      const ok = await deps.userExists(cid)
      if (!ok) {
        res.status(403).json({ error: "CID not registered (useraccount)" })
        return
      }
    } catch (err) {
      res.status(500).json({ error: "Auth lookup failed" })
      return
    }
    ;(req as Request & { cid: number }).cid = cid
    next()
  }

  router.use(requireUser)

  router.get("/sync/:realm/:airport", async (req, res) => {
    const realm = String(req.params.realm || "").toLowerCase()
    const airport = String(req.params.airport || "").toUpperCase()
    if (!REALMS.has(realm) || !/^[A-Z0-9]{3,4}$/.test(airport)) {
      res.status(400).json({ error: "invalid realm or airport" })
      return
    }
    const since = typeof req.query.since === "string" ? req.query.since : undefined
    const list = await store.listSince(realm, airport, since)
    const strips: Record<string, unknown> = {}
    let updatedAt = since || ""
    for (const row of list) {
      strips[row.stripKey] = {
        strokes: row.strokes,
        ...(row.stripMeta ? { strip: row.stripMeta } : {}),
        updatedAt: row.updatedAt,
        updatedByCid: row.updatedByCid,
      }
      if (row.updatedAt > updatedAt) updatedAt = row.updatedAt
    }
    res.json({ updatedAt: updatedAt || new Date(0).toISOString(), strips })
  })

  /** Airport meta — register before :stripKey so "meta" is not treated as a strip key. */
  router.get("/sync/:realm/:airport/meta", async (req, res) => {
    const realm = String(req.params.realm || "").toLowerCase()
    const airport = String(req.params.airport || "").toUpperCase()
    if (!REALMS.has(realm) || !/^[A-Z0-9]{3,4}$/.test(airport)) {
      res.status(400).json({ error: "invalid realm or airport" })
      return
    }
    const row = await store.getAirportMeta(realm, airport)
    if (!row) {
      res.json({
        meta: {},
        updatedAt: new Date(0).toISOString(),
        updatedByCid: null,
      })
      return
    }
    res.json({
      meta: row.meta,
      updatedAt: row.updatedAt,
      updatedByCid: row.updatedByCid,
    })
  })

  router.put("/sync/:realm/:airport/meta", async (req, res) => {
    const realm = String(req.params.realm || "").toLowerCase()
    const airport = String(req.params.airport || "").toUpperCase()
    if (!REALMS.has(realm) || !/^[A-Z0-9]{3,4}$/.test(airport)) {
      res.status(400).json({ error: "invalid realm or airport" })
      return
    }
    const checked = validateAirportMeta(req.body)
    if (!checked.ok) {
      res.status(400).json({ error: checked.error })
      return
    }
    const cid = (req as Request & { cid: number }).cid
    const row = await store.upsertAirportMeta(realm, airport, checked.meta, cid)
    deps.publishRoom?.(
      realm,
      airport,
      {
        type: "meta",
        meta: row.meta,
        updatedAt: row.updatedAt,
        updatedByCid: row.updatedByCid,
      },
      cid,
    )
    res.json({
      ok: true,
      meta: row.meta,
      updatedAt: row.updatedAt,
      updatedByCid: row.updatedByCid,
    })
  })

  router.put("/sync/:realm/:airport/:stripKey", async (req, res) => {
    const realm = String(req.params.realm || "").toLowerCase()
    const airport = String(req.params.airport || "").toUpperCase()
    const stripKey = decodeURIComponent(String(req.params.stripKey || ""))
    if (!REALMS.has(realm) || !/^[A-Z0-9]{3,4}$/.test(airport) || !stripKey || stripKey.length > 128) {
      res.status(400).json({ error: "invalid room or stripKey" })
      return
    }
    const body = req.body && typeof req.body === "object" ? req.body : {}
    const hasStrokes = Object.prototype.hasOwnProperty.call(body, "strokes")
    const hasStrip = Object.prototype.hasOwnProperty.call(body, "strip")
    if (!hasStrokes && !hasStrip) {
      res.status(400).json({ error: "strokes and/or strip required" })
      return
    }
    let strokes: unknown[] | undefined
    if (hasStrokes) {
      const checked = validateStrokes((body as { strokes?: unknown }).strokes)
      if (!checked.ok) {
        res.status(400).json({ error: checked.error })
        return
      }
      strokes = checked.strokes
    }
    let stripMeta: StripMeta | null | undefined
    if (hasStrip) {
      const raw = (body as { strip?: unknown }).strip
      if (raw == null) {
        stripMeta = null
      } else if (typeof raw === "object") {
        const forbidden = findForbiddenSyncStripKeys(raw)
        if (forbidden.length) {
          res.status(400).json({
            error: `strip must not include ES fields: ${forbidden.join(", ")}`,
          })
          return
        }
        const s = raw as StripMeta
        stripMeta = {
          kind: typeof s.kind === "string" ? s.kind : undefined,
          paperInfoKind: typeof s.paperInfoKind === "string" ? s.paperInfoKind : undefined,
          airport: typeof s.airport === "string" ? s.airport.toUpperCase() : undefined,
          callsign: typeof s.callsign === "string" ? s.callsign : undefined,
          aircraftType: typeof s.aircraftType === "string" ? s.aircraftType : undefined,
          adep: typeof s.adep === "string" ? s.adep : undefined,
          ades: typeof s.ades === "string" ? s.ades : undefined,
          flightRules: typeof s.flightRules === "string" ? s.flightRules : undefined,
          bayId: typeof s.bayId === "string" ? s.bayId : undefined,
          sectionId: typeof s.sectionId === "string" ? s.sectionId : undefined,
          position: typeof s.position === "number" && Number.isFinite(s.position) ? s.position : undefined,
          bottom: typeof s.bottom === "boolean" ? s.bottom : undefined,
          clearanceRead: typeof s.clearanceRead === "boolean" ? s.clearanceRead : undefined,
          qnhGiven:
            s.qnhGiven === null
              ? null
              : typeof s.qnhGiven === "number" && Number.isFinite(s.qnhGiven)
                ? s.qnhGiven
                : undefined,
          atisGiven:
            s.atisGiven === null
              ? null
              : typeof s.atisGiven === "string"
                ? s.atisGiven
                : undefined,
          noteText: typeof s.noteText === "string" ? s.noteText : undefined,
          std: typeof s.std === "string" ? s.std : undefined,
        }
      } else {
        res.status(400).json({ error: "strip must be an object or null" })
        return
      }
    }
    const cid = (req as Request & { cid: number }).cid
    const row = await store.upsert(realm, airport, stripKey, strokes, stripMeta, cid)
    res.json({ ok: true, stripKey: row.stripKey, updatedAt: row.updatedAt, updatedByCid: row.updatedByCid })
  })

  router.delete("/sync/:realm/:airport/:stripKey", async (req, res) => {
    const realm = String(req.params.realm || "").toLowerCase()
    const airport = String(req.params.airport || "").toUpperCase()
    const stripKey = decodeURIComponent(String(req.params.stripKey || ""))
    const cid = (req as Request & { cid: number }).cid
    await store.remove(realm, airport, stripKey, cid)
    res.json({ ok: true })
  })

  return router
}

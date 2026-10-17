import fs from "fs"
import path from "path"

export interface StripMeta {
  kind?: string
  paperInfoKind?: string
  airport?: string
  callsign?: string
  /** Anonymous VFR/CROSS recreate */
  aircraftType?: string
  adep?: string
  ades?: string
  flightRules?: string
  bayId?: string
  sectionId?: string
  position?: number
  bottom?: boolean
  /** EFS-only (not EuroScope-native) — synced across controllers */
  clearanceRead?: boolean
  /** null clears */
  qnhGiven?: number | null
  atisGiven?: string | null
  noteText?: string
  /** Vehicle STD field */
  std?: string
  /** EFS cleared-for-takeoff. False clears the Stripview mark. */
  cfto?: boolean
  /** EFS ATD as UTC HHmm. Null clears a previous time. */
  atd?: string | null
}

export interface ScribbleRow {
  realm: string
  airport: string
  stripKey: string
  strokes: unknown[]
  stripMeta: StripMeta | null
  updatedAt: string
  updatedByCid: number | null
}

/** Airport-scoped meta (e.g. ESSA SEP/DLV/DEP GAP for Stripview). */
export interface EssaSepMeta {
  sep: string
  dlv: string
  depGap: string
}

export interface AirportMetaPayload {
  essaSep?: EssaSepMeta
  /** ESSA bankonfig id (QuickRef / Strip TV), e.g. "9A". */
  essaConfig?: string
  /** Locked contract SEP (also mirrored into essaSep for legacy readers). */
  sep?: string
  dlv?: string
  depGap?: string
}

export interface AirportMetaRow {
  realm: string
  airport: string
  meta: AirportMetaPayload
  updatedAt: string
  updatedByCid: number | null
}

export type OrderEntry = {
  stripKey: string
  bayId: string
  sectionId: string
  position: number
  /** EFS cleared-for-takeoff. */
  cfto?: boolean
  /** EFS ATD as UTC HHmm, or null to clear. */
  atd?: string | null
}

export type OrderPayload = {
  revision: number
  entries: OrderEntry[]
}

export type OrderRow = {
  realm: string
  airport: string
  order: OrderPayload
  updatedAt: string
  updatedByCid: number | null
  lastHeartbeatAt: string
}

/** Unused room entries expire after 1h (return flights within 1h keep ink). */
const TTL_MS = 60 * 60 * 1000
const MAX_STROKES = 40
const MAX_POINTS_CHARS = 8000
const MAX_BODY_HINT = 256 * 1024

type StoreFile = {
  rows: ScribbleRow[]
  airportMeta?: AirportMetaRow[]
  orders?: OrderRow[]
}

let dataPath = ""
let rows: ScribbleRow[] = []
let airportMetaRows: AirportMetaRow[] = []
let orderRows: OrderRow[] = []

function keyOf(r: Pick<ScribbleRow, "realm" | "airport" | "stripKey">) {
  return `${r.realm}\0${r.airport}\0${r.stripKey}`
}

function persist() {
  const payload: StoreFile = { rows, airportMeta: airportMetaRows, orders: orderRows }
  fs.writeFileSync(dataPath, JSON.stringify(payload), "utf-8")
}

export function initDb(dataDir: string) {
  fs.mkdirSync(dataDir, { recursive: true })
  dataPath = path.join(dataDir, "sync.json")
  const legacyPath = path.join(dataDir, "scribbles.json")
  if (!fs.existsSync(dataPath) && fs.existsSync(legacyPath)) {
    fs.renameSync(legacyPath, dataPath)
  }
  if (fs.existsSync(dataPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(dataPath, "utf-8")) as StoreFile
      rows = Array.isArray(parsed.rows) ? parsed.rows : []
      airportMetaRows = Array.isArray(parsed.airportMeta) ? parsed.airportMeta : []
      orderRows = Array.isArray(parsed.orders) ? parsed.orders : []
    } catch {
      rows = []
      airportMetaRows = []
      orderRows = []
    }
  } else {
    rows = []
    airportMetaRows = []
    orderRows = []
    persist()
  }
}

export function purgeExpired() {
  const cutoff = new Date(Date.now() - TTL_MS).toISOString()
  const before = rows.length
  const beforeMeta = airportMetaRows.length
  const beforeOrders = orderRows.length
  rows = rows.filter((r) => r.updatedAt >= cutoff)
  airportMetaRows = airportMetaRows.filter((r) => r.updatedAt >= cutoff)
  orderRows = orderRows.filter((r) => r.lastHeartbeatAt >= cutoff || r.updatedAt >= cutoff)
  if (
    rows.length !== before ||
    airportMetaRows.length !== beforeMeta ||
    orderRows.length !== beforeOrders
  ) {
    persist()
    const n =
      before - rows.length + (beforeMeta - airportMetaRows.length) + (beforeOrders - orderRows.length)
    console.log(`[vatefs-sync] purged ${n} expired row(s)`)
  }
}

export function validateSepBody(
  raw: unknown,
): { ok: true; sep: EssaSepMeta } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "sep body must be an object" }
  }
  const s = raw as Record<string, unknown>
  const toStr = (v: unknown) => (v == null ? "" : String(v))
  const sep = toStr(s.sep)
  const dlv = toStr(s.dlv)
  const depGap = toStr(s.depGap)
  if (sep.length > 32 || dlv.length > 32 || depGap.length > 32) {
    return { ok: false, error: "sep field too long" }
  }
  return { ok: true, sep: { sep, dlv, depGap } }
}

export function validateOrderBody(
  raw: unknown,
): { ok: true; order: OrderPayload } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "order body must be an object" }
  }
  const body = raw as { revision?: unknown; entries?: unknown }
  if (!Array.isArray(body.entries)) return { ok: false, error: "entries array required" }
  const entries: OrderEntry[] = []
  for (const e of body.entries) {
    if (!e || typeof e !== "object") return { ok: false, error: "invalid order entry" }
    const row = e as Record<string, unknown>
    if (typeof row.stripKey !== "string" || !row.stripKey) {
      return { ok: false, error: "entry.stripKey required" }
    }
    if (typeof row.bayId !== "string" || typeof row.sectionId !== "string") {
      return { ok: false, error: "entry.bayId/sectionId required" }
    }
    if (typeof row.position !== "number" || !Number.isFinite(row.position)) {
      return { ok: false, error: "entry.position required" }
    }
    const atd =
      row.atd === null
        ? null
        : typeof row.atd === "string" && /^\d{4}$/.test(row.atd.trim())
          ? row.atd.trim()
          : undefined
    entries.push({
      stripKey: String(row.stripKey).toUpperCase(),
      bayId: String(row.bayId),
      sectionId: String(row.sectionId),
      position: row.position,
      ...(typeof row.cfto === "boolean" ? { cfto: row.cfto } : {}),
      ...(atd !== undefined ? { atd } : {}),
    })
  }
  const revision =
    typeof body.revision === "number" && Number.isFinite(body.revision) ? body.revision : 0
  return { ok: true, order: { revision, entries } }
}

export function getOrder(realm: string, airport: string): OrderRow | null {
  return orderRows.find((r) => r.realm === realm && r.airport === airport) ?? null
}

export function upsertOrder(
  realm: string,
  airport: string,
  order: OrderPayload,
  cid: number,
): OrderRow {
  const now = new Date().toISOString()
  const idx = orderRows.findIndex((r) => r.realm === realm && r.airport === airport)
  const next: OrderRow = {
    realm,
    airport,
    order,
    updatedAt: now,
    updatedByCid: cid,
    lastHeartbeatAt: now,
  }
  if (idx >= 0) orderRows[idx] = next
  else orderRows.push(next)
  persist()
  return next
}

export function touchHeartbeat(realm: string, airport: string, cid: number): OrderRow {
  const now = new Date().toISOString()
  const idx = orderRows.findIndex((r) => r.realm === realm && r.airport === airport)
  if (idx >= 0) {
    orderRows[idx] = { ...orderRows[idx]!, lastHeartbeatAt: now, updatedByCid: cid }
    persist()
    return orderRows[idx]!
  }
  const next: OrderRow = {
    realm,
    airport,
    order: { revision: 0, entries: [] },
    updatedAt: now,
    updatedByCid: cid,
    lastHeartbeatAt: now,
  }
  orderRows.push(next)
  persist()
  return next
}

const ESSA_CONFIG_ID_RE = /^(?:[1-8]|9[ABC]|1[0-4]|15[ABC]|16)$/

/** ES-native / ops fields — stay on esdata; reject if present on sync strip bodies.
 *  `cfto` and `atd` are allowed: EFS owns those for Stripview (not IRIS ground speed). */
export const FORBIDDEN_SYNC_STRIP_KEYS = [
  "groundstate",
  "clearedForTakeoff",
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
    if (typeof body.essaConfig !== "string" || !ESSA_CONFIG_ID_RE.test(body.essaConfig.trim())) {
      return { ok: false, error: "essaConfig must be a known bankonfig id" }
    }
    out.essaConfig = body.essaConfig.trim()
  }
  if (!out.essaSep) {
    return { ok: false, error: "essaSep required" }
  }
  return { ok: true, meta: out }
}

export function getAirportMeta(realm: string, airport: string): AirportMetaRow | null {
  return airportMetaRows.find((r) => r.realm === realm && r.airport === airport) ?? null
}

export function upsertAirportMeta(
  realm: string,
  airport: string,
  meta: AirportMetaPayload,
  cid: number,
): AirportMetaRow {
  const updatedAt = new Date().toISOString()
  const idx = airportMetaRows.findIndex((r) => r.realm === realm && r.airport === airport)
  const next: AirportMetaRow = { realm, airport, meta, updatedAt, updatedByCid: cid }
  if (idx >= 0) airportMetaRows[idx] = next
  else airportMetaRows.push(next)
  persist()
  return next
}

export function validateStrokes(raw: unknown): { ok: true; strokes: unknown[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: "strokes must be an array" }
  if (raw.length > MAX_STROKES) return { ok: false, error: `max ${MAX_STROKES} strokes per strip` }
  let total = 2
  for (const s of raw) {
    if (!s || typeof s !== "object") return { ok: false, error: "invalid stroke" }
    const points = (s as { points?: unknown }).points
    if (typeof points !== "string" || !points) return { ok: false, error: "stroke.points required" }
    if (points.length > MAX_POINTS_CHARS) {
      return { ok: false, error: `stroke.points max ${MAX_POINTS_CHARS} chars` }
    }
    total += points.length + 32
  }
  if (total > MAX_BODY_HINT) return { ok: false, error: "payload too large" }
  return { ok: true, strokes: raw }
}

export function listSince(realm: string, airport: string, since?: string): ScribbleRow[] {
  return rows
    .filter((r) => r.realm === realm && r.airport === airport && (!since || r.updatedAt > since))
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
}

function mergeStripMeta(prev: StripMeta | null, incoming: StripMeta | null): StripMeta | null {
  if (!incoming) return prev
  if (!prev) return incoming
  const out: StripMeta = { ...prev, ...incoming }
  // undefined on incoming means "leave previous"; null clears QNH/ATIS
  if (!("qnhGiven" in incoming)) out.qnhGiven = prev.qnhGiven
  if (!("atisGiven" in incoming)) out.atisGiven = prev.atisGiven
  if (!("clearanceRead" in incoming)) out.clearanceRead = prev.clearanceRead
  if (!("noteText" in incoming)) out.noteText = prev.noteText
  if (!("std" in incoming)) out.std = prev.std
  return out
}

/**
 * Upsert scribble/strip row.
 * - `strokes` undefined → keep previous strokes (strip-meta-only PUT)
 * - `stripMeta` undefined → keep previous strip meta (strokes-only PUT)
 * - `stripMeta` null → clear meta after merge helper (rare)
 */
export function upsert(
  realm: string,
  airport: string,
  stripKey: string,
  strokes: unknown[] | undefined,
  stripMeta: StripMeta | null | undefined,
  cid: number,
): ScribbleRow {
  const updatedAt = new Date().toISOString()
  const k = `${realm}\0${airport}\0${stripKey}`
  const idx = rows.findIndex((r) => keyOf(r) === k)
  const prev = idx >= 0 ? rows[idx]! : null
  const next: ScribbleRow = {
    realm,
    airport,
    stripKey,
    strokes: strokes !== undefined ? strokes : (prev?.strokes ?? []),
    stripMeta:
      stripMeta !== undefined
        ? mergeStripMeta(prev?.stripMeta ?? null, stripMeta)
        : (prev?.stripMeta ?? null),
    updatedAt,
    updatedByCid: cid,
  }
  if (idx >= 0) rows[idx] = next
  else rows.push(next)
  persist()
  return next
}

export function remove(realm: string, airport: string, stripKey: string, cid: number): boolean {
  return !!upsert(realm, airport, stripKey, [], null, cid)
}

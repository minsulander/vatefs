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

/** Unused room entries expire after 1h (return flights within 1h keep ink). */
const TTL_MS = 60 * 60 * 1000
const MAX_STROKES = 40
const MAX_POINTS_CHARS = 8000
const MAX_BODY_HINT = 256 * 1024

type StoreFile = { rows: ScribbleRow[] }

let dataPath = ""
let rows: ScribbleRow[] = []

function keyOf(r: Pick<ScribbleRow, "realm" | "airport" | "stripKey">) {
  return `${r.realm}\0${r.airport}\0${r.stripKey}`
}

function persist() {
  const payload: StoreFile = { rows }
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
    } catch {
      rows = []
    }
  } else {
    rows = []
    persist()
  }
}

export function purgeExpired() {
  const cutoff = new Date(Date.now() - TTL_MS).toISOString()
  const before = rows.length
  rows = rows.filter((r) => r.updatedAt >= cutoff)
  if (rows.length !== before) {
    persist()
    console.log(`[vatefs-sync] purged ${before - rows.length} expired row(s)`)
  }
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

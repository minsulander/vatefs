/**
 * GRpluginSettings.txt + GRpluginMaps.txt helpers for ESSA stand menu.
 *
 * - System_AutoAssignDist: distance (nm) from destination for Planned/Inbound + auto-assign
 * - MAP BLOCKS + ACTIVE schedules: stands closed by active WIP maps (colour + auto exclude)
 *
 * ACTIVE schedule semantics follow the Ground Radar developer guide (UTC).
 */

import fs from "fs"
import path from "path"

const DEFAULT_AUTO_ASSIGN_DIST_NM = 30

let defaultAutoAssignDistNm = DEFAULT_AUTO_ASSIGN_DIST_NM
/** ICAO → nm override from System_AutoAssignDist=ESSA,30 style lines */
const autoAssignDistByIcao = new Map<string, number>()

export interface GrpMapClosedStand {
    /** Canonical stand name as listed in BLOCKS (resolved later against stand file) */
    stand: string
    /** MAP: name (without :G2 suffix used for drawing type) */
    mapName: string
    airport: string
}

interface ActiveSchedule {
    /** ACTIVE:1 */
    always?: boolean
    /** YYMMDD or MMDD */
    startDate?: string
    endDate?: string
    /** "0" = continuous window; else digits 1=Mon … 7=Sun */
    weekdays?: string
    startHhmm?: string
    endHhmm?: string
}

interface MapBlockDef {
    name: string
    airport: string
    stands: string[]
    /** OR of ACTIVE lines (AND_ACTIVE not used by current ESSA WIP maps) */
    actives: ActiveSchedule[]
}

let mapBlocks: MapBlockDef[] = []
let mapsLoaded = false

function findPluginFile(euroscopeDir: string, filename: string, packageFilter?: string): string | undefined {
    function matchesFilter(filePath: string): boolean {
        return !packageFilter || filePath.includes(packageFilter)
    }
    const direct = path.join(euroscopeDir, filename)
    if (fs.existsSync(direct) && matchesFilter(direct)) return direct

    function searchDir(dir: string, depth: number): string | undefined {
        if (depth > 4) return undefined
        try {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                if (!entry.isDirectory()) continue
                const sub = path.join(dir, entry.name, filename)
                if (fs.existsSync(sub) && matchesFilter(sub)) return sub
                const deeper = searchDir(path.join(dir, entry.name), depth + 1)
                if (deeper) return deeper
            }
        } catch {
            /* ignore */
        }
        return undefined
    }
    return searchDir(euroscopeDir, 0)
}

function parseDistValue(raw: string): number | undefined {
    const n = Number.parseFloat(raw.trim())
    if (!Number.isFinite(n) || n < 0 || n > 999) return undefined
    return n
}

/** Load System_AutoAssignDist from GRpluginSettings.txt (default 30 when missing). */
export function loadGrpAutoAssignDist(euroscopeDir: string, packageFilter = "ESAA"): number {
    defaultAutoAssignDistNm = DEFAULT_AUTO_ASSIGN_DIST_NM
    autoAssignDistByIcao.clear()

    const file = findPluginFile(euroscopeDir, "GRpluginSettings.txt", packageFilter)
    if (!file) {
        console.warn(
            `[GRP settings] GRpluginSettings.txt not found — AutoAssignDist default ${DEFAULT_AUTO_ASSIGN_DIST_NM} nm`,
        )
        return defaultAutoAssignDistNm
    }

    for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
        const line = raw.trim()
        if (!line || line.startsWith("//") || line.startsWith(";")) continue
        const eq = line.indexOf("=")
        if (eq < 0) continue
        const key = line.slice(0, eq).trim()
        const val = line.slice(eq + 1).trim()
        if (key !== "System_AutoAssignDist") continue

        // Airport-specific: ICAO,distance
        const comma = val.indexOf(",")
        if (comma > 0) {
            const icao = val.slice(0, comma).trim().toUpperCase()
            const dist = parseDistValue(val.slice(comma + 1))
            if (icao.length === 4 && dist !== undefined) {
                autoAssignDistByIcao.set(icao, dist)
            }
            continue
        }
        const dist = parseDistValue(val)
        if (dist !== undefined) defaultAutoAssignDistNm = dist
    }

    const extras = [...autoAssignDistByIcao.entries()]
        .map(([k, v]) => `${k}=${v}`)
        .join(", ")
    console.log(
        `[GRP settings] AutoAssignDist default ${defaultAutoAssignDistNm} nm` +
            (extras ? ` (${extras})` : "") +
            ` from ${file}`,
    )
    return defaultAutoAssignDistNm
}

export function getAutoAssignDistNm(icao = "ESSA"): number {
    const key = icao.toUpperCase()
    return autoAssignDistByIcao.get(key) ?? defaultAutoAssignDistNm
}

function parseActiveLine(parts: string[]): ActiveSchedule | undefined {
    // ACTIVE:1
    if (parts.length === 1 && parts[0] === "1") return { always: true }

    // Schedule: start:end:weekdays:HHMM:HHMM
    if (parts.length >= 5) {
        const startDate = parts[0]!
        const endDate = parts[1]!
        const weekdays = parts[2]!
        const startHhmm = parts[3]!
        const endHhmm = parts[4]!
        // Skip non-schedule ACTIVE:RWY / ID / CALLSIGN / LVP / MAP / STAND / GNDSTS
        if (!/^\d{4,6}$/.test(startDate) || !/^\d{4,6}$/.test(endDate)) return undefined
        if (!/^\d{3,4}$/.test(startHhmm) || !/^\d{3,4}$/.test(endHhmm)) return undefined
        return { startDate, endDate, weekdays, startHhmm, endHhmm }
    }
    return undefined
}

/** Parse GRpluginMaps.txt MAP…BLOCKS…ACTIVE blocks (ESSA WIP closed stands). */
export function loadGrpMapsBlocks(euroscopeDir: string, packageFilter = "ESAA"): number {
    mapBlocks = []
    mapsLoaded = false

    const file = findPluginFile(euroscopeDir, "GRpluginMaps.txt", packageFilter)
    if (!file) {
        console.warn("[GRP maps] GRpluginMaps.txt not found — no map-closed stands")
        return 0
    }

    const text = fs.readFileSync(file, "utf8")
    let current: {
        name: string
        airport?: string
        stands: string[]
        actives: ActiveSchedule[]
    } | null = null

    const flush = () => {
        if (!current) return
        if (current.airport && current.stands.length && current.actives.length) {
            mapBlocks.push({
                name: current.name,
                airport: current.airport,
                stands: [...current.stands],
                actives: [...current.actives],
            })
        }
        current = null
    }

    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim()
        if (!line || line.startsWith("//")) continue

        if (line.startsWith("MAP:")) {
            flush()
            // MAP:STD 52:G2 → name "STD 52"
            const rest = line.slice(4)
            const name = rest.includes(":") ? rest.slice(0, rest.lastIndexOf(":")) : rest
            current = { name: name.trim() || rest, stands: [], actives: [] }
            continue
        }

        if (!current) continue

        if (line.startsWith("AIRPORT:")) {
            current.airport = line.slice(8).trim().toUpperCase()
            continue
        }

        if (line.startsWith("BLOCKS:")) {
            // BLOCKS:ESSA:52,G141  — not stand-file neighbour BLOCKS:
            const body = line.slice(7)
            const colon = body.indexOf(":")
            if (colon < 0) continue
            const icao = body.slice(0, colon).trim().toUpperCase()
            if (icao.length !== 4) continue
            if (!current.airport) current.airport = icao
            if (current.airport !== icao) continue
            const list = body.slice(colon + 1).trim()
            for (const s of list.split(",")) {
                const t = s.trim()
                if (t) current.stands.push(t)
            }
            continue
        }

        if (line.startsWith("ACTIVE:")) {
            const parts = line.slice(7).split(":")
            const sched = parseActiveLine(parts)
            if (sched) current.actives.push(sched)
            continue
        }
    }
    flush()

    mapsLoaded = mapBlocks.length > 0
    const standCount = new Set(mapBlocks.flatMap((m) => m.stands.map((s) => `${m.airport}:${s}`))).size
    console.log(
        `[GRP maps] ${mapBlocks.length} maps with BLOCKS (${standCount} stand refs) from ${file}`,
    )
    return mapBlocks.length
}

function padHhmm(raw: string): number {
    const d = raw.replace(/\D/g, "").padStart(4, "0").slice(0, 4)
    const hh = Number.parseInt(d.slice(0, 2), 10)
    const mm = Number.parseInt(d.slice(2), 10)
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) return 0
    return hh * 60 + mm
}

/** Expand YYMMDD or MMDD to UTC Y/M/D for `now`. */
function resolveYmd(token: string, now: Date): { y: number; m: number; d: number } | undefined {
    if (/^\d{6}$/.test(token)) {
        const yy = Number.parseInt(token.slice(0, 2), 10)
        const m = Number.parseInt(token.slice(2, 4), 10)
        const d = Number.parseInt(token.slice(4, 6), 10)
        if (m < 1 || m > 12 || d < 1 || d > 31) return undefined
        return { y: 2000 + yy, m, d }
    }
    if (/^\d{4}$/.test(token)) {
        const m = Number.parseInt(token.slice(0, 2), 10)
        const d = Number.parseInt(token.slice(2, 4), 10)
        if (m < 1 || m > 12 || d < 1 || d > 31) return undefined
        return { y: now.getUTCFullYear(), m, d }
    }
    return undefined
}

function utcYmdNum(y: number, m: number, d: number): number {
    return y * 10000 + m * 100 + d
}

function dateFromYmd(y: number, m: number, d: number): Date {
    return new Date(Date.UTC(y, m - 1, d, 0, 0, 0))
}

/** GRP weekday: 1=Mon … 7=Sun. JS getUTCDay: 0=Sun … 6=Sat. */
function grpWeekdayUtc(d: Date): number {
    const js = d.getUTCDay()
    return js === 0 ? 7 : js
}

function scheduleActive(sched: ActiveSchedule, now: Date): boolean {
    if (sched.always) return true
    if (!sched.startDate || !sched.endDate || !sched.weekdays || !sched.startHhmm || !sched.endHhmm) {
        return false
    }

    const start = resolveYmd(sched.startDate, now)
    const end = resolveYmd(sched.endDate, now)
    if (!start || !end) return false

    const startNum = utcYmdNum(start.y, start.m, start.d)
    const endNum = utcYmdNum(end.y, end.m, end.d)
    const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes()
    const t0 = padHhmm(sched.startHhmm)
    const t1 = padHhmm(sched.endHhmm)

    // Continuous from StartTime on start date → EndTime on end date
    if (sched.weekdays === "0") {
        const startMs = Date.UTC(start.y, start.m - 1, start.d, Math.floor(t0 / 60), t0 % 60)
        let endMs = Date.UTC(end.y, end.m - 1, end.d, Math.floor(t1 / 60), t1 % 60)
        // If end clock is before start clock on a single-day window, still honour end date clock
        if (endMs < startMs) endMs += 24 * 60 * 60 * 1000
        const nowMs = now.getTime()
        return nowMs >= startMs && nowMs <= endMs
    }

    // Weekday list within date range; each day StartTime–EndTime (may span midnight)
    const todayNum = utcYmdNum(now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate())
    if (todayNum < startNum || todayNum > endNum) {
        // Overnight spill from previous day still inside range
        if (t0 > t1) {
            const yest = new Date(now.getTime() - 24 * 60 * 60 * 1000)
            const yNum = utcYmdNum(yest.getUTCFullYear(), yest.getUTCMonth() + 1, yest.getUTCDate())
            if (yNum < startNum || yNum > endNum) return false
            const wd = String(grpWeekdayUtc(yest))
            if (!sched.weekdays.includes(wd)) return false
            return nowMin <= t1
        }
        return false
    }

    const wd = String(grpWeekdayUtc(now))
    if (!sched.weekdays.includes(wd)) {
        if (t0 > t1) {
            const yest = new Date(now.getTime() - 24 * 60 * 60 * 1000)
            const yNum = utcYmdNum(yest.getUTCFullYear(), yest.getUTCMonth() + 1, yest.getUTCDate())
            if (yNum < startNum || yNum > endNum) return false
            if (!sched.weekdays.includes(String(grpWeekdayUtc(yest)))) return false
            return nowMin <= t1
        }
        return false
    }

    if (t0 <= t1) return nowMin >= t0 && nowMin <= t1
    // Spans midnight: active from t0 today, or until t1 from yesterday's activation
    if (nowMin >= t0) return true
    const yest = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    const yNum = utcYmdNum(yest.getUTCFullYear(), yest.getUTCMonth() + 1, yest.getUTCDate())
    if (yNum < startNum || yNum > endNum) return false
    if (!sched.weekdays.includes(String(grpWeekdayUtc(yest)))) return false
    return nowMin <= t1
}

function mapIsActive(def: MapBlockDef, now: Date): boolean {
    if (!def.actives.length) return false
    return def.actives.some((a) => scheduleActive(a, now))
}

/**
 * Stands currently closed by an active GRpluginMaps BLOCKS entry for `airport`.
 * First matching map name wins per stand.
 */
export function getActiveMapClosedStands(
    airport = "ESSA",
    now: Date = new Date(),
): Map<string, string> {
    const out = new Map<string, string>()
    if (!mapsLoaded) return out
    const icao = airport.toUpperCase()
    for (const def of mapBlocks) {
        if (def.airport !== icao) continue
        if (!mapIsActive(def, now)) continue
        for (const raw of def.stands) {
            const key = raw.trim()
            if (!key || out.has(key)) continue
            out.set(key, def.name)
        }
    }
    return out
}

/** Test helper — reset module state. */
export function _resetGrpMapsForTests(): void {
    defaultAutoAssignDistNm = DEFAULT_AUTO_ASSIGN_DIST_NM
    autoAssignDistByIcao.clear()
    mapBlocks = []
    mapsLoaded = false
}

/** Test helper — inject map defs. */
export function _setMapBlocksForTests(defs: MapBlockDef[]): void {
    mapBlocks = defs
    mapsLoaded = defs.length > 0
}

// silence unused in production builds that tree-shake tests only
void dateFromYmd

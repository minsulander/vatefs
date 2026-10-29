/**
 * ESSA stand menu: parse GRpluginStands.txt (ESSA only) and classify stands
 * for one arrival (physical fit, preferred airline/Schengen highlight, occupancy).
 */

import fs from "fs"
import path from "path"

// ─── Types ───────────────────────────────────────────────────────────────────

export type StandFitStatus = "preferred" | "allowed" | "notAllowed"

export interface StandOccupancy {
    /** Callsign of the aircraft on / planned for / blocking this stand */
    label: string
    /** occupied = radar on stand; assigned = planned; blocked = GRP BLOCKS/LIMITS neighbour */
    kind: "occupied" | "assigned" | "blocked"
    /**
     * For kind=blocked only: whether the related stand is physically occupied
     * (red style) or only planned/assigned (amber planned style).
     */
    blockFrom?: "occupied" | "assigned"
    /** For kind=blocked: the stand that is occupied/planned and triggers BLOCKS/LIMITS. */
    relatedStand?: string
    /**
     * For kind=assigned (and blocked from assigned): true when the planned aircraft
     * is still airborne — frontend uses a softer planned shade.
     */
    airborne?: boolean
    /**
     * For kind=occupied: true when the aircraft on stand is an ESSA departure
     * (frontend: departing icon vs parking for arrivals).
     */
    departure?: boolean
    /** Departure TSAT (HHmm) — UI label TS */
    tsat?: string
    /** Departure TOBT (HHmm) — UI label TB */
    tobt?: string
    /** Departure EOBT (HHmm) — UI label EB */
    eobt?: string
}

export interface StandMenuEntry {
    name: string
    /** Physical fit (size/type/use/engine). Schengen/STANDLIST never set notAllowed. */
    fit: StandFitStatus
    /** Why fit is notAllowed (size/type/use/engine); omitted otherwise. */
    reason?: string
    occupied?: StandOccupancy
    /**
     * APNH/APNJ/APNL/APNP: number of aircraft assigned/on the apron (info only;
     * no occupied/planned styling — several may share the area).
     */
    assignedCount?: number
    area: boolean
    selectable: boolean
}

export interface StandMenuApron {
    title: string
    stands: StandMenuEntry[]
}

export interface StandMenuResult {
    stripId: string
    currentStand?: string
    aprons: StandMenuApron[]
}

export interface AircraftDims {
    type: string
    wtc?: string
    wingspan: number
    length: number
    /** Use category letters from ICAO_Aircraft / OperatorInfo (e.g. "A", "AC") */
    use: string
    /** Engine letter from Description[2]: E/J/P/R/T */
    engine?: string
}

export interface OccupierInfo {
    callsign: string
    stand?: string
    latitude?: number
    longitude?: number
    heading?: number
    /** EuroScope groundstate (PARK/TXIN/…) — PARK+stand counts as occupied when GPS misses polygon */
    groundstate?: string
    /** True when the aircraft is airborne (softer Planned shade) */
    airborne?: boolean
    /** Origin is ESSA — show TS/TB/EB on occupied/planned stand */
    departure?: boolean
    tsat?: string
    tobt?: string
    eobt?: string
    dims: AircraftDims
    /** True when flight.stand is an ESSA assignment (arrival or departure) */
    assigned: boolean
}

interface StandVariant {
    name: string
    apron: string
    coords: { lat: number; lon: number }[]
    /** Circle form from STAND:…:lat:lon:radius */
    circle?: { lat: number; lon: number; radiusM: number }
    heading?: { hdg: number; tolerance: number }
    area: boolean
    manual: boolean
    use?: string
    atyp?: string[]
    notAtyp?: string[]
    codeMin?: string
    codeMax?: string
    wingspanMin?: number
    wingspanMax?: number
    lengthMin?: number
    lengthMax?: number
    engineType?: string
    notEngineType?: string
    schengen?: "schengen" | "non-schengen"
    adep?: string[]
    notAdep?: string[]
    priority: number
    blocks: { stands: string[]; wingspanOrCode?: string; length?: number }[]
    limits: {
        stands: string[]
        triggerWoc: string
        limitedWoc: string
        triggerLength?: number
        limitedLength?: number
    }[]
}

interface StandListEntry {
    callsignPrefixes: string[]
    points: number
    stands: string[]
}

interface IcaoAircraftEntry {
    ICAO: string
    Description?: string
    WTC?: string
    Wingspan?: number
    Length?: number
    Height?: number
    MTOW?: number
    Use?: string
}

// ─── Module state ────────────────────────────────────────────────────────────

/** Stand name → variants (COPY creates multiple) */
let essaVariants: Map<string, StandVariant[]> = new Map()
/** Apron order + stand names in file order */
let apronOrder: { title: string; standNames: string[] }[] = []
let standLists: StandListEntry[] = []
let groups: Map<string, string[]> = new Map()
let aircraftByIcao: Map<string, IcaoAircraftEntry> = new Map()
/** Callsign prefix (3 letters) → use override from OperatorInfo */
let operatorUse: Map<string, string> = new Map()
let loaded = false

/** ICAO aerodrome ref code letter → max wingspan (CODE:C ≡ WINGSPAN:35.999) */
const CODE_MAX_WINGSPAN: Record<string, number> = {
    A: 14.999,
    B: 23.999,
    C: 35.999,
    D: 51.999,
    E: 64.999,
    F: 79.999,
}

/** Fallback wingspan when ICAO_Aircraft has none (by WTC) */
const WTC_DEFAULT_WINGSPAN: Record<string, number> = {
    L: 15,
    M: 36,
    H: 65,
    J: 80,
}

/**
 * Schengen by ICAO prefix (first 2 letters). ES* always Schengen.
 * Ireland (EI) and UK (EG) are outside Schengen.
 */
const SCHENGEN_PREFIXES = new Set([
    "BI", // Iceland
    "EB", "ED", "EE", "EF", "EH", "EK", "EL", "EN", "EP", "ES", "EV", "EY",
    "LB", "LC", "LD", "LF", "LG", "LH", "LI", "LJ", "LK", "LM", "LO", "LP", "LQ", "LR", "LS", "LT", "LU", "LW", "LZ",
])

// ─── DMS / geometry ──────────────────────────────────────────────────────────

function parseDmsPart(part: string): number | undefined {
    if (part.length < 2) return undefined
    const dir = part[0]!
    const segments = part.substring(1).split(".")
    if (segments.length < 3) return undefined
    const degrees = parseInt(segments[0]!, 10)
    const minutes = parseInt(segments[1]!, 10)
    const seconds =
        segments.length >= 4
            ? parseInt(segments[2]!, 10) + parseInt(segments[3]!, 10) / Math.pow(10, segments[3]!.length)
            : parseInt(segments[2]!, 10)
    if (isNaN(degrees) || isNaN(minutes) || isNaN(seconds)) return undefined
    let decimal = degrees + minutes / 60 + seconds / 3600
    if (dir === "S" || dir === "W") decimal = -decimal
    return decimal
}

function parseDmsCoord(coordStr: string): { lat: number; lon: number } | undefined {
    const parts = coordStr.split(":")
    if (parts.length !== 2) return undefined
    const lat = parseDmsPart(parts[0]!)
    const lon = parseDmsPart(parts[1]!)
    if (lat === undefined || lon === undefined) return undefined
    return { lat, lon }
}

function pointInPolygon(lat: number, lon: number, polygon: { lat: number; lon: number }[]): boolean {
    let inside = false
    const n = polygon.length
    for (let i = 0, j = n - 1; i < n; j = i++) {
        const yi = polygon[i]!.lat
        const xi = polygon[i]!.lon
        const yj = polygon[j]!.lat
        const xj = polygon[j]!.lon
        if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
            inside = !inside
        }
    }
    return inside
}

function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371000
    const dLat = ((lat2 - lat1) * Math.PI) / 180
    const dLon = ((lon2 - lon1) * Math.PI) / 180
    const avgLat = (((lat1 + lat2) / 2) * Math.PI) / 180
    const dx = dLon * Math.cos(avgLat) * R
    const dy = dLat * R
    return Math.sqrt(dx * dx + dy * dy)
}

function headingDiff(a: number, b: number): number {
    let d = Math.abs(a - b) % 360
    if (d > 180) d = 360 - d
    return d
}

// ─── Stand menu geographic layout (TWR looking west: south→north L→R) ────────

/** ESSA TWR — menu geography reference. */
export const ESSA_TWR = { lat: 59.64932297049761, lon: 17.933728764815783 }

/** Swedavia T3 SYD / NORD faces (Plan för uppställningsplatser). */
export const T3_SYD_STANDS = new Set(["60A", "53", "55", "57"])
export const T3_NORD_STANDS = new Set(["52", "54", "56", "58"])

/**
 * Apron titles L→R (south→north from TWR). M with G/H; last stack J→K→L→P.
 * D/E → E then D; T2/T3/T4/T5* single piers (T3: 60A/odds then evens↑).
 * T2: single descending 68→62 block.
 */
export const GEO_APRON_ORDER = [
    "R",
    "S",
    "E",
    "D",
    "T2",
    "T3",
    "T4",
    "T5B",
    "T5A",
    "T5F",
    "F",
    "G",
    "H",
    "M",
    "J",
    "K",
    "L",
    "P",
] as const

/** GRP title → menu pier id; stands ordered odds ascending then evens ascending. */
const PIER_ODDS_THEN_EVENS: Record<string, string> = {
    T4: "T4",
    "T5 PIER B": "T5B",
    "T5 PIER A": "T5A",
    "T5 PIER F": "T5F",
}

/** T3 SYD list order (60A first, then odds ascending). */
const T3S_STAND_ORDER = ["60A", "53", "55", "57"] as const

function variantCentroid(v: StandVariant): { lat: number; lon: number } | undefined {
    if (v.coords.length > 0) {
        let lat = 0
        let lon = 0
        for (const c of v.coords) {
            lat += c.lat
            lon += c.lon
        }
        const n = v.coords.length
        return { lat: lat / n, lon: lon / n }
    }
    if (v.circle) return { lat: v.circle.lat, lon: v.circle.lon }
    return undefined
}

/** Mean lat of a stand’s variants (kept for tests / diagnostics). */
export function standCentroidLat(name: string): number | undefined {
    const variants = essaVariants.get(name)
    if (!variants?.length) return undefined
    let latSum = 0
    let n = 0
    for (const v of variants) {
        const c = variantCentroid(v)
        if (!c) continue
        latSum += c.lat
        n++
    }
    return n > 0 ? latSum / n : undefined
}

/** Natural key: F28L → ["F", 28, "L"], R10B → ["R", 10, "B"], 60A → [60, "A"]. */
function standChronoKey(name: string): (string | number)[] {
    const parts = name.toUpperCase().match(/\d+|[^\d]+/g) ?? [name.toUpperCase()]
    return parts.map((p) => (/^\d+$/.test(p) ? Number.parseInt(p, 10) : p))
}

function compareChronoKeys(a: (string | number)[], b: (string | number)[]): number {
    const n = Math.max(a.length, b.length)
    for (let i = 0; i < n; i++) {
        const x = a[i]
        const y = b[i]
        if (x === undefined) return -1
        if (y === undefined) return 1
        if (typeof x === "number" && typeof y === "number") {
            if (x !== y) return x - y
            continue
        }
        const sx = String(x)
        const sy = String(y)
        if (sx !== sy) return sx < sy ? -1 : 1
    }
    return 0
}

/** Ascending numerical order (S / odd faces: 101→119, 31→43, …). */
function sortStandsAscending<T extends { name: string }>(stands: T[]): T[] {
    return [...stands].sort((a, b) =>
        compareChronoKeys(standChronoKey(a.name), standChronoKey(b.name)),
    )
}

/** Descending numerical order (T2 pier: 68→62, …). */
function sortStandsDescending<T extends { name: string }>(stands: T[]): T[] {
    return [...stands].sort((a, b) =>
        compareChronoKeys(standChronoKey(b.name), standChronoKey(a.name)),
    )
}

/** T3S face: 60A, 53, 55, 57 then any extras ascending. */
function sortT3SouthStands<T extends { name: string }>(stands: T[]): T[] {
    const rank = new Map<string, number>(T3S_STAND_ORDER.map((n, i) => [n.toUpperCase(), i]))
    return [...stands].sort((a, b) => {
        const ra = rank.get(a.name.toUpperCase())
        const rb = rank.get(b.name.toUpperCase())
        if (ra !== undefined && rb !== undefined) return ra - rb
        if (ra !== undefined) return -1
        if (rb !== undefined) return 1
        return compareChronoKeys(standChronoKey(a.name), standChronoKey(b.name))
    })
}

/** T3 single list: south face (60A…) then north face descending. */
function sortT3Stands<T extends { name: string }>(stands: T[]): T[] {
    const south: T[] = []
    const north: T[] = []
    const other: T[] = []
    for (const s of stands) {
        const side = isSouthSideStand(s.name)
        if (side === true) south.push(s)
        else if (side === false) north.push(s)
        else other.push(s)
    }
    return [
        ...sortT3SouthStands(south),
        ...sortStandsAscending(north),
        ...sortStandsAscending(other),
    ]
}

function normalizeMenuApronTitle(title: string): string {
    const t = title.trim().toUpperCase()
    if (t === "D/E") return "APRON D/E"
    if (t === "APRON F") return "F"
    if (t === "APRON S") return "S"
    if (t === "APRON R") return "R"
    if (t === "APRON M") return "M"
    if (/^APRON\s+[GHJKLP]$/.test(t)) return t.replace(/^APRON\s+/, "")
    return t
}

function standPrimaryNumber(name: string): number | undefined {
    const m = name.match(/\d+/)
    return m ? Number.parseInt(m[0]!, 10) : undefined
}

/** Odd (or T3 60A) → south; even → north. */
function isSouthSideStand(name: string): boolean | undefined {
    const upper = name.toUpperCase()
    if (upper === "60A") return true // T3 SYD (Swedavia)
    if (T3_SYD_STANDS.has(upper) || T3_SYD_STANDS.has(name)) return true
    if (T3_NORD_STANDS.has(upper) || T3_NORD_STANDS.has(name)) return false
    const num = standPrimaryNumber(name)
    if (num === undefined) return undefined
    return num % 2 === 1
}

/** Odds ascending, then evens ascending (101→119, then 108→112; 31→43, then 32→44). */
function sortStandsOddsAscThenEvensAsc<T extends { name: string }>(stands: T[]): T[] {
    const south: T[] = []
    const north: T[] = []
    const other: T[] = []
    for (const s of stands) {
        const side = isSouthSideStand(s.name)
        if (side === true) south.push(s)
        else if (side === false) north.push(s)
        else other.push(s)
    }
    return [
        ...sortStandsAscending(south),
        ...sortStandsAscending(north),
        ...sortStandsAscending(other),
    ]
}

function putSplit(
    byTitle: Map<string, StandMenuApron>,
    southKey: string,
    northKey: string,
    stands: StandMenuEntry[],
    sortSouth: (s: StandMenuEntry[]) => StandMenuEntry[] = sortStandsAscending,
    sortNorth: (s: StandMenuEntry[]) => StandMenuEntry[] = sortStandsAscending,
) {
    const south: StandMenuEntry[] = []
    const north: StandMenuEntry[] = []
    const other: StandMenuEntry[] = []
    for (const s of stands) {
        const side = isSouthSideStand(s.name)
        if (side === true) south.push(s)
        else if (side === false) north.push(s)
        else other.push(s)
    }
    if (south.length) {
        byTitle.set(southKey, { title: southKey, stands: sortSouth(south) })
    }
    if (north.length) {
        byTitle.set(northKey, { title: northKey, stands: sortNorth(north) })
    }
    if (other.length) {
        const sorted = sortSouth(other)
        const dest = byTitle.get(southKey) ?? byTitle.get(northKey)
        if (dest) dest.stands.push(...sorted)
        else byTitle.set(southKey, { title: southKey, stands: sorted })
    }
}

/**
 * D/E → E/D; T3 single pier (60A/odds↑ then evens↑); T4 & T5* odds↑+evens↑;
 * T2 descending; geo group order.
 */
export function applyEssaStandMenuGeoLayout(aprons: StandMenuApron[]): StandMenuApron[] {
    const byTitle = new Map<string, StandMenuApron>()

    for (const apron of aprons) {
        const norm = normalizeMenuApronTitle(apron.title)
        if (norm === "APRON D/E") {
            putSplit(byTitle, "E", "D", apron.stands)
            continue
        }
        if (norm === "T2") {
            byTitle.set("T2", {
                title: "T2",
                stands: sortStandsDescending(apron.stands),
            })
            continue
        }
        if (norm === "T3") {
            byTitle.set("T3", {
                title: "T3",
                stands: sortT3Stands(apron.stands),
            })
            continue
        }
        const pierId = PIER_ODDS_THEN_EVENS[norm]
        if (pierId) {
            byTitle.set(pierId, {
                title: pierId,
                stands: sortStandsOddsAscThenEvensAsc(apron.stands),
            })
            continue
        }
        byTitle.set(norm, {
            title: norm,
            stands: sortStandsAscending(apron.stands),
        })
    }

    const ordered: StandMenuApron[] = []
    const seen = new Set<string>()
    for (const key of GEO_APRON_ORDER) {
        const a = byTitle.get(key)
        if (a?.stands.length) {
            ordered.push(a)
            seen.add(key)
        }
    }
    for (const [key, a] of byTitle) {
        if (!seen.has(key) && a.stands.length) ordered.push(a)
    }
    return ordered
}

// ─── Apron title normalize ───────────────────────────────────────────────────

export function normalizeApronTitle(raw: string): string {
    const t = raw.trim().toUpperCase()
    const m = t.match(/^TERMINAL\s+(\d+)\s+PIER\s+([A-Z])$/)
    if (m) return `T${m[1]} PIER ${m[2]}`
    const m2 = t.match(/^TERMINAL\s+(\d+)$/)
    if (m2) return `T${m2[1]}`
    const m3 = t.match(/^APRON\s+(.+)$/)
    if (m3) {
        const rest = m3[1]!
        // Short single-letter aprons: G, H, J, … — keep letter only per plan
        if (/^[A-Z]$/.test(rest)) return rest
        return `APRON ${rest}`
    }
    return t
}

function isApronComment(line: string): string | undefined {
    if (!line.startsWith("//")) return undefined
    const body = line.substring(2).trim()
    if (/^TERMINAL\b/i.test(body) || /^APRON\b/i.test(body)) {
        return normalizeApronTitle(body)
    }
    return undefined
}

// ─── Parse helpers ───────────────────────────────────────────────────────────

function expandGroupToken(token: string): string[] {
    if (token.startsWith("GROUP_")) {
        const name = token.substring(6)
        return groups.get(name) ?? [token]
    }
    return [token]
}

function expandList(items: string[]): string[] {
    const out: string[] = []
    for (const item of items) {
        const t = item.trim()
        if (!t) continue
        out.push(...expandGroupToken(t))
    }
    return out
}

function parseWoc(value: string): number | undefined {
    const u = value.trim().toUpperCase()
    if (CODE_MAX_WINGSPAN[u] !== undefined) return CODE_MAX_WINGSPAN[u]
    const n = parseFloat(u)
    return isNaN(n) ? undefined : n
}

function cloneVariant(v: StandVariant): StandVariant {
    return {
        ...v,
        coords: v.coords.map((c) => ({ ...c })),
        circle: v.circle ? { ...v.circle } : undefined,
        heading: v.heading ? { ...v.heading } : undefined,
        atyp: v.atyp ? [...v.atyp] : undefined,
        notAtyp: v.notAtyp ? [...v.notAtyp] : undefined,
        adep: undefined,
        notAdep: undefined,
        schengen: undefined,
        blocks: v.blocks.map((b) => ({ ...b, stands: [...b.stands] })),
        limits: v.limits.map((l) => ({ ...l, stands: [...l.stands] })),
    }
}

function emptyVariant(name: string, apron: string): StandVariant {
    return {
        name,
        apron,
        coords: [],
        area: false,
        manual: false,
        priority: 0,
        blocks: [],
        limits: [],
    }
}

function applyStandLine(v: StandVariant, line: string): void {
    const idx = line.indexOf(":")
    const key = (idx >= 0 ? line.substring(0, idx) : line).toUpperCase()
    const rest = idx >= 0 ? line.substring(idx + 1) : ""
    const parts = rest.split(":")

    switch (key) {
        case "COORD": {
            const c = parseDmsCoord(rest.trim())
            if (c) v.coords.push(c)
            break
        }
        case "HEADING": {
            const hdg = parseFloat(parts[0] ?? "")
            const tol = parts[1] !== undefined ? parseFloat(parts[1]) : 20
            if (!isNaN(hdg)) v.heading = { hdg, tolerance: isNaN(tol) ? 20 : tol }
            break
        }
        case "MANUAL":
            v.manual = true
            break
        case "AREA":
            v.area = true
            break
        case "USE":
            v.use = rest.trim().toUpperCase()
            break
        case "ATYP":
            v.atyp = rest.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)
            break
        case "NOTATYP":
            v.notAtyp = rest.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)
            break
        case "CODE": {
            if (parts.length >= 2) {
                v.codeMin = parts[0]!.trim().toUpperCase()
                v.codeMax = parts[1]!.trim().toUpperCase()
            } else {
                v.codeMin = undefined
                v.codeMax = parts[0]!.trim().toUpperCase()
            }
            break
        }
        case "WINGSPAN": {
            if (parts.length >= 2) {
                v.wingspanMin = parseFloat(parts[0]!)
                v.wingspanMax = parseFloat(parts[1]!)
            } else {
                v.wingspanMin = undefined
                v.wingspanMax = parseFloat(parts[0]!)
            }
            break
        }
        case "LENGTH": {
            if (parts.length >= 2) {
                v.lengthMin = parseFloat(parts[0]!)
                v.lengthMax = parseFloat(parts[1]!)
            } else {
                v.lengthMin = undefined
                v.lengthMax = parseFloat(parts[0]!)
            }
            break
        }
        case "ENGINETYPE":
            v.engineType = rest.trim().toUpperCase()
            break
        case "NOTENGINETYPE":
            v.notEngineType = rest.trim().toUpperCase()
            break
        case "SCHENGEN":
            v.schengen = "schengen"
            break
        case "NON-SCHENGEN":
        case "NONSCHENGEN":
            v.schengen = "non-schengen"
            break
        case "ADEP":
            v.adep = rest.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)
            break
        case "NOTADEP":
            v.notAdep = rest.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)
            break
        case "PRIORITY":
            v.priority = parseInt(rest.trim(), 10) || 0
            break
        case "BLOCKS": {
            const stands = expandList((parts[0] ?? "").split(","))
            v.blocks.push({
                stands,
                wingspanOrCode: parts[1]?.trim(),
                length: parts[2] !== undefined ? parseFloat(parts[2]) : undefined,
            })
            break
        }
        case "LIMITS": {
            if (parts.length >= 3) {
                v.limits.push({
                    stands: expandList((parts[0] ?? "").split(",")),
                    triggerWoc: parts[1]!.trim(),
                    limitedWoc: parts[2]!.trim(),
                    triggerLength: parts[3] !== undefined ? parseFloat(parts[3]) : undefined,
                    limitedLength: parts[4] !== undefined ? parseFloat(parts[4]) : undefined,
                })
            }
            break
        }
        default:
            break
    }
}

function finalizeVariant(v: StandVariant | undefined): void {
    if (!v) return
    if (v.coords.length === 0 && !v.circle) return
    const list = essaVariants.get(v.name) ?? []
    // Avoid duplicating identical empty-coord copies without geometry on first save
    list.push(v)
    essaVariants.set(v.name, list)
}

/**
 * Parse ESSA section of GRpluginStands.txt content (stops at ESSB/ESGG dividers).
 * Exported for fixture tests.
 */
export function parseEssaStandsContent(content: string): void {
    essaVariants = new Map()
    apronOrder = []
    standLists = []
    groups = new Map()

    const lines = content.split(/\r?\n/)
    let currentApron = "OTHER"
    let apronStands: Map<string, string[]> = new Map()
    let current: StandVariant | undefined
    let inEssa = false

    const ensureApron = (title: string) => {
        if (!apronStands.has(title)) {
            apronStands.set(title, [])
            apronOrder.push({ title, standNames: apronStands.get(title)! })
        }
        return apronStands.get(title)!
    }

    const noteStandInApron = (name: string, apron: string) => {
        const list = ensureApron(apron)
        if (!list.includes(name)) list.push(name)
    }

    for (const rawLine of lines) {
        const line = rawLine.trim()
        if (!line) continue

        // Airport dividers
        // Stop at ESSB / ESGG section dividers in the shared stands file
        if (/ESSB|ESGG/i.test(line) && /^-{4,}/.test(line.replace(/\s/g, ""))) {
            finalizeVariant(current)
            current = undefined
            inEssa = false
            break
        }

        const apronTitle = isApronComment(line)
        if (apronTitle) {
            // Section comments before first ESSA STAND still apply once we see ESSA
            currentApron = apronTitle
            ensureApron(currentApron)
            continue
        }

        if (line.startsWith("//")) continue

        if (line.startsWith("GROUP:")) {
            const parts = line.substring(6).split(":")
            const name = parts[0]!
            groups.set(name, parts.slice(1).filter(Boolean))
            continue
        }

        if (line.startsWith("STANDLIST:")) {
            const parts = line.substring(10).split(":")
            if (parts.length >= 4 && parts[0]!.toUpperCase() === "ESSA") {
                inEssa = true
                const callsignList = expandList(parts[1]!.split(","))
                const points = parseInt(parts[2]!, 10) || 0
                const stands = expandList(parts[3]!.split(","))
                standLists.push({ callsignPrefixes: callsignList, points, stands })
            }
            continue
        }

        if (line.toUpperCase() === "COPY") {
            if (current) {
                const next = cloneVariant(current)
                finalizeVariant(current)
                current = next
            }
            continue
        }

        if (line.startsWith("STAND:")) {
            finalizeVariant(current)
            current = undefined
            const parts = line.substring(6).split(":")
            const airport = (parts[0] ?? "").toUpperCase()
            if (airport !== "ESSA") {
                // Leave ESSA block when another airport's STAND appears
                if (inEssa && airport && airport !== "ESSA") break
                continue
            }
            inEssa = true
            const name = (parts[1] ?? "").trim()
            if (!name) continue
            current = emptyVariant(name, currentApron)
            noteStandInApron(name, currentApron)
            // Circle form: STAND:ESSA:name:lat:lon:radius
            if (parts.length >= 5) {
                const lat = parseDmsPart(parts[2]!)
                const lon = parseDmsPart(parts[3]!)
                const radiusM = parseFloat(parts[4]!)
                if (lat !== undefined && lon !== undefined && !isNaN(radiusM)) {
                    current.circle = { lat, lon, radiusM }
                }
            }
            continue
        }

        if (current && inEssa) {
            applyStandLine(current, line)
        }
    }
    finalizeVariant(current)

    // Drop empty aprons
    apronOrder = apronOrder.filter((a) => a.standNames.length > 0)
    loaded = essaVariants.size > 0
}

export function loadEssaStandAssign(euroscopeDir: string, packageFilter = "ESAA"): number {
    loaded = false
    essaVariants = new Map()
    apronOrder = []
    standLists = []
    groups = new Map()

    const standFile = findPluginFile(euroscopeDir, "GRpluginStands.txt", packageFilter)
    if (!standFile) {
        console.warn("[ESSA stands] GRpluginStands.txt not found")
        return 0
    }
    parseEssaStandsContent(fs.readFileSync(standFile, "utf8"))

    const aircraftFile = findPluginFile(euroscopeDir, "ICAO_Aircraft.json", packageFilter)
    aircraftByIcao = new Map()
    if (aircraftFile) {
        try {
            // EuroScope package file may start with a UTF-8 BOM
            const raw = fs.readFileSync(aircraftFile, "utf8").replace(/^\uFEFF/, "")
            const arr = JSON.parse(raw) as IcaoAircraftEntry[]
            for (const e of arr) {
                if (e?.ICAO) aircraftByIcao.set(e.ICAO.toUpperCase(), e)
            }
        } catch (err) {
            console.warn(`[ESSA stands] Failed to load ICAO_Aircraft.json: ${err}`)
        }
    }

    operatorUse = new Map()
    const opFile = findPluginFile(euroscopeDir, "GRpluginOperatorInfo.txt", packageFilter)
    if (opFile) {
        for (const raw of fs.readFileSync(opFile, "utf8").split(/\r?\n/)) {
            const line = raw.trim()
            if (!line || line.startsWith("//")) continue
            const parts = line.split(/\t+|\s+/)
            if (parts.length >= 2) {
                operatorUse.set(parts[0]!.toUpperCase(), parts[1]!.toUpperCase())
            }
        }
    }

    console.log(
        `[ESSA stands] ${essaVariants.size} stands, ${standLists.length} STANDLIST rows, ` +
            `${aircraftByIcao.size} aircraft types from ${standFile}`,
    )
    return essaVariants.size
}

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

export function hasEssaStandAssignData(): boolean {
    return loaded && essaVariants.size > 0
}

// ─── Aircraft resolution ─────────────────────────────────────────────────────

export function resolveAircraftDims(
    aircraftType: string | undefined,
    wakeTurbulence: string | undefined,
    callsign: string,
    fplRemarks?: string,
): AircraftDims {
    const type = (aircraftType ?? "").toUpperCase()
    const entry = type ? aircraftByIcao.get(type) : undefined
    const wtc = (wakeTurbulence || entry?.WTC || "M").toUpperCase().charAt(0)
    let wingspan = entry?.Wingspan
    if (wingspan === undefined || wingspan <= 0) {
        wingspan = WTC_DEFAULT_WINGSPAN[wtc] ?? 36
    }
    const length = entry?.Length && entry.Length > 0 ? entry.Length : 0

    let use = (entry?.Use ?? "").toUpperCase()
    const opKey = callsign.substring(0, 3).toUpperCase()
    const opOverride = operatorUse.get(opKey)
    if (opOverride) {
        if (opOverride === "MIL") {
            // Military priority from guide — simplified
            if (/\bCARGO\b/i.test(fplRemarks ?? "")) use = "T"
            else if (use.includes("C")) use = "T"
            else if (use.includes("H")) use = "I"
            else if (wtc === "L" || wtc === "M") use = "M"
            else use = "T"
        } else if (opOverride === "CIV") {
            if (use.includes("T")) use = "C"
            else if (use.includes("I")) use = "H"
            else if (!use) use = wtc === "L" ? "P" : "A"
        } else {
            // Listed uses: if aircraft type use is in the list, keep it; else use listed
            if (!use || ![...opOverride].some((c) => use.includes(c))) {
                use = opOverride
            }
        }
    }
    if (/\bCARGO\b/i.test(fplRemarks ?? "") && !use.includes("C")) {
        use = (use || "") + "C"
    }
    if (!use) {
        use = wtc === "L" ? "P" : "A"
    }

    let engine: string | undefined
    if (entry?.Description && entry.Description.length >= 3) {
        engine = entry.Description.charAt(2).toUpperCase()
    }

    return { type, wtc, wingspan, length, use, engine }
}

export function isSchengenOrigin(origin: string | undefined): boolean {
    if (!origin || origin.length < 2) return false
    const prefix = origin.substring(0, 2).toUpperCase()
    if (prefix === "ES") return true
    return SCHENGEN_PREFIXES.has(prefix)
}

// ─── Physical fit ────────────────────────────────────────────────────────────

function atypMatches(pattern: string, type: string): boolean {
    const p = pattern.toUpperCase()
    const t = type.toUpperCase()
    if (p === "*") return true
    if (p.endsWith("*")) {
        const prefix = p.slice(0, -1)
        // "A3*" needs at least one char after A3
        return t.startsWith(prefix) && t.length > prefix.length
    }
    return t === p
}

function physicalFitVariant(
    v: StandVariant,
    ac: AircraftDims,
    extraMaxWingspan?: number,
    extraMaxLength?: number,
): boolean {
    if (v.use) {
        const allowed = new Set([...v.use.toUpperCase()])
        if (![...ac.use.toUpperCase()].some((c) => allowed.has(c))) return false
    }
    if (v.atyp && v.atyp.length > 0) {
        if (!v.atyp.some((p) => atypMatches(p, ac.type))) return false
    }
    if (v.notAtyp && v.notAtyp.some((p) => atypMatches(p, ac.type))) return false

    let maxWs = v.wingspanMax
    let minWs = v.wingspanMin
    if (v.codeMax) {
        const codeMax = CODE_MAX_WINGSPAN[v.codeMax.toUpperCase()]
        if (codeMax !== undefined) maxWs = maxWs === undefined ? codeMax : Math.min(maxWs, codeMax)
    }
    if (v.codeMin) {
        const codeMinLetter = v.codeMin.toUpperCase()
        // Min code letter → min wingspan is previous letter's max + epsilon; treat as min span of that letter
        const letters = ["A", "B", "C", "D", "E", "F"]
        const idx = letters.indexOf(codeMinLetter)
        if (idx > 0) {
            const prevMax = CODE_MAX_WINGSPAN[letters[idx - 1]!]!
            minWs = minWs === undefined ? prevMax + 0.001 : Math.max(minWs, prevMax + 0.001)
        }
    }
    if (extraMaxWingspan !== undefined) {
        maxWs = maxWs === undefined ? extraMaxWingspan : Math.min(maxWs, extraMaxWingspan)
    }
    if (minWs !== undefined && ac.wingspan < minWs) return false
    if (maxWs !== undefined && ac.wingspan > maxWs) return false

    let maxLen = v.lengthMax
    let minLen = v.lengthMin
    if (extraMaxLength !== undefined) {
        maxLen = maxLen === undefined ? extraMaxLength : Math.min(maxLen, extraMaxLength)
    }
    if (minLen !== undefined && ac.length < minLen) return false
    if (maxLen !== undefined && ac.length > 0 && ac.length > maxLen) return false

    if (v.engineType && ac.engine) {
        if (![...v.engineType].includes(ac.engine)) return false
    }
    if (v.notEngineType && ac.engine) {
        if ([...v.notEngineType].includes(ac.engine)) return false
    }
    return true
}

function schengenAgrees(v: StandVariant, flightIsSchengen: boolean): boolean {
    if (!v.schengen) return true
    if (v.schengen === "schengen") return flightIsSchengen
    return !flightIsSchengen
}

function anyPhysicalFit(
    name: string,
    ac: AircraftDims,
    extraMaxWingspan?: number,
    extraMaxLength?: number,
): boolean {
    const variants = essaVariants.get(name)
    if (!variants?.length) return false
    return variants.some((v) => physicalFitVariant(v, ac, extraMaxWingspan, extraMaxLength))
}

/** Collect why one variant rejects this aircraft (empty = fits). */
function variantRejectReasons(
    v: StandVariant,
    ac: AircraftDims,
    extraMaxWingspan?: number,
    extraMaxLength?: number,
): string[] {
    const reasons: string[] = []
    if (v.use) {
        const allowed = new Set([...v.use.toUpperCase()])
        if (![...ac.use.toUpperCase()].some((c) => allowed.has(c))) {
            reasons.push(`use ${ac.use || "?"} (need ${v.use})`)
        }
    }
    if (v.atyp && v.atyp.length > 0) {
        if (!v.atyp.some((p) => atypMatches(p, ac.type))) {
            reasons.push(`type ${ac.type} (need ${v.atyp.join("/")})`)
        }
    }
    if (v.notAtyp && v.notAtyp.some((p) => atypMatches(p, ac.type))) {
        reasons.push(`type ${ac.type} excluded`)
    }

    let maxWs = v.wingspanMax
    let minWs = v.wingspanMin
    if (v.codeMax) {
        const codeMax = CODE_MAX_WINGSPAN[v.codeMax.toUpperCase()]
        if (codeMax !== undefined) maxWs = maxWs === undefined ? codeMax : Math.min(maxWs, codeMax)
    }
    if (v.codeMin) {
        const codeMinLetter = v.codeMin.toUpperCase()
        const letters = ["A", "B", "C", "D", "E", "F"]
        const idx = letters.indexOf(codeMinLetter)
        if (idx > 0) {
            const prevMax = CODE_MAX_WINGSPAN[letters[idx - 1]!]!
            minWs = minWs === undefined ? prevMax + 0.001 : Math.max(minWs, prevMax + 0.001)
        }
    }
    if (extraMaxWingspan !== undefined) {
        maxWs = maxWs === undefined ? extraMaxWingspan : Math.min(maxWs, extraMaxWingspan)
    }
    if (minWs !== undefined && ac.wingspan < minWs) {
        reasons.push(`wingspan ${fmtM(ac.wingspan)} < min ${fmtM(minWs)}`)
    }
    if (maxWs !== undefined && ac.wingspan > maxWs) {
        const codeNote = v.codeMax ? ` (CODE ${v.codeMax})` : ""
        reasons.push(`wingspan ${fmtM(ac.wingspan)} > max ${fmtM(maxWs)}${codeNote}`)
    }

    let maxLen = v.lengthMax
    let minLen = v.lengthMin
    if (extraMaxLength !== undefined) {
        maxLen = maxLen === undefined ? extraMaxLength : Math.min(maxLen, extraMaxLength)
    }
    if (minLen !== undefined && ac.length < minLen) {
        reasons.push(`length ${fmtM(ac.length)} < min ${fmtM(minLen)}`)
    }
    if (maxLen !== undefined && ac.length > 0 && ac.length > maxLen) {
        reasons.push(`length ${fmtM(ac.length)} > max ${fmtM(maxLen)}`)
    }

    if (v.engineType && ac.engine) {
        if (![...v.engineType].includes(ac.engine)) {
            reasons.push(`engine ${ac.engine} (need ${v.engineType})`)
        }
    }
    if (v.notEngineType && ac.engine) {
        if ([...v.notEngineType].includes(ac.engine)) {
            reasons.push(`engine ${ac.engine} excluded`)
        }
    }
    return reasons
}

function fmtM(n: number): string {
    return Number.isInteger(n) ? `${n}m` : `${Math.round(n * 10) / 10}m`
}

function isTypeOnlyReason(reasons: string[]): boolean {
    return reasons.length > 0 && reasons.every((r) => r.startsWith("type "))
}

/** Best short reject reason when no variant fits (prefer size/use over ATYP-only COPYs). */
function physicalRejectReason(
    name: string,
    ac: AircraftDims,
    extraMaxWingspan?: number,
    extraMaxLength?: number,
): string | undefined {
    const variants = essaVariants.get(name)
    if (!variants?.length) return "no stand definition"
    const scored: string[][] = []
    for (const v of variants) {
        const reasons = variantRejectReasons(v, ac, extraMaxWingspan, extraMaxLength)
        if (reasons.length === 0) return undefined
        scored.push(reasons)
    }
    // Prefer a COPY that fails on size/use/engine — not merely a different ATYP allowlist.
    const preferred = scored.filter((r) => !isTypeOnlyReason(r))
    const pool = preferred.length > 0 ? preferred : scored
    pool.sort((a, b) => a.length - b.length)
    return pool[0]?.join("; ")
}

function preferredEligible(name: string, ac: AircraftDims, flightIsSchengen: boolean): boolean {
    const variants = essaVariants.get(name)
    if (!variants?.length) return false
    return variants.some(
        (v) => physicalFitVariant(v, ac) && schengenAgrees(v, flightIsSchengen),
    )
}

// ─── Occupancy ───────────────────────────────────────────────────────────────

function positionOnStand(
    v: StandVariant,
    lat: number,
    lon: number,
    heading?: number,
): boolean {
    let inside = false
    if (v.coords.length >= 3) {
        inside = pointInPolygon(lat, lon, v.coords)
    } else if (v.circle) {
        inside = distanceMeters(lat, lon, v.circle.lat, v.circle.lon) <= v.circle.radiusM
    } else if (v.coords.length >= 1) {
        inside = distanceMeters(lat, lon, v.coords[0]!.lat, v.coords[0]!.lon) <= 100
    }
    if (!inside) return false
    if (v.heading && heading !== undefined) {
        if (headingDiff(heading, v.heading.hdg) > v.heading.tolerance) return false
    }
    return true
}

function findStandAtPosition(
    lat: number,
    lon: number,
    heading?: number,
): string | undefined {
    for (const [name, variants] of essaVariants) {
        for (const v of variants) {
            if (positionOnStand(v, lat, lon, heading)) return name
        }
    }
    return undefined
}

function exceedsWoc(dims: AircraftDims, woc: string | undefined, length?: number): boolean {
    if (!woc) return true // BLOCKS without threshold always blocks
    const threshold = parseWoc(woc)
    if (threshold !== undefined && dims.wingspan > threshold) return true
    if (length !== undefined && dims.length > length) return true
    if (threshold === undefined && length === undefined) return true
    // wingspanOrCode set but not exceeded, and length not exceeded
    if (threshold !== undefined && dims.wingspan <= threshold) {
        if (length === undefined) return false
        return dims.length > length
    }
    return false
}

/**
 * GRP BLOCKS/LIMITS often reference stands as "3" while STAND names are "03".
 * Resolve to the canonical key in essaVariants when possible.
 */
function resolveStandRef(ref: string): string {
    const t = ref.trim()
    if (!t) return t
    if (essaVariants.has(t)) return t
    const up = t.toUpperCase()
    for (const k of essaVariants.keys()) {
        if (k.toUpperCase() === up) return k
    }
    if (/^\d+$/.test(t)) {
        const pad2 = t.padStart(2, "0")
        if (essaVariants.has(pad2)) return pad2
        if (t.length < 3) {
            const pad3 = t.padStart(3, "0")
            if (essaVariants.has(pad3)) return pad3
        }
    }
    return t
}

function resolveStandKey(stand: string): string {
    const sn = stand.trim()
    if (!sn) return sn
    if (essaVariants.has(sn)) return sn
    return resolveStandRef(sn)
}

/** Apron areas that accept several simultaneous assignments (count only, no Occ/Plan style). */
const MULTI_ASSIGN_STANDS = new Set(["APNH", "APNJ", "APNL", "APNP"])

function isMultiAssignStand(name: string): boolean {
    return MULTI_ASSIGN_STANDS.has(name.toUpperCase())
}

// ─── Classify ────────────────────────────────────────────────────────────────

export interface ClassifyInput {
    stripId: string
    callsign: string
    origin?: string
    destination?: string
    aircraftType?: string
    wakeTurbulence?: string
    fplRemarks?: string
    currentStand?: string
    /** Other aircraft that may occupy / block stands */
    traffic: OccupierInfo[]
}

function depTimesFrom(info: OccupierInfo): Pick<StandOccupancy, "tsat" | "tobt" | "eobt"> {
    if (!info.departure) return {}
    const out: Pick<StandOccupancy, "tsat" | "tobt" | "eobt"> = {}
    if (info.tsat) out.tsat = info.tsat
    if (info.tobt) out.tobt = info.tobt
    if (info.eobt) out.eobt = info.eobt
    return out
}

/**
 * Build apron-grouped stand menu for one ESSA arrival.
 * Status never reorders stands.
 */
export function buildEssaStandMenu(input: ClassifyInput): StandMenuResult | undefined {
    if (!loaded || input.destination?.toUpperCase() !== "ESSA") return undefined

    const ac = resolveAircraftDims(
        input.aircraftType,
        input.wakeTurbulence,
        input.callsign,
        input.fplRemarks,
    )
    const flightSchengen = isSchengenOrigin(input.origin)
    const selfCs = input.callsign.toUpperCase()

    // Map stand → occupier (position first, then assignment / PARK)
    const occupiedBy = new Map<string, OccupierInfo>()
    const assignedBy = new Map<string, OccupierInfo>()
    /** Multi-assign apron areas: unique callsigns on/assigned (count only). */
    const multiAssignCs = new Map<string, Set<string>>()

    const bumpMulti = (stand: string, callsign: string) => {
        const key = stand.toUpperCase()
        let set = multiAssignCs.get(key)
        if (!set) {
            set = new Set()
            multiAssignCs.set(key, set)
        }
        set.add(callsign.toUpperCase())
    }

    for (const t of input.traffic) {
        if (t.callsign.toUpperCase() === selfCs) continue

        let positionStand: string | undefined
        if (t.latitude !== undefined && t.longitude !== undefined) {
            positionStand = findStandAtPosition(t.latitude, t.longitude, t.heading)
            if (positionStand) {
                if (isMultiAssignStand(positionStand)) {
                    bumpMulti(positionStand, t.callsign)
                } else if (!occupiedBy.has(positionStand)) {
                    occupiedBy.set(positionStand, t)
                }
            }
        }

        const assignedKey = t.stand ? resolveStandKey(t.stand) : undefined
        const gs = (t.groundstate || "").toUpperCase()
        const parked = gs === "PARK"

        if (assignedKey) {
            if (isMultiAssignStand(assignedKey)) {
                // Always count assignment/presence on multi aprons; never Occ/Plan style
                if (t.assigned || parked || positionStand === assignedKey) {
                    bumpMulti(assignedKey, t.callsign)
                }
            } else if (positionStand && positionStand !== assignedKey) {
                // On a different stand than GRP assignment: only occupy the real stand
                // (above). Do not show Planned on the unused assigned stand.
            } else if (!positionStand) {
                // No polygon hit: PARK+stand → Occupied; otherwise Planned if assigned
                if (parked) {
                    if (!occupiedBy.has(assignedKey)) occupiedBy.set(assignedKey, t)
                } else if (t.assigned && !assignedBy.has(assignedKey) && !occupiedBy.has(assignedKey)) {
                    assignedBy.set(assignedKey, t)
                }
            }
            // positionStand === assignedKey → already Occupied via position; no Planned
        }
    }

    type BlockSource = {
        callsign: string
        from: "occupied" | "assigned"
        relatedStand: string
        airborne?: boolean
        /** Departure times when blocking from an occupied departure stand */
        tsat?: string
        tobt?: string
        eobt?: string
    }

    // Active LIMITS from occupied/assigned stands
    const limitedWs = new Map<string, number>()
    const limitedLen = new Map<string, number>()
    const limitedBy = new Map<string, BlockSource>() // stand → limiter
    const applyLimitsFrom = (
        standName: string,
        info: OccupierInfo,
        from: "occupied" | "assigned",
    ) => {
        const dims = info.dims
        const variants = essaVariants.get(standName)
        if (!variants) return
        for (const v of variants) {
            // Prefer LIMITS from definitions that fit this aircraft (COPY variants)
            if (!physicalFitVariant(v, dims) && variants.some((x) => physicalFitVariant(x, dims))) {
                continue
            }
            for (const lim of v.limits) {
                if (!exceedsWoc(dims, lim.triggerWoc, lim.triggerLength)) continue
                const limWs = parseWoc(lim.limitedWoc)
                for (const raw of lim.stands) {
                    const target = resolveStandRef(raw)
                    if (!limitedBy.has(target)) {
                        limitedBy.set(target, {
                            callsign: info.callsign,
                            from,
                            relatedStand: standName,
                            airborne: from === "assigned" ? !!info.airborne : undefined,
                            // TS/TB/EB only when hard-blocked by an occupied departure
                            ...(from === "occupied" ? depTimesFrom(info) : {}),
                        })
                    }
                    if (limWs !== undefined) {
                        const prev = limitedWs.get(target)
                        limitedWs.set(target, prev === undefined ? limWs : Math.min(prev, limWs))
                    }
                    if (lim.limitedLength !== undefined) {
                        const prev = limitedLen.get(target)
                        limitedLen.set(
                            target,
                            prev === undefined ? lim.limitedLength : Math.min(prev, lim.limitedLength),
                        )
                    }
                }
            }
        }
    }
    for (const [name, info] of occupiedBy) applyLimitsFrom(name, info, "occupied")
    for (const [name, info] of assignedBy) applyLimitsFrom(name, info, "assigned")

    // BLOCKS — neighbour stands unavailable when this stand is occupied/assigned
    // and the aircraft exceeds BLOCKS wingspan/CODE (or always if no threshold).
    const blockedBy = new Map<string, BlockSource>()
    const applyBlocksFrom = (
        standName: string,
        info: OccupierInfo,
        from: "occupied" | "assigned",
    ) => {
        const variants = essaVariants.get(standName)
        if (!variants) return
        const fitting = variants.filter((v) => physicalFitVariant(v, info.dims))
        const useVariants = fitting.length > 0 ? fitting : variants
        for (const v of useVariants) {
            for (const b of v.blocks) {
                if (!exceedsWoc(info.dims, b.wingspanOrCode, b.length)) continue
                for (const raw of b.stands) {
                    const target = resolveStandRef(raw)
                    if (!blockedBy.has(target)) {
                        blockedBy.set(target, {
                            callsign: info.callsign,
                            from,
                            relatedStand: standName,
                            airborne: from === "assigned" ? !!info.airborne : undefined,
                            ...(from === "occupied" ? depTimesFrom(info) : {}),
                        })
                    }
                }
            }
        }
    }
    for (const [name, info] of occupiedBy) applyBlocksFrom(name, info, "occupied")
    for (const [name, info] of assignedBy) applyBlocksFrom(name, info, "assigned")

    // Preferred: highest STANDLIST points tier with at least one preferred-eligible stand
    const cs = input.callsign.toUpperCase()
    const matchingLists = standLists.filter((sl) =>
        sl.callsignPrefixes.some((p) => cs.startsWith(p.toUpperCase())),
    )
    const byPoints = new Map<number, Set<string>>()
    for (const sl of matchingLists) {
        let set = byPoints.get(sl.points)
        if (!set) {
            set = new Set()
            byPoints.set(sl.points, set)
        }
        for (const s of sl.stands) set.add(s)
    }
    const pointLevels = [...byPoints.keys()].sort((a, b) => b - a)
    let preferredSet = new Set<string>()
    for (const pts of pointLevels) {
        const candidates = byPoints.get(pts)!
        const eligible = [...candidates].filter((s) => preferredEligible(s, ac, flightSchengen))
        if (eligible.length > 0) {
            preferredSet = new Set(eligible)
            break
        }
    }

    const aprons: StandMenuApron[] = []
    for (const apron of apronOrder) {
        const stands: StandMenuEntry[] = []
        for (const name of apron.standNames) {
            const variants = essaVariants.get(name)
            if (!variants?.length) continue
            const area = variants.some((v) => v.area)
            const extraWs = limitedWs.get(name)
            const extraLen = limitedLen.get(name)
            const fits = anyPhysicalFit(name, ac, extraWs, extraLen)

            let fit: StandFitStatus
            let reason: string | undefined
            if (!fits) {
                fit = "notAllowed"
                reason = physicalRejectReason(name, ac, extraWs, extraLen)
            } else if (preferredSet.has(name)) fit = "preferred"
            else fit = "allowed"

            let occupied: StandOccupancy | undefined
            let assignedCount: number | undefined
            const multiCs = multiAssignCs.get(name.toUpperCase())
            if (isMultiAssignStand(name) && multiCs && multiCs.size > 0) {
                // Info count only — no occupied/planned/blocked styling on these aprons
                assignedCount = multiCs.size
            } else {
                const occ = occupiedBy.get(name)
                const asg = assignedBy.get(name)
                const blk = blockedBy.get(name)
                const limBy = limitedBy.get(name)
                if (occ) {
                    occupied = {
                        label: occ.callsign,
                        kind: "occupied",
                        departure: !!occ.departure,
                        // TS/TB/EB only for departures physically on stand
                        ...depTimesFrom(occ),
                    }
                } else if (asg) {
                    occupied = {
                        label: asg.callsign,
                        kind: "assigned",
                        airborne: !!asg.airborne,
                    }
                } else if (blk) {
                    occupied = {
                        label: blk.callsign,
                        kind: "blocked",
                        blockFrom: blk.from,
                        relatedStand: blk.relatedStand,
                        airborne: blk.from === "assigned" ? !!blk.airborne : undefined,
                        ...(blk.from === "occupied"
                            ? { tsat: blk.tsat, tobt: blk.tobt, eobt: blk.eobt }
                            : {}),
                    }
                } else if (!fits && limBy) {
                    // LIMITS that make this aircraft not fit → "Blocked" text; style from related stand
                    occupied = {
                        label: limBy.callsign,
                        kind: "blocked",
                        blockFrom: limBy.from,
                        relatedStand: limBy.relatedStand,
                        airborne: limBy.from === "assigned" ? !!limBy.airborne : undefined,
                        ...(limBy.from === "occupied"
                            ? { tsat: limBy.tsat, tobt: limBy.tobt, eobt: limBy.eobt }
                            : {}),
                    }
                }
            }

            stands.push({
                name,
                fit,
                reason,
                occupied,
                assignedCount,
                area,
                selectable: true,
            })
        }
        if (stands.length) aprons.push({ title: apron.title, stands })
    }

    return {
        stripId: input.stripId,
        currentStand: input.currentStand,
        aprons: applyEssaStandMenuGeoLayout(aprons),
    }
}

/** Test helpers */
export function _testReset() {
    essaVariants = new Map()
    apronOrder = []
    standLists = []
    groups = new Map()
    aircraftByIcao = new Map()
    operatorUse = new Map()
    loaded = false
}

export function _testSetAircraft(entries: IcaoAircraftEntry[]) {
    aircraftByIcao = new Map()
    for (const e of entries) aircraftByIcao.set(e.ICAO.toUpperCase(), e)
}

export function _testMarkLoaded() {
    loaded = essaVariants.size > 0
}

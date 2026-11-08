/**
 * Stand menu: parse GRpluginStands.txt for all GRP airports and classify stands
 * for one arrival (physical fit, preferred airline/Schengen highlight, occupancy).
 *
 * Menu columns: VatEFS data/stand-menu-groups.yml → //TERMINAL|APRON comments →
 * airport terminal GROUP: sections → single ALL column.
 */

import fs from "fs"
import path from "path"
import yaml from "js-yaml"
import { getAirportCoords } from "./airport-data.js"
import { calculateDistanceNm } from "./geo-utils.js"
import {
    getActiveMapClosedStands,
    getAutoAssignDistNm,
    loadGrpAutoAssignDist,
    loadGrpMapsBlocks,
} from "./grp-maps.js"

// ─── Types ───────────────────────────────────────────────────────────────────

export type StandFitStatus = "preferred" | "allowed" | "notAllowed"

export interface StandOccupancy {
    /** Callsign of the aircraft on / planned for / blocking this stand */
    label: string
    /**
     * occupied = radar on stand; assigned = planned; blocked = GRP BLOCKS/LIMITS neighbour;
     * closed = active GRpluginMaps WIP BLOCKS (auto-assign excluded).
     */
    kind: "occupied" | "assigned" | "blocked" | "closed"
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
    /**
     * When still on stand but startup/push/taxi cleared: show STUP / PUSH / TAXI
     * instead of TS/TB/EB.
     */
    gsLabel?: string
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
    /** True when an arrival has an ESSA stand assignment (Planned); never deps */
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

interface MenuApronDef {
    title: string
    standNames: string[]
}

interface AirportStandStore {
    /** Stand name → variants (COPY creates multiple) */
    variants: Map<string, StandVariant[]>
    /** Columns from //TERMINAL / //APRON comments in this airport block */
    commentAprons: MenuApronDef[]
    standLists: StandListEntry[]
    /** Terminal-section GROUP: names in file order (e.g. GGTERM, T5A) */
    terminalGroupOrder: string[]
    terminalGroups: Map<string, string[]>
    /** Resolved display columns (hybrid) */
    menuAprons: MenuApronDef[]
}

function emptyAirportStore(): AirportStandStore {
    return {
        variants: new Map(),
        commentAprons: [],
        standLists: [],
        terminalGroupOrder: [],
        terminalGroups: new Map(),
        menuAprons: [],
    }
}

/** Per-airport GRP stand data */
let byAirport: Map<string, AirportStandStore> = new Map()
/** All GROUP: definitions (airline + terminal) for GROUP_ expansion */
let groups: Map<string, string[]> = new Map()
/** VatEFS YAML menu overrides (airport → columns) */
let yamlMenuGroups: Map<
    string,
    { title: string; stands?: string[]; group?: string; all?: boolean }[]
> = new Map()
let aircraftByIcao: Map<string, IcaoAircraftEntry> = new Map()
/** Callsign prefix (3 letters) → use override from OperatorInfo */
let operatorUse: Map<string, string> = new Map()
let loaded = false

/**
 * Active airport pointers — helpers (fit / occupancy / auto) read these.
 * `bindAirport` swaps them before building a menu.
 */
let essaVariants: Map<string, StandVariant[]> = new Map()
let apronOrder: MenuApronDef[] = []
let standLists: StandListEntry[] = []
let activeAirport = ""

function ensureAirport(icao: string): AirportStandStore {
    const key = icao.toUpperCase()
    let store = byAirport.get(key)
    if (!store) {
        store = emptyAirportStore()
        byAirport.set(key, store)
    }
    return store
}

function bindAirport(icao: string): AirportStandStore | undefined {
    const store = byAirport.get(icao.toUpperCase())
    if (!store) {
        essaVariants = new Map()
        apronOrder = []
        standLists = []
        activeAirport = ""
        return undefined
    }
    essaVariants = store.variants
    apronOrder = store.menuAprons.length > 0 ? store.menuAprons : store.commentAprons
    standLists = store.standLists
    activeAirport = icao.toUpperCase()
    return store
}

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

function finalizeVariant(store: AirportStandStore, v: StandVariant | undefined): void {
    if (!v) return
    if (v.coords.length === 0 && !v.circle) return
    const list = store.variants.get(v.name) ?? []
    list.push(v)
    store.variants.set(v.name, list)
}

/** `//----------------------------------------------------------------------------ESSA` or bare `----ESSB` */
function airportDividerIcao(line: string): string | undefined {
    const compact = line.replace(/\s/g, "")
    const m = compact.match(/^\/\/?-{4,}([A-Z]{4})$/i)
    return m ? m[1]!.toUpperCase() : undefined
}

function prettyTerminalGroupTitle(groupName: string): string {
    const g = groupName.trim()
    const known: Record<string, string> = {
        GGCARGO: "Cargo",
        GGTERM: "Term",
        GGMSTERMNEW: "MS Term",
        GGAPNSE: "Apron SE",
        GGAPNSW: "Apron SW",
        MSTERMN: "Term N",
        MSTERMS: "Term S",
        MSREMOTE: "Remote",
        MSCARGO: "Cargo",
    }
    if (known[g]) return known[g]!
    if (g.startsWith("GG")) return g.slice(2)
    if (g.startsWith("MS")) return g.slice(2)
    return g
}

/** Numeric-aware stand name sort (ascending). */
function compareStandNamesAsc(a: string, b: string): number {
    return a.localeCompare(b, undefined, { numeric: true })
}

/** Numeric-aware stand name sort (high → low). */
function compareStandNamesDesc(a: string, b: string): number {
    return b.localeCompare(a, undefined, { numeric: true })
}

function sortMenuColumnStands(
    cols: MenuApronDef[],
    compare: (a: string, b: string) => number,
): MenuApronDef[] {
    return cols.map((c) => ({
        ...c,
        standNames: [...c.standNames].sort(compare),
    }))
}

/**
 * Ensure every GRP stand appears in some menu column.
 * Leftovers (not listed in YAML / comments / GROUPs) go into Other.
 */
function ensureAllGrpStandsInMenu(
    cols: MenuApronDef[],
    store: AirportStandStore,
    compare: (a: string, b: string) => number = compareStandNamesAsc,
): MenuApronDef[] {
    if (!cols.length) return cols
    const covered = new Set<string>()
    for (const col of cols) {
        for (const n of col.standNames) covered.add(n)
    }
    const leftover = [...store.variants.keys()]
        .filter((n) => !covered.has(n))
        .sort(compare)
    if (!leftover.length) return sortMenuColumnStands(cols, compare)

    // Prefer Other / ALL / Cargo/Other sink — never bare "Cargo" (leave that group intact)
    const sinkIdx = cols.findIndex((c) => {
        const t = c.title.trim().toUpperCase().replace(/\s+/g, "")
        return t === "OTHER" || t === "ALL" || t.startsWith("CARGO/OTHER")
    })
    if (sinkIdx >= 0) {
        const sink = cols[sinkIdx]!
        const seen = new Set(sink.standNames)
        const extras: string[] = []
        for (const n of leftover) {
            if (seen.has(n)) continue
            seen.add(n)
            extras.push(n)
        }
        // Keep original group stands first (sorted); append leftovers after — do not
        // re-interleave so Cargo/etc. membership stays visually unchanged.
        const next = cols.slice()
        next[sinkIdx] = {
            ...sink,
            standNames: [...[...sink.standNames].sort(compare), ...extras],
        }
        return next.map((c, i) =>
            i === sinkIdx ? c : { ...c, standNames: [...c.standNames].sort(compare) },
        )
    }
    return sortMenuColumnStands(
        [...cols, { title: "Other", standNames: leftover }],
        compare,
    )
}

/**
 * Resolve display columns for one airport (hybrid):
 * YAML → comment aprons → terminal GROUPs → ALL.
 * Never omit a stand that exists in GRpluginStands for that airport.
 */
function resolveMenuApronsForAirport(icao: string, store: AirportStandStore): MenuApronDef[] {
    const standCompare =
        icao.toUpperCase() === "ESGG" ? compareStandNamesDesc : compareStandNamesAsc

    const resolveNames = (raw: string[]): string[] => {
        const out: string[] = []
        const seen = new Set<string>()
        for (const r of raw) {
            const key = resolveStandKeyIn(store, r)
            if (!store.variants.has(key) && !store.variants.has(r)) continue
            const name = store.variants.has(key) ? key : r
            if (seen.has(name)) continue
            seen.add(name)
            out.push(name)
        }
        return out
    }

    const yamlCols = yamlMenuGroups.get(icao.toUpperCase())
    if (yamlCols?.length) {
        const cols: MenuApronDef[] = []
        for (const col of yamlCols) {
            let raw: string[] = []
            // No group/stands (or all: true) → every stand at this airport
            if (col.all || (!col.group && !(col.stands?.length))) {
                raw = [...store.variants.keys()].sort(standCompare)
            } else {
                if (col.group) {
                    raw = [
                        ...(store.terminalGroups.get(col.group) ?? []),
                        ...(groups.get(col.group) ?? []),
                    ]
                }
                if (col.stands?.length) raw = [...raw, ...col.stands]
            }
            const standNames = resolveNames(raw)
            if (standNames.length) cols.push({ title: col.title, standNames })
        }
        if (cols.length) return ensureAllGrpStandsInMenu(cols, store, standCompare)
    }

    // //TERMINAL|APRON comments; keep pre-comment stands as a leading "Stands" column
    // (e.g. ESSB 3–19 before //APRON EAST) rather than dropping the OTHER bucket.
    const namedComments = store.commentAprons
        .filter((a) => a.title !== "OTHER")
        .map((a) => ({ title: a.title, standNames: resolveNames(a.standNames) }))
        .filter((a) => a.standNames.length > 0)
    if (namedComments.length) {
        const other = store.commentAprons.find((a) => a.title === "OTHER")
        const pre = other ? resolveNames(other.standNames) : []
        const cols = pre.length
            ? [{ title: "Stands", standNames: pre }, ...namedComments]
            : namedComments
        return ensureAllGrpStandsInMenu(cols, store, standCompare)
    }

    if (store.terminalGroupOrder.length) {
        const cols: MenuApronDef[] = []
        for (const gName of store.terminalGroupOrder) {
            const standNames = resolveNames(store.terminalGroups.get(gName) ?? [])
            if (standNames.length) {
                cols.push({ title: prettyTerminalGroupTitle(gName), standNames })
            }
        }
        if (cols.length) return ensureAllGrpStandsInMenu(cols, store, standCompare)
    }

    const all = [...store.variants.keys()].sort(standCompare)
    return all.length ? [{ title: "ALL", standNames: all }] : []
}

/** Resolve stand ref against one airport store (padding / case). */
function resolveStandKeyIn(store: AirportStandStore, stand: string): string {
    const sn = stand.trim()
    if (!sn) return sn
    if (store.variants.has(sn)) return sn
    const up = sn.toUpperCase()
    for (const k of store.variants.keys()) {
        if (k.toUpperCase() === up) return k
    }
    if (/^\d+$/.test(sn)) {
        const pad2 = sn.padStart(2, "0")
        if (store.variants.has(pad2)) return pad2
        if (sn.length < 3) {
            const pad3 = sn.padStart(3, "0")
            if (store.variants.has(pad3)) return pad3
        }
    }
    return sn
}

/**
 * Parse GRpluginStands.txt for all airports (exported for fixture tests).
 */
export function parseEssaStandsContent(content: string): void {
    byAirport = new Map()
    groups = new Map()
    essaVariants = new Map()
    apronOrder = []
    standLists = []
    activeAirport = ""

    const lines = content.split(/\r?\n/)
    let currentIcao: string | undefined
    let store: AirportStandStore | undefined
    let currentApron = "OTHER"
    let apronStands: Map<string, string[]> = new Map()
    let current: StandVariant | undefined
    /** GROUPs before first STAND: in an airport block are menu terminal groups */
    let inTerminalGroupSection = false

    const beginAirport = (icao: string) => {
        if (store) finalizeVariant(store, current)
        current = undefined
        currentIcao = icao
        store = ensureAirport(icao)
        currentApron = "OTHER"
        apronStands = new Map()
        for (const a of store.commentAprons) {
            apronStands.set(a.title, a.standNames)
        }
        inTerminalGroupSection = true
    }

    const ensureApron = (title: string) => {
        if (!store) return [] as string[]
        if (!apronStands.has(title)) {
            const standNames: string[] = []
            apronStands.set(title, standNames)
            store.commentAprons.push({ title, standNames })
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

        const divIcao = airportDividerIcao(line)
        if (divIcao) {
            if (store) finalizeVariant(store, current)
            current = undefined
            beginAirport(divIcao)
            continue
        }

        const apronTitle = isApronComment(line)
        if (apronTitle) {
            currentApron = apronTitle
            if (store) ensureApron(currentApron)
            continue
        }

        if (line.startsWith("//")) continue

        if (line.startsWith("GROUP:")) {
            const parts = line.substring(6).split(":")
            const name = parts[0]!
            const members = parts.slice(1).filter(Boolean)
            groups.set(name, members)
            if (store && inTerminalGroupSection) {
                if (!store.terminalGroups.has(name)) {
                    store.terminalGroupOrder.push(name)
                }
                store.terminalGroups.set(name, members)
            }
            continue
        }

        if (line.startsWith("STANDLIST:")) {
            inTerminalGroupSection = false
            const parts = line.substring(10).split(":")
            if (parts.length >= 4) {
                const airport = parts[0]!.toUpperCase()
                if (!store || currentIcao !== airport) {
                    if (store) finalizeVariant(store, current)
                    current = undefined
                    beginAirport(airport)
                    inTerminalGroupSection = false
                }
                const callsignList = expandList(parts[1]!.split(","))
                const points = parseInt(parts[2]!, 10) || 0
                const stands = expandList(parts[3]!.split(","))
                store!.standLists.push({ callsignPrefixes: callsignList, points, stands })
            }
            continue
        }

        if (line.toUpperCase() === "COPY") {
            if (current && store) {
                const next = cloneVariant(current)
                finalizeVariant(store, current)
                current = next
            }
            continue
        }

        if (line.startsWith("STAND:")) {
            inTerminalGroupSection = false
            if (store) finalizeVariant(store, current)
            current = undefined
            const parts = line.substring(6).split(":")
            const airport = (parts[0] ?? "").toUpperCase()
            if (!airport) continue
            if (!store || currentIcao !== airport) {
                beginAirport(airport)
                inTerminalGroupSection = false
            }
            const name = (parts[1] ?? "").trim()
            if (!name) continue
            current = emptyVariant(name, currentApron)
            noteStandInApron(name, currentApron)
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

        if (current && store) {
            applyStandLine(current, line)
        }
    }
    if (store) finalizeVariant(store, current)

    // Drop empty comment aprons; resolve hybrid menu columns
    for (const [icao, s] of byAirport) {
        s.commentAprons = s.commentAprons.filter((a) => a.standNames.length > 0)
        s.menuAprons = resolveMenuApronsForAirport(icao, s)
    }

    bindAirport("ESSA")
    loaded = byAirport.size > 0 && [...byAirport.values()].some((s) => s.variants.size > 0)
}

/** Load optional VatEFS stand-menu-groups.yml (relative to dataDir). */
export function loadStandMenuGroupsYaml(dataDir: string): void {
    yamlMenuGroups = new Map()
    const file = path.join(dataDir, "stand-menu-groups.yml")
    if (!fs.existsSync(file)) return
    try {
        const doc = yaml.load(fs.readFileSync(file, "utf8")) as Record<
            string,
            | { title?: string; stands?: string[]; group?: string; all?: boolean }[]
            | undefined
        >
        if (!doc || typeof doc !== "object") return
        for (const [icao, cols] of Object.entries(doc)) {
            if (!Array.isArray(cols)) continue
            const parsed = cols
                .map((c) => {
                    const title = String(c?.title || "").trim() || "Stands"
                    const stands = Array.isArray(c?.stands)
                        ? c.stands.map((s) => String(s).trim()).filter(Boolean)
                        : undefined
                    const group = c?.group ? String(c.group).trim() : undefined
                    const all =
                        c?.all === true ||
                        (!group && !(stands?.length) && title.toUpperCase() === "ALL")
                    return { title, stands, group, all: all || undefined }
                })
                .filter(
                    (c) =>
                        (c.stands?.length ?? 0) > 0 || !!c.group || !!c.all,
                )
            if (parsed.length) yamlMenuGroups.set(icao.toUpperCase(), parsed)
        }
        // Re-resolve menu columns if stands already loaded
        for (const [icao, s] of byAirport) {
            s.menuAprons = resolveMenuApronsForAirport(icao, s)
        }
        if (activeAirport) bindAirport(activeAirport)
        console.log(`[stands] menu groups YAML: ${yamlMenuGroups.size} airports from ${file}`)
    } catch (err) {
        console.warn(`[stands] Failed to load stand-menu-groups.yml: ${err}`)
    }
}

export function loadEssaStandAssign(
    euroscopeDir: string,
    packageFilter = "ESAA",
    dataDir?: string,
): number {
    loaded = false
    byAirport = new Map()
    essaVariants = new Map()
    apronOrder = []
    standLists = []
    groups = new Map()
    activeAirport = ""

    loadGrpAutoAssignDist(euroscopeDir, packageFilter)
    loadGrpMapsBlocks(euroscopeDir, packageFilter)

    if (dataDir) loadStandMenuGroupsYaml(dataDir)

    const standFile = findPluginFile(euroscopeDir, "GRpluginStands.txt", packageFilter)
    if (!standFile) {
        console.warn("[stands] GRpluginStands.txt not found")
        return 0
    }
    // YAML may load before parse; re-apply after parse inside parseEssaStandsContent
    const savedYaml = yamlMenuGroups
    parseEssaStandsContent(fs.readFileSync(standFile, "utf8"))
    if (savedYaml.size) {
        yamlMenuGroups = savedYaml
        for (const [icao, s] of byAirport) {
            s.menuAprons = resolveMenuApronsForAirport(icao, s)
        }
        bindAirport("ESSA")
    }

    const aircraftFile = findPluginFile(euroscopeDir, "ICAO_Aircraft.json", packageFilter)
    aircraftByIcao = new Map()
    if (aircraftFile) {
        try {
            const raw = fs.readFileSync(aircraftFile, "utf8").replace(/^\uFEFF/, "")
            const arr = JSON.parse(raw) as IcaoAircraftEntry[]
            for (const e of arr) {
                if (e?.ICAO) aircraftByIcao.set(e.ICAO.toUpperCase(), e)
            }
        } catch (err) {
            console.warn(`[stands] Failed to load ICAO_Aircraft.json: ${err}`)
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

    let totalStands = 0
    let totalLists = 0
    for (const s of byAirport.values()) {
        totalStands += s.variants.size
        totalLists += s.standLists.length
    }
    console.log(
        `[stands] ${byAirport.size} airports, ${totalStands} stands, ${totalLists} STANDLIST rows, ` +
            `${aircraftByIcao.size} aircraft types from ${standFile}`,
    )
    return totalStands
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
    return loaded && (byAirport.get("ESSA")?.variants.size ?? 0) > 0
}

/** Airports with resolved menu columns (hybrid groups + geometry). */
export function standMenuAirports(): string[] {
    if (!loaded) return []
    return [...byAirport.entries()]
        .filter(([, s]) => s.menuAprons.length > 0 && s.variants.size > 0)
        .map(([icao]) => icao)
        .sort()
}

export function hasStandMenuAirport(airport: string | undefined | null): boolean {
    if (!airport || !loaded) return false
    const s = byAirport.get(airport.toUpperCase())
    return !!s && s.menuAprons.length > 0 && s.variants.size > 0
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
    // Allowed stands: engine type + size only — ignore GRP USE: restrictions
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
    // USE: ignored for allowed-stand checks (engine + size only)
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

/**
 * True when an ESSA arrival with a stand may show as Planned/Inbound and count for
 * auto-assign occupancy. Matches GRP System_AutoAssignDist (default 30 nm).
 * Missing position → not planned (avoids far-out FP clutter); Occupied still uses GPS/PARK.
 */
/** Fallback when airports.csv not loaded yet (tests / early boot). */
const ESSA_COORDS_FALLBACK = { latitude: 59.64849, longitude: 17.928829 }

export function isWithinEssaStandAssignDist(
    latitude: number | undefined,
    longitude: number | undefined,
    airport = "ESSA",
): boolean {
    if (latitude === undefined || longitude === undefined) return false
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false
    const coords =
        getAirportCoords(airport) ??
        (airport.toUpperCase() === "ESSA" ? ESSA_COORDS_FALLBACK : undefined)
    if (!coords) return false
    const limit = getAutoAssignDistNm(airport)
    if (limit <= 0) return false
    const nm = calculateDistanceNm(latitude, longitude, coords.latitude, coords.longitude)
    return nm <= limit
}

/** Resolve map BLOCKS stand refs (may be unpadded) → canonical keys + map name. */
function activeClosedStandMap(airport = "ESSA", now?: Date): Map<string, string> {
    const raw = getActiveMapClosedStands(airport, now)
    const out = new Map<string, string>()
    for (const [stand, mapName] of raw) {
        const key = resolveStandKey(stand)
        if (!out.has(key)) out.set(key, mapName)
        // Also keep raw upper key for lookup when variant missing
        const up = stand.trim().toUpperCase()
        if (!out.has(up)) out.set(up, mapName)
    }
    return out
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

/** Still on stand but cleared — prefer GS label over TSAT/EOBT (GPS still occupies). */
function gsOccupancyLabel(gs: string): string | undefined {
    const g = gs.toUpperCase()
    if (g === "STUP") return "STUP"
    if (g === "PUSH") return "PUSH"
    if (g === "TAXI") return "TAXI"
    return undefined
}

function depTimesFrom(info: OccupierInfo): Pick<StandOccupancy, "tsat" | "tobt" | "eobt" | "gsLabel"> {
    if (!info.departure) return {}
    const gsLabel = gsOccupancyLabel(info.groundstate || "")
    if (gsLabel) return { gsLabel }
    const out: Pick<StandOccupancy, "tsat" | "tobt" | "eobt" | "gsLabel"> = {}
    if (info.tsat) out.tsat = info.tsat
    if (info.tobt) out.tobt = info.tobt
    if (info.eobt) out.eobt = info.eobt
    return out
}

/**
 * Build apron-grouped stand menu for one arrival at a GRP airport.
 * Status never reorders stands. ESSA still gets geo pier layout.
 */
export function buildStandMenu(input: ClassifyInput): StandMenuResult | undefined {
    const dest = (input.destination || "").toUpperCase()
    if (!loaded || !dest) return undefined
    const store = bindAirport(dest)
    if (!store || store.menuAprons.length === 0 || store.variants.size === 0) return undefined

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
    /** Active GRpluginMaps WIP BLOCKS → map name */
    const closedByMap = activeClosedStandMap(dest)

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
        const gs = (t.groundstate || "").toUpperCase()
        // Occupancy is physical (GPS in polygon), not GS. Strip stand is informational
        // for departures — do not mirror it as Planned (that looked like arrivals).

        let positionStand: string | undefined
        if (!t.airborne && t.latitude !== undefined && t.longitude !== undefined) {
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
        const parked = gs === "PARK"
        // When radar position is known, Planned/Inbound only within GRP AutoAssignDist.
        // No position → keep prior behaviour (cannot apply the nm gate).
        const hasPos = t.latitude !== undefined && t.longitude !== undefined
        const plannedOk =
            !hasPos || isWithinEssaStandAssignDist(t.latitude, t.longitude, dest)

        if (assignedKey) {
            if (isMultiAssignStand(assignedKey)) {
                if ((t.assigned && plannedOk) || parked || positionStand === assignedKey) {
                    bumpMulti(assignedKey, t.callsign)
                }
            } else if (positionStand && positionStand !== assignedKey) {
                // On a different stand than GRP assignment: only occupy the real stand.
            } else if (!positionStand) {
                // No polygon hit: PARK+stand → Occupied.
                // Planned = arrivals only (incl. airborne Inbound shade). Never departures —
                // strip stand after push/taxi/depart must not keep the gate Planned.
                if (parked && !t.airborne) {
                    if (!occupiedBy.has(assignedKey)) occupiedBy.set(assignedKey, t)
                } else if (
                    !t.departure &&
                    t.assigned &&
                    plannedOk &&
                    !assignedBy.has(assignedKey) &&
                    !occupiedBy.has(assignedKey)
                ) {
                    assignedBy.set(assignedKey, t)
                }
            }
            // positionStand === assignedKey → already Occupied via GPS; no Planned
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
                } else {
                    // Active GRpluginMaps WIP BLOCKS — distinct colour; still manually selectable
                    const mapName = closedByMap.get(name) ?? closedByMap.get(name.toUpperCase())
                    if (mapName) {
                        occupied = {
                            label: mapName,
                            kind: "closed",
                        }
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
                // GRP maps BLOCKS only exclude auto-assign; manual pick still allowed
                selectable: true,
            })
        }
        if (stands.length) aprons.push({ title: apron.title, stands })
    }

    const laidOut = dest === "ESSA" ? applyEssaStandMenuGeoLayout(aprons) : aprons
    return {
        stripId: input.stripId,
        currentStand: input.currentStand,
        aprons: laidOut,
    }
}

/** @deprecated Use buildStandMenu — kept for callers/tests */
export function buildEssaStandMenu(input: ClassifyInput): StandMenuResult | undefined {
    return buildStandMenu(input)
}

/**
 * True when another aircraft has this stand occupied/planned on the ground, or
 * BLOCKS/LIMITS/closed — amber-highlight the STD cell on the other arrival strip.
 * Airborne planned arrivals do not trigger amber (Inbound shade only in the menu).
 */
export function isStandBlocked(
    airport: string,
    stand: string | undefined,
    selfCallsign: string,
    traffic: OccupierInfo[],
): boolean {
    if (!loaded || !stand?.trim()) return false
    const dest = airport.toUpperCase()
    if (!hasStandMenuAirport(dest)) return false
    const menu = buildStandMenu({
        stripId: "_stand_warn",
        callsign: selfCallsign,
        origin: dest === "ESSA" ? "ESGG" : "ESSA",
        destination: dest,
        aircraftType: "A320",
        traffic,
    })
    if (!menu) return false
    const key = resolveStandKey(stand)
    for (const apron of menu.aprons) {
        for (const s of apron.stands) {
            if (s.name !== key && s.name.toUpperCase() !== stand.trim().toUpperCase()) continue
            const occ = s.occupied
            if (!occ) return false
            if (occ.kind === "blocked" || occ.kind === "closed") return true
            if (occ.kind === "occupied") return true
            if (occ.kind === "assigned" && !occ.airborne) return true
            return false
        }
    }
    return false
}

/** @deprecated ESSA-only wrapper */
export function isEssaStandBlocked(
    stand: string | undefined,
    selfCallsign: string,
    traffic: OccupierInfo[],
): boolean {
    return isStandBlocked("ESSA", stand, selfCallsign, traffic)
}

/**
 * Weighted pick among candidates (weight ≤ 0 treated as equal share of 1).
 * `rng` returns [0, 1) — inject for tests.
 */
function pickWeightedStand(
    cands: { name: string; weight: number }[],
    rng: () => number,
): string | undefined {
    if (!cands.length) return undefined
    const weights = cands.map((c) => (c.weight > 0 ? c.weight : 1))
    const total = weights.reduce((s, w) => s + w, 0)
    if (total <= 0) return cands[0]?.name
    let r = rng() * total
    if (r < 0) r = 0
    if (r >= total) r = total - Number.EPSILON
    for (let i = 0; i < cands.length; i++) {
        r -= weights[i]!
        if (r < 0) return cands[i]!.name
    }
    return cands[cands.length - 1]!.name
}

/**
 * GRP-style Auto: pick a free arrival stand (not MANUAL/AREA/occupied/planned/blocked).
 * Prefers STANDLIST points (weighted random) + stand PRIORITY; retries with soft filters lifted.
 * Excludes the strip's current stand so pressing Auto again yields a different gate when possible.
 */
export function pickAutoStand(
    input: ClassifyInput,
    rng: () => number = Math.random,
): string | undefined {
    const dest = (input.destination || "").toUpperCase()
    if (!loaded || !dest || !hasStandMenuAirport(dest)) return undefined
    const menu = buildStandMenu(input)
    if (!menu) return undefined

    const ac = resolveAircraftDims(
        input.aircraftType,
        input.wakeTurbulence,
        input.callsign,
        input.fplRemarks,
    )
    const flightSchengen = isSchengenOrigin(input.origin)
    const cs = input.callsign.toUpperCase()
    const currentKey = input.currentStand ? resolveStandKey(input.currentStand) : undefined

    const standWeight = (name: string): number => {
        let w = 0
        for (const sl of standLists) {
            if (!sl.callsignPrefixes.some((p) => cs.startsWith(p.toUpperCase()))) continue
            for (const raw of sl.stands) {
                if (resolveStandKey(raw) === name || raw === name) {
                    w = Math.max(w, sl.points)
                }
            }
        }
        return w
    }

    const standBestPriority = (name: string, liftSoft: boolean): number => {
        const variants = essaVariants.get(name)
        if (!variants?.length) return Number.NEGATIVE_INFINITY
        let best = Number.NEGATIVE_INFINITY
        for (const v of variants) {
            if (!physicalFitVariant(v, ac)) continue
            if (!liftSoft && !schengenAgrees(v, flightSchengen)) continue
            best = Math.max(best, v.priority)
        }
        return best
    }

    const isManualStand = (name: string) =>
        (essaVariants.get(name) ?? []).some((v) => v.manual)

    const collect = (liftSoft: boolean, excludeCurrent: boolean) => {
        const out: { name: string; weight: number; priority: number }[] = []
        for (const apron of menu.aprons) {
            for (const s of apron.stands) {
                if (s.area || isManualStand(s.name)) continue
                if (s.occupied) continue
                if (excludeCurrent && currentKey && s.name === currentKey) continue
                if (liftSoft) {
                    if (!anyPhysicalFit(s.name, ac)) continue
                } else if (!preferredEligible(s.name, ac, flightSchengen)) {
                    continue
                }
                const priority = standBestPriority(s.name, liftSoft)
                if (priority === Number.NEGATIVE_INFINITY) continue
                out.push({ name: s.name, weight: standWeight(s.name), priority })
            }
        }
        return out
    }

    const choose = (cands: { name: string; weight: number; priority: number }[]): string | undefined => {
        if (!cands.length) return undefined
        const positive = cands.filter((c) => c.weight > 0)
        let pool: typeof cands
        if (positive.length) {
            // Ratio of STANDLIST points — higher-point stands more likely (GRP).
            pool = positive
        } else {
            const onZeroList = cands.filter((c) => {
                for (const sl of standLists) {
                    if (sl.points !== 0) continue
                    if (!sl.callsignPrefixes.some((p) => cs.startsWith(p.toUpperCase()))) continue
                    if (sl.stands.some((raw) => resolveStandKey(raw) === c.name || raw === c.name)) {
                        return true
                    }
                }
                return false
            })
            pool = onZeroList.length ? onZeroList : cands
        }
        const maxP = Math.max(...pool.map((c) => c.priority))
        const top = pool.filter((c) => c.priority === maxP)
        return pickWeightedStand(top, rng)
    }

    // Prefer a different stand than current when Auto is pressed again.
    return (
        choose(collect(false, true)) ??
        choose(collect(true, true)) ??
        choose(collect(false, false)) ??
        choose(collect(true, false))
    )
}

/** @deprecated Use pickAutoStand */
export function pickEssaAutoStand(
    input: ClassifyInput,
    rng: () => number = Math.random,
): string | undefined {
    return pickAutoStand(input, rng)
}

/** Test helpers */
export function _testReset() {
    byAirport = new Map()
    essaVariants = new Map()
    apronOrder = []
    standLists = []
    groups = new Map()
    yamlMenuGroups = new Map()
    aircraftByIcao = new Map()
    operatorUse = new Map()
    activeAirport = ""
    loaded = false
}

export function _testSetAircraft(entries: IcaoAircraftEntry[]) {
    aircraftByIcao = new Map()
    for (const e of entries) aircraftByIcao.set(e.ICAO.toUpperCase(), e)
}

export function _testMarkLoaded() {
    loaded = [...byAirport.values()].some((s) => s.variants.size > 0)
    if (!activeAirport && byAirport.has("ESSA")) bindAirport("ESSA")
}

/** Test helper: inject YAML menu groups then re-resolve. */
export function _testSetYamlMenuGroups(
    doc: Record<
        string,
        { title: string; stands?: string[]; group?: string; all?: boolean }[]
    >,
): void {
    yamlMenuGroups = new Map()
    for (const [icao, cols] of Object.entries(doc)) {
        yamlMenuGroups.set(icao.toUpperCase(), cols)
    }
    for (const [icao, s] of byAirport) {
        s.menuAprons = resolveMenuApronsForAirport(icao, s)
    }
    if (activeAirport) bindAirport(activeAirport)
}

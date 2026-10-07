/**
 * Parse EuroScope .ese [POSITIONS] + [AIRSPACE] for ESSA GND/CTR sector volumes.
 * Used for custom position-sequence (next SI) and role-based strip visibility.
 */

import fs from "fs"
import path from "path"

export interface EseCoord {
    lat: number
    lon: number
}

export interface EsePosition {
    callsign: string
    frequency: number
    si: string
    airport: string
    role: string
}

export type EssaGndFamily = "GE" | "GN" | "GW"
export type EssaCtrFamily = "TE" | "TW" | "TS"
export type EssaSectorFamily = EssaGndFamily | EssaCtrFamily | "CD" | "OTHER"

export interface EseSector {
    name: string
    /** Short label e.g. "ESSA GNDE", "ESSA GNDE TWY W" */
    shortName: string
    floorFt: number
    ceilingFt: number
    owners: string[]
    active?: { airport: string; runway: string }
    polygon: EseCoord[]
    family: EssaSectorFamily
    /** True if name looks like a runway-gated / named sub-slice */
    isSpecific: boolean
    area: number
}

let positionsBySi: Map<string, EsePosition> = new Map()
let positionsByCallsign: Map<string, EsePosition> = new Map()
let sectors: EseSector[] = []
/** APP/DEP OWNER chains keyed by primary SI (DW/DE/W/E) */
let appDepOwnerChains: Map<string, string[]> = new Map()
/** GND OWNER chains keyed by family (from main ESSA GNDx volume) */
let gndOwnerChains: Map<EssaGndFamily, string[]> = new Map()
/** TWR OWNER chains keyed by family (from main ESSA CTRx volume) */
let twrOwnerChains: Map<EssaCtrFamily, string[]> = new Map()
let loaded = false

export type AppDepOwnerSi = "DW" | "DE" | "W" | "E"

const APP_DEP_SIS = new Set<string>(["DW", "DE", "W", "E"])
const GND_OWNER_SIS = new Set(["AGE", "AGN", "AGW"])
const TWR_OWNER_SIS = new Set(["TE", "TW", "TS"])

function findEseFile(euroscopeDir: string, packageFilter?: string): string | undefined {
    let latestFile: string | undefined
    let latestMtime = 0

    function scanDir(dir: string) {
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true })
            for (const entry of entries) {
                if (entry.isFile() && entry.name.endsWith(".ese")) {
                    const fullPath = path.join(dir, entry.name)
                    if (packageFilter && !fullPath.includes(packageFilter)) continue
                    const stat = fs.statSync(fullPath)
                    if (stat.mtimeMs > latestMtime) {
                        latestMtime = stat.mtimeMs
                        latestFile = fullPath
                    }
                }
            }
        } catch {
            /* ignore */
        }
    }

    scanDir(euroscopeDir)
    try {
        for (const entry of fs.readdirSync(euroscopeDir, { withFileTypes: true })) {
            if (entry.isDirectory()) scanDir(path.join(euroscopeDir, entry.name))
        }
    } catch {
        /* ignore */
    }
    return latestFile
}

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

function parseCoordLine(line: string): EseCoord | undefined {
    // COORD:N059.38.58.301:E017.57.09.158
    if (!line.startsWith("COORD:")) return undefined
    const parts = line.substring(6).split(":")
    if (parts.length < 2) return undefined
    const lat = parseDmsPart(parts[0]!)
    const lon = parseDmsPart(parts[1]!)
    if (lat === undefined || lon === undefined) return undefined
    return { lat, lon }
}

function pointInPolygon(lat: number, lon: number, polygon: EseCoord[]): boolean {
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

function dist2(a: EseCoord, b: EseCoord): number {
    const dLat = a.lat - b.lat
    const dLon = a.lon - b.lon
    return dLat * dLat + dLon * dLon
}

const ENDPOINT_EPS = 1e-8

function near(a: EseCoord, b: EseCoord): boolean {
    return dist2(a, b) < ENDPOINT_EPS
}

function chainBorderPolygon(
    borderIds: number[],
    lines: Map<number, EseCoord[]>
): EseCoord[] {
    if (borderIds.length === 0) return []
    const unused = [...borderIds]
    const firstId = unused.shift()!
    const firstLine = lines.get(firstId)
    if (!firstLine || firstLine.length === 0) return []

    let poly: EseCoord[] = [...firstLine]

    while (unused.length > 0) {
        const end = poly[poly.length - 1]!
        const start = poly[0]!
        let matched = false
        for (let i = 0; i < unused.length; i++) {
            const id = unused[i]!
            const line = lines.get(id)
            if (!line || line.length === 0) {
                unused.splice(i, 1)
                i--
                continue
            }
            const lStart = line[0]!
            const lEnd = line[line.length - 1]!
            if (near(end, lStart)) {
                poly = poly.concat(line.slice(1))
                unused.splice(i, 1)
                matched = true
                break
            }
            if (near(end, lEnd)) {
                poly = poly.concat([...line].reverse().slice(1))
                unused.splice(i, 1)
                matched = true
                break
            }
            if (near(start, lEnd)) {
                poly = line.slice(0, -1).concat(poly)
                unused.splice(i, 1)
                matched = true
                break
            }
            if (near(start, lStart)) {
                poly = [...line].reverse().slice(0, -1).concat(poly)
                unused.splice(i, 1)
                matched = true
                break
            }
        }
        if (!matched) break
    }

    // Drop duplicate closing vertex
    if (poly.length >= 2 && near(poly[0]!, poly[poly.length - 1]!)) {
        poly = poly.slice(0, -1)
    }
    return poly
}

function polygonArea(poly: EseCoord[]): number {
    let a = 0
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        a += poly[j]!.lon * poly[i]!.lat - poly[i]!.lon * poly[j]!.lat
    }
    return Math.abs(a / 2)
}

function classifySector(shortName: string): { family: EssaSectorFamily; isSpecific: boolean } {
    const u = shortName.toUpperCase()
    if (u.includes("DEL")) return { family: "CD", isSpecific: false }
    if (u.includes("GNDE")) {
        const specific = /GNDE\s+(01R|19L|T2|TWY)/i.test(u)
        return { family: "GE", isSpecific: specific }
    }
    if (u.includes("GNDN")) {
        return { family: "GN", isSpecific: /GNDN\s+01L/i.test(u) }
    }
    if (u.includes("GNDW")) {
        return { family: "GW", isSpecific: /GNDW\s+19R/i.test(u) }
    }
    if (u.includes("CTRE")) return { family: "TE", isSpecific: false }
    if (u.includes("CTRW")) return { family: "TW", isSpecific: false }
    if (u.includes("CTRSN") || u.includes("CTRSS")) return { family: "TS", isSpecific: false }
    return { family: "OTHER", isSpecific: false }
}

function shortSectorName(fullName: string): string {
    // ESAA·ESSA GNDE 01R·000·003 → ESSA GNDE 01R
    const parts = fullName.split(/[·•]/)
    if (parts.length >= 2) return parts[1]!.trim()
    return fullName
}

function isEssaGroundOrCtr(shortName: string): boolean {
    const u = shortName.toUpperCase()
    return (
        u.startsWith("ESSA GND") ||
        u.startsWith("ESSA CTR") ||
        u === "ESSA DEL" ||
        u.startsWith("ESSA DEL")
    )
}

/** Map STO APP/DEP sector short name → primary SI for OWNER chain storage */
function appDepPrimarySiFromShortName(shortName: string): AppDepOwnerSi | undefined {
    const u = shortName.toUpperCase().replace(/\s+/g, " ")
    // Prefer TECH volumes (longest OWNER chains)
    if (u.includes("STO DEPW") || u.endsWith("STO DEPW") || /\bSTO DEPW\b/.test(u)) return "DW"
    if (u.includes("STO DEPE") || /\bSTO DEPE\b/.test(u)) return "DE"
    if (u.includes("STO APPW") || /\bSTO APPW\b/.test(u)) return "W"
    if (u.includes("STO APPE") || /\bSTO APPE\b/.test(u)) return "E"
    return undefined
}

function isTechSectorName(shortName: string): boolean {
    return shortName.toUpperCase().includes("TECH")
}

function considerAppDepOwnerChain(shortName: string, owners: string[]): void {
    const primary = appDepPrimarySiFromShortName(shortName)
    if (!primary || owners.length === 0) return
    const next = owners.map((o) => o.toUpperCase())
    const existing = appDepOwnerChains.get(primary)
    const tech = isTechSectorName(shortName)
    // Prefer longer OWNER lists; TECH breaks ties (coverage chain)
    if (!existing || next.length > existing.length || (next.length === existing.length && tech)) {
        appDepOwnerChains.set(primary, next)
    }
}

/**
 * When DEPE only has OWNER:DE, synthesize DE + APPE owners (mirrors DEPW = DW + APPW).
 */
function synthesizeDepeOwnerChain(): void {
    const de = appDepOwnerChains.get("DE")
    const appe = appDepOwnerChains.get("E")
    if (!appe || appe.length === 0) return
    if (de && de.length > 1) return // already have a real multi-SI chain
    const rest = appe[0] === "E" ? appe : ["E", ...appe.filter((s) => s !== "E")]
    appDepOwnerChains.set("DE", ["DE", ...rest.filter((s) => s !== "DE")])
}

/**
 * Load ESSA positions + airspace from the latest ESAA .ese file.
 */
export function loadEseAirspace(euroscopeDir: string, packageFilter?: string): {
    positionCount: number
    sectorCount: number
} {
    const eseFile = findEseFile(euroscopeDir, packageFilter)
    positionsBySi = new Map()
    positionsByCallsign = new Map()
    sectors = []
    appDepOwnerChains = new Map()
    gndOwnerChains = new Map()
    twrOwnerChains = new Map()
    loaded = false

    if (!eseFile) {
        console.warn("ESE airspace: no .ese file found")
        return { positionCount: 0, sectorCount: 0 }
    }

    const content = fs.readFileSync(eseFile, "latin1")
    const lines = content.split(/\r?\n/)

    let section: "none" | "positions" | "airspace" = "none"
    const sectorLines = new Map<number, EseCoord[]>()
    let currentLineId: number | undefined
    let currentLineCoords: EseCoord[] = []

    // Pending sector fields while parsing
    let curName = ""
    let curFloor = 0
    let curCeil = 0
    let curOwners: string[] = []
    let curBorder: number[] = []
    let curActive: { airport: string; runway: string } | undefined

    const flushSector = () => {
        if (!curName) return
        const shortName = shortSectorName(curName)
        // Capture APP/DEP OWNER chains even without polygons
        if (curOwners.length > 0) {
            considerAppDepOwnerChain(shortName, curOwners)
        }
        if (!isEssaGroundOrCtr(shortName)) {
            curName = ""
            curOwners = []
            curBorder = []
            curActive = undefined
            return
        }
        const poly = chainBorderPolygon(curBorder, sectorLines)
        if (poly.length < 3) {
            curName = ""
            curOwners = []
            curBorder = []
            curActive = undefined
            return
        }
        const { family, isSpecific } = classifySector(shortName)
        const specific = isSpecific || !!curActive
        sectors.push({
            name: curName,
            shortName,
            floorFt: curFloor,
            ceilingFt: curCeil,
            owners: curOwners,
            active: curActive,
            polygon: poly,
            family,
            isSpecific: specific,
            area: polygonArea(poly),
        })
        // Main GND volume OWNER (e.g. ESSA GNDN → AGN:AGW)
        if (
            !specific &&
            (family === "GE" || family === "GN" || family === "GW") &&
            curOwners.length > 0
        ) {
            const gndSis = curOwners.map((o) => o.toUpperCase()).filter((o) => GND_OWNER_SIS.has(o))
            if (gndSis.length > 0 && !gndOwnerChains.has(family)) {
                gndOwnerChains.set(family, gndSis)
            }
        }
        // Main CTR volume OWNER (e.g. ESSA CTRE → TE:TS:TW)
        if (
            !specific &&
            (family === "TE" || family === "TW" || family === "TS") &&
            curOwners.length > 0
        ) {
            const twrSis = curOwners.map((o) => o.toUpperCase()).filter((o) => TWR_OWNER_SIS.has(o))
            if (twrSis.length > 0 && !twrOwnerChains.has(family)) {
                twrOwnerChains.set(family, twrSis)
            }
        }
        curName = ""
        curOwners = []
        curBorder = []
        curActive = undefined
    }

    const flushLine = () => {
        if (currentLineId !== undefined && currentLineCoords.length > 0) {
            sectorLines.set(currentLineId, currentLineCoords)
        }
        currentLineId = undefined
        currentLineCoords = []
    }

    for (const raw of lines) {
        const line = raw.trim()
        if (!line || line.startsWith(";")) continue

        if (line.startsWith("[")) {
            flushLine()
            flushSector()
            const upper = line.toUpperCase()
            if (upper.startsWith("[POSITIONS]")) section = "positions"
            else if (upper.startsWith("[AIRSPACE]")) section = "airspace"
            else section = "none"
            continue
        }

        if (section === "positions") {
            // CALLSIGN:name:freq:SI:sub:airport:role:...
            const parts = line.split(":")
            if (parts.length < 7) continue
            const callsign = parts[0]!
            if (!callsign.startsWith("ESSA_")) continue
            const freq = parseFloat(parts[2]!)
            const si = parts[3]!
            const airport = parts[5]!
            const role = parts[6]!
            if (!si) continue
            const pos: EsePosition = {
                callsign,
                frequency: isNaN(freq) ? 0 : freq,
                si,
                airport,
                role,
            }
            positionsBySi.set(si.toUpperCase(), pos)
            positionsByCallsign.set(callsign.toUpperCase(), pos)
            continue
        }

        if (section === "airspace") {
            if (line.startsWith("SECTORLINE:")) {
                flushLine()
                flushSector()
                currentLineId = parseInt(line.substring(11), 10)
                currentLineCoords = []
                continue
            }
            if (line.startsWith("COORD:")) {
                const c = parseCoordLine(line)
                if (c && currentLineId !== undefined) currentLineCoords.push(c)
                continue
            }
            if (line.startsWith("DISPLAY:")) continue

            if (line.startsWith("SECTOR:")) {
                flushLine()
                flushSector()
                // SECTOR:name:floor:ceiling
                const parts = line.substring(7).split(":")
                curName = parts[0] ?? ""
                curFloor = parseInt(parts[1] ?? "0", 10) || 0
                curCeil = parseInt(parts[2] ?? "0", 10) || 0
                curOwners = []
                curBorder = []
                curActive = undefined
                continue
            }
            if (line.startsWith("OWNER:")) {
                curOwners = line
                    .substring(6)
                    .split(":")
                    .map((s) => s.trim())
                    .filter(Boolean)
                continue
            }
            if (line.startsWith("BORDER:")) {
                curBorder = line
                    .substring(7)
                    .split(":")
                    .map((s) => parseInt(s, 10))
                    .filter((n) => !isNaN(n))
                continue
            }
            if (line.startsWith("ACTIVE:")) {
                const parts = line.substring(7).split(":")
                if (parts.length >= 2) {
                    curActive = { airport: parts[0]!, runway: parts[1]! }
                }
                continue
            }
            if (
                line.startsWith("ALTOWNER:") ||
                line.startsWith("DEPAPT:") ||
                line.startsWith("ARRAPT:") ||
                line.startsWith("GUEST:")
            ) {
                continue
            }
        }
    }
    flushLine()
    flushSector()
    synthesizeDepeOwnerChain()

    loaded = sectors.length > 0 || positionsBySi.size > 0
    console.log(
        `Loaded ${positionsBySi.size} ESSA positions and ${sectors.length} ESSA airspace sectors from ${eseFile}` +
            (appDepOwnerChains.size
                ? `; APP/DEP OWNER chains: ${[...appDepOwnerChains.entries()].map(([k, v]) => `${k}=[${v.join(":")}]`).join(" ")}`
                : "") +
            (twrOwnerChains.size
                ? `; TWR OWNER chains: ${[...twrOwnerChains.entries()].map(([k, v]) => `${k}=[${v.join(":")}]`).join(" ")}`
                : "")
    )
    return { positionCount: positionsBySi.size, sectorCount: sectors.length }
}

export function isEseAirspaceLoaded(): boolean {
    return loaded
}

export function getEsePositionBySi(si: string | undefined): EsePosition | undefined {
    if (!si) return undefined
    return positionsBySi.get(si.toUpperCase())
}

export function getEsePositionByCallsign(callsign: string | undefined): EsePosition | undefined {
    if (!callsign) return undefined
    return positionsByCallsign.get(callsign.toUpperCase())
}

export function getAllEseSectors(): EseSector[] {
    return sectors
}

/**
 * ESE OWNER coverage chain for an ideal APP/DEP SI (DW/DE/W/E).
 * Falls back to [si] if unknown.
 */
export function getAppDepOwnerChain(idealSi: string): string[] {
    const u = idealSi.toUpperCase()
    const chain = appDepOwnerChains.get(u)
    if (chain && chain.length > 0) return [...chain]
    if (APP_DEP_SIS.has(u)) return [u]
    return []
}

/**
 * ESE OWNER chain for an ESSA GND family (AGE/AGN/AGW only).
 * Defaults: GE→AGE:AGW, GN→AGN:AGW, GW→AGW (matches ESAA main volumes).
 */
export function getGndOwnerChain(family: EssaGndFamily): string[] {
    const chain = gndOwnerChains.get(family)
    if (chain && chain.length > 0) return [...chain]
    switch (family) {
        case "GE":
            return ["AGE", "AGW"]
        case "GN":
            return ["AGN", "AGW"]
        case "GW":
            return ["AGW"]
    }
}

/**
 * ESE OWNER chain for an ESSA TWR/CTR family (TE/TW/TS only).
 * Defaults match ESAA main CTR volumes (CTRE→TE:TS:TW, etc.).
 */
export function getTwrOwnerChain(family: EssaCtrFamily): string[] {
    const chain = twrOwnerChains.get(family)
    if (chain && chain.length > 0) return [...chain]
    switch (family) {
        case "TE":
            return ["TE", "TS", "TW"]
        case "TS":
            return ["TS", "TE", "TW"]
        case "TW":
            return ["TW", "TE", "TS"]
    }
}

/** Test helper: inject GND OWNER chains */
export function __setGndOwnerChainsForTest(chains: Partial<Record<EssaGndFamily, string[]>>): void {
    gndOwnerChains = new Map(
        Object.entries(chains).map(([k, v]) => [k as EssaGndFamily, (v ?? []).map((s) => s.toUpperCase())])
    )
}

/** Test helper: inject TWR OWNER chains */
export function __setTwrOwnerChainsForTest(chains: Partial<Record<EssaCtrFamily, string[]>>): void {
    twrOwnerChains = new Map(
        Object.entries(chains).map(([k, v]) => [k as EssaCtrFamily, (v ?? []).map((s) => s.toUpperCase())])
    )
}

/** Test helper: inject OWNER chains without loading a full ESE */
export function __setAppDepOwnerChainsForTest(chains: Record<string, string[]>): void {
    appDepOwnerChains = new Map(
        Object.entries(chains).map(([k, v]) => [k.toUpperCase(), v.map((s) => s.toUpperCase())])
    )
}

/** Test helper: inject a single ESE position */
export function __setEsePositionForTest(pos: EsePosition): void {
    positionsBySi.set(pos.si.toUpperCase(), pos)
    positionsByCallsign.set(pos.callsign.toUpperCase(), pos)
}

export function getSectorCentroid(sector: EseSector): EseCoord {
    let lat = 0
    let lon = 0
    for (const c of sector.polygon) {
        lat += c.lat
        lon += c.lon
    }
    const n = sector.polygon.length || 1
    return { lat: lat / n, lon: lon / n }
}

export function findSectorByShortName(substring: string): EseSector | undefined {
    const u = substring.toUpperCase()
    return sectors.find((s) => s.shortName.toUpperCase().includes(u))
}

/**
 * Find ESSA GND/CTR sectors containing a point.
 * Filters ACTIVE runway gates against activeRunways when provided.
 */
export function findContainingSectors(
    lat: number,
    lon: number,
    options?: {
        families?: EssaSectorFamily[]
        activeRunways?: { arr: string[]; dep: string[] }
        airport?: string
    }
): EseSector[] {
    const airport = options?.airport ?? "ESSA"
    const active = new Set<string>()
    if (options?.activeRunways) {
        for (const r of options.activeRunways.arr) active.add(r.toUpperCase())
        for (const r of options.activeRunways.dep) active.add(r.toUpperCase())
    }

    const out: EseSector[] = []
    for (const s of sectors) {
        if (options?.families && !options.families.includes(s.family)) continue
        if (s.active) {
            if (s.active.airport.toUpperCase() !== airport.toUpperCase()) continue
            if (active.size > 0 && !active.has(s.active.runway.toUpperCase())) continue
        }
        if (pointInPolygon(lat, lon, s.polygon)) out.push(s)
    }

    // Prefer specific / ACTIVE / smaller area
    out.sort((a, b) => {
        if (a.isSpecific !== b.isSpecific) return a.isSpecific ? -1 : 1
        if (!!a.active !== !!b.active) return a.active ? -1 : 1
        return a.area - b.area
    })
    return out
}

export function primaryGndFamilyAt(
    lat: number,
    lon: number,
    activeRunways?: { arr: string[]; dep: string[] }
): EssaGndFamily | undefined {
    const hits = findContainingSectors(lat, lon, {
        families: ["GE", "GN", "GW"],
        activeRunways,
    })
    const fam = hits[0]?.family
    if (fam === "GE" || fam === "GN" || fam === "GW") return fam
    return undefined
}

export function primaryCtrFamilyAt(
    lat: number,
    lon: number,
    activeRunways?: { arr: string[]; dep: string[] }
): EssaCtrFamily | undefined {
    const hits = findContainingSectors(lat, lon, {
        families: ["TE", "TW", "TS"],
        activeRunways,
    })
    const fam = hits[0]?.family
    if (fam === "TE" || fam === "TW" || fam === "TS") return fam
    return undefined
}

/** Map SI → ESSA role family letter for hops */
export function siToGndFamily(si: string | undefined): EssaGndFamily | undefined {
    if (!si) return undefined
    const u = si.toUpperCase()
    if (u === "AGE") return "GE"
    if (u === "AGN") return "GN"
    if (u === "AGW") return "GW"
    return undefined
}

export function siToTwFamily(si: string | undefined): EssaCtrFamily | undefined {
    if (!si) return undefined
    const u = si.toUpperCase()
    if (u === "TE") return "TE"
    if (u === "TW") return "TW"
    if (u === "TS") return "TS"
    return undefined
}

export function gndFamilyPrimarySi(family: EssaGndFamily): string {
    switch (family) {
        case "GE":
            return "AGE"
        case "GN":
            return "AGN"
        case "GW":
            return "AGW"
    }
}

export function twFamilyPrimarySi(family: EssaCtrFamily): string {
    return family
}

/** Bearing degrees from a→b (0=N) */
export function bearingDeg(a: EseCoord, b: EseCoord): number {
    const φ1 = (a.lat * Math.PI) / 180
    const φ2 = (b.lat * Math.PI) / 180
    const Δλ = ((b.lon - a.lon) * Math.PI) / 180
    const y = Math.sin(Δλ) * Math.cos(φ2)
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
    return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

export function angleDiffDeg(a: number, b: number): number {
    let d = Math.abs(a - b) % 360
    if (d > 180) d = 360 - d
    return d
}

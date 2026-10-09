/**
 * Parse transition altitudes + APPCLR from TopSkyAirspace.txt (GNG / ESAA Plugins).
 *
 * Sources in file:
 *   QNHTL:ES:... //ES5000          → default TA 5000 for ICAO prefix ES
 *   QNHTL:ESKS,...:... //ES6000    → TA 6000 for listed airports
 *   TA_CIRCLE:9000:... //ESUT      → TA 9000 near that airport (comment ICAO)
 *   APPCLR:Icao:Rwy:AppTypes       → extra CFL-menu approach types (CAT2, CAT3, OS, …)
 */

import fs from "fs"
import path from "path"
import { DEFAULT_TRANSITION_ALTITUDE_FT } from "@vatefs/common"

let defaultTransitionAltitudeFt = DEFAULT_TRANSITION_ALTITUDE_FT
/** ICAO → TA feet */
const airportTa = new Map<string, number>()

export interface AppClrEntry {
    icao: string
    rwy: string
    types: string[]
}

/** Raw APPCLR rows from TopSkyAirspace.txt */
const appClrEntries: AppClrEntry[] = []

function parseEsTaComment(comment: string | undefined): number | undefined {
    if (!comment) return undefined
    const m = comment.match(/ES(\d{3,5})\b/i)
    if (!m) return undefined
    const n = parseInt(m[1], 10)
    return Number.isFinite(n) && n > 0 ? n : undefined
}

/**
 * Load TopSkyAirspace.txt from EuroScope ESAA/Plugins.
 */
export function loadTopSkyAirspace(euroscopeDir: string): {
    defaultTaFt: number
    airportCount: number
} {
    airportTa.clear()
    appClrEntries.length = 0
    defaultTransitionAltitudeFt = DEFAULT_TRANSITION_ALTITUDE_FT

    const file = path.join(euroscopeDir, "ESAA", "Plugins", "TopSkyAirspace.txt")
    if (!fs.existsSync(file)) {
        console.log(`TopSkyAirspace.txt not found: ${file} (using TA ${defaultTransitionAltitudeFt} ft)`)
        return { defaultTaFt: defaultTransitionAltitudeFt, airportCount: 0 }
    }

    const content = fs.readFileSync(file, "latin1")
    for (const rawLine of content.split(/\r?\n/)) {
        const hash = rawLine.indexOf("//")
        const line = (hash >= 0 ? rawLine.slice(0, hash) : rawLine).trim()
        const comment = hash >= 0 ? rawLine.slice(hash + 2).trim() : ""
        if (!line) continue

        if (line.startsWith("APPCLR:")) {
            const parts = line.split(":")
            if (parts.length < 4) continue
            const icao = (parts[1] || "").trim().toUpperCase()
            const rwy = (parts[2] || "").trim().toUpperCase()
            const types = (parts[3] || "")
                .split(",")
                .map((t) => t.trim().toUpperCase())
                .filter((t) => t.length >= 1 && t.length <= 4)
            if (!icao || !rwy || types.length === 0) continue
            appClrEntries.push({ icao, rwy, types })
            continue
        }

        if (line.startsWith("QNHTL:")) {
            const parts = line.split(":")
            if (parts.length < 3) continue
            const taFromComment = parseEsTaComment(comment)
            if (taFromComment == null) continue
            const keys = parts[1].split(",").map((k) => k.trim().toUpperCase()).filter(Boolean)
            for (const key of keys) {
                if (key === "ES") {
                    defaultTransitionAltitudeFt = taFromComment
                } else if (/^[A-Z]{4}$/.test(key)) {
                    airportTa.set(key, taFromComment)
                }
            }
            continue
        }

        if (line.startsWith("TA_CIRCLE:")) {
            const parts = line.split(":")
            const ta = parseInt(parts[1], 10)
            if (!Number.isFinite(ta) || ta <= 0) continue
            // Prefer explicit ICAO in comment (//ESUT)
            const icaoFromComment = comment.match(/\b([A-Z]{4})\b/)
            if (icaoFromComment) {
                airportTa.set(icaoFromComment[1], ta)
            }
        }
    }

    console.log(
        `TopSky transition altitude: default ${defaultTransitionAltitudeFt} ft` +
            (airportTa.size ? `, ${airportTa.size} airport override(s)` : "") +
            (appClrEntries.length ? `, ${appClrEntries.length} APPCLR row(s)` : "") +
            ` (from ${file})`,
    )
    return { defaultTaFt: defaultTransitionAltitudeFt, airportCount: airportTa.size }
}

/** Transition altitude (ft) for an airport ICAO, or Swedish default. */
export function getTransitionAltitudeFt(airport?: string | null): number {
    if (airport) {
        const icao = airport.toUpperCase()
        const specific = airportTa.get(icao)
        if (specific != null) return specific
    }
    return defaultTransitionAltitudeFt
}

export function getDefaultTransitionAltitudeFt(): number {
    return defaultTransitionAltitudeFt
}

/**
 * Resolve APPCLR approach types for an arrival (TopSky order):
 * runway-specific → airport-specific (`Rwy=*`) → global (`Icao=*` and `Rwy=*`).
 * COOPANS always includes OS when not already listed.
 */
export function getAppClrTypes(airport?: string | null, runway?: string | null): string[] {
    const icao = (airport || "").trim().toUpperCase()
    const rwy = (runway || "").trim().toUpperCase().replace(/^RWY/, "")

    let types: string[] | undefined

    if (icao && rwy && icao !== "*") {
        const rwyHit = appClrEntries.find((e) => e.icao === icao && e.rwy === rwy)
        if (rwyHit) types = rwyHit.types
    }
    if (!types && icao && icao !== "*") {
        const aptHit = appClrEntries.find((e) => e.icao === icao && e.rwy === "*")
        if (aptHit) types = aptHit.types
    }
    if (!types) {
        const globalHit = appClrEntries.find((e) => e.icao === "*" && e.rwy === "*")
        if (globalHit) types = globalHit.types
    }

    const out = [...(types ?? [])]
    // COOPANS default: Own Separation always selectable
    if (!out.includes("OS")) out.push("OS")
    return out
}

/** Test helper — replace APPCLR table. */
export function _setAppClrEntriesForTest(entries: AppClrEntry[]): void {
    appClrEntries.length = 0
    appClrEntries.push(...entries)
}

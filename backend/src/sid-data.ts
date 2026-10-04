/**
 * SID and COPX data parsing from EuroScope .ese sector files.
 *
 * Extracts SID definitions and coordination point (COPX) altitude data
 * to support SID selection and automatic cleared flight level setting.
 */

import fs from "fs"
import path from "path"

export interface SidInfo {
    name: string
    waypoints: string[]
}

/** SIDs indexed by airport -> runway -> SidInfo[] */
let sids: Map<string, Map<string, SidInfo[]>> = new Map()

/** COPX altitudes indexed by airport -> fix -> altitude (feet) */
let copx: Map<string, Map<string, number>> = new Map()

/**
 * Find the latest .ese file in the EuroScope directory (by modification time).
 * Scans the root directory and immediate subdirectories.
 * If packageFilter is provided, only considers files whose path contains it (e.g. 'ESAA').
 */
function findEseFile(euroscopeDir: string, packageFilter?: string): string | undefined {
    let latestFile: string | undefined
    let latestMtime = 0

    function scanDir(dir: string) {
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true })
            for (const entry of entries) {
                if (entry.isFile() && entry.name.endsWith('.ese')) {
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
            // Directory doesn't exist or can't be read
        }
    }

    // Scan root and subdirectories
    scanDir(euroscopeDir)
    try {
        const entries = fs.readdirSync(euroscopeDir, { withFileTypes: true })
        for (const entry of entries) {
            if (entry.isDirectory()) {
                scanDir(path.join(euroscopeDir, entry.name))
            }
        }
    } catch {
        // Can't read euroscope dir
    }

    return latestFile
}

/**
 * Load SID and COPX data from the latest .ese file in the EuroScope directory.
 * Returns counts of loaded SIDs and COPX entries.
 */
export function loadSidData(euroscopeDir: string, packageFilter?: string): { sidCount: number; copxCount: number } {
    const eseFile = findEseFile(euroscopeDir, packageFilter)
    if (!eseFile) {
        console.warn('No .ese sector file found')
        return { sidCount: 0, copxCount: 0 }
    }

    // Read with latin1 encoding (ISO-8859-1) as EuroScope uses this encoding
    const content = fs.readFileSync(eseFile, 'latin1')
    const lines = content.split('\n')

    sids = new Map()
    copx = new Map()
    let sidCount = 0
    let copxCount = 0

    for (const rawLine of lines) {
        const line = rawLine.trim()

        // Parse SID lines: SID:<airport>:<runway>:<name>:<waypoint1> <waypoint2> ...
        if (line.startsWith('SID:')) {
            const parts = line.substring(4).split(':')
            if (parts.length >= 4) {
                const airport = parts[0]
                const runway = parts[1]
                const name = parts[2]
                const waypointsStr = parts[3]
                const waypoints = waypointsStr.split(' ').filter(w => w.length > 0)

                if (!sids.has(airport)) {
                    sids.set(airport, new Map())
                }
                const airportSids = sids.get(airport)!
                if (!airportSids.has(runway)) {
                    airportSids.set(runway, [])
                }
                airportSids.get(runway)!.push({ name, waypoints })
                sidCount++
            }
        }

        // Parse COPX lines: fields separated by ':'
        // Field 0: COPX, field 1: airport (departure), field 2: *, field 3: fix, field 8: climb altitude
        if (line.startsWith('COPX:')) {
            const parts = line.substring(5).split(':')
            if (parts.length >= 9) {
                const airport = parts[0]
                const fix = parts[2] // field index 3 from original line (index 2 after removing 'COPX:')
                const altStr = parts[7] // field index 8 from original line (index 7 after removing 'COPX:')
                const altitude = parseInt(altStr, 10)

                if (fix && !isNaN(altitude) && altStr !== '*') {
                    if (!copx.has(airport)) {
                        copx.set(airport, new Map())
                    }
                    copx.get(airport)!.set(fix, altitude)
                    copxCount++
                }
            }
        }
    }

    console.log(`Loaded ${sidCount} SIDs and ${copxCount} COPX entries from ${eseFile}`)
    return { sidCount, copxCount }
}

/**
 * Get all SIDs for a specific airport and runway.
 * Matches ES runway ids (e.g. 19R) against ESE keys that may omit L/R/C (19).
 */
export function getSidsForRunway(airport: string, runway: string): SidInfo[] {
    const airportSids = sids.get(airport)
    if (!airportSids || !runway) return []

    const exact = airportSids.get(runway)
    if (exact && exact.length > 0) return exact

    const base = runway.replace(/[LRC]$/i, "")
    const suffix = /[LRC]$/i.test(runway) ? runway.slice(-1).toUpperCase() : ""

    // ESE often lists "19" while EuroScope reports "19R"
    if (base !== runway) {
        const byBase = airportSids.get(base)
        if (byBase && byBase.length > 0) return byBase
    }

    // ESE lists "19R" while strip has "19"
    if (!suffix) {
        for (const s of ["L", "R", "C"] as const) {
            const bySuffix = airportSids.get(base + s)
            if (bySuffix && bySuffix.length > 0) return bySuffix
        }
    }

    // Collect every ESE key that shares the same runway number
    const merged: SidInfo[] = []
    const seen = new Set<string>()
    for (const [key, list] of airportSids) {
        if (key.replace(/[LRC]$/i, "") !== base) continue
        for (const sid of list) {
            if (seen.has(sid.name)) continue
            seen.add(sid.name)
            merged.push(sid)
        }
    }
    return merged
}

/**
 * True if `sidName` exists in the ESE SID list for the airport
 * (any runway, or the given runway when provided).
 */
export function hasSidInEse(airport: string, sidName: string, runway?: string): boolean {
    return getSidInfo(airport, sidName, runway) !== undefined
}

/**
 * Look up SID definition from ESE data.
 */
export function getSidInfo(airport: string, sidName: string, runway?: string): SidInfo | undefined {
    if (!airport || !sidName) return undefined
    const airportSids = sids.get(airport)
    if (!airportSids) return undefined

    if (runway) {
        const forRwy = getSidsForRunway(airport, runway)
        const match = forRwy.find(s => s.name === sidName)
        if (match) return match
    }

    for (const [, runwaySids] of airportSids) {
        const match = runwaySids.find(s => s.name === sidName)
        if (match) return match
    }
    return undefined
}

/**
 * Resolve the initial departure altitude for a SID by finding the first
 * waypoint that has a COPX entry for the same airport.
 *
 * This naturally returns the CTR→APP coordination altitude since early
 * waypoints in the SID are the initial coordination fixes.
 */
export function getSidAltitude(airport: string, sidName: string): number | undefined {
    const airportSids = sids.get(airport)
    if (!airportSids) return undefined

    // Find the SID across all runways (same SID name may appear on multiple runways)
    let sidInfo: SidInfo | undefined
    for (const [, runwaySids] of airportSids) {
        sidInfo = runwaySids.find(s => s.name === sidName)
        if (sidInfo) break
    }

    if (!sidInfo) return undefined

    // Look up COPX entries for this airport
    const airportCopx = copx.get(airport)
    if (!airportCopx) return undefined

    // Find the first waypoint with a COPX entry
    for (const waypoint of sidInfo.waypoints) {
        const altitude = airportCopx.get(waypoint)
        if (altitude !== undefined) {
            return altitude
        }
    }

    return undefined
}

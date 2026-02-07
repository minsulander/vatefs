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
 */
function findEseFile(euroscopeDir: string): string | undefined {
    let latestFile: string | undefined
    let latestMtime = 0

    function scanDir(dir: string) {
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true })
            for (const entry of entries) {
                if (entry.isFile() && entry.name.endsWith('.ese')) {
                    const fullPath = path.join(dir, entry.name)
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
export function loadSidData(euroscopeDir: string): { sidCount: number; copxCount: number } {
    const eseFile = findEseFile(euroscopeDir)
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
 */
export function getSidsForRunway(airport: string, runway: string): SidInfo[] {
    return sids.get(airport)?.get(runway) ?? []
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

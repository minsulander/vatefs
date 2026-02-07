/**
 * Stand data loading and lookup from EuroScope GRplugin stand files.
 *
 * Parses GRpluginStands.txt to extract stand polygons/coordinates,
 * then provides position-based stand lookup for aircraft at gates.
 */

import fs from "fs"
import path from "path"

export interface Stand {
    name: string
    coords: { lat: number; lon: number }[]
}

/** Loaded stands indexed by airport ICAO code */
let stands: Map<string, Stand[]> = new Map()

/**
 * Parse a DMS coordinate string like "N059.39.07.320:E017.55.50.403"
 * to decimal degrees { lat, lon }.
 */
function parseDmsCoord(coordStr: string): { lat: number; lon: number } | undefined {
    const parts = coordStr.split(':')
    if (parts.length !== 2) return undefined

    const lat = parseDmsPart(parts[0])
    const lon = parseDmsPart(parts[1])

    if (lat === undefined || lon === undefined) return undefined
    return { lat, lon }
}

/**
 * Parse a single DMS part like "N059.39.07.320" or "E017.55.50.403"
 * Format: <direction><degrees>.<minutes>.<seconds>.<fractional_seconds>
 */
function parseDmsPart(part: string): number | undefined {
    if (part.length < 2) return undefined

    const dir = part[0]
    const rest = part.substring(1)
    const segments = rest.split('.')

    if (segments.length < 3) return undefined

    const degrees = parseInt(segments[0], 10)
    const minutes = parseInt(segments[1], 10)
    // Seconds with optional fractional part
    const seconds = segments.length >= 4
        ? parseInt(segments[2], 10) + parseInt(segments[3], 10) / Math.pow(10, segments[3].length)
        : parseInt(segments[2], 10)

    if (isNaN(degrees) || isNaN(minutes) || isNaN(seconds)) return undefined

    let decimal = degrees + minutes / 60 + seconds / 3600

    if (dir === 'S' || dir === 'W') {
        decimal = -decimal
    }

    return decimal
}

/**
 * Find GRpluginStands.txt by recursively scanning the EuroScope directory.
 */
function findStandFile(euroscopeDir: string): string | undefined {
    const filename = 'GRpluginStands.txt'

    // Check directly in euroscopeDir
    const directPath = path.join(euroscopeDir, filename)
    if (fs.existsSync(directPath)) return directPath

    // Recursively scan subdirectories (typically found in e.g. ESAA/Plugins/)
    function searchDir(dir: string, depth: number): string | undefined {
        if (depth > 3) return undefined
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true })
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    const subPath = path.join(dir, entry.name, filename)
                    if (fs.existsSync(subPath)) return subPath
                    const deeper = searchDir(path.join(dir, entry.name), depth + 1)
                    if (deeper) return deeper
                }
            }
        } catch {
            // Directory doesn't exist or can't be read
        }
        return undefined
    }

    return searchDir(euroscopeDir, 0)
}

/**
 * Load stands from a GRpluginStands.txt file found in the EuroScope directory.
 * Returns the number of stands loaded.
 */
export function loadStands(euroscopeDir: string): number {
    const standFile = findStandFile(euroscopeDir)
    if (!standFile) {
        console.warn('Stand file (GRpluginStands.txt) not found')
        return 0
    }

    const content = fs.readFileSync(standFile, 'utf8')
    const lines = content.split('\n')

    stands = new Map()
    let currentAirport: string | undefined
    let currentStand: Stand | undefined
    let count = 0

    for (const rawLine of lines) {
        const line = rawLine.trim()
        if (!line || line.startsWith('//')) continue

        if (line.startsWith('STAND:')) {
            // Save previous stand
            if (currentStand && currentAirport && currentStand.coords.length > 0) {
                if (!stands.has(currentAirport)) {
                    stands.set(currentAirport, [])
                }
                stands.get(currentAirport)!.push(currentStand)
                count++
            }

            // Parse STAND:<airport>:<name>
            const parts = line.substring(6).split(':')
            if (parts.length >= 2) {
                currentAirport = parts[0]
                currentStand = { name: parts[1], coords: [] }
            } else {
                currentAirport = undefined
                currentStand = undefined
            }
        } else if (line.startsWith('COORD:') && currentStand) {
            const coordStr = line.substring(6).trim()
            const coord = parseDmsCoord(coordStr)
            if (coord) {
                currentStand.coords.push(coord)
            }
        } else {
            // Non-COORD line: finalize current stand
            if (currentStand && currentAirport && currentStand.coords.length > 0) {
                if (!stands.has(currentAirport)) {
                    stands.set(currentAirport, [])
                }
                stands.get(currentAirport)!.push(currentStand)
                count++
            }
            currentStand = undefined
            currentAirport = undefined
        }
    }

    // Don't forget the last stand
    if (currentStand && currentAirport && currentStand.coords.length > 0) {
        if (!stands.has(currentAirport)) {
            stands.set(currentAirport, [])
        }
        stands.get(currentAirport)!.push(currentStand)
        count++
    }

    console.log(`Loaded ${count} stands for ${stands.size} airports from ${standFile}`)
    return count
}

/**
 * Ray-casting point-in-polygon test.
 * Returns true if the point (lat, lon) is inside the polygon defined by coords.
 */
function pointInPolygon(lat: number, lon: number, polygon: { lat: number; lon: number }[]): boolean {
    let inside = false
    const n = polygon.length

    for (let i = 0, j = n - 1; i < n; j = i++) {
        const yi = polygon[i].lat
        const xi = polygon[i].lon
        const yj = polygon[j].lat
        const xj = polygon[j].lon

        if (((yi > lat) !== (yj > lat)) &&
            (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) {
            inside = !inside
        }
    }

    return inside
}

/**
 * Calculate approximate distance in meters between two coordinates.
 * Uses simple equirectangular approximation (good enough for <1km).
 */
function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371000 // Earth radius in meters
    const dLat = (lat2 - lat1) * Math.PI / 180
    const dLon = (lon2 - lon1) * Math.PI / 180
    const avgLat = (lat1 + lat2) / 2 * Math.PI / 180

    const dx = dLon * Math.cos(avgLat) * R
    const dy = dLat * R

    return Math.sqrt(dx * dx + dy * dy)
}

/**
 * Find the stand for a given aircraft position at an airport.
 *
 * For polygon stands (>= 3 coords): uses ray-casting point-in-polygon test.
 * For single/double-coord stands: finds the nearest one within 100 meters.
 *
 * Returns the stand name, or undefined if no match.
 */
export function findStandForPosition(airport: string, lat: number, lon: number): string | undefined {
    const airportStands = stands.get(airport)
    if (!airportStands) return undefined

    // First check polygon stands
    for (const stand of airportStands) {
        if (stand.coords.length >= 3) {
            if (pointInPolygon(lat, lon, stand.coords)) {
                return stand.name
            }
        }
    }

    // Then check single/double-coord stands (nearest within 100m)
    let nearestName: string | undefined
    let nearestDist = 100 // max distance in meters

    for (const stand of airportStands) {
        if (stand.coords.length >= 1 && stand.coords.length <= 2) {
            for (const coord of stand.coords) {
                const dist = distanceMeters(lat, lon, coord.lat, coord.lon)
                if (dist < nearestDist) {
                    nearestDist = dist
                    nearestName = stand.name
                }
            }
        }
    }

    return nearestName
}

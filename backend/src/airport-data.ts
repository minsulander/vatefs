/**
 * Airport data loading and lookup from CSV files.
 */

import fs from "fs"

/**
 * Airport data structure matching the CSV format.
 */
export interface Airport {
    ident: string
    name: string
    latitude_deg: number
    longitude_deg: number
    elevation_ft: number | null
    type: string
}

/** Loaded airports indexed by ICAO code */
let airports: Map<string, Airport> = new Map()

/**
 * Parse a CSV line with proper quote handling.
 * Handles quoted fields containing commas.
 */
function parseCSVLine(line: string): string[] {
    const fields: string[] = []
    let current = ''
    let inQuotes = false

    for (let i = 0; i < line.length; i++) {
        const char = line[i]

        if (char === '"') {
            if (inQuotes && line[i + 1] === '"') {
                // Escaped quote
                current += '"'
                i++
            } else {
                // Toggle quote mode
                inQuotes = !inQuotes
            }
        } else if (char === ',' && !inQuotes) {
            fields.push(current)
            current = ''
        } else {
            current += char
        }
    }
    fields.push(current)

    return fields
}

/**
 * Load airports from a CSV file.
 * Expected columns: id, ident, type, name, latitude_deg, longitude_deg, elevation_ft, ...
 */
export function loadAirports(csvPath: string): number {
    const content = fs.readFileSync(csvPath, 'utf8')
    const lines = content.split('\n')

    if (lines.length < 2) {
        console.warn('Airport CSV file is empty or missing header')
        return 0
    }

    // Parse header to find column indices
    const header = parseCSVLine(lines[0])
    const identIdx = header.indexOf('ident')
    const nameIdx = header.indexOf('name')
    const latIdx = header.indexOf('latitude_deg')
    const lonIdx = header.indexOf('longitude_deg')
    const elevIdx = header.indexOf('elevation_ft')
    const typeIdx = header.indexOf('type')

    if (identIdx === -1 || latIdx === -1 || lonIdx === -1) {
        console.warn('Airport CSV missing required columns (ident, latitude_deg, longitude_deg)')
        return 0
    }

    airports = new Map()

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim()
        if (!line) continue

        const fields = parseCSVLine(line)

        const ident = fields[identIdx]
        const lat = parseFloat(fields[latIdx])
        const lon = parseFloat(fields[lonIdx])

        if (!ident || isNaN(lat) || isNaN(lon)) continue

        const elevation = elevIdx !== -1 ? parseFloat(fields[elevIdx]) : null

        airports.set(ident, {
            ident,
            name: nameIdx !== -1 ? fields[nameIdx] : '',
            latitude_deg: lat,
            longitude_deg: lon,
            elevation_ft: isNaN(elevation!) ? null : elevation,
            type: typeIdx !== -1 ? fields[typeIdx] : ''
        })
    }

    console.log(`Loaded ${airports.size} airports from ${csvPath}`)
    return airports.size
}

/**
 * Get an airport by its ICAO code.
 */
export function getAirportByIcao(icao: string): Airport | undefined {
    return airports.get(icao)
}

/**
 * Get airport coordinates by ICAO code (for use with geo-utils).
 */
export function getAirportCoords(icao: string): { latitude: number; longitude: number } | undefined {
    const airport = airports.get(icao)
    if (airport) {
        return {
            latitude: airport.latitude_deg,
            longitude: airport.longitude_deg
        }
    }
    return undefined
}

/**
 * Get the field elevation for an airport.
 * Returns the elevation in feet, or undefined if not found.
 */
export function getAirportElevation(icao: string): number | undefined {
    const airport = airports.get(icao)
    if (airport && airport.elevation_ft !== null) {
        return airport.elevation_ft
    }
    return undefined
}

/**
 * Check if airport data has been loaded.
 */
export function isAirportDataLoaded(): boolean {
    return airports.size > 0
}

/**
 * Get the number of loaded airports.
 */
export function getAirportCount(): number {
    return airports.size
}

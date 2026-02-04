/**
 * Runway data loading and lookup from CSV files.
 */

import fs from "fs"

/**
 * Runway data structure matching the CSV format.
 */
export interface Runway {
    id: number
    airport_ident: string
    length_ft: number | null
    width_ft: number | null
    surface: string
    lighted: boolean
    closed: boolean
    le_ident: string
    le_latitude_deg: number | null
    le_longitude_deg: number | null
    le_elevation_ft: number | null
    le_heading_degT: number | null
    he_ident: string
    he_latitude_deg: number | null
    he_longitude_deg: number | null
    he_elevation_ft: number | null
    he_heading_degT: number | null
}

/** Loaded runways indexed by airport ICAO code */
let runwaysByAirport: Map<string, Runway[]> = new Map()

/**
 * Parse a CSV line with proper quote handling.
 */
function parseCSVLine(line: string): string[] {
    const fields: string[] = []
    let current = ''
    let inQuotes = false

    for (let i = 0; i < line.length; i++) {
        const char = line[i]

        if (char === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"'
                i++
            } else {
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
 * Load runways from a CSV file.
 */
export function loadRunways(csvPath: string): number {
    const content = fs.readFileSync(csvPath, 'utf8')
    const lines = content.split('\n')

    if (lines.length < 2) {
        console.warn('Runway CSV file is empty or missing header')
        return 0
    }

    // Parse header to find column indices
    const header = parseCSVLine(lines[0])
    const idIdx = header.indexOf('id')
    const airportIdentIdx = header.indexOf('airport_ident')
    const lengthIdx = header.indexOf('length_ft')
    const widthIdx = header.indexOf('width_ft')
    const surfaceIdx = header.indexOf('surface')
    const lightedIdx = header.indexOf('lighted')
    const closedIdx = header.indexOf('closed')
    const leIdentIdx = header.indexOf('le_ident')
    const leLatIdx = header.indexOf('le_latitude_deg')
    const leLonIdx = header.indexOf('le_longitude_deg')
    const leElevIdx = header.indexOf('le_elevation_ft')
    const leHdgIdx = header.indexOf('le_heading_degT')
    const heIdentIdx = header.indexOf('he_ident')
    const heLatIdx = header.indexOf('he_latitude_deg')
    const heLonIdx = header.indexOf('he_longitude_deg')
    const heElevIdx = header.indexOf('he_elevation_ft')
    const heHdgIdx = header.indexOf('he_heading_degT')

    if (airportIdentIdx === -1) {
        console.warn('Runway CSV missing required column (airport_ident)')
        return 0
    }

    runwaysByAirport = new Map()
    let count = 0

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim()
        if (!line) continue

        const fields = parseCSVLine(line)

        const airportIdent = fields[airportIdentIdx]
        if (!airportIdent) continue

        const parseNum = (idx: number): number | null => {
            if (idx === -1) return null
            const val = parseFloat(fields[idx])
            return isNaN(val) ? null : val
        }

        const parseBool = (idx: number): boolean => {
            if (idx === -1) return false
            return fields[idx] === '1' || fields[idx].toLowerCase() === 'true'
        }

        const runway: Runway = {
            id: parseNum(idIdx) ?? 0,
            airport_ident: airportIdent,
            length_ft: parseNum(lengthIdx),
            width_ft: parseNum(widthIdx),
            surface: surfaceIdx !== -1 ? fields[surfaceIdx] : '',
            lighted: parseBool(lightedIdx),
            closed: parseBool(closedIdx),
            le_ident: leIdentIdx !== -1 ? fields[leIdentIdx] : '',
            le_latitude_deg: parseNum(leLatIdx),
            le_longitude_deg: parseNum(leLonIdx),
            le_elevation_ft: parseNum(leElevIdx),
            le_heading_degT: parseNum(leHdgIdx),
            he_ident: heIdentIdx !== -1 ? fields[heIdentIdx] : '',
            he_latitude_deg: parseNum(heLatIdx),
            he_longitude_deg: parseNum(heLonIdx),
            he_elevation_ft: parseNum(heElevIdx),
            he_heading_degT: parseNum(heHdgIdx)
        }

        if (!runwaysByAirport.has(airportIdent)) {
            runwaysByAirport.set(airportIdent, [])
        }
        runwaysByAirport.get(airportIdent)!.push(runway)
        count++
    }

    console.log(`Loaded ${count} runways for ${runwaysByAirport.size} airports from ${csvPath}`)
    return count
}

/**
 * Get all runways for an airport by ICAO code.
 */
export function getRunwaysByAirport(icao: string): Runway[] {
    return runwaysByAirport.get(icao) ?? []
}

/**
 * Check if runway data has been loaded.
 */
export function isRunwayDataLoaded(): boolean {
    return runwaysByAirport.size > 0
}

/**
 * Get the number of loaded runways.
 */
export function getRunwayCount(): number {
    let count = 0
    runwaysByAirport.forEach(runways => count += runways.length)
    return count
}

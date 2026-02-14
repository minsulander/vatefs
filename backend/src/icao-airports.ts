/**
 * ICAO airport name lookup.
 * Parses ICAO_Airports.txt (tab-separated: ICAO\tNAME\tCOUNTRY, skip ; comment lines)
 */

import fs from "fs"

const airportNames: Map<string, string> = new Map()

/**
 * Load ICAO airport names from a tab-separated file.
 */
export function loadIcaoAirports(filePath: string) {
    if (!fs.existsSync(filePath)) {
        console.warn(`ICAO airports file not found: ${filePath}`)
        return
    }

    const content = fs.readFileSync(filePath, "utf-8")
    const lines = content.split("\n")
    let count = 0

    for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith(";")) continue

        const parts = trimmed.split("\t")
        if (parts.length >= 2) {
            airportNames.set(parts[0]!, parts[1]!)
            count++
        }
    }

    console.log(`Loaded ${count} ICAO airport names`)
}

/**
 * Get the full name for an ICAO airport code.
 */
export function getIcaoAirportName(icao: string): string | undefined {
    return airportNames.get(icao)
}

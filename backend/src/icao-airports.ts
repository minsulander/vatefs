/**
 * ICAO airport name/country lookup.
 * Parses ICAO_Airports.txt (tab-separated: ICAO\tNAME\tCOUNTRY, skip ; comment lines)
 */

import fs from "fs"

export interface IcaoAirportInfo {
    name: string
    country?: string
}

const airportInfo: Map<string, IcaoAirportInfo> = new Map()

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
        if (parts.length >= 2 && parts[0] && parts[1]) {
            const country = parts[2]?.trim() || undefined
            airportInfo.set(parts[0], { name: parts[1], country })
            count++
        }
    }

    console.log(`Loaded ${count} ICAO airport names`)
}

/**
 * Get the full name for an ICAO airport code.
 */
export function getIcaoAirportName(icao: string): string | undefined {
    return airportInfo.get(icao)?.name
}

/**
 * Get the country for an ICAO airport code.
 */
export function getIcaoAirportCountry(icao: string): string | undefined {
    return airportInfo.get(icao)?.country
}

/**
 * Get name + country for an ICAO airport code.
 */
export function getIcaoAirportInfo(icao: string): IcaoAirportInfo | undefined {
    return airportInfo.get(icao)
}

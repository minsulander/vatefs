/**
 * Airports where LVP is announced via ATIS / vATIS (AIRPORT CONDITIONS).
 * These get an LVP info strip (auto when ATIS text contains LVP).
 *
 * From VATSIM Scandinavia LOP (new wiki format):
 * - ESGG, ESMS, ESSB — "LVP is added to the AIRPORT CONDITIONS field in vATIS"
 * - ESKN, ESNN — "announced by/via ATIS"
 *
 * ESSA: legacy LOP not yet in the new wiki dump, but LVP is announced via ATIS
 * the same way — include it for detection + strip availability.
 *
 * Many other LOPs define LVP procedures but do not mention ATIS announcement —
 * those do not get an auto LVP strip.
 */
export const ATIS_LVP_AIRPORTS = [
    "ESGG",
    "ESKN",
    "ESMS",
    "ESNN",
    "ESSA",
    "ESSB",
] as const

export type AtisLvpAirport = (typeof ATIS_LVP_AIRPORTS)[number]

export function isAtisLvpAirport(icao: string | undefined | null): boolean {
    if (!icao) return false
    const u = icao.toUpperCase()
    return (ATIS_LVP_AIRPORTS as readonly string[]).includes(u)
}

/** True when ATIS text mentions LVP (word boundary). */
export function atisTextHasLvp(text: string | undefined | null): boolean {
    if (!text) return false
    return /\bLVP\b/i.test(text)
}

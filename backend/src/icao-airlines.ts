/**
 * ICAO airline telephony (RTF) lookup + FPL RMK callsign parsing.
 * Parses ICAO_Airlines.txt (tab-separated: CODE\tNAME\tTELEPHONY\tCOUNTRY, skip ; comment lines)
 *
 * FPL remarks parsing matches VATScout extractCallsign (CALLSIGN / CS/ / C/S).
 */

import fs from "fs"

const airlineTelephony: Map<string, string> = new Map()

/**
 * Load ICAO airline telephony designators from a tab-separated file.
 */
export function loadIcaoAirlines(filePath: string) {
    if (!fs.existsSync(filePath)) {
        console.warn(`ICAO airlines file not found: ${filePath}`)
        return
    }

    const content = fs.readFileSync(filePath, "utf-8")
    const lines = content.split("\n")
    let count = 0

    for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith(";")) continue

        const parts = trimmed.split("\t")
        if (parts.length >= 3 && parts[0] && parts[2]) {
            airlineTelephony.set(parts[0], parts[2])
            count++
        }
    }

    console.log(`Loaded ${count} ICAO airline telephony designators`)
}

/**
 * Extract telephony callsign from FPL item 18 remarks (VATScout-compatible).
 * Recognises CALLSIGN IS / CALLSIGN/=_ / C/S=_ / CS/
 * Captures only the first token (e.g. CALLSIGN/BLUESCAN ... → BLUESCAN).
 */
export function extractRtfFromFplRemarks(remarks: string): string | undefined {
    // Pad so \W can match at start of remarks (same trick as needing a boundary)
    const padded = ` ${remarks}`
    if (!padded.includes("CALLSIGN") && !padded.includes("CS/") && !padded.includes("C/S")) {
        return undefined
    }

    const m = padded.match(/(\WCALLSIGN IS |\WCALLSIGN[/=_ ]+|\WC\/S[=_ ]|\WCS\/)(["']?)([A-Za-z][\w-]*)/i)
    if (!m?.[3]) return undefined

    return m[3].trim() || undefined
}

/**
 * Strip trailing flight-number suffix so tooltip shows telephony designator only.
 */
function telephonyDesignatorOnly(rtf: string, callsign: string): string {
    let designator = rtf.trim()
    if (callsign.length > 3) {
        const suffix = callsign.substring(3)
        const upper = designator.toUpperCase()
        const suf = suffix.toUpperCase()
        if (upper.endsWith(" " + suf)) {
            designator = designator.slice(0, -(suf.length + 1)).trim()
        } else if (upper.endsWith(suf) && designator.length > suf.length) {
            designator = designator.slice(0, -suf.length).trim()
        }
    }
    // Drop a trailing numeric token if still present (e.g. "SPEEDBIRD 123")
    designator = designator.replace(/\s+\d+[A-Z0-9]*$/i, "").trim()
    return designator
}

/**
 * Resolve radiotelephony designator for hover tooltip.
 * Prefer FPL RMK CALLSIGN/CS/C/S; fall back to ICAO_Airlines.txt.
 * Returns telephony only (no flight number), e.g. "SCANDINAVIAN".
 */
export function getRtfCallsign(callsign: string, fplRemarks?: string): string | undefined {
    if (fplRemarks) {
        const fromRmk = extractRtfFromFplRemarks(fplRemarks)
        if (fromRmk) {
            const designator = telephonyDesignatorOnly(fromRmk, callsign)
            if (designator) return designator
        }
    }

    const match = callsign.toUpperCase().match(/^([A-Z]{3})([A-Z0-9]+)$/)
    if (!match) return undefined

    return airlineTelephony.get(match[1]!)
}

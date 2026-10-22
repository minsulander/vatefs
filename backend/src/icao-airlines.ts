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
 * Recognises CALLSIGN IS / CALLSIGN/=_ / C/S=_ / CS/ / CS=
 *
 * Both variants:
 *   1) Simple token — CALLSIGN/VIKING, CALLSIGN IS SCANDINAVIAN, CALLSIGN/"VIKING"
 *   2) ICAO→telephony map — CALLSIGN EUS "EUROSCOT" | SCO "BRAVEHEART"
 *      (when `callsign` is given, pick the pair matching the strip ICAO prefix)
 */
export function extractRtfFromFplRemarks(
    remarks: string,
    callsign?: string,
): string | undefined {
    // Pad so \W can match at start of remarks (same trick as needing a boundary)
    const padded = ` ${remarks}`
    if (
        !padded.includes("CALLSIGN") &&
        !padded.includes("CS/") &&
        !padded.includes("C/S") &&
        !/\bCS=/i.test(padded)
    ) {
        return undefined
    }

    const marker = String.raw`(\WCALLSIGN IS |\WCALLSIGN[/=_ ]+|\WC\/S[=_ ]|\WCS\/)`
    const icaoPrefix = callsign?.toUpperCase().match(/^([A-Z]{3})/)?.[1]

    // Variant 2: ICAO "TELEPHONY" pairs (EUS "EUROSCOT" | SCO "BRAVEHEART")
    const pairs = [...padded.matchAll(/\b([A-Z]{3})\s+["']([A-Za-z][\w -]*?)["']/gi)]
    if (pairs.length > 0) {
        if (icaoPrefix) {
            const hit = pairs.find((p) => p[1]!.toUpperCase() === icaoPrefix)
            if (hit?.[2]?.trim()) return hit[2].trim()
        }
        // No strip prefix / no matching code — first pair after a CALLSIGN marker
        const afterMarker = padded.match(
            new RegExp(`${marker}\\s*(?:[A-Z]{3}\\s+)?["']([A-Za-z][\\w -]*?)["']`, "i"),
        )
        if (afterMarker?.[2]?.trim()) return afterMarker[2].trim()
        if (pairs[0]?.[2]?.trim()) return pairs[0][2]!.trim()
    }

    // Variant 1a: CALLSIGN/"VIKING" (quote directly on the token)
    const directQuoted = padded.match(new RegExp(`${marker}\\s*["']([A-Za-z][\\w -]*?)["']`, "i"))
    if (directQuoted?.[2]?.trim()) return directQuoted[2].trim()

    // VATSIM VA: CS=EUROSCOT=EUROSCOT VIRTUAL AIRLINES …
    const csEq = padded.match(/\WCS=([A-Za-z][\w-]*)/i)
    if (csEq?.[1]?.trim()) return csEq[1].trim()

    // Variant 1b: unquoted first token (CALLSIGN/BLUESCAN, CALLSIGN IS SCANDINAVIAN)
    const m = padded.match(new RegExp(`${marker}(["']?)([A-Za-z][\\w-]*)`, "i"))
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
        const fromRmk = extractRtfFromFplRemarks(fplRemarks, callsign)
        if (fromRmk) {
            const designator = telephonyDesignatorOnly(fromRmk, callsign)
            if (designator) return designator
        }
    }

    const match = callsign.toUpperCase().match(/^([A-Z]{3})([A-Z0-9]+)$/)
    if (!match) return undefined

    return airlineTelephony.get(match[1]!)
}

/**
 * Wake / ATYP highlight helpers for strip UI.
 *
 * B757 and Tu-204/214 are filed as WTC M but are treated as Heavy when leading
 * for wake spacing — UI keeps showing "M" and uses a yellow cell instead.
 *
 * Super/heavy wingspan types always get a thick ATYP cell border (and ESSA
 * prefers DEP 01L/19R — see airport-rules).
 */

/** Strip ICAO type from raw ATYP / TYPE/WTC-EQUIP strings. */
export function normalizeAircraftTypeDesignator(raw?: string | null): string {
    if (!raw) return ''
    const token = raw.trim().toUpperCase().split(/[/\s]/)[0] ?? ''
    // Drop trailing hyphen junk (rare); keep alnum only for matching
    return token.replace(/[^A-Z0-9]/g, '')
}

/**
 * Boeing 757 / Tupolev 204–214 family — "heavy as leader" for wake spacing.
 * Matches common ICAO designators and VATSIM misspellings without catching B738 etc.
 */
export function isHeavyAsLeaderAircraftType(aircraftType?: string | null): boolean {
    const t = normalizeAircraftTypeDesignator(aircraftType)
    if (!t) return false

    // B752 / B753 / B757 / B75x (ICAO 757 series); not B738/B748/…
    if (/^B75[0-9A-Z]?$/.test(t)) return true

    // T204 / T214 (ICAO); TU204 / TU214 (common misspellings)
    if (/^T(?:U)?(?:204|214)$/.test(t)) return true

    return false
}

/**
 * Super / very-large types that always get a thick ATYP cell border.
 * Also the ESSA heavy take-off set (01L/19R) — see resolveEssaHeavyPreferredDepRwy.
 * Includes A380 as a common non-ICAO filing for A388.
 */
const THICK_ATYP_BORDER_TYPES = new Set([
    'A388',
    'A380',
    'A124',
    'A225',
    'B748',
    'A345',
    'A346',
    'B779',
    'C5',
    'C5M',
])

/** True for A388/A124/A225/B748/A345/A346/B779/C5/C5M (and A380 alias). */
export function isThickAtypBorderAircraftType(aircraftType?: string | null): boolean {
    const t = normalizeAircraftTypeDesignator(aircraftType)
    return !!t && THICK_ATYP_BORDER_TYPES.has(t)
}

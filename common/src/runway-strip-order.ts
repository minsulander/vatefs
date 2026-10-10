/**
 * DEP RWY bay ordering.
 *
 * New strips append at bottom (addFromTop: false → increasing position).
 * Display sort top → bottom:
 * 1. Status rank among L/U traffic: CFTO (clearedForTakeoff / DEPA) above LINEUP
 *    — status overrides appearance (later CFTO still above earlier LINEUP)
 * 2. Same status: sticky bay appearance (lower position = earlier / first cleared above)
 * 3. Non–L/U (e.g. ARR): appearance position only (no forced rank vs L/U)
 */

export type RunwayOrderStrip = {
    callsign: string
    position: number
    groundstate?: string
    clearedForTakeoff?: boolean
}

/** Sections that host LINEUP / CFTO (DEPA) departure flow. */
export function isRunwayOrderSectionId(sectionId: string): boolean {
    if (sectionId === 'runway' || sectionId === 'arr_runway' || sectionId === 'dep_runway') {
        return true
    }
    if (sectionId === 'rwy' || sectionId.endsWith('_rwy')) return true
    // ESSA dynamic physical pairs: runway_01L_19R
    if (sectionId.startsWith('runway_')) return true
    return false
}

/**
 * L/U-related rank: 0 = CFTO, 1 = LINEUP, null = not L/U traffic
 * (arrivals / other groundstates keep sticky position only).
 */
export function runwayLuRank(strip: {
    clearedForTakeoff?: boolean
    groundstate?: string
}): number | null {
    const gs = (strip.groundstate || '').toUpperCase()
    if (strip.clearedForTakeoff || gs === 'DEPA') return 0
    if (gs === 'LINEUP') return 1
    return null
}

/**
 * Compare two strips for runway bay display order (ascending = top first).
 */
export function compareRunwayLuOrder(a: RunwayOrderStrip, b: RunwayOrderStrip): number {
    const ra = runwayLuRank(a)
    const rb = runwayLuRank(b)
    if (ra != null && rb != null && ra !== rb) return ra - rb
    if (a.position !== b.position) return a.position - b.position
    return a.callsign.localeCompare(b.callsign)
}

export function sortRunwayLuOrder<T extends RunwayOrderStrip>(list: T[]): T[] {
    return [...list].sort(compareRunwayLuOrder)
}

/**
 * HHMM time helpers (UTC), aligned with frontend INBOUND ETA sort:
 * midnight wrap via ±12h delta around "now".
 */

/** Parse HHMM / HHMMSS → minutes since midnight UTC, or null if missing/invalid. */
export function parseHhmmMinutes(hhmm: string | undefined): number | null {
    if (!hhmm) return null
    const digits = hhmm.replace(/\D/g, "")
    if (digits.length < 3) return null
    const normalized = digits.length === 3 ? digits.padStart(4, "0") : digits.slice(0, 4)
    const h = Number(normalized.slice(0, 2))
    const m = Number(normalized.slice(2, 4))
    if (h > 23 || m > 59) return null
    return h * 60 + m
}

/** Current UTC minutes since midnight. */
export function utcNowMinutes(nowMs: number = Date.now()): number {
    const d = new Date(nowMs)
    return d.getUTCHours() * 60 + d.getUTCMinutes()
}

/**
 * Signed minutes from now until HHMM, with midnight wrap (±12h).
 * Same mapping as frontend `hhmmSortKey` delta.
 */
export function minutesUntilHhmm(hhmm: string | undefined, nowMs: number = Date.now()): number | null {
    const abs = parseHhmmMinutes(hhmm)
    if (abs == null) return null
    const nowMin = utcNowMinutes(nowMs)
    let delta = abs - nowMin
    if (delta > 720) delta -= 1440
    if (delta < -720) delta += 1440
    return delta
}

/** Format a UTC timestamp as HHmm. */
export function formatHhmmUtc(ms: number): string {
    const d = new Date(ms)
    const h = String(d.getUTCHours()).padStart(2, "0")
    const m = String(d.getUTCMinutes()).padStart(2, "0")
    return `${h}${m}`
}

/**
 * Strip-style ETA (HHmm) from EuroScope ETE + lastUpdate.
 * Missing/non-positive ETE → undefined (same as createStrip).
 */
export function flightEtaHhmm(flight: {
    ete?: number
    lastUpdate?: number
}): string | undefined {
    if (flight.ete == null || !(flight.ete > 0)) return undefined
    const base = flight.lastUpdate ?? Date.now()
    return formatHhmmUtc(base + flight.ete * 60_000)
}

/**
 * Minutes until flight ETA (HHMM, midnight-wrapped), or null if no ETA.
 * Past ETAs within the wrap window are negative.
 */
export function minutesUntilFlightEta(
    flight: { ete?: number; lastUpdate?: number },
    nowMs: number = Date.now()
): number | null {
    return minutesUntilHhmm(flightEtaHhmm(flight), nowMs)
}

/**
 * Sort key relative to "now" with midnight wrap (±12h).
 * Missing/invalid → +∞ (same as frontend `hhmmSortKey`).
 */
export function hhmmSortKey(hhmm: string | undefined, nowMin: number): number {
    const abs = parseHhmmMinutes(hhmm)
    if (abs == null) return Number.POSITIVE_INFINITY
    let delta = abs - nowMin
    if (delta > 720) delta -= 1440
    if (delta < -720) delta += 1440
    return nowMin + delta
}

/** Paper pending KLARERING: local CLR read (not yet ES CLR / correct). */
export function stripHasClrReadAbove(flight: {
    clearance?: boolean
    clearanceReadback?: boolean
    clearanceRead?: boolean
}): boolean {
    if (flight.clearance || flight.clearanceReadback) return false
    return !!flight.clearanceRead
}

/**
 * Compare for paper pending KLARERING insert/sort (matches frontend
 * `sortByEobtEarliestBottom`): CLR-read at bottom; missing EOBT at top;
 * earlier EOBT toward bay floor; callsign tiebreak.
 * Negative → `a` before `b` (higher in the bay).
 */
export function comparePendingKlareringEobt(
    a: {
        eobt?: string
        callsign?: string
        clearance?: boolean
        clearanceReadback?: boolean
        clearanceRead?: boolean
    },
    b: {
        eobt?: string
        callsign?: string
        clearance?: boolean
        clearanceReadback?: boolean
        clearanceRead?: boolean
    },
    nowMin: number = utcNowMinutes(),
): number {
    const aClr = stripHasClrReadAbove(a)
    const bClr = stripHasClrReadAbove(b)
    if (aClr !== bClr) return aClr ? 1 : -1
    const ka = hhmmSortKey(a.eobt, nowMin)
    const kb = hhmmSortKey(b.eobt, nowMin)
    const aMiss = !Number.isFinite(ka)
    const bMiss = !Number.isFinite(kb)
    if (aMiss !== bMiss) return aMiss ? -1 : 1
    const d = kb - ka
    if (d !== 0) return d
    return (a.callsign || "").localeCompare(b.callsign || "")
}

/**
 * Insert index for a new pending-CLR strip among position-ordered existing
 * flights — EOBT order without re-sorting the list.
 */
export function eobtInsertIndexAmong(
    existingInPositionOrder: Array<{
        eobt?: string
        callsign?: string
        clearance?: boolean
        clearanceReadback?: boolean
        clearanceRead?: boolean
    }>,
    incoming: {
        eobt?: string
        callsign?: string
        clearance?: boolean
        clearanceReadback?: boolean
        clearanceRead?: boolean
    },
    nowMin: number = utcNowMinutes(),
): number {
    for (let i = 0; i < existingInPositionOrder.length; i++) {
        if (comparePendingKlareringEobt(incoming, existingInPositionOrder[i], nowMin) < 0) {
            return i
        }
    }
    return existingInPositionOrder.length
}

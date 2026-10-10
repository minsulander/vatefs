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

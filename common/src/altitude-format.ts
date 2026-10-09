/**
 * Strip display formatting for CFL / XFL.
 *
 * Examples (transition altitude 5000 ft):
 *   5000 / A050  →  "5.0"
 *   A012 / 1200  →  "1.2"
 *   FL90 / 9000  →  "90"
 *
 * Below/at TA → thousands of feet with one decimal.
 * Above TA    → flight level number (no "FL" prefix).
 */

export const DEFAULT_TRANSITION_ALTITUDE_FT = 5000

/** True when CFL cell shows an approach clearance (CA/VA/CAT3/…), not a level. */
export function isApproachClearanceLabel(input: string | null | undefined): boolean {
  if (input == null || input === '') return false
  const s = String(input).trim().toUpperCase()
  if (s === 'CA' || s === 'VA' || s === 'OS') return true
  if (/^CAT\d$/.test(s)) return true
  // Other APPCLR types: 1–4 chars, not FL / Axxx altitude tokens
  if (!/^[A-Z][A-Z0-9]{0,3}$/.test(s)) return false
  if (/^A\d{1,3}$/.test(s) || /^FL\d{2,3}$/.test(s)) return false
  return true
}

/** Parse ES / TopSky-style altitude into feet. */
export function parseAltitudeToFeet(input: string | number | null | undefined): number | undefined {
  if (input == null || input === '') return undefined
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input <= 0) return undefined
    // EuroScope: 1 = ILS/CA, 2 = visual/VA — not feet
    if (input === 1 || input === 2) return undefined
    // Small integers (e.g. 90) are treated as flight levels → feet
    if (input > 0 && input < 1000 && Number.isInteger(input)) {
      return input * 100
    }
    return input
  }

  const s = String(input).trim().toUpperCase().replace(/\s+/g, '')
  if (!s) return undefined
  if (isApproachClearanceLabel(s)) return undefined

  // Already strip-formatted "5.0" (thousands)
  if (/^\d+\.\d$/.test(s)) {
    const thou = parseFloat(s)
    if (!Number.isFinite(thou) || thou <= 0) return undefined
    return Math.round(thou * 1000)
  }

  // FL90 / F90
  const fl = s.match(/^F(?:L)?(\d{2,3})$/)
  if (fl) return parseInt(fl[1], 10) * 100

  // A012 / A50
  const alt = s.match(/^A(\d{2,3})$/)
  if (alt) return parseInt(alt[1], 10) * 100

  // Plain feet or FL digits
  const n = parseInt(s, 10)
  if (!Number.isFinite(n) || n <= 0) return undefined
  if (n < 1000) return n * 100
  return n
}

/**
 * Parse free-form CFL entry to feet.
 *
 * 1200 ft: `1.2`, `12`, `012`, `A012`, `A12`
 * FL95: `95`, `095`, `FL95`, `F95`
 */
export function parseManualCfl(raw: string | null | undefined): number | undefined {
  if (raw == null) return undefined
  const s = String(raw).trim().toUpperCase().replace(/\s+/g, '')
  if (!s) return undefined

  // Strip display thousands: 1.2 → 1200
  if (/^\d{1,2}\.\d$/.test(s)) {
    const thou = parseFloat(s)
    if (!Number.isFinite(thou) || thou <= 0 || thou > 60) return undefined
    return Math.round(thou * 1000)
  }

  // FL95 / F95
  const flPref = s.match(/^FL?(\d{1,3})$/)
  if (flPref) {
    const fl = parseInt(flPref[1], 10)
    if (fl < 1 || fl > 600) return undefined
    return fl * 100
  }

  // A12 / A012 / A5 → altitude in hundreds of feet
  const alt = s.match(/^A(\d{1,3})$/)
  if (alt) {
    const hundreds = parseInt(alt[1], 10)
    if (hundreds < 1 || hundreds > 200) return undefined
    return hundreds * 100
  }

  // Plain digits: 12 / 012 / 95 / 095 → flight level × 100
  // (FL12 = 1200 ft, same as A12)
  if (/^\d{1,3}$/.test(s)) {
    const fl = parseInt(s, 10)
    if (fl < 1 || fl > 600) return undefined
    return fl * 100
  }

  return undefined
}

/**
 * Format altitude for strip CFL/XFL cells.
 * @param transitionAltitudeFt from TopSkyAirspace (default Swedish ES = 5000)
 */
export function formatStripAltitude(
  input: string | number | null | undefined,
  transitionAltitudeFt: number = DEFAULT_TRANSITION_ALTITUDE_FT,
): string | undefined {
  if (input == null || input === '') return undefined
  if (typeof input === 'string' && isApproachClearanceLabel(input)) {
    return input.trim().toUpperCase()
  }
  if (input === 1 || input === '1') return 'CA'
  if (input === 2 || input === '2') return 'VA'

  const feet = parseAltitudeToFeet(input)
  if (feet == null) return undefined

  if (feet <= transitionAltitudeFt) {
    return (feet / 1000).toFixed(1)
  }
  return String(Math.round(feet / 100))
}

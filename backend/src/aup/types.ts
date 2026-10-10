/**
 * Minimal AUP (Airspace Use Plan) types, adapted from VatIRIS backend/src/aup/types.ts.
 * Only what the R16 status feature needs (no TopSky serialization types).
 */

export type AltitudeType = "ft" | "FL"

export interface Restriction {
    name: string
    from: Date
    to: Date
    /** Lower vertical limit (FL level, or feet AMSL / A-prefix hundreds when altitudeUpper is set). */
    altitude: string
    altitudeType: AltitudeType
    /** Upper vertical limit for a flight-level band (e.g. FL095-FL285). */
    altitudeUpper?: string
    comment: string
}

export interface ParseWarning {
    line?: number
    snippet?: string
    message: string
}

/** Public R16 status exposed via GET /api/aup/r16 and WS `aupR16`. */
export interface AupR16Status {
    /** R16/ESR16 active NOW and upper limit > 1600 ft ("utökad") */
    active: boolean
    /** Highest upper limit among currently-active R16 rows, in feet (null when none active) */
    topAltitudeFt: number | null
    /** Start of the active window (ISO UTC), null when not active */
    from: string | null
    /** End of the active window (ISO UTC), null when not active */
    to: string | null
    /** ESSA RWY config suggestion for AUTO mode consumers (never forced by backend) */
    suggestConfigId: "9C" | "15C" | null
    fetchStatus?: "ok" | "error" | "pending"
}

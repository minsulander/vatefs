/**
 * EuroScope scratchpad ↔ VatEFS remarks + holding point (HP).
 *
 * VCH hold short (HS) is NOT stored here — strip annotation 4.
 * Departure Coordination (DepC / coo) is NOT stored here — strip annotation 6.
 *
 * Format:
 *   .URNAV /Y2     — remarks + HP (HP after remarks)
 *   .URNAV         — remarks only
 *   /Y2            — HP only (single alphanumeric token)
 *   .SLOW          — slow flag (leading dot, same as other remarks)
 *   SLOW           — bare TopSky form still accepted when reading
 *
 * Protocol scratches (/ROF/…, /LAM/ROF/…, /EFSROF/…, /RJC/…, etc.) must not
 * touch remarks or HP — return null to leave existing fields unchanged.
 */

import { groundstateFromScratch, isGroundstateToken } from "./groundstate.js"

export { groundstateFromScratch, isGroundstateToken }
/** @deprecated use isGroundstateToken */
export const isSwedishGroundstateScratch = isGroundstateToken

/** Persistent scratch: remarks + HP only (never DepC / coo). */
export function buildCombinedScratch(
    remarks: string | undefined,
    hp: string | undefined,
): string {
    const r = remarks?.trim()
    const h = hp?.trim().toUpperCase()
    if (r && h) return `.${r} /${h}`
    if (h) return `/${h}`
    if (r) return `.${r}`
    return ""
}

/** @deprecated use buildCombinedScratch — kept for call sites that only set remarks */
export function buildScratchRemarks(remarks: string | undefined): string {
    return buildCombinedScratch(remarks, undefined)
}

/** True when scratch is a TopSky/ops message that must not update remarks or HP. */
export function isProtocolScratch(scratch: string): boolean {
    // TopSky manual-alert / G/A scratch tokens (MISAP_, EST_, IRREG_, WX_)
    if (
        scratch === "MISAP_" ||
        scratch === "EST_" ||
        scratch === "IRREG_" ||
        scratch === "WX_" ||
        scratch === "NOSTATE"
    ) {
        return true
    }
    if (isGroundstateToken(scratch)) return true
    // Holding point is exactly /TOKEN; anything else starting with / is protocol
    if (scratch.startsWith("/") && !/^\/[A-Z0-9]+\s*$/i.test(scratch)) return true
    return false
}

/**
 * Ground Radar arrival-stand broadcast embedded in the scratch pad.
 * Lists show this assignment immediately; the scratch token is the same value.
 * Returns undefined when the scratch is not a stand broadcast (leave flight.stand).
 */
export function standFromGrpScratch(scratch: string | undefined | null): string | undefined {
    if (!scratch) return undefined
    const match = scratch.match(/GRP\/S\/([A-Z0-9]{1,6})/i)
    if (!match?.[1]) return undefined
    return match[1].toUpperCase()
}

function parseRemarksAndHp(body: string): {
    remarks: string | undefined
    hp: string | undefined
} {
    const trimmed = body.trim()
    if (!trimmed) return { remarks: undefined, hp: undefined }

    const combined = trimmed.match(/^(.*?)\s+\/([A-Z0-9]+)\s*$/i)
    if (combined) {
        return {
            remarks: combined[1]!.trim() || undefined,
            hp: combined[2]!.trim().toUpperCase() || undefined,
        }
    }

    const hpOnly = trimmed.match(/^\/([A-Z0-9]+)\s*$/i)
    if (hpOnly) {
        return { remarks: undefined, hp: hpOnly[1]!.toUpperCase() }
    }

    return { remarks: trimmed || undefined, hp: undefined }
}

/**
 * Parse scratch into remarks + HP.
 * `null` = leave existing flight field unchanged (special TopSky ops).
 * DepC / coo is never derived from scratch (strip annotation 6).
 */
export function parseCombinedScratch(scratch: string): {
    remarks: string | undefined | null
    hp: string | undefined | null
} {
    // GRP/S/<stand> is a stand broadcast, not remarks. Do not start a scratch hold.
    if (standFromGrpScratch(scratch)) {
        return { remarks: null, hp: null }
    }
    if (isProtocolScratch(scratch)) {
        return { remarks: null, hp: null }
    }

    if (scratch === "") {
        return { remarks: undefined, hp: undefined }
    }

    if (scratch.toUpperCase() === "SLOW") {
        return { remarks: "SLOW", hp: undefined }
    }

    if (scratch.startsWith(".")) {
        const { remarks, hp } = parseRemarksAndHp(scratch.substring(1))
        return { remarks, hp }
    }

    // HP only: /Y2
    const hpOnly = scratch.match(/^\/([A-Z0-9]+)\s*$/i)
    if (hpOnly) {
        return {
            remarks: undefined,
            hp: hpOnly[1]!.toUpperCase(),
        }
    }

    return { remarks: undefined, hp: undefined }
}

/** Remarks-only parse (ignores HP). Prefer parseCombinedScratch. */
export function parseScratchRemarks(scratch: string | undefined): string | undefined | null {
    if (scratch === undefined) return null
    return parseCombinedScratch(scratch).remarks
}

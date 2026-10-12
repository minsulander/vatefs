/**
 * EuroScope scratchpad ↔ VatEFS remarks + holding point (HP) + COO flag.
 *
 * VCH hold short (HS) is NOT stored here — strip annotation 4.
 *
 * Format:
 *   .URNAV /Y2     — remarks + HP (HP after remarks)
 *   .URNAV         — remarks only
 *   /Y2            — HP only (single alphanumeric token)
 *   .SLOW          — slow flag (leading dot, same as other remarks)
 *   SLOW           — bare TopSky form still accepted when reading
 *   .COO           — ACC coordination flag (RTC)
 *   .COO SLOW /Y2  — COO + remarks + HP
 *
 * TopSky protocol scratches (/ROF/…, /LAM/ROF/…, /RJC/…, etc.) must not
 * touch remarks, HP, or COO — return null to leave existing fields unchanged.
 */

import { groundstateFromScratch, isGroundstateToken } from "./groundstate.js"

export { groundstateFromScratch, isGroundstateToken }
/** @deprecated use isGroundstateToken */
export const isSwedishGroundstateScratch = isGroundstateToken

export function buildCombinedScratch(
    remarks: string | undefined,
    hp: string | undefined,
    coo?: boolean,
): string {
    const r = remarks?.trim()
    const h = hp?.trim().toUpperCase()
    if (coo) {
        if (r && h) return `.COO ${r} /${h}`
        if (h) return `.COO /${h}`
        if (r) return `.COO ${r}`
        return `.COO`
    }
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
    if (scratch === "MISAP_" || scratch === "NOSTATE") return true
    if (isGroundstateToken(scratch)) return true
    // Holding point is exactly /TOKEN; anything else starting with / is protocol
    if (scratch.startsWith("/") && !/^\/[A-Z0-9]+\s*$/i.test(scratch)) return true
    return false
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
 * Parse scratch into remarks + HP + COO.
 * `null` = leave existing flight field unchanged (special TopSky ops).
 * `undefined` coo = cleared (no COO token).
 */
export function parseCombinedScratch(scratch: string): {
    remarks: string | undefined | null
    hp: string | undefined | null
    coo: boolean | undefined | null
} {
    if (isProtocolScratch(scratch)) {
        return { remarks: null, hp: null, coo: null }
    }

    if (scratch === "") {
        return { remarks: undefined, hp: undefined, coo: undefined }
    }

    if (scratch.toUpperCase() === "SLOW") {
        return { remarks: "SLOW", hp: undefined, coo: false }
    }

    if (scratch.startsWith(".")) {
        const afterDot = scratch.substring(1)
        const upper = afterDot.toUpperCase()
        if (upper === "COO" || upper.startsWith("COO ") || upper.startsWith("COO/")) {
            const afterCoo =
                upper === "COO"
                    ? ""
                    : upper.startsWith("COO/")
                      ? afterDot.slice(3) // keep leading /
                      : afterDot.slice(4).trimStart()
            const { remarks, hp } = parseRemarksAndHp(afterCoo)
            return { remarks, hp, coo: true }
        }
        const { remarks, hp } = parseRemarksAndHp(afterDot)
        return { remarks, hp, coo: false }
    }

    // HP only: /Y2
    const hpOnly = scratch.match(/^\/([A-Z0-9]+)\s*$/i)
    if (hpOnly) {
        return {
            remarks: undefined,
            hp: hpOnly[1]!.toUpperCase(),
            coo: false,
        }
    }

    return { remarks: undefined, hp: undefined, coo: false }
}

/** Remarks-only parse (ignores HP). Prefer parseCombinedScratch. */
export function parseScratchRemarks(scratch: string | undefined): string | undefined | null {
    if (scratch === undefined) return null
    return parseCombinedScratch(scratch).remarks
}

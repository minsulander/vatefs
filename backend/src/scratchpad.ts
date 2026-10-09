/**
 * EuroScope scratchpad ↔ VatEFS remarks + holding point (HP).
 *
 * VCH hold short (HS) is NOT stored here — strip annotation 4.
 *
 * Format:
 *   .URNAV /Y2     — remarks + HP (HP after remarks)
 *   .URNAV         — remarks only
 *   /Y2            — HP only (single alphanumeric token)
 *   SLOW           — TopSky slow flag (remarks)
 *
 * TopSky protocol scratches (/ROF/…, /LAM/ROF/…, /RJC/…, etc.) must not
 * touch remarks or HP — return null to leave existing fields unchanged.
 */

export function buildCombinedScratch(
    remarks: string | undefined,
    hp: string | undefined,
): string {
    const r = remarks?.trim()
    const h = hp?.trim().toUpperCase()
    if (r && h) return `.${r} /${h}`
    if (h) return `/${h}`
    if (r) {
        if (r.toUpperCase() === "SLOW") return "SLOW"
        return `.${r}`
    }
    return ""
}

/** @deprecated use buildCombinedScratch — kept for call sites that only set remarks */
export function buildScratchRemarks(remarks: string | undefined): string {
    return buildCombinedScratch(remarks, undefined)
}

/** True when scratch is a TopSky/ops message that must not update remarks or HP. */
export function isProtocolScratch(scratch: string): boolean {
    if (scratch === "MISAP_" || scratch === "NOSTATE") return true
    // Holding point is exactly /TOKEN; anything else starting with / is protocol
    if (scratch.startsWith("/") && !/^\/[A-Z0-9]+\s*$/i.test(scratch)) return true
    return false
}

/**
 * Parse scratch into remarks + HP.
 * `null` = leave existing flight field unchanged (special TopSky ops).
 */
export function parseCombinedScratch(scratch: string): {
    remarks: string | undefined | null
    hp: string | undefined | null
} {
    if (isProtocolScratch(scratch)) {
        return { remarks: null, hp: null }
    }

    if (scratch === "") {
        return { remarks: undefined, hp: undefined }
    }

    if (scratch.toUpperCase() === "SLOW") {
        return { remarks: "SLOW", hp: undefined }
    }

    const combined = scratch.match(/^\.(.*?)\s+\/([A-Z0-9]+)\s*$/i)
    if (combined) {
        return {
            remarks: combined[1]!.trim() || undefined,
            hp: combined[2]!.trim().toUpperCase() || undefined,
        }
    }

    if (scratch.startsWith(".")) {
        return {
            remarks: scratch.substring(1).trim() || undefined,
            hp: undefined,
        }
    }

    // HP only: /Y2 (already validated by isProtocolScratch)
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
export function parseScratchRemarks(scratch: string): string | undefined | null {
    return parseCombinedScratch(scratch).remarks
}

/**
 * ESGG ARR sector box (ZZGE / ZZGW / ZZGG) from GOT APP AoR.
 *
 * Inbound COPX (ESE) into GOT APPE / APPW by STAR IAF / entry fix:
 *   KELIN, MOXAM, NEGIL, GG550 → APPE (E / GE)
 *   RISMA, MAKUR, LOBBI, GG630 → APPW (W / GW)
 *   ARQUS → runway-dependent (ESE STAR + APPS split):
 *     RWY 03 ARQUS… via GG630 → APPW (W); APPS03 OWNER GW first
 *     RWY 21 ARQUS… via GG550 → APPE (E); APPS21 OWNER GE first
 *
 * When EuroScope has no sectorEntryMin, the strip shows ZZGG + ETA instead.
 */

export type EsggArrAppSide = "E" | "W"

/** Normalize ESGG runway to "03" / "21" when possible. */
export function normalizeEsggArrRwy(rwy: string | undefined | null): string | undefined {
    if (!rwy) return undefined
    const digits = String(rwy).replace(/\D/g, "")
    if (!digits) return undefined
    const n = parseInt(digits, 10)
    if (n === 3) return "03"
    if (n === 21) return "21"
    return digits.padStart(2, "0")
}

/** STAR / procedure designator → IAF fix (NEGIL3L → NEGIL, ARQUS1S → ARQUS). */
export function esggStarEntryFix(star: string | undefined | null): string | undefined {
    if (!star) return undefined
    const compact = star.toUpperCase().replace(/[·.•\s]/g, "")
    if (!compact) return undefined
    const m = compact.match(/^([A-Z]{2,})/)
    return m?.[1]
}

/** Fixed APPE/APPW ownership for named TMA entry fixes (ESE COPX). */
const FIXED_ENTRY_SIDE: Record<string, EsggArrAppSide> = {
    KELIN: "E",
    MOXAM: "E",
    NEGIL: "E",
    GG550: "E",
    RISMA: "W",
    MAKUR: "W",
    LOBBI: "W",
    GG630: "W",
}

/**
 * Which GOT APP side (E/W) an ESGG arrival enters, from STAR / TMA entry / runway.
 * Undefined when entry cannot be resolved from filed data.
 */
export function esggArrAppSide(opts: {
    star?: string | null
    tmaEntry?: string | null
    arrRwy?: string | null
}): EsggArrAppSide | undefined {
    const entry = (opts.tmaEntry || "").trim().toUpperCase()
    const fromStar = esggStarEntryFix(opts.star)
    const key = entry || fromStar
    if (!key) return undefined

    const fixed = FIXED_ENTRY_SIDE[key]
    if (fixed) return fixed

    // ARQUS (and GG630/GG550 if only runway known via STAR family): south split flips with RWY
    if (key === "ARQUS") {
        const rwy = normalizeEsggArrRwy(opts.arrRwy)
        if (rwy === "03") return "W"
        if (rwy === "21") return "E"
        return undefined
    }

    return undefined
}

/**
 * Sector label for ESGG ARR col 4 top.
 * - With sectorEntryMin + resolved AoR → ZZGE / ZZGW
 * - Otherwise → ZZGG (no expected E/W sector entry)
 */
export function esggArrSectorCode(opts: {
    star?: string | null
    tmaEntry?: string | null
    arrRwy?: string | null
    sectorEntryMin?: number | null
}): "ZZGE" | "ZZGW" | "ZZGG" {
    const min = opts.sectorEntryMin
    const hasEtn = min != null && Number.isFinite(min) && min >= 0
    if (!hasEtn) return "ZZGG"
    const side = esggArrAppSide(opts)
    if (side === "E") return "ZZGE"
    if (side === "W") return "ZZGW"
    return "ZZGG"
}

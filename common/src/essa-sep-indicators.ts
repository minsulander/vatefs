/**
 * ESSA top-bar SEP / DLV / DEP GAP indicators (SAAB-style).
 *
 * SEP — min radar separation from active ARR RWY SCC (VatIRIS WX.AWOS), opposite ends mapped.
 * DLV — APP→TWR delivery spacing from runway combination.
 * DEP GAP — single-runway final spacing only (6 VMC / 7 IMC / 8 Enbana 08).
 */

import { getEssaRwyCombination, normalizeEssaRwy } from "./essa-rwy-config.js"

export interface EssaSepIndicators {
    /** e.g. "2.5 nm" / "3 nm" */
    sep: string
    /** e.g. "2.5 nm" / "3.5 nm" / "4 nm" */
    dlv: string
    /** e.g. "6 nm" / "7 nm" / "8 nm" / "" when not single-RWY */
    depGap: string
}

/** TWR-managed overrides; absent key = use auto. Present "" for DEP GAP is intentional blank. */
export type EssaSepOverrides = Partial<EssaSepIndicators>

export type EssaSepField = keyof EssaSepIndicators

/** Click-cycle presets; last step returns to auto (clear override). */
export const ESSA_SEP_CYCLE: Record<EssaSepField, readonly (string | null)[]> = {
    sep: ["2.5 nm", "3 nm", null],
    dlv: ["2.5 nm", "3.5 nm", "4 nm", null],
    depGap: ["6 nm", "7 nm", "8 nm", "", null],
}

export function mergeEssaSepIndicators(
    auto: EssaSepIndicators,
    overrides: EssaSepOverrides | null | undefined
): EssaSepIndicators {
    if (!overrides) return auto
    return {
        sep: overrides.sep !== undefined ? overrides.sep : auto.sep,
        dlv: overrides.dlv !== undefined ? overrides.dlv : auto.dlv,
        depGap: overrides.depGap !== undefined ? overrides.depGap : auto.depGap,
    }
}

/** Next cycle value; `null` means clear override (auto). */
export function nextEssaSepCycleValue(
    field: EssaSepField,
    currentEffective: string,
    hasOverride: boolean
): string | null {
    const cycle = ESSA_SEP_CYCLE[field]
    if (!hasOverride) {
        // From auto → next preset after matching value; never emit null (that is
        // only for clearing an existing override). If match is last before null
        // (e.g. auto depGap ""), wrap to first preset.
        const idx = cycle.findIndex((v) => v === currentEffective)
        if (idx >= 0 && idx < cycle.length - 1) {
            const next = cycle[idx + 1]!
            return next === null ? cycle[0]! : next
        }
        return cycle[0]!
    }
    const idx = cycle.findIndex((v) => v === currentEffective)
    if (idx < 0) return cycle[0]!
    return cycle[(idx + 1) % cycle.length]!
}

/** AWOS reports three designators; map opposite ends like VatIRIS MetreportWX. */
export function essaSccLookupDesignator(rwy: string): string {
    const n = normalizeEssaRwy(rwy)
    if (n === "19R") return "01L"
    if (n === "19L") return "01R"
    if (n === "26") return "08"
    return n
}

/** Parse `01L: SCC 5 5 5 …` lines from VatIRIS /wx HTML or plain text. */
export function parseEssaSccFromWxText(text: string): Map<string, [number, number, number]> {
    const out = new Map<string, [number, number, number]>()
    const re = /^(\d{2}[LRC]?):\s*SCC\s+(\d)\s+(\d)\s+(\d)/gim
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
        const id = normalizeEssaRwy(m[1]!)
        out.set(id, [Number(m[2]), Number(m[3]), Number(m[4])])
    }
    return out
}

/**
 * SEP from SCC on active ARR runway(s) only (opposite ends resolved).
 * - 3 nm when any third is ≤ 4
 * - 2.5 nm otherwise (e.g. 555), or when no SCC is available
 */
export function resolveEssaSepNm(
    arrRunways: string[],
    _depRunways: string[],
    sccByDesignator: Map<string, [number, number, number]>
): number {
    const designators = new Set<string>()
    for (const r of arrRunways) {
        if (!r) continue
        designators.add(essaSccLookupDesignator(r))
    }

    for (const d of designators) {
        const trip = sccByDesignator.get(d)
        if (!trip) continue
        if (trip.some((n) => n <= 4)) return 3
    }
    return 2.5
}

/** DLV APP→TWR: 2.5 nm default; exceptions per Appendix A. */
export function resolveEssaDlvNm(configId: string | null | undefined): number {
    switch (configId) {
        case "5":
            return 3.5
        case "8":
        case "14":
            return 4
        default:
            return 2.5
    }
}

/** Single-RWY combination ids (ARR end === DEP end). */
export function isEssaSingleRwyConfig(configId: string | null | undefined): boolean {
    if (!configId) return false
    const combo = getEssaRwyCombination(configId)
    if (!combo) return false
    if (combo.arr.length !== 1 || combo.dep.length !== 1) return false
    return normalizeEssaRwy(combo.arr[0]!) === normalizeEssaRwy(combo.dep[0]!)
}

/**
 * IMC from METAR for DEP GAP 6/7.
 * VMC: CAVOK, or vis ≥ 5000 m and no BKN/OVC/VV below 1500 ft.
 * Missing/unparseable METAR → treat as VMC (show 6).
 */
export function isEssaImcFromMetar(metar: string | null | undefined): boolean {
    if (!metar) return false
    const u = metar.toUpperCase().replace(/\s+/g, " ")
    if (/\bCAVOK\b/.test(u)) return false
    if (/\bNSC\b/.test(u) && !hasLowVis(u)) return false

    if (hasLowVis(u)) return true
    if (hasCeilingBelowFt(u, 1500)) return true
    return false
}

function hasLowVis(u: string): boolean {
    // 9999 / 10SM / P6SM = good
    if (/\b9999\b/.test(u) || /\bP6SM\b/.test(u) || /\b10SM\b/.test(u) || /\b6SM\b/.test(u)) {
        return false
    }
    // Statute miles
    const sm = u.match(/\b(\d{1,2})SM\b/)
    if (sm) {
        const n = Number(sm[1])
        return Number.isFinite(n) && n < 3
    }
    // Metres after wind (KT/MPS), before weather/clouds — skip Zulu time / QNH
    const afterWind = u.match(
        /\b(?:\d{5}(?:G\d{2,3})?KT|\d{5}(?:G\d{2,3})?MPS|VRB\d{2}KT)\s+(\d{4})(?:NDV)?\b/
    )
    if (afterWind) {
        const n = Number(afterWind[1])
        return Number.isFinite(n) && n < 5000
    }
    return false
}

function hasCeilingBelowFt(u: string, maxFt: number): boolean {
    // VV/// or VVxxx
    const vv = u.match(/\bVV(\d{3}|\/\/\/)\b/)
    if (vv) {
        if (vv[1] === "///") return true
        const ft = Number(vv[1]) * 100
        return Number.isFinite(ft) && ft < maxFt
    }
    for (const m of u.matchAll(/\b(?:BKN|OVC)(\d{3})\b/g)) {
        const ft = Number(m[1]) * 100
        if (Number.isFinite(ft) && ft < maxFt) return true
    }
    return false
}

/**
 * DEP GAP only for single-RWY configs:
 * - Config 7 (Enbana 08): 8 nm
 * - Else: 6 nm VMC / 7 nm IMC
 * Empty string when not single-RWY.
 */
export function resolveEssaDepGapNm(
    configId: string | null | undefined,
    imc: boolean
): number | null {
    if (!isEssaSingleRwyConfig(configId)) return null
    if (configId === "7") return 8
    return imc ? 7 : 6
}

function formatNm(n: number): string {
    // Prefer "2.5 nm" / "3 nm" / "3.5 nm"
    const s = Number.isInteger(n) ? String(n) : n.toFixed(1)
    return `${s} nm`
}

export function computeEssaSepIndicators(options: {
    configId: string | null | undefined
    arrRunways: string[]
    depRunways: string[]
    sccByDesignator: Map<string, [number, number, number]>
    metar?: string | null
}): EssaSepIndicators {
    const sep = resolveEssaSepNm(options.arrRunways, options.depRunways, options.sccByDesignator)
    const dlv = resolveEssaDlvNm(options.configId)
    const imc = isEssaImcFromMetar(options.metar)
    const gap = resolveEssaDepGapNm(options.configId, imc)
    return {
        sep: formatNm(sep),
        dlv: formatNm(dlv),
        depGap: gap == null ? "" : formatNm(gap),
    }
}

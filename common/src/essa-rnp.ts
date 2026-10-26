/**
 * ESSA RNP / EoR detection for breakout info strips (LOP: Established on RNP).
 *
 * Triggers:
 * - Assigned STAR / approach name contains RNP (ESE APP STARs, e.g. "ALJAC RNP Y", "RNP Z")
 * - OP-TEXT2 / remarks: RNPX 19R, RNP Y, RNP-X, etc. (flexible spacing)
 */

export type EssaBreakoutRunway = '01L' | '01R' | '19L' | '19R'

const BREAKOUT_RWYS: EssaBreakoutRunway[] = ['01L', '01R', '19L', '19R']

/** Normalize ESE / label separators (middle dots, NBSP, hyphens) to spaces. */
export function normalizeEssaProcText(text: string | undefined | null): string {
    if (!text) return ''
    return text
        .replace(/[\u00B7\u2022\u2219\u30FB\uFF0E]/g, ' ') // · • ∙ ・．
        .replace(/[\u00A0\u202F]/g, ' ')
        .replace(/[-_/]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
}

/**
 * True when a STAR / approach procedure name is an RNP APP procedure.
 * Matches "… RNP Y", "RNP Z", "RNP", "FOO·RNP·X", etc.
 */
export function isEssaRnpStar(star: string | undefined | null): boolean {
    const n = normalizeEssaProcText(star).toUpperCase()
    if (!n) return false
    return /(?:^|\s)RNP(?:\s+[WXYZ])?(?:\s|$)/.test(n) || /(?:^|\s)RNP[WXYZ](?:\s|$)/.test(n)
}

/** Letter from STAR name when present (e.g. "ALJAC RNP Y" → Y). */
export function essaRnpLetterFromStar(
    star: string | undefined | null,
): 'W' | 'X' | 'Y' | 'Z' | undefined {
    const n = normalizeEssaProcText(star).toUpperCase()
    if (!n) return undefined
    const m = n.match(/(?:^|\s)RNP\s*([WXYZ])(?:\s|$)/)
    return m ? (m[1] as 'W' | 'X' | 'Y' | 'Z') : undefined
}

export type EssaRnpOpTextMatch = {
    /** Present when text indicates RNP (letter optional) */
    detected: true
    /** Pilot request only (RQ/REQ RNP) — not cleared/informed yet */
    request?: true
    letter?: 'W' | 'X' | 'Y' | 'Z'
    runway?: EssaBreakoutRunway
}

/**
 * Parse ESSA OP-TEXT2 / remarks for RNP coordination markers.
 * Accepts: RNPX 19R, RNP X 19R, RNP-Y, RNP Y RWY 01L, RQ RNP, bare RNP, …
 */
export function parseEssaRnpOpText(text: string | undefined | null): EssaRnpOpTextMatch | null {
    const n = normalizeEssaProcText(text).toUpperCase()
    if (!n) return null

    // RQ / REQ RNP = pilot request (breakout awareness; must not paint CFL)
    if (
        /\b(?:RQ|REQ|REQUEST)\s*RNP\b/.test(n) ||
        /\bRNP\s*(?:RQ|REQ|REQUEST)\b/.test(n)
    ) {
        return { detected: true, request: true }
    }

    // RNPX 19R / RNP X 19R / RNP-X RWY 19R / RNP Y
    const withLetter = n.match(
        /\bRNP\s*([WXYZ])\b(?:\s*(?:RWY|RUNWAY)?\s*(\d{2}[LRC]?))?/,
    )
    if (withLetter) {
        const letter = withLetter[1] as 'W' | 'X' | 'Y' | 'Z'
        const rwy = normalizeBreakoutRwy(withLetter[2])
        return rwy ? { detected: true, letter, runway: rwy } : { detected: true, letter }
    }

    // Bare RNP (optionally with runway): RNP 19R / RNP RWY 01L
    const bare = n.match(/\bRNP\b(?:\s*(?:RWY|RUNWAY)?\s*(\d{2}[LRC]?))?/)
    if (bare) {
        const rwy = normalizeBreakoutRwy(bare[1])
        return rwy ? { detected: true, runway: rwy } : { detected: true }
    }

    return null
}

/** Scratch without leading `.` that is OP-TEXT2 RNP coordination (ESSA LOP). */
export function isEssaRnpOpTextScratch(scratch: string | undefined | null): boolean {
    if (!scratch) return false
    const body = scratch.startsWith('.') ? scratch.slice(1) : scratch
    return parseEssaRnpOpText(body) != null
}

/**
 * CFL cell label when CA is set and RNP APP is indicated (STAR and/or informed
 * OP-TEXT2), same slot as CAT2/CAT3. Compact: RNPY / RNPX / RNP.
 *
 * Does **not** paint for bare CA, nor for RQ/REQ/REQUEST RNP (pilot request only).
 */
export function essaRnpCflLabel(
    star: string | undefined | null,
    remarks: string | undefined | null,
): string | undefined {
    const op = parseEssaRnpOpText(remarks)
    // Ignore pilot-request remarks entirely for CFL (RQ / REQ / REQUEST RNP)
    const informed = op && !op.request ? op : null
    const fromStar = isEssaRnpStar(star)
    if (!fromStar && !informed) return undefined
    const letter = informed?.letter ?? essaRnpLetterFromStar(star)
    return letter ? `RNP${letter}` : 'RNP'
}

function normalizeBreakoutRwy(raw: string | undefined): EssaBreakoutRunway | undefined {
    if (!raw) return undefined
    const u = raw.toUpperCase().replace(/^(?:RWY|RUNWAY)/, '')
    if ((BREAKOUT_RWYS as string[]).includes(u)) return u as EssaBreakoutRunway
    return undefined
}

/** Parallel pair that needs mutual breakout monitoring under EoR. */
export function essaParallelBreakoutPair(
    runway: string | undefined | null,
): EssaBreakoutRunway[] | null {
    if (!runway) return null
    const u = runway.toUpperCase()
    if (u === '01L' || u === '01R') return ['01L', '01R']
    if (u === '19L' || u === '19R') return ['19L', '19R']
    return null
}

/**
 * Runways that should show breakout strips when RNP is detected.
 * Prefer the matched approach runway’s parallel pair; else ARR+DEP from config
 * when they form a parallel pair; else the config ARR if it is a breakout rwy.
 */
export function essaRnpBreakoutRunways(opts: {
    hintRunway?: string | null
    configArr?: string | null
    configDep?: string | null
}): EssaBreakoutRunway[] {
    const fromHint = essaParallelBreakoutPair(opts.hintRunway)
    if (fromHint) return fromHint

    const arr = opts.configArr?.toUpperCase()
    const dep = opts.configDep?.toUpperCase()
    const fromArr = essaParallelBreakoutPair(arr)
    if (fromArr) return fromArr
    const fromDep = essaParallelBreakoutPair(dep)
    if (fromDep) return fromDep

    if (arr && (BREAKOUT_RWYS as string[]).includes(arr)) {
        return [arr as EssaBreakoutRunway]
    }
    if (dep && (BREAKOUT_RWYS as string[]).includes(dep)) {
        return [dep as EssaBreakoutRunway]
    }
    return []
}

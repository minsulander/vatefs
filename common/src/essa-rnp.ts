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
 * RNP Z is practically identical to an ILS APP — do not highlight / do not
 * treat as EoR parallel-APP for breakouts.
 */
export function isEssaIlsLikeRnpLetter(
    letter: string | undefined | null,
): boolean {
    return !!letter && letter.toUpperCase() === 'Z'
}

/**
 * True when a STAR / approach procedure name is an RNP APP procedure that
 * should highlight (EoR). Matches "… RNP Y", "RNP", "FOO·RNP·X", etc.
 * RNP Z is excluded (ILS-like).
 */
export function isEssaRnpStar(star: string | undefined | null): boolean {
    const n = normalizeEssaProcText(star).toUpperCase()
    if (!n) return false
    if (!/(?:^|\s)RNP(?:\s+[WXYZ])?(?:\s|$)/.test(n) && !/(?:^|\s)RNP[WXYZ](?:\s|$)/.test(n)) {
        return false
    }
    // Explicit RNP Z only → ILS-like, no highlight
    if (isEssaIlsLikeRnpLetter(essaRnpLetterFromStar(star))) return false
    return true
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
 * RNP APP indicator text (shown under the RWY cell — not in CFL).
 * STAR and/or informed OP-TEXT2 → "RNP Y" / "RNP X" / "RNP".
 *
 * Does **not** paint for RQ/REQ/REQUEST RNP (pilot request only).
 */
export function essaRnpIndicatorLabel(
    star: string | undefined | null,
    remarks: string | undefined | null,
): string | undefined {
    const op = parseEssaRnpOpText(remarks)
    // Ignore pilot-request remarks entirely (RQ / REQ / REQUEST RNP)
    const informed = op && !op.request ? op : null
    // RNP Z in OP-TEXT alone is ILS-like — ignore
    const informedHighlight =
        informed && !isEssaIlsLikeRnpLetter(informed.letter) ? informed : null
    const fromStar = isEssaRnpStar(star)
    if (!fromStar && !informedHighlight) return undefined
    const letter = informedHighlight?.letter ?? essaRnpLetterFromStar(star)
    if (isEssaIlsLikeRnpLetter(letter)) return undefined
    return letter ? `RNP ${letter}` : 'RNP'
}

/** @deprecated Use essaRnpIndicatorLabel — kept as alias for older call sites. */
export function essaRnpCflLabel(
    star: string | undefined | null,
    remarks: string | undefined | null,
): string | undefined {
    return essaRnpIndicatorLabel(star, remarks)
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
 * EoR RNP AR runway (parallel to ILS): 01L with config 1 / 19R with config 2.
 * ILS main side is 01R / 19L.
 */
export function isEssaEorRnpRunway(runway: string | undefined | null): boolean {
    if (!runway) return false
    const u = runway.toUpperCase()
    return u === '01L' || u === '19R'
}

/**
 * Parallel breakout pair when RNP / EoR parallel approaches are detected.
 * Always returns both RWYs of the pair (never a single ARR-only breakout).
 *
 * Prefer the matched approach runway’s pair (e.g. RNP on 01L → 01L+01R);
 * else ARR/DEP from config when they form a parallel pair (configs 1 & 2).
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

    // No single-runway fallback — auto breakouts only for parallel APP pairs
    return []
}

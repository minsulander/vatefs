/**
 * ESSA runway combination numbers from Arlanda TWR Appendix A /
 * Stockholm APP Appendix B (2026-09-03).
 *
 * EuroScope only provides bare runway IDs (e.g. "08", "19L"), so lettered
 * variants that share the same ARR/DEP runways (9A/B/C, 15A/B/C) are
 * disambiguated by local time — same rule as VatIRIS QuickRef:
 * night (9B / 15B) when hour >= 22 or < 6 (Europe/Stockholm).
 *
 * Display names follow the PDF: `ARR 19L / DEP 19L-NIGHT`.
 * Quickref image keys match VatIRIS `QuickRef.vue` runway list order;
 * images are served from https://vatiris.se/quickref/.
 */

export interface EssaRwyCombination {
    /** Config id as published (e.g. "13", "15A") */
    id: string
    arr: string[]
    /** Bare runway(s) used for matching (suffixes like -LT/-Q stripped) */
    dep: string[]
    /** Arrival runway as in the PDF (e.g. "19L", "26") */
    arrName: string
    /** Departure runway as in the PDF, including SID suffix (e.g. "19L-NIGHT", "08-LT") */
    depName: string
    /** VatIRIS QuickRef runway key (e.g. "26/19L-NIGHT") */
    quickrefKey: string
    /** True for 19L-NIGHT variants (9B, 15B) */
    night?: boolean
}

/**
 * VatIRIS ESSA quickref runway keys — index maps to image number:
 * TWR: essa-twr-{index+6}, APP: essa-app-{index+5} (zero-padded).
 */
export const ESSA_QUICKREF_KEYS = [
    '01R/01L',
    '19L/19R',
    '01L',
    '01L/08',
    '01R/08',
    '01R',
    '08',
    '08/19L',
    '19L',
    '19L-NIGHT',
    '19L-E',
    '19R/08',
    '19R/19L',
    '19R',
    '26/01L',
    '26/19R',
    '26/19L-Q',
    '26/19L-NIGHT',
    '26/19L-E',
    '26',
] as const

/** Published combinations in document / VatIRIS order */
export const ESSA_RWY_COMBINATIONS: EssaRwyCombination[] = [
    { id: '1', arr: ['01R'], dep: ['01L'], arrName: '01R', depName: '01L', quickrefKey: '01R/01L' },
    { id: '2', arr: ['19L'], dep: ['19R'], arrName: '19L', depName: '19R', quickrefKey: '19L/19R' },
    { id: '3', arr: ['01L'], dep: ['01L'], arrName: '01L', depName: '01L', quickrefKey: '01L' },
    { id: '4', arr: ['01L'], dep: ['08'], arrName: '01L', depName: '08-LT', quickrefKey: '01L/08' },
    { id: '5', arr: ['01R'], dep: ['08'], arrName: '01R', depName: '08-LT', quickrefKey: '01R/08' },
    { id: '6', arr: ['01R'], dep: ['01R'], arrName: '01R', depName: '01R', quickrefKey: '01R' },
    { id: '7', arr: ['08'], dep: ['08'], arrName: '08', depName: '08', quickrefKey: '08' },
    { id: '8', arr: ['08'], dep: ['19L'], arrName: '08', depName: '19L-Q', quickrefKey: '08/19L' },
    { id: '9A', arr: ['19L'], dep: ['19L'], arrName: '19L', depName: '19L-Q', quickrefKey: '19L' },
    { id: '9B', arr: ['19L'], dep: ['19L'], arrName: '19L', depName: '19L-NIGHT', quickrefKey: '19L-NIGHT', night: true },
    { id: '9C', arr: ['19L'], dep: ['19L'], arrName: '19L', depName: '19L-E', quickrefKey: '19L-E' },
    { id: '10', arr: ['19R'], dep: ['08'], arrName: '19R', depName: '08-RT', quickrefKey: '19R/08' },
    { id: '11', arr: ['19R'], dep: ['19L'], arrName: '19R', depName: '19L-E', quickrefKey: '19R/19L' },
    { id: '12', arr: ['19R'], dep: ['19R'], arrName: '19R', depName: '19R', quickrefKey: '19R' },
    { id: '13', arr: ['26'], dep: ['01L'], arrName: '26', depName: '01L', quickrefKey: '26/01L' },
    { id: '14', arr: ['26'], dep: ['19R'], arrName: '26', depName: '19R', quickrefKey: '26/19R' },
    { id: '15A', arr: ['26'], dep: ['19L'], arrName: '26', depName: '19L-Q', quickrefKey: '26/19L-Q' },
    { id: '15B', arr: ['26'], dep: ['19L'], arrName: '26', depName: '19L-NIGHT', quickrefKey: '26/19L-NIGHT', night: true },
    { id: '15C', arr: ['26'], dep: ['19L'], arrName: '26', depName: '19L-E', quickrefKey: '26/19L-E' },
    { id: '16', arr: ['26'], dep: ['26'], arrName: '26', depName: '26', quickrefKey: '26' },
]

/** Base URL for VatIRIS quickref PNGs */
export const VATIRIS_QUICKREF_BASE = 'https://vatiris.se/quickref'

export function normalizeEssaRwy(rwy: string): string {
    return rwy.toUpperCase().replace(/[^0-9LRC]/g, '')
}

function sameSet(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false
    const sa = [...a].map(normalizeEssaRwy).sort()
    const sb = [...b].map(normalizeEssaRwy).sort()
    return sa.every((v, i) => v === sb[i])
}

/**
 * Day window for ESSA RWY letter selection / auto-SLOW: [06:00, 22:00) LT.
 * Night configs (9B, 15B) auto-select outside this window.
 */
export function isEssaRwyDayHours(now: Date = new Date()): boolean {
    const hourStr = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Stockholm',
        hour: '2-digit',
        hour12: false,
    }).format(now)
    const hour = Number(hourStr)
    const h = hour === 24 ? 0 : hour
    return h >= 6 && h < 22
}

export function getEssaRwyCombination(id: string): EssaRwyCombination | undefined {
    return ESSA_RWY_COMBINATIONS.find(c => c.id === id)
}

/** PDF-style name: `ARR 19L / DEP 19L-NIGHT` */
export function formatEssaRwyPdfName(combo: EssaRwyCombination): string {
    return `ARR ${combo.arrName} / DEP ${combo.depName}`
}

/** Configs whose ARR/DEP match the given active runways */
export function findMatchingEssaRwyConfigs(arr: string[], dep: string[]): EssaRwyCombination[] {
    if (arr.length === 0 || dep.length === 0) return []
    return ESSA_RWY_COMBINATIONS.filter(
        c => sameSet(c.arr, arr) && sameSet(c.dep, dep)
    )
}

/** Day preference: A → C → unmarked → night B */
function dayRank(c: EssaRwyCombination): number {
    if (c.night) return 3
    if (c.id.endsWith('A')) return 0
    if (c.id.endsWith('C')) return 1
    return 2
}

/** Night preference: night B → A → C → unmarked */
function nightRank(c: EssaRwyCombination): number {
    if (c.night) return 0
    if (c.id.endsWith('A')) return 1
    if (c.id.endsWith('C')) return 2
    return 3
}

/**
 * Resolve ESSA runway combination id from active ARR/DEP runways.
 * When several lettered variants share the same runways, pick night (B)
 * outside 06–22 LT, otherwise prefer A (then C).
 */
export function resolveEssaRwyConfigId(
    arr: string[],
    dep: string[],
    now: Date = new Date()
): string | null {
    const matches = findMatchingEssaRwyConfigs(arr, dep)
    if (matches.length === 0) return null
    if (matches.length === 1) return matches[0]!.id

    const night = !isEssaRwyDayHours(now)
    const ranked = [...matches].sort(
        (a, b) => (night ? nightRank(a) - nightRank(b) : dayRank(a) - dayRank(b))
    )
    return ranked[0]!.id
}

/**
 * Format like the SAAB EFS indicator: `RWY: 9B - ARR 19L / DEP 19L-NIGHT`
 * Optional `configId` overrides the resolved id (manual picker).
 */
export function formatEssaRwyConfigLabel(
    arr: string[],
    dep: string[],
    options?: { configId?: string | null; now?: Date }
): string | null {
    if (arr.length === 0 && dep.length === 0 && !options?.configId) return null

    let id = options?.configId ?? null
    if (!id) {
        id = resolveEssaRwyConfigId(arr, dep, options?.now)
    }

    if (id) {
        const combo = getEssaRwyCombination(id)
        if (combo) return `RWY: ${id} - ${formatEssaRwyPdfName(combo)}`
        return `RWY: ${id}`
    }

    // Unmatched ES runways — show bare ARR/DEP
    const arrStr = arr.length > 0 ? arr.join('/') : '?'
    const depStr = dep.length > 0 ? dep.join('/') : '?'
    return `RWY: ARR ${arrStr} / DEP ${depStr}`
}

/**
 * VatIRIS quickref image basename for an ESSA config (e.g. "essa-twr-20").
 * Matches QuickRef.vue: indexOf(key) + (TWR ? 6 : 5), zero-padded.
 */
export function essaRwyQuickrefImageId(
    configId: string,
    type: 'TWR' | 'APP' = 'TWR'
): string | null {
    const combo = getEssaRwyCombination(configId)
    if (!combo) return null
    const index = ESSA_QUICKREF_KEYS.indexOf(combo.quickrefKey as (typeof ESSA_QUICKREF_KEYS)[number])
    if (index < 0) return null
    const offset = type === 'TWR' ? 6 : 5
    const num = String(index + offset).padStart(2, '0')
    return `essa-${type.toLowerCase()}-${num}`
}

/** Full URL to the VatIRIS quickref PNG for a config */
export function essaRwyQuickrefImageUrl(
    configId: string,
    type: 'TWR' | 'APP' = 'TWR'
): string | null {
    const id = essaRwyQuickrefImageId(configId, type)
    return id ? `${VATIRIS_QUICKREF_BASE}/${id}.png` : null
}

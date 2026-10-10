/**
 * AUP R16 service: fetch + parse the LFV daily use plan (cached with a TTL, like VatIRIS),
 * and expose the current R16 "utökad" status.
 *
 * The backend never switches the ESSA RWY config itself — it only reports `suggestConfigId`.
 * The manual RWY config lock lives in the frontend (`essaRwyConfigManual`), which applies the
 * suggestion only in AUTO mode.
 */
import { fetchTodayUsePlanPdf, planDateUtcFrom } from "./fetcher.js"
import { extractPdfPages, loadPdfDocument, parseUsePlanPages, planDateFromIso } from "./parser-layout.js"
import { detectStrikethroughAreas } from "./strikethrough.js"
import {
    computeR16Status,
    INACTIVE_R16,
    normalizeR16Name,
    sameR16Status,
    type EssaOps,
} from "./r16.js"
import type { AupR16Status, ParseWarning, Restriction } from "./types.js"

/** Same env names / default as VatIRIS (AUP_USEPLAN_TTL_SEC, 1 h). */
const USEPLAN_TTL_MS =
    (parseInt(process.env.AUP_USEPLAN_TTL_SEC || process.env.LARA_USEPLAN_TTL_SEC || "3600", 10) || 3600) * 1000
/** Retry sooner after a failed fetch/parse. */
const RETRY_AFTER_ERROR_MS = 5 * 60 * 1000
/** Re-evaluate status (time windows open/close) this often. */
const STATUS_TICK_MS = 60 * 1000

interface RawCache {
    fetchedAt: number
    planDate: string
    pdfUrl: string
    restrictions: Restriction[]
    parseWarnings: ParseWarning[]
}

let rawCache: RawCache | null = null
let lastAttemptAt = 0
let lastFailed = false
let inflight: Promise<void> | null = null

let getOps: (() => EssaOps | null) | null = null
let onChange: ((status: AupR16Status) => void) | null = null
let timer: ReturnType<typeof setInterval> | null = null
/** Baseline = inactive, so the first fetch that reveals an active R16 is broadcast. */
let lastBroadcast: AupR16Status = { ...INACTIVE_R16 }

/** Parse a use plan PDF into R16-relevant restrictions (all areas are kept; strikethrough rows removed). */
export async function parseUsePlanPdf(buffer: Buffer, planDateIso: string) {
    const { pdfjs, doc } = await loadPdfDocument(buffer)
    try {
        const pages = await extractPdfPages(doc)
        const { restrictions, parseWarnings } = parseUsePlanPages(pages, planDateFromIso(planDateIso))
        const struck = await detectStrikethroughAreas(doc, pdfjs.OPS as unknown as Record<string, number>)
        const kept = restrictions.filter((r) => !struck.has(r.name))
        return { restrictions: kept, parseWarnings, struckAreaIds: [...struck] }
    } finally {
        await doc.destroy()
    }
}

async function refreshRaw(): Promise<void> {
    lastAttemptAt = Date.now()
    try {
        const pdf = await fetchTodayUsePlanPdf()
        const { restrictions, parseWarnings, struckAreaIds } = await parseUsePlanPdf(pdf.buffer, pdf.planDate)
        rawCache = {
            fetchedAt: Date.now(),
            planDate: pdf.planDate,
            pdfUrl: pdf.pdfUrl,
            restrictions,
            parseWarnings,
        }
        lastFailed = false
        const r16 = restrictions.filter((r) => normalizeR16Name(r.name))
        console.log(
            `aup: ${pdf.planDate} v${pdf.version}  ${restrictions.length} restrictions ` +
                `(${r16.length} R16, ${struckAreaIds.length} struck)`,
        )
    } catch (err) {
        lastFailed = true
        console.warn(`aup: fetch/parse failed: ${err instanceof Error ? err.message : String(err)}`)
    }
}

function cacheFresh(now = Date.now()): boolean {
    if (!rawCache) return false
    if (rawCache.planDate !== planDateUtcFrom(new Date(now))) return false // new UTC day
    return now - rawCache.fetchedAt < USEPLAN_TTL_MS
}

/** Ensure the cache is fresh (single-flight, throttled after errors). */
export function ensureAupFresh(force = false): Promise<void> {
    if (inflight) return inflight
    const now = Date.now()
    if (!force && cacheFresh(now)) return Promise.resolve()
    if (!force && lastFailed && now - lastAttemptAt < RETRY_AFTER_ERROR_MS) return Promise.resolve()
    inflight = refreshRaw().finally(() => {
        inflight = null
    })
    return inflight
}

/** Current R16 status from cache (sync; inactive when nothing is cached). */
export function getAupR16Status(ops?: EssaOps | null, now: Date = new Date()): AupR16Status {
    // Do not trust yesterday's plan once the UTC day rolled over.
    if (!rawCache || rawCache.planDate !== planDateUtcFrom(now)) {
        return {
            ...INACTIVE_R16,
            fetchStatus: lastFailed ? 'error' : rawCache ? 'ok' : 'pending',
        }
    }
    const status = computeR16Status(rawCache.restrictions, now, ops ?? getOps?.() ?? null)
    return { ...status, fetchStatus: 'ok' }
}

/** Refresh-if-needed, then return status (for HTTP handlers). */
export async function getAupR16StatusFresh(ops?: EssaOps | null): Promise<AupR16Status> {
    await ensureAupFresh()
    return getAupR16Status(ops)
}

/** Re-evaluate and notify `onChange` when the status differs from the last broadcast. */
export function checkAupR16Change(): void {
    const status = getAupR16Status()
    if (sameR16Status(lastBroadcast, status)) return
    lastBroadcast = status
    onChange?.(status)
}

/**
 * Start background polling. Idempotent. `ops` supplies current ESSA ARR/DEP runways;
 * `notify` is called when the status changes (activation, expiry, runway change).
 */
export function startAupR16Service(options: {
    getEssaOps: () => EssaOps | null
    onChange: (status: AupR16Status) => void
}): void {
    getOps = options.getEssaOps
    onChange = options.onChange
    if (timer) return
    // Always use real LFV AUP (including when the server runs with --mock for flight data).
    // Utökad = active now AND topAltitudeFt > 1600; 1600 ft exactly is not utökad.
    void ensureAupFresh().then(() => checkAupR16Change())
    timer = setInterval(() => {
        void ensureAupFresh().then(() => checkAupR16Change())
    }, STATUS_TICK_MS)
    timer.unref?.()
}

export function stopAupR16Service(): void {
    if (timer) clearInterval(timer)
    timer = null
}

/** Test hook: inject parsed restrictions without network. */
export function __setAupRawForTest(restrictions: Restriction[], planDate = planDateUtcFrom()): void {
    rawCache = { fetchedAt: Date.now(), planDate, pdfUrl: "test", restrictions, parseWarnings: [] }
}

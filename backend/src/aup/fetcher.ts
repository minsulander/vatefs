/**
 * LFV daily airspace use plan (AUP) fetcher.
 * Adapted from VatIRIS backend/src/aup/fetcher.ts, without axios/cheerio:
 * Node 22 global fetch + a small anchor regex replace `a.document-link` scraping.
 */

export const LFV_BASE_URL = "https://aro.lfv.se"
export const LFV_DAILY_USE_PATH = "/Editorial/View/GeneralDocument?torLinkId=337&type=AIS&folderId=77"

const HTTP_TIMEOUT_MS = 30_000
const HTTP_HEADERS = { "User-Agent": "VatEFS-AUP/1.0" }

/** Matches link label or URL path: "... 2026-05-24 ... version 3" */
const PLAN_LINK_META_RE = /(\d{4})-(\d{2})-(\d{2}).*?version\s*(\d+)/i

export interface UsePlanDocumentLink {
    href: string
    label: string
    planDate: string
    version: number
}

export interface FetchedUsePlanPdf {
    sourcePageUrl: string
    pdfUrl: string
    planDate: string
    version: number
    buffer: Buffer
}

export function planDateUtcFrom(date: Date = new Date()): string {
    const y = date.getUTCFullYear()
    const m = String(date.getUTCMonth() + 1).padStart(2, "0")
    const d = String(date.getUTCDate()).padStart(2, "0")
    return `${y}-${m}-${d}`
}

export function parseUsePlanLinkMeta(href: string, label: string): UsePlanDocumentLink | null {
    let decodedHref = href
    try {
        decodedHref = decodeURIComponent(href)
    } catch {
        /* keep raw */
    }
    const m = `${label} ${decodedHref}`.match(PLAN_LINK_META_RE)
    if (!m) return null
    return {
        href,
        label: label.trim(),
        planDate: `${m[1]}-${m[2]}-${m[3]}`,
        version: parseInt(m[4]!, 10),
    }
}

function decodeHtmlEntities(s: string): string {
    return s
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&nbsp;/g, " ")
}

/** Extract `<a class="...document-link..." href="...">label</a>` pairs from the LFV page HTML. */
export function extractDocumentLinks(html: string): { href: string; label: string }[] {
    const out: { href: string; label: string }[] = []
    const anchorRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi
    let m: RegExpExecArray | null
    while ((m = anchorRe.exec(html)) !== null) {
        const attrs = m[1]!
        if (!/class\s*=\s*["'][^"']*\bdocument-link\b/i.test(attrs)) continue
        const hrefMatch = attrs.match(/href\s*=\s*["']([^"']+)["']/i)
        if (!hrefMatch) continue
        const label = decodeHtmlEntities(m[2]!.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim()
        out.push({ href: decodeHtmlEntities(hrefMatch[1]!), label })
    }
    return out
}

/** Newest version for the given plan date, or null when LFV has not published it. */
export function selectUsePlanLink(links: UsePlanDocumentLink[], planDate: string): UsePlanDocumentLink | null {
    const forDate = links.filter((l) => l.planDate === planDate)
    if (forDate.length === 0) return null
    return forDate.reduce((best, cur) => (cur.version > best.version ? cur : best))
}

async function fetchWithTimeout(url: string): Promise<Response> {
    const res = await fetch(url, {
        headers: HTTP_HEADERS,
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
    return res
}

/**
 * Fetch today's (UTC) newest use-plan PDF.
 * Only today's plan is needed to answer "is R16 active now?".
 */
export async function fetchTodayUsePlanPdf(now: Date = new Date()): Promise<FetchedUsePlanPdf> {
    const sourcePageUrl = `${LFV_BASE_URL}${LFV_DAILY_USE_PATH}`
    const html = await (await fetchWithTimeout(sourcePageUrl)).text()

    const anchors = extractDocumentLinks(html)
    if (anchors.length === 0) throw new Error("No a.document-link found on LFV airspace use plan page")

    const links: UsePlanDocumentLink[] = []
    for (const a of anchors) {
        const meta = parseUsePlanLinkMeta(a.href, a.label)
        if (meta) links.push(meta)
    }
    if (links.length === 0) throw new Error("Could not parse plan date/version from any LFV document link")

    const planDate = planDateUtcFrom(now)
    const link = selectUsePlanLink(links, planDate)
    if (!link) {
        const available = [...new Set(links.map((l) => l.planDate))].sort().join(", ")
        throw new Error(`No daily use plan PDF for ${planDate}. Available plan dates: ${available || "none"}`)
    }

    const pdfUrl = link.href.startsWith("http") ? link.href : `${LFV_BASE_URL}${link.href}`
    const buffer = Buffer.from(await (await fetchWithTimeout(pdfUrl)).arrayBuffer())
    return { sourcePageUrl, pdfUrl, planDate: link.planDate, version: link.version, buffer }
}

/**
 * Column-position based parser for the LFV daily use plan PDF.
 * Adapted from VatIRIS backend/src/aup/parser-layout.ts.
 *
 * Differences from VatIRIS:
 *  - takes pre-extracted pdfjs text items so the row logic is unit-testable
 *  - no pdf-parse text fallback / TopSky serialization (R16 only needs the layout path)
 */
import type { AltitudeType, ParseWarning, Restriction } from "./types.js"

export const SWEDISH_MONTHS: Record<string, number> = {
    jan: 0,
    feb: 1,
    mar: 2,
    apr: 3,
    maj: 4,
    jun: 5,
    jul: 6,
    aug: 7,
    sep: 8,
    okt: 9,
    nov: 10,
    dec: 11,
}

const TIME_RE = /^(\d{1,2}):(\d{2})$/
const DATE_RE = /^(\d{1,2})\s*(jan|feb|mar|apr|maj|jun|jul|aug|sep|okt|nov|dec)$/i
const AREA_RE = /^ES\s*SUP|^ES\s*[A-Z]/i
const TEMP_HEADER_RE = /^2\.\s*Temporary/i
const TEMP_SECTION_END_RE = /^3\.\s/
const TEMP_AREA_RE = /^([DR])(\d{2,3}[A-Z]?)\b/i
const ALT_FT_RE = /^(\d+)\s*ft$/i
const ALT_FL_RE = /^FL\s*(\d+)/i
/** Flight-level band: lower and upper limits (FL520-FL660, FL095-FL285). */
const ALT_FL_BAND_RE = /^FL\s*(\d+)\s*-\s*FL\s*(\d+)$/i
const ALT_UAV_GND_RE = /^UAV\s*120m-\s*GND$/i
/** Foreign-area band: e.g. A030-FL145 (feet floor to FL ceiling). */
const ALT_A_FL_BAND_RE = /^A(\d+)-FL(\d+)$/i

const COL = {
    area: { min: 0, max: 100 },
    tempArea: { min: 60, max: 130 },
    start: { min: 280, max: 350 },
    end: { min: 350, max: 400 },
    altitude: { min: 200, max: 280 },
    flRange: { min: 470, max: 560 },
}

export interface TextItem {
    str: string
    x: number
    y: number
}

export interface PlanDate {
    year: number
    month: number
    day: number
}

/** pdfjs text content item → positioned item (trimmed, empties dropped). */
export function toTextItems(items: Array<{ str?: string; transform?: number[] }>): TextItem[] {
    const out: TextItem[] = []
    for (const it of items) {
        if (typeof it.str !== "string" || !it.transform) continue
        const str = it.str.trim()
        if (!str) continue
        out.push({ str, x: it.transform[4]!, y: it.transform[5]! })
    }
    return out
}

export function planDateFromIso(iso: string): PlanDate {
    const [y, m, d] = iso.split("-").map(Number)
    return { year: y!, month: m! - 1, day: d! }
}

function utcDateTime(year: number, month: number, day: number, hour: number, minute: number): Date {
    return new Date(Date.UTC(year, month, day, hour, minute, 0, 0))
}

function parseAreaToken(raw: string): string {
    return raw.trim().replace(/\s+/g, "")
}

function parseTemporaryAreaToken(raw: string): string | null {
    const m = raw.trim().match(TEMP_AREA_RE)
    if (!m) return null
    return `ES${m[1]}${m[2]}`.toUpperCase()
}

function pickBandColumnItem(rowItems: TextItem[]): TextItem | undefined {
    return rowItems.find((it) => it.x >= COL.flRange.min && it.x <= COL.flRange.max)
}

type Alt = { altitude: string; altitudeType: AltitudeType; altitudeUpper?: string }

function parseFlLevelBand(rowItems: TextItem[]): Alt | null {
    const raw = pickBandColumnItem(rowItems)
    if (!raw || ALT_UAV_GND_RE.test(raw.str)) return null
    const m = raw.str.match(ALT_FL_BAND_RE)
    if (!m) return null
    return { altitude: m[1]!, altitudeType: "FL", altitudeUpper: m[2]! }
}

function parseAtoFlBand(rowItems: TextItem[]): Alt | null {
    const raw = pickBandColumnItem(rowItems)
    if (!raw) return null
    const m = raw.str.match(ALT_A_FL_BAND_RE)
    if (!m) return null
    return { altitude: m[1]!, altitudeType: "ft", altitudeUpper: m[2]! }
}

function parseSingleCeiling(rowItems: TextItem[]): Alt | null {
    const altRaw = rowItems.find(
        (it) =>
            it.x >= COL.altitude.min &&
            it.x <= COL.altitude.max &&
            (ALT_FT_RE.test(it.str) || ALT_FL_RE.test(it.str)),
    )
    if (!altRaw) return null
    const ft = altRaw.str.match(ALT_FT_RE)
    const fl = altRaw.str.match(ALT_FL_RE)
    if (ft) return { altitude: ft[1]!, altitudeType: "ft" }
    if (fl) return { altitude: fl[1]!, altitudeType: "FL" }
    return null
}

function parseAltitudes(rowItems: TextItem[]): Alt | null {
    return parseFlLevelBand(rowItems) ?? parseAtoFlBand(rowItems) ?? parseSingleCeiling(rowItems)
}

function activityComment(rowItems: TextItem[]): string {
    return rowItems.some((it) => it.x > 400 && /^ACFT|^CIV|^MIL|^TT/i.test(it.str)) ? "FLYG" : ""
}

function pickColumn(items: TextItem[], col: { min: number; max: number }): string | undefined {
    const hit = items.filter((it) => it.x >= col.min && it.x <= col.max).sort((a, b) => a.x - b.x)
    return hit[0]?.str
}

function parseSwedishDate(token: string, plan: PlanDate, role: "start" | "end"): Date | null {
    const m = token.match(DATE_RE)
    if (!m) return null
    const day = parseInt(m[1]!, 10)
    const month = SWEDISH_MONTHS[m[2]!.toLowerCase()]
    if (month === undefined) return null
    let year = plan.year
    let mon = month
    if (role === "end" && month === plan.month && day < plan.day) {
        mon = month + 1
        if (mon > 11) {
            mon = 0
            year += 1
        }
    }
    return utcDateTime(year, mon, day, role === "end" ? 23 : 0, role === "end" ? 59 : 0)
}

function parseTimeOnPlan(token: string, plan: PlanDate): Date | null {
    const m = token.match(TIME_RE)
    if (!m) return null
    const hour = parseInt(m[1]!, 10)
    const minute = parseInt(m[2]!, 10)
    if (hour > 23 || minute > 59) return null
    return utcDateTime(plan.year, plan.month, plan.day, hour, minute)
}

function parseStartEnd(
    startToken: string | undefined,
    endToken: string | undefined,
    plan: PlanDate,
): { from: Date; to: Date } | null {
    if (!startToken || !endToken) return null

    const startIsTime = TIME_RE.test(startToken)
    const endIsTime = TIME_RE.test(endToken)
    const startIsDate = DATE_RE.test(startToken)
    const endIsDate = DATE_RE.test(endToken)

    let from: Date | null = null
    let to: Date | null = null

    if (startIsTime) {
        from = parseTimeOnPlan(startToken, plan)
    } else if (startIsDate) {
        from = parseSwedishDate(startToken, plan, "start")
        if (from) from = utcDateTime(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), 0, 0)
    }

    if (endIsTime) {
        to = parseTimeOnPlan(endToken, plan)
    } else if (endIsDate) {
        to = parseSwedishDate(endToken, plan, "end")
    }

    if (!from || !to) return null

    if (startIsTime && endIsTime && to.getTime() <= from.getTime()) {
        to = new Date(to.getTime() + 24 * 60 * 60 * 1000)
    }

    if (startIsDate && endIsDate) {
        const sm = startToken.match(DATE_RE)!
        const em = endToken.match(DATE_RE)!
        const fromDay = parseInt(sm[1]!, 10)
        const toDay = parseInt(em[1]!, 10)
        const fromMonth = SWEDISH_MONTHS[sm[2]!.toLowerCase()]
        let toMonth = SWEDISH_MONTHS[em[2]!.toLowerCase()]
        let year = plan.year
        if (toMonth === undefined || fromMonth === undefined) return null
        if (toMonth < fromMonth || (toMonth === fromMonth && toDay < fromDay)) {
            year += 1
        } else if (toDay < fromDay && toMonth === fromMonth) {
            toMonth = fromMonth + 1
        }
        to = utcDateTime(year, toMonth, toDay, 23, 59)
    }

    return { from, to }
}

function parseLayoutRow(
    rowItems: TextItem[],
    plan: PlanDate,
    areaName: string,
): { restriction: Restriction } | { warning: ParseWarning } {
    const startToken = pickColumn(rowItems, COL.start)
    const endToken = pickColumn(rowItems, COL.end)
    const times = parseStartEnd(startToken, endToken, plan)
    if (!times) {
        return {
            warning: {
                snippet: `${startToken ?? "?"} - ${endToken ?? "?"}`,
                message: `Could not parse start/end for ${areaName}`,
            },
        }
    }

    const alt = parseAltitudes(rowItems)
    if (!alt) {
        return { warning: { snippet: areaName, message: "No altitude in layout row" } }
    }

    return {
        restriction: {
            name: areaName,
            from: times.from,
            to: times.to,
            altitude: alt.altitude,
            altitudeType: alt.altitudeType,
            altitudeUpper: alt.altitudeUpper,
            comment: activityComment(rowItems),
        },
    }
}

function groupRows(items: TextItem[]): Map<number, TextItem[]> {
    const rows = new Map<number, TextItem[]>()
    for (const it of items) {
        const y = Math.round(it.y)
        let key = y
        for (const existing of rows.keys()) {
            if (Math.abs(existing - y) <= 2) {
                key = existing
                break
            }
        }
        if (!rows.has(key)) rows.set(key, [])
        rows.get(key)!.push(it)
    }
    return rows
}

/** Parse all pages (already extracted as positioned text items). */
export function parseUsePlanPages(
    pages: TextItem[][],
    plan: PlanDate,
): { restrictions: Restriction[]; parseWarnings: ParseWarning[] } {
    const restrictions: Restriction[] = []
    const parseWarnings: ParseWarning[] = []
    let inTemporarySection = false

    for (const items of pages) {
        let temporaryEndY: number | null = null
        for (const it of items) {
            if (TEMP_HEADER_RE.test(it.str)) inTemporarySection = true
            else if (TEMP_SECTION_END_RE.test(it.str)) temporaryEndY = it.y
        }

        const rows = groupRows(items)

        for (const [rowY, rowItems] of rows) {
            const rowInTemporary = inTemporarySection && (temporaryEndY === null || rowY > temporaryEndY)

            if (rowInTemporary) {
                const tempRaw = rowItems.find(
                    (it) =>
                        it.x >= COL.tempArea.min && it.x <= COL.tempArea.max && TEMP_AREA_RE.test(it.str),
                )
                if (tempRaw) {
                    const name = parseTemporaryAreaToken(tempRaw.str)
                    if (!name) continue
                    const parsed = parseLayoutRow(rowItems, plan, name)
                    if ("restriction" in parsed) restrictions.push(parsed.restriction)
                    else parseWarnings.push(parsed.warning)
                    continue
                }
            }

            const areaRaw = rowItems.find(
                (it) => it.x >= COL.area.min && it.x <= COL.area.max && AREA_RE.test(it.str),
            )
            if (!areaRaw) continue

            const name = parseAreaToken(areaRaw.str)
            const parsed = parseLayoutRow(rowItems, plan, name)
            if ("restriction" in parsed) restrictions.push(parsed.restriction)
            else parseWarnings.push(parsed.warning)
        }

        if (temporaryEndY !== null) inTemporarySection = false
    }

    return { restrictions, parseWarnings }
}

/** pdfjs-dist (legacy build, Node-safe) loader. Lazy so the server starts without a PDF ever being parsed. */
export async function loadPdfDocument(pdfBuffer: Buffer) {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs")
    const doc = await pdfjs.getDocument({ data: new Uint8Array(pdfBuffer), verbosity: 0 }).promise
    return { pdfjs, doc }
}

export type PdfDoc = Awaited<ReturnType<typeof loadPdfDocument>>["doc"]

export async function extractPdfPages(doc: PdfDoc): Promise<TextItem[][]> {
    const pages: TextItem[][] = []
    for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p)
        const content = await page.getTextContent()
        pages.push(toTextItems(content.items as Array<{ str?: string; transform?: number[] }>))
    }
    return pages
}

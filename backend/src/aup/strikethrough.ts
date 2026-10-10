/**
 * Detect area rows cancelled by horizontal strikethrough lines in LFV AUP PDFs.
 * Adapted from VatIRIS backend/src/aup/strikethrough.ts (reuses an already-loaded pdfjs document).
 * Plain text extraction does not include line graphics, so we inspect the operator list.
 */
import type { PdfDoc } from "./parser-layout.js"

const STROKE_MIN_WIDTH = 100
const STROKE_MAX_HEIGHT = 5
const STROKE_Y_TOLERANCE = 8
const AREA_LABEL_RE = /^ES\s*SUP|^ES\s*R/i

export interface StrikethroughStroke {
    y: number
    x1: number
    x2: number
}

export interface AreaTextMark {
    name: string
    y: number
    page: number
}

/** Horizontal stroke paths from constructPath bounding boxes (LFV draws strikethrough as thin wide paths). */
export function extractHorizontalStrokes(
    fnArray: number[],
    argsArray: unknown[],
    OPS: Record<string, number>,
): StrikethroughStroke[] {
    const strokes: StrikethroughStroke[] = []
    const constructPathOp = OPS.constructPath
    for (let i = 0; i < fnArray.length; i++) {
        if (fnArray[i] !== constructPathOp) continue
        const arg = argsArray[i]
        if (!Array.isArray(arg) || arg.length < 3) continue
        const minMax = arg[2] as number[] | null
        if (!minMax || minMax.length < 4) continue
        const [x1, y1, x2, y2] = minMax as [number, number, number, number]
        if (x2 - x1 >= STROKE_MIN_WIDTH && y2 - y1 <= STROKE_MAX_HEIGHT) {
            strokes.push({ y: (y1 + y2) / 2, x1, x2 })
        }
    }
    return strokes
}

export function extractAreaLabels(
    items: Array<{ str: string; transform: number[] }>,
    page: number,
): AreaTextMark[] {
    const marks: AreaTextMark[] = []
    for (const it of items) {
        const str = it.str.trim()
        if (!AREA_LABEL_RE.test(str)) continue
        marks.push({ name: str.replace(/\s+/g, ""), y: it.transform[5]!, page })
    }
    return marks
}

export function isRowStruck(labelY: number, strokes: StrikethroughStroke[]): boolean {
    return strokes.some((s) => Math.abs(s.y - labelY) <= STROKE_Y_TOLERANCE && s.x1 <= 200 && s.x2 >= 50)
}

export function findStruckAreaIds(
    labels: AreaTextMark[],
    strokesByPage: Map<number, StrikethroughStroke[]>,
): Set<string> {
    const struck = new Set<string>()
    for (const label of labels) {
        if (isRowStruck(label.y, strokesByPage.get(label.page) || [])) struck.add(label.name)
    }
    return struck
}

export async function detectStrikethroughAreas(
    doc: PdfDoc,
    OPS: Record<string, number>,
): Promise<Set<string>> {
    const allLabels: AreaTextMark[] = []
    const strokesByPage = new Map<number, StrikethroughStroke[]>()

    for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p)
        const ops = await page.getOperatorList()
        strokesByPage.set(p, extractHorizontalStrokes(ops.fnArray, ops.argsArray, OPS))
        const content = await page.getTextContent()
        allLabels.push(
            ...extractAreaLabels(content.items as Array<{ str: string; transform: number[] }>, p),
        )
    }
    return findStruckAreaIds(allLabels, strokesByPage)
}

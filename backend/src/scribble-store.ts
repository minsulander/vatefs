/**
 * Authoritative scribble strokes for connected EFS clients (local WS fanout).
 * SAAB and paper are separate canvases for the same strip id.
 */

import type { ScribbleCanvas, ScribbleStrokePayload } from "@vatefs/common"

interface Canvases {
    saab: ScribbleStrokePayload[]
    paper: ScribbleStrokePayload[]
}

const byStripId = new Map<string, Canvases>()
const remoteUpdatedAt = new Map<string, string>()

function blank(): Canvases {
    return { saab: [], paper: [] }
}

export function strokeCanvas(raw: {
    canvas?: unknown
    tag?: unknown
    color?: unknown
}): ScribbleCanvas {
    if (raw.canvas === "paper" || raw.canvas === "saab") return raw.canvas
    if (typeof raw.tag === "string" && raw.tag) return "paper"
    if (raw.color === "red" || raw.color === "blue") return "paper"
    return "saab"
}

function normalizeStroke(raw: unknown): ScribbleStrokePayload | null {
    if (!raw || typeof raw !== "object") return null
    const points = (raw as { points?: unknown }).points
    if (typeof points !== "string" || !points) return null
    const c = (raw as { color?: unknown }).color
    const color: ScribbleStrokePayload["color"] =
        c === "red" ? "red" : c === "black" ? "black" : "blue"
    const tag = (raw as { tag?: unknown }).tag
    const canvas = strokeCanvas({
        canvas: (raw as { canvas?: unknown }).canvas,
        tag,
        color,
    })
    if (typeof tag === "string" && tag) return { points, color, tag, canvas }
    return { points, color, canvas }
}

export function normalizeStrokes(raw: unknown): ScribbleStrokePayload[] {
    if (!Array.isArray(raw)) return []
    return raw.map(normalizeStroke).filter((s): s is ScribbleStrokePayload => !!s)
}

function writeEntry(stripId: string, entry: Canvases) {
    if (entry.saab.length === 0 && entry.paper.length === 0) byStripId.delete(stripId)
    else byStripId.set(stripId, entry)
}

/** Both faces, each stroke tagged with its canvas. Remote sync stores this list. */
export function getScribbles(stripId: string): ScribbleStrokePayload[] {
    const entry = byStripId.get(stripId)
    if (!entry) return []
    return [...entry.saab, ...entry.paper]
}

export function getCanvas(stripId: string, canvas: ScribbleCanvas): ScribbleStrokePayload[] {
    return byStripId.get(stripId)?.[canvas] ?? []
}

/** Replace one face. The other face is left as it is. */
export function setCanvas(
    stripId: string,
    canvas: ScribbleCanvas,
    strokes: ScribbleStrokePayload[],
    opts?: { remoteUpdatedAt?: string },
): ScribbleStrokePayload[] {
    const next = normalizeStrokes(strokes).map((s) => ({ ...s, canvas }))
    const entry = byStripId.get(stripId) ?? blank()
    entry[canvas] = next
    writeEntry(stripId, entry)
    if (opts?.remoteUpdatedAt) remoteUpdatedAt.set(stripId, opts.remoteUpdatedAt)
    return next
}

/** Replace both faces from a flat list (remote snapshot or a legacy payload). */
export function setScribbles(
    stripId: string,
    strokes: ScribbleStrokePayload[],
    opts?: { remoteUpdatedAt?: string },
): ScribbleStrokePayload[] {
    const next = normalizeStrokes(strokes)
    const entry = blank()
    for (const stroke of next) {
        const canvas = stroke.canvas === "paper" ? "paper" : "saab"
        entry[canvas].push({ ...stroke, canvas })
    }
    writeEntry(stripId, entry)
    if (opts?.remoteUpdatedAt) remoteUpdatedAt.set(stripId, opts.remoteUpdatedAt)
    return getScribbles(stripId)
}

export function getRemoteUpdatedAt(stripId: string): string | undefined {
    return remoteUpdatedAt.get(stripId)
}

export function snapshotAll(): Record<string, ScribbleStrokePayload[]> {
    const out: Record<string, ScribbleStrokePayload[]> = {}
    for (const [id] of byStripId) {
        out[id] = getScribbles(id)
    }
    return out
}

export function snapshotCanvases(): Array<{
    stripId: string
    canvas: ScribbleCanvas
    strokes: ScribbleStrokePayload[]
}> {
    const out: Array<{
        stripId: string
        canvas: ScribbleCanvas
        strokes: ScribbleStrokePayload[]
    }> = []
    for (const [stripId, entry] of byStripId) {
        if (entry.saab.length) out.push({ stripId, canvas: "saab", strokes: entry.saab })
        if (entry.paper.length) out.push({ stripId, canvas: "paper", strokes: entry.paper })
    }
    return out
}

export function clearScribbles(stripId: string) {
    byStripId.delete(stripId)
    remoteUpdatedAt.delete(stripId)
}

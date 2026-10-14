/**
 * Authoritative scribble strokes for connected EFS clients (local WS fanout).
 */

import type { ScribbleStrokePayload } from "@vatefs/common"

const strokesByStripId = new Map<string, ScribbleStrokePayload[]>()
const remoteUpdatedAt = new Map<string, string>()

function normalizeStroke(raw: unknown): ScribbleStrokePayload | null {
    if (!raw || typeof raw !== "object") return null
    const points = (raw as { points?: unknown }).points
    if (typeof points !== "string" || !points) return null
    const c = (raw as { color?: unknown }).color
    const color: ScribbleStrokePayload["color"] =
        c === "red" ? "red" : c === "black" ? "black" : "blue"
    const tag = (raw as { tag?: unknown }).tag
    if (typeof tag === "string" && tag) return { points, color, tag }
    return { points, color }
}

export function normalizeStrokes(raw: unknown): ScribbleStrokePayload[] {
    if (!Array.isArray(raw)) return []
    return raw.map(normalizeStroke).filter((s): s is ScribbleStrokePayload => !!s)
}

export function getScribbles(stripId: string): ScribbleStrokePayload[] {
    return strokesByStripId.get(stripId) ?? []
}

export function setScribbles(
    stripId: string,
    strokes: ScribbleStrokePayload[],
    opts?: { remoteUpdatedAt?: string },
): ScribbleStrokePayload[] {
    const next = normalizeStrokes(strokes)
    if (next.length === 0) strokesByStripId.delete(stripId)
    else strokesByStripId.set(stripId, next)
    if (opts?.remoteUpdatedAt) remoteUpdatedAt.set(stripId, opts.remoteUpdatedAt)
    return next
}

export function getRemoteUpdatedAt(stripId: string): string | undefined {
    return remoteUpdatedAt.get(stripId)
}

export function snapshotAll(): Record<string, ScribbleStrokePayload[]> {
    const out: Record<string, ScribbleStrokePayload[]> = {}
    for (const [id, strokes] of strokesByStripId) {
        out[id] = strokes
    }
    return out
}

export function clearScribbles(stripId: string) {
    strokesByStripId.delete(stripId)
    remoteUpdatedAt.delete(stripId)
}

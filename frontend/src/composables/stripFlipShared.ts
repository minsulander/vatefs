/** Shared FLIP timing + drag suppress (no Pinia import — safe for store). */

export const STRIP_FLIP_DURATION_MS = 500

let suppressFlipUntilMs = 0

/** Call from strip dragend / touch-drag end so cross-bay drops don't FLIP-glitch. */
export function markStripDragEnded(holdMs = STRIP_FLIP_DURATION_MS + 50) {
  suppressFlipUntilMs = Math.max(suppressFlipUntilMs, performance.now() + holdMs)
}

export function isStripFlipSuppressed(): boolean {
  return performance.now() < suppressFlipUntilMs
}

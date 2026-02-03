/**
 * Shared gap management utilities used by both frontend and backend.
 */

import type { Gap } from "./types.js"

/** Minimum pixels to create/maintain a gap */
export const GAP_BUFFER = 30

/**
 * Generate a unique key for a gap based on its location
 */
export function gapKey(bayId: string, sectionId: string, index: number): string {
    return `${bayId}:${sectionId}:${index}`
}

/**
 * Parse a gap key back into its components
 */
export function parseGapKey(key: string): { bayId: string; sectionId: string; index: number } | null {
    const parts = key.split(':')
    if (parts.length !== 3) return null
    const index = parseInt(parts[2], 10)
    if (isNaN(index)) return null
    return { bayId: parts[0], sectionId: parts[1], index }
}

/**
 * Calculate gap adjustments when a strip moves within the same section.
 * Returns the updates that should be applied to gap indices.
 */
export function calculateGapAdjustments(
    sectionGaps: Gap[],
    fromIndex: number,
    toIndex: number
): { oldIndex: number; newIndex: number }[] {
    const adjustments: { oldIndex: number; newIndex: number }[] = []

    for (const gap of sectionGaps) {
        let newIndex = gap.index

        if (fromIndex < toIndex) {
            // Moving down: gaps between from and to shift up by 1
            if (gap.index > fromIndex && gap.index <= toIndex) {
                newIndex = gap.index - 1
            }
        } else {
            // Moving up: gaps between to and from shift down by 1
            if (gap.index >= toIndex && gap.index < fromIndex) {
                newIndex = gap.index + 1
            }
        }

        if (newIndex !== gap.index) {
            adjustments.push({ oldIndex: gap.index, newIndex })
        }
    }

    return adjustments
}

/**
 * Shared drag-and-drop insert math for the cyan placement line and the drop commit.
 *
 * The line is drawn against the v-for (the drag source still occupies a row).
 * The commit index is counted on the other strips only — moveStrip splices into
 * that list. visualIndexForInsert maps one onto the other so the line marks
 * the row the strip actually lands in.
 */

/** Index among `strips` where clientY inserts (`strips.length` = after the last). */
export function insertIndexAtClientY(strips: ArrayLike<Element>, clientY: number): number {
  const list = Array.from(strips)
  for (let i = 0; i < list.length; i++) {
    const el = list[i]
    if (!el) continue
    const rect = el.getBoundingClientRect()
    if (clientY < rect.top + rect.height / 2) return i
  }
  return list.length
}

/**
 * Map an insert index counted on non-dragging strips onto the v-for index
 * of `allStrips` (drag source still rendered). `allStrips.length` = end line.
 */
export function visualIndexForInsert(allStrips: ArrayLike<Element>, insertAmongVisible: number): number {
  const list = Array.from(allStrips)
  let seen = 0
  for (let i = 0; i < list.length; i++) {
    if (seen === insertAmongVisible) return i
    const el = list[i]
    if (el && !el.classList.contains('dragging')) seen++
  }
  return list.length
}

export function flightStripsIn(container: Element, includeDragging: boolean): HTMLElement[] {
  const sel = includeDragging ? '.flight-strip' : '.flight-strip:not(.dragging)'
  return Array.from(container.querySelectorAll<HTMLElement>(sel))
}

/** Id of the strip currently under the pointer (HTML5 or touch). */
export function draggingStripId(): string | null {
  const el = document.querySelector('.flight-strip.dragging')
  return el?.getAttribute('data-strip-id') ?? null
}

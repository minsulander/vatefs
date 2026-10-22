import { nextTick, ref } from 'vue'
import {
  collapseStripExpanders,
  getStripExpanderState,
  isCdAllOrTsatSection,
  setStripExpanderState,
} from './useStripExpanders'
import {
  clearStripFitBaseline,
  getStripFitBaseline,
  isStripCompact,
  setStripFitBaseline,
  setStripSizeMode,
  type StripFitBaseline,
} from './useStripSizeMode'

export type { StripFitBaseline }

const OVERFLOW_EPS_PX = 2
/** Min free px (content vs viewport) before trying a grow step. */
const GROW_MIN_FREE_PX = 8

/**
 * User chose Expanded / Normal / Compact (or toggled expanders) — auto-fit must
 * not shrink or grow this strip. Scrollbar is allowed if the bay no longer fits.
 */
const manualSizeLockById = new Set<string>()

export const autoFitLayoutEpoch = ref(0)
export const autoFitApplying = ref(false)

export function notifyAutoFitLayoutChanged(): void {
  autoFitLayoutEpoch.value++
}

export function clearAutoFitState(stripId: string): void {
  clearStripFitBaseline(stripId)
  manualSizeLockById.delete(stripId)
}

/**
 * User picked a size / expander state manually.
 * Locks the strip out of auto shrink/grow so enlarging can create a scrollbar.
 * Does NOT recheck the bay — a full fit pass would briefly grow/re-shrink other
 * auto-minimized strips (visible glitch when opening one expander).
 */
export function adoptManualStripFitBaseline(stripId: string): void {
  setStripFitBaseline(stripId, snapshotCurrent(stripId))
  manualSizeLockById.add(stripId)
}

export function isAutoFitExemptSection(sectionId: string): boolean {
  if (isCdAllOrTsatSection(sectionId)) return true
  if (sectionId === 'dep') return true
  if (!sectionId.endsWith('_dep')) return false
  if (
    sectionId.endsWith('_pending_dep') ||
    sectionId.endsWith('_taxi_dep') ||
    sectionId.endsWith('_ctr_dep')
  ) {
    return false
  }
  return true
}

function snapshotCurrent(stripId: string): StripFitBaseline {
  const exp = getStripExpanderState(stripId)
  return {
    compact: isStripCompact(stripId),
    top: exp.top,
    bottom: exp.bottom,
  }
}

/** Ceiling before auto-reduction; infer Normal if compact and tracking was lost. */
function resolveCeiling(stripId: string): StripFitBaseline {
  const existing = getStripFitBaseline(stripId)
  if (existing) return existing
  if (isStripCompact(stripId)) {
    const inferred: StripFitBaseline = { compact: false, top: false, bottom: false }
    setStripFitBaseline(stripId, inferred)
    return inferred
  }
  return snapshotCurrent(stripId)
}

function ensureCeilingBeforeShrink(stripId: string): void {
  if (getStripFitBaseline(stripId)) return
  setStripFitBaseline(stripId, snapshotCurrent(stripId))
}

export function isBelowCeiling(stripId: string): boolean {
  const ceiling = getStripFitBaseline(stripId)
  if (!ceiling) return isStripCompact(stripId)
  if (isStripCompact(stripId) && !ceiling.compact) return true
  if (isStripCompact(stripId)) return false
  const exp = getStripExpanderState(stripId)
  if (ceiling.top && !exp.top) return true
  if (ceiling.bottom && !exp.bottom) return true
  return false
}

type GrowKind = 'uncompact' | 'expanders'

function nextGrowKind(stripId: string): GrowKind | null {
  if (manualSizeLockById.has(stripId)) return null
  const ceiling = resolveCeiling(stripId)
  if (isStripCompact(stripId) && !ceiling.compact) return 'uncompact'
  if (!isStripCompact(stripId)) {
    const exp = getStripExpanderState(stripId)
    if ((ceiling.top && !exp.top) || (ceiling.bottom && !exp.bottom)) return 'expanders'
  }
  return null
}

function applyGrow(stripId: string, kind: GrowKind): void {
  const ceiling = resolveCeiling(stripId)
  if (kind === 'uncompact') {
    setStripSizeMode(stripId, 'normal')
    return
  }
  setStripExpanderState(stripId, { top: ceiling.top, bottom: ceiling.bottom })
}

function revertGrow(stripId: string, kind: GrowKind): void {
  if (kind === 'uncompact') {
    setStripSizeMode(stripId, 'compact')
    return
  }
  collapseStripExpanders(stripId)
}

function canShrink(stripId: string, canCompact: boolean): boolean {
  if (manualSizeLockById.has(stripId)) return false
  if (isStripCompact(stripId)) return false
  const exp = getStripExpanderState(stripId)
  if (exp.top || exp.bottom) return true
  return canCompact
}

function shrinkOneStep(stripId: string, canCompact: boolean): boolean {
  if (!canShrink(stripId, canCompact)) return false
  ensureCeilingBeforeShrink(stripId)
  const exp = getStripExpanderState(stripId)
  if (exp.top || exp.bottom) {
    collapseStripExpanders(stripId)
    return true
  }
  if (canCompact) {
    setStripSizeMode(stripId, 'compact')
    return true
  }
  return false
}

/**
 * True content height of the strip list.
 * Do NOT use scrollHeight − clientHeight: when content fits, browsers set
 * scrollHeight === clientHeight, so "free space" always reads as 0 and grow-back
 * never runs.
 */
export function contentSpanPx(el: HTMLElement): number {
  const kids = el.children
  if (!kids.length) return 0
  let minTop = Infinity
  let maxBottom = 0
  for (let i = 0; i < kids.length; i++) {
    const c = kids[i] as HTMLElement
    // skip zero-size spacers that aren't laid out
    if (c.offsetHeight === 0 && c.offsetWidth === 0) continue
    minTop = Math.min(minTop, c.offsetTop)
    maxBottom = Math.max(maxBottom, c.offsetTop + c.offsetHeight)
  }
  if (!Number.isFinite(minTop)) return 0
  return Math.max(0, maxBottom - minTop)
}

export function freeSpacePx(el: HTMLElement): number {
  return el.clientHeight - contentSpanPx(el)
}

export function containerOverflows(el: HTMLElement): boolean {
  // scrollHeight is reliable for "needs scrollbar"
  return el.scrollHeight > el.clientHeight + OVERFLOW_EPS_PX
}

function waitFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve())
  })
}

async function waitLayout(): Promise<void> {
  await nextTick()
  await waitFrame()
  await waitFrame()
}

/**
 * Auto-fit size priority follows **first-in-sequence** in the visual list.
 *
 * `preferTop: true` (default) — first is visual top: shrink bottom→top, grow top→bottom.
 * `preferTop: false` — first is visual bottom (ESSA/SAAB INBOUND APP ETA / TSAT order):
 * shrink top→bottom, grow bottom→top, so the earliest/first strip stays full.
 */
export function shrinkOrderIds(visualIds: string[], preferTop = true): string[] {
  return preferTop ? [...visualIds].reverse() : [...visualIds]
}

export function growOrderIds(visualIds: string[], preferTop = true): string[] {
  return preferTop ? [...visualIds] : [...visualIds].reverse()
}

export function firstInSequenceId(
  visualIds: string[],
  preferTop = true,
): string | undefined {
  if (visualIds.length === 0) return undefined
  return preferTop ? visualIds[0] : visualIds[visualIds.length - 1]
}

export function scrollStripListToBottom(container: HTMLElement): void {
  if (container.scrollHeight <= container.clientHeight + OVERFLOW_EPS_PX) return
  const max = container.scrollHeight - container.clientHeight
  if (Math.abs(container.scrollTop - max) < 4) return
  container.scrollTop = max
}

export function centerScrollOnFirstInSequence(
  container: HTMLElement,
  visualIds: string[],
  preferTop = true,
): void {
  if (container.scrollHeight <= container.clientHeight + OVERFLOW_EPS_PX) return

  const targetId = firstInSequenceId(visualIds, preferTop)
  if (!targetId) return
  const escape =
    typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
      ? CSS.escape(targetId)
      : targetId.replace(/"/g, '\\"')
  const stripEl = container.querySelector(
    `.flight-strip[data-strip-id="${escape}"]`,
  ) as HTMLElement | null
  if (!stripEl) return
  const cRect = container.getBoundingClientRect()
  const sRect = stripEl.getBoundingClientRect()
  const delta =
    sRect.top + sRect.height / 2 - (cRect.top + cRect.height / 2)
  if (Math.abs(delta) < 4) return
  container.scrollTop += delta
}

export interface AutoFitRunOptions {
  container: HTMLElement
  visualIds: string[]
  /**
   * When true (default), first-in-sequence is visual top — keep it largest
   * (shrink bottom-first, grow top-first). When false, first is visual bottom
   * (ESSA INBOUND APP / TSAT) — keep the bottom strip largest instead.
   * Prefer over section.addFromTop (insert position ≠ size priority).
   */
  preferTop?: boolean
  /** @deprecated Use preferTop. Treated as preferTop when preferTop omitted. */
  addFromTop?: boolean
  canCompact: (stripId: string) => boolean
  allowSizeFit: boolean
  growBack: boolean
  scrollToBottom?: boolean
}

export async function runAutoFitStripSize(opts: AutoFitRunOptions): Promise<void> {
  const {
    container,
    visualIds,
    canCompact,
    allowSizeFit,
    growBack,
    scrollToBottom = false,
  } = opts
  const preferTop = opts.preferTop ?? opts.addFromTop ?? true
  await waitLayout()

  autoFitApplying.value = true
  try {
    if (allowSizeFit && visualIds.length > 0) {
      const shrinkIds = shrinkOrderIds(visualIds, preferTop)
      let guard = shrinkIds.length * 2 + 2
      while (guard-- > 0 && containerOverflows(container)) {
        let stepped = false
        for (const id of shrinkIds) {
          if (shrinkOneStep(id, canCompact(id))) {
            stepped = true
            await waitLayout()
            break
          }
        }
        if (!stepped) break
      }

      if (growBack) {
        const growIds = growOrderIds(visualIds, preferTop)
        guard = growIds.length * 2 + 4
        while (guard-- > 0) {
          // Content-based free space (scrollHeight cannot see slack when fitting)
          if (freeSpacePx(container) < GROW_MIN_FREE_PX) break
          if (containerOverflows(container)) break

          let stepped = false
          for (const id of growIds) {
            const kind = nextGrowKind(id)
            if (!kind) continue

            applyGrow(id, kind)
            stepped = true
            await waitLayout()

            if (containerOverflows(container)) {
              // Do NOT skip to a lower-priority strip — that created
              // full–compact–full holes and could leave the last strip maximised.
              revertGrow(id, kind)
              await waitLayout()
              stepped = false
            }
            break
          }
          if (!stepped) break
        }
      }
    }

    if (scrollToBottom) {
      scrollStripListToBottom(container)
    } else {
      centerScrollOnFirstInSequence(container, visualIds, preferTop)
    }
  } finally {
    autoFitApplying.value = false
  }
}

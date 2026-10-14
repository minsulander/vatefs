import { watch, nextTick, type Ref, type ComputedRef } from 'vue'
import { useEfsStore } from '@/store/efs'
import {
  STRIP_FLIP_DURATION_MS,
  isStripFlipSuppressed,
} from '@/composables/stripFlipShared'
import {
  afterLayoutSettle,
  driveAnimationWallClock,
} from '@/composables/wallClockAnimation'

export { STRIP_FLIP_DURATION_MS, markStripDragEnded } from '@/composables/stripFlipShared'

const STRIP_FLIP_EASING = 'ease-in-out'
const STRIP_FLIP_ANIM_ID = 'strip-order-flip'
const MIN_DELTA_PX = 1

function idsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

function isDragInProgress(): boolean {
  if (isStripFlipSuppressed()) return true
  return !!document.querySelector('.flight-strip.dragging')
}

function isAutoMoveOwned(id: string, el: HTMLElement): boolean {
  // Class and reactive store set (set before strip remount) — fly-clone owns this strip.
  if (el.classList.contains('auto-move-hidden')) return true
  return useEfsStore().autoMovingStripIds.has(id)
}

function measureStripRects(container: HTMLElement): Map<string, DOMRect> {
  const map = new Map<string, DOMRect>()
  const nodes = container.querySelectorAll<HTMLElement>('.flight-strip[data-strip-id]')
  for (const el of nodes) {
    const id = el.getAttribute('data-strip-id')
    if (!id) continue
    // Fly-clone owns this strip; neighbors still FLIP.
    if (isAutoMoveOwned(id, el)) continue
    map.set(id, el.getBoundingClientRect())
  }
  return map
}

function cancelStripFlipAnimations(container: HTMLElement) {
  const nodes = container.querySelectorAll<HTMLElement>('.flight-strip[data-strip-id]')
  for (const el of nodes) {
    for (const anim of el.getAnimations()) {
      if (anim.id === STRIP_FLIP_ANIM_ID) anim.cancel()
    }
  }
}

function playStripFlip(container: HTMLElement, first: Map<string, DOMRect>) {
  if (first.size === 0) return
  const nodes = container.querySelectorAll<HTMLElement>('.flight-strip[data-strip-id]')
  for (const el of nodes) {
    const id = el.getAttribute('data-strip-id')
    if (!id) continue
    if (isAutoMoveOwned(id, el)) continue
    if (el.classList.contains('dragging')) continue

    const oldRect = first.get(id)
    if (!oldRect) continue // newly inserted — appear in place

    const newRect = el.getBoundingClientRect()
    const dx = oldRect.left - newRect.left
    const dy = oldRect.top - newRect.top
    if (Math.abs(dx) < MIN_DELTA_PX && Math.abs(dy) < MIN_DELTA_PX) continue

    const anim = el.animate(
      [
        { transform: `translate(${dx}px, ${dy}px)` },
        { transform: 'translate(0px, 0px)' },
      ],
      {
        duration: STRIP_FLIP_DURATION_MS,
        easing: STRIP_FLIP_EASING,
        fill: 'none',
        id: STRIP_FLIP_ANIM_ID,
      },
    )
    // Wall-clock drive so neighbor FLIP completes in background tabs
    driveAnimationWallClock(anim, STRIP_FLIP_DURATION_MS, () => {
      /* fill:none — nothing to clean up */
    })
  }
}

/**
 * FLIP-animate flight strips when their order in a section list changes
 * (time/ETA/ATD sort, addFromTop inserts, inbound appearance order, etc.).
 *
 * Uses flush:'pre' so First rects are read from the still-old DOM, then
 * plays after the Vue update — same 500ms ease-in-out as auto-move fly.
 */
export function useStripOrderFlip(
  containerRef: Ref<HTMLElement | null>,
  orderedIds: ComputedRef<string[]>,
  enabled?: ComputedRef<boolean>,
) {
  let prevIds: string[] = []

  watch(
    orderedIds,
    async (ids) => {
      const container = containerRef.value
      if (!container) {
        prevIds = ids.slice()
        return
      }

      // Initial populate / full clear — no animation
      if (prevIds.length === 0 || ids.length === 0) {
        prevIds = ids.slice()
        return
      }

      if (idsEqual(prevIds, ids)) return

      // Stick-bottom / paper KLARERING: FLIP off for manual drag — still on for auto-move
      const autoMoveActive = useEfsStore().autoMovingStripIds.size > 0
      if (enabled && !enabled.value && !autoMoveActive) {
        prevIds = ids.slice()
        return
      }

      // Manual drag suppress — never block neighbor FLIP during auto-move fly
      if (!autoMoveActive && isDragInProgress()) {
        prevIds = ids.slice()
        return
      }

      // First: positions before Vue reorders the DOM
      const first = measureStripRects(container)
      cancelStripFlipAnimations(container)
      prevIds = ids.slice()

      await nextTick()
      // Settle layout (gaps / info strips / stick-bottom spacer) before Last.
      // Wall-clock fallback so hidden tabs still FLIP (rAF is paused in bg).
      afterLayoutSettle(() => {
        playStripFlip(container, first)
      })
    },
    { flush: 'pre' },
  )
}

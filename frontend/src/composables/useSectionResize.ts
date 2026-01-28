import { ref, onUnmounted } from 'vue'
import { useEfsStore } from '@/store/efs'

export interface ResizeState {
  isResizing: boolean
  startY: number
  aboveStartHeight: number
  belowStartHeight: number
  bayId: string
  aboveSectionId: string // The section ABOVE (grows when dragging down)
  belowSectionId: string // The section BELOW (shrinks when dragging down)
}

export function useSectionResize() {
  const store = useEfsStore()
  const isResizing = ref(false)
  const resizeState = ref<ResizeState | null>(null)

  const MIN_HEIGHT = 80

  function startResize(
    event: MouseEvent | TouchEvent,
    bayId: string,
    aboveSectionId: string,
    aboveHeight: number,
    belowSectionId: string,
    belowHeight: number
  ) {
    event.preventDefault()
    event.stopPropagation()

    const clientY = 'touches' in event ? event.touches[0]?.clientY ?? 0 : event.clientY

    isResizing.value = true
    resizeState.value = {
      isResizing: true,
      startY: clientY,
      aboveStartHeight: aboveHeight,
      belowStartHeight: belowHeight,
      bayId,
      aboveSectionId,
      belowSectionId
    }

    document.body.classList.add('section-resizing')

    // Add move/end listeners
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onEnd)
    document.addEventListener('touchmove', onMove, { passive: false })
    document.addEventListener('touchend', onEnd)
    document.addEventListener('touchcancel', onEnd)
  }

  function onMove(event: MouseEvent | TouchEvent) {
    if (!resizeState.value) return

    event.preventDefault()

    const clientY = 'touches' in event ? event.touches[0]?.clientY ?? 0 : event.clientY
    // Dragging down = section above gets larger, section below gets smaller
    // Dragging up = section above gets smaller, section below gets larger
    let delta = clientY - resizeState.value.startY

    // Clamp delta so neither section goes below MIN_HEIGHT
    const maxGrow = resizeState.value.belowStartHeight - MIN_HEIGHT
    const maxShrink = resizeState.value.aboveStartHeight - MIN_HEIGHT
    delta = Math.max(-maxShrink, Math.min(maxGrow, delta))

    const aboveNewHeight = resizeState.value.aboveStartHeight + delta
    const belowNewHeight = resizeState.value.belowStartHeight - delta

    store.setSectionHeight(
      resizeState.value.bayId,
      resizeState.value.aboveSectionId,
      aboveNewHeight
    )
    store.setSectionHeight(
      resizeState.value.bayId,
      resizeState.value.belowSectionId,
      belowNewHeight
    )
  }

  function onEnd() {
    isResizing.value = false
    resizeState.value = null

    document.body.classList.remove('section-resizing')

    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onEnd)
    document.removeEventListener('touchmove', onMove)
    document.removeEventListener('touchend', onEnd)
    document.removeEventListener('touchcancel', onEnd)
  }

  // Cleanup on unmount
  onUnmounted(() => {
    if (isResizing.value) {
      onEnd()
    }
  })

  return {
    isResizing,
    startResize
  }
}

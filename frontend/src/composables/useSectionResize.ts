import { ref, onUnmounted } from 'vue'
import { useEfsStore } from '@/store/efs'

export interface ResizeState {
  isResizing: boolean
  startY: number
  startHeight: number
  bayId: string
  sectionId: string
}

export function useSectionResize() {
  const store = useEfsStore()
  const isResizing = ref(false)
  const resizeState = ref<ResizeState | null>(null)

  const MIN_HEIGHT = 80

  function startResize(
    event: MouseEvent | TouchEvent,
    bayId: string,
    sectionId: string,
    currentHeight: number
  ) {
    event.preventDefault()
    event.stopPropagation()

    const clientY = 'touches' in event ? event.touches[0]?.clientY ?? 0 : event.clientY

    isResizing.value = true
    resizeState.value = {
      isResizing: true,
      startY: clientY,
      startHeight: currentHeight,
      bayId,
      sectionId
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
    // Invert delta: dragging header down = smaller section, dragging up = bigger
    const delta = resizeState.value.startY - clientY
    const newHeight = Math.max(MIN_HEIGHT, resizeState.value.startHeight + delta)

    store.setSectionHeight(
      resizeState.value.bayId,
      resizeState.value.sectionId,
      newHeight
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

import { ref } from 'vue'

export interface DragData {
  stripId: string
  bayId: string
  sectionId: string
}

// Global state for touch drag operations
const isDragging = ref(false)
const dragData = ref<DragData | null>(null)
const dragElement = ref<HTMLElement | null>(null)
const dragClone = ref<HTMLElement | null>(null)
const currentDropTarget = ref<HTMLElement | null>(null)

// Offset from touch point to element top-left
let offsetX = 0
let offsetY = 0

// Track if global listeners are installed
let globalListenersInstalled = false

export function useTouchDrag() {
  function startDrag(element: HTMLElement, data: DragData, touch: Touch) {
    isDragging.value = true
    dragData.value = data
    dragElement.value = element

    // Calculate offset
    const rect = element.getBoundingClientRect()
    offsetX = touch.clientX - rect.left
    offsetY = touch.clientY - rect.top

    // Create visual clone for dragging
    const clone = element.cloneNode(true) as HTMLElement
    clone.classList.add('drag-clone')
    clone.style.cssText = `
      position: fixed;
      left: ${rect.left}px;
      top: ${rect.top}px;
      width: ${rect.width}px;
      height: ${rect.height}px;
      z-index: 9999;
      pointer-events: none;
      opacity: 0.9;
      transform: scale(1.02);
      box-shadow: 0 8px 24px rgba(0,0,0,0.3);
      transition: transform 0.1s ease;
    `
    document.body.appendChild(clone)
    dragClone.value = clone

    // Fade original
    element.style.opacity = '0.3'

    // Add body class
    document.body.classList.add('touch-dragging')
  }

  function moveDrag(touch: Touch) {
    if (!isDragging.value || !dragClone.value) return

    const x = touch.clientX - offsetX
    const y = touch.clientY - offsetY

    dragClone.value.style.left = `${x}px`
    dragClone.value.style.top = `${y}px`

    // Find drop target under touch point
    // Temporarily hide clone to get element underneath
    dragClone.value.style.display = 'none'
    const elementUnder = document.elementFromPoint(touch.clientX, touch.clientY)
    dragClone.value.style.display = ''

    // Find the section-content element
    const dropTarget = elementUnder?.closest('.section-content') as HTMLElement | null

    // Update highlight
    if (currentDropTarget.value && currentDropTarget.value !== dropTarget) {
      currentDropTarget.value.classList.remove('drag-over')
    }
    if (dropTarget && dropTarget !== currentDropTarget.value) {
      dropTarget.classList.add('drag-over')
    }
    currentDropTarget.value = dropTarget
  }

  function endDrag(): { dropTarget: HTMLElement | null; data: DragData | null; dropPosition: number } {
    const result = {
      dropTarget: currentDropTarget.value,
      data: dragData.value,
      dropPosition: 0
    }

    // Calculate drop position within section
    if (currentDropTarget.value && dragClone.value) {
      const cloneRect = dragClone.value.getBoundingClientRect()
      const cloneCenterY = cloneRect.top + cloneRect.height / 2

      const strips = Array.from(currentDropTarget.value.querySelectorAll('.flight-strip'))
      let position = strips.length

      for (let i = 0; i < strips.length; i++) {
        const strip = strips[i]
        if (!strip) continue
        const stripRect = strip.getBoundingClientRect()
        const stripMidY = stripRect.top + stripRect.height / 2
        if (cloneCenterY < stripMidY) {
          position = i
          break
        }
      }
      result.dropPosition = position
    }

    // Cleanup
    if (dragElement.value) {
      dragElement.value.style.opacity = ''
    }
    if (dragClone.value) {
      dragClone.value.remove()
      dragClone.value = null
    }
    if (currentDropTarget.value) {
      currentDropTarget.value.classList.remove('drag-over')
      currentDropTarget.value = null
    }

    isDragging.value = false
    dragData.value = null
    dragElement.value = null

    document.body.classList.remove('touch-dragging')

    return result
  }

  function cancelDrag() {
    if (dragElement.value) {
      dragElement.value.style.opacity = ''
    }
    if (dragClone.value) {
      dragClone.value.remove()
      dragClone.value = null
    }
    if (currentDropTarget.value) {
      currentDropTarget.value.classList.remove('drag-over')
      currentDropTarget.value = null
    }

    isDragging.value = false
    dragData.value = null
    dragElement.value = null

    document.body.classList.remove('touch-dragging')
  }

  // Force cleanup any stuck drag state (can be called externally)
  function forceCleanup() {
    // Remove any stuck clones
    document.querySelectorAll('.drag-clone').forEach(el => el.remove())

    // Remove drag-over highlights
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'))

    // Reset dragging elements opacity
    document.querySelectorAll('.flight-strip').forEach(el => {
      (el as HTMLElement).style.opacity = ''
    })

    // Reset state
    isDragging.value = false
    dragData.value = null
    dragElement.value = null
    dragClone.value = null
    currentDropTarget.value = null

    document.body.classList.remove('touch-dragging')
  }

  // Install global listeners for cleanup on edge cases
  function installGlobalListeners() {
    if (globalListenersInstalled) return
    globalListenersInstalled = true

    // Clean up on window blur (switching apps, etc)
    window.addEventListener('blur', forceCleanup)

    // Clean up on escape key
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isDragging.value) {
        forceCleanup()
      }
    })

    // Clean up on visibility change (tab switch)
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && isDragging.value) {
        forceCleanup()
      }
    })

    // Safety: clean up stuck clones on any click when not dragging
    document.addEventListener('click', () => {
      if (!isDragging.value) {
        const stuckClones = document.querySelectorAll('.drag-clone')
        if (stuckClones.length > 0) {
          forceCleanup()
        }
      }
    }, true)
  }

  // Install listeners on first use
  installGlobalListeners()

  return {
    isDragging,
    dragData,
    startDrag,
    moveDrag,
    endDrag,
    cancelDrag,
    forceCleanup
  }
}

// Singleton instance for global access
let instance: ReturnType<typeof useTouchDrag> | null = null

export function getTouchDragInstance() {
  if (!instance) {
    instance = useTouchDrag()
  }
  return instance
}

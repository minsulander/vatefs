import { ref } from 'vue'
import { flightStripsIn, insertIndexAtClientY } from '@/composables/dropPlacement'

export interface DragData {
  stripId: string
  bayId: string
  sectionId: string
  isBottom?: boolean
  originalTop?: number
  originalBottom?: number
  stripHeight?: number
  dragOffsetY?: number
}

/** Live insert index for the green placement line during touch/iPad drag. */
export interface TouchDropPlacement {
  sectionId: string
  bayId: string
  /** Index among non-dragging top strips (length = append at end). Null when bottom / trash. */
  insertIndex: number | null
  isBottom: boolean
  clientY: number
}

// Global state for touch drag operations
const isDragging = ref(false)
const dragData = ref<DragData | null>(null)
const dragElement = ref<HTMLElement | null>(null)
const dragClone = ref<HTMLElement | null>(null)
const currentDropTarget = ref<HTMLElement | null>(null)
const isOverBottomZone = ref(false)
const isOverTrash = ref(false)
/** Shared so EfsSection can show the same drop-placement-line as HTML5 drag. */
const touchDropPlacement = ref<TouchDropPlacement | null>(null)

/**
 * Insert index among flight strips. Also treats leading/trailing .info-strip
 * blocks so drops between/below runway DEP·ARR info strips resolve correctly
 * (not only “above” → previous section bottom).
 */
function computeTopInsertIndex(container: Element, clientY: number): number {
  // Same midpoint test as the mouse placement line and the drop commit.
  return insertIndexAtClientY(flightStripsIn(container, false), clientY)
}

function clearTouchDropPlacement() {
  touchDropPlacement.value = null
}

/** Update insert-line / bottom-slot from a hit-test element (no full-bay highlight).
 *  Bottom-slot styling is driven by EfsSection via touchDropPlacement → isBottomDragOver.
 */
function applyTouchDropPlacement(elementUnder: Element | null, clientY: number) {
  const bottomZone = elementUnder?.closest('.bottom-drop-zone') as HTMLElement | null
  const bottomStripsContainer = elementUnder?.closest('.bottom-strips-container') as HTMLElement | null
  const headerEl = elementUnder?.closest('.section-header') as HTMLElement | null
  const isOverBottom = bottomZone !== null || bottomStripsContainer !== null

  const sectionEl =
    (elementUnder?.closest('.efs-section') as HTMLElement | null) ||
    headerEl?.closest('.efs-section') ||
    bottomZone?.closest('.efs-section') ||
    bottomStripsContainer?.closest('.efs-section')
  const bayEl = sectionEl?.closest('.efs-bay') as HTMLElement | null
  const sectionId = sectionEl?.getAttribute('data-section-id')
  const bayId = bayEl?.getAttribute('data-bay-id')

  if (!sectionId || !bayId) {
    clearTouchDropPlacement()
    return { dropTarget: null as HTMLElement | null, isOverBottom: false }
  }

  if (isOverBottom) {
    touchDropPlacement.value = { sectionId, bayId, insertIndex: null, isBottom: true, clientY }
    const dropTarget =
      (bottomZone || bottomStripsContainer)?.closest('.section-content') as HTMLElement | null
    return { dropTarget, isOverBottom: true }
  }

  // Drop on section header → insert at top of that section
  if (headerEl && sectionEl?.contains(headerEl)) {
    touchDropPlacement.value = { sectionId, bayId, insertIndex: 0, isBottom: false, clientY }
    const topContainer = sectionEl.querySelector('.top-strips-container') as HTMLElement | null
    const dropTarget =
      (sectionEl.querySelector('.section-content') as HTMLElement | null) || topContainer
    return { dropTarget, isOverBottom: false }
  }

  const topContainer =
    (elementUnder?.closest('.top-strips-container') as HTMLElement | null) ||
    (sectionEl?.querySelector('.top-strips-container') as HTMLElement | null)
  const insertIndex = topContainer ? computeTopInsertIndex(topContainer, clientY) : 0
  touchDropPlacement.value = { sectionId, bayId, insertIndex, isBottom: false, clientY }

  const dropTarget =
    (elementUnder?.closest('.section-content') as HTMLElement | null) ||
    topContainer
  return { dropTarget, isOverBottom: false }
}

// Offset from touch point to element top-left
let offsetX = 0
let offsetY = 0
let lastTouchY = 0

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

    // Create visual clone for dragging — set position props only so inline
    // --strip-scale / fitted fonts from the live strip are preserved (cssText would wipe them).
    const clone = element.cloneNode(true) as HTMLElement
    clone.classList.add('drag-clone')
    clone.classList.remove('klack-float', 'klack-left', 'klack-right', 'klack-pulling', 'dragging')
    // Layout size (not getBoundingClientRect) — avoids stretched clones from fixed/transformed strips
    const w = element.offsetWidth || rect.width
    const h = element.offsetHeight || rect.height
    clone.style.position = 'fixed'
    clone.style.left = `${rect.left}px`
    clone.style.top = `${rect.top}px`
    clone.style.width = `${w}px`
    clone.style.height = `${h}px`
    clone.style.maxWidth = `${w}px`
    clone.style.transform = 'none'
    clone.style.zIndex = '9999'
    clone.style.pointerEvents = 'none'
    clone.style.opacity = '0.9'
    clone.style.margin = '0'
    clone.style.boxShadow = '0 8px 24px rgba(0,0,0,0.3)'
    // Clone is under document.body — pin numeric bay/body sizes (calc() vars
    // alone collapse when --bay-scale is not inherited from the bay).
    const cs = getComputedStyle(element)
    const bayScale = cs.getPropertyValue('--bay-scale').trim()
    const bodyEl = element.querySelector(
      '.paper-with-actions, .paper-info-body',
    ) as HTMLElement | null
    const bodyPx = bodyEl?.offsetHeight || 0
    if (bayScale) {
      clone.style.setProperty('--bay-scale', bayScale)
      clone.style.setProperty('--strip-scale', bayScale)
    }
    if (bodyPx > 0) {
      clone.style.setProperty('--strip-body-h', `${bodyPx}px`)
      // Match outer box to content — avoid tall empty frame around a short grid
      const frameTb = parseFloat(cs.getPropertyValue('--frame-tb')) || 0
      clone.style.height = `${bodyPx + frameTb * 2}px`
    }
    document.body.appendChild(clone)
    dragClone.value = clone

    // Hide / collapse original (paper CSS collapses .dragging; else fade)
    element.classList.add('dragging')
    if (!element.classList.contains('look-paper')) {
      element.style.opacity = '0.3'
    }

    // Add body class
    document.body.classList.add('touch-dragging')
  }

  function moveDrag(touch: Touch) {
    if (!isDragging.value || !dragClone.value) return

    const x = touch.clientX - offsetX
    const y = touch.clientY - offsetY
    lastTouchY = touch.clientY

    dragClone.value.style.left = `${x}px`
    dragClone.value.style.top = `${y}px`

    // Find drop target under touch point
    // Temporarily hide clone to get element underneath
    dragClone.value.style.display = 'none'
    const elementUnder = document.elementFromPoint(touch.clientX, touch.clientY)
    dragClone.value.style.display = ''

    // Trash can (bottom bar) — delete on drop
    const trashZone = elementUnder?.closest('.efs-trash-drop') as HTMLElement | null
    isOverTrash.value = trashZone !== null
    document.querySelectorAll('.efs-trash-drop.drag-over').forEach((el) => {
      if (el !== trashZone) el.classList.remove('drag-over')
    })
    if (trashZone) trashZone.classList.add('drag-over')

    // Trash: no bay insert/bottom indicators
    if (trashZone) {
      clearTouchDropPlacement()
      currentDropTarget.value = trashZone
      isOverBottomZone.value = false
      return
    }

    const { dropTarget, isOverBottom } = applyTouchDropPlacement(elementUnder, touch.clientY)
    isOverBottomZone.value = isOverBottom
    currentDropTarget.value = dropTarget
  }

  function endDrag(): {
    dropTarget: HTMLElement | null
    data: DragData | null
    dropPosition: number
    isBottomDrop: boolean
    isTrashDrop: boolean
    touchY: number
    draggedStripTop: number
    cloneRect: DOMRect | null
  } {
    // Calculate dragged strip top position from clone
    const cloneRect = dragClone.value?.getBoundingClientRect() || null
    const draggedStripTop = cloneRect ? cloneRect.top : 0

    const result = {
      dropTarget: currentDropTarget.value,
      data: dragData.value,
      dropPosition: 0,
      isBottomDrop: isOverBottomZone.value,
      isTrashDrop: isOverTrash.value,
      touchY: lastTouchY,
      draggedStripTop,
      cloneRect
    }

    // Prefer placement from hit-test (header → 0); else compute from clone Y
    const placedIndex = touchDropPlacement.value?.insertIndex
    if (!result.isBottomDrop && placedIndex != null) {
      result.dropPosition = placedIndex
    } else if (currentDropTarget.value && dragClone.value) {
      const cloneRect = dragClone.value.getBoundingClientRect()
      const cloneCenterY = cloneRect.top + cloneRect.height / 2

      // Find strips in the appropriate container
      const container = result.isBottomDrop
        ? currentDropTarget.value.querySelector('.bottom-strips-container')
        : currentDropTarget.value.querySelector('.top-strips-container') || currentDropTarget.value

      const strips = Array.from(container?.querySelectorAll('.flight-strip:not(.dragging)') || [])
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
      dragElement.value.classList.remove('dragging')
      dragElement.value.style.opacity = ''
    }
    if (dragClone.value) {
      dragClone.value.remove()
      dragClone.value = null
    }
    currentDropTarget.value = null

    // Clean up bottom-slot / trash highlights
    document.querySelectorAll('.bottom-drop-zone.drop-active').forEach(el => {
      el.classList.remove('drop-active')
    })
    document.querySelectorAll('.efs-trash-drop.drag-over').forEach((el) => {
      el.classList.remove('drag-over')
    })

    isDragging.value = false
    isOverBottomZone.value = false
    isOverTrash.value = false
    dragData.value = null
    dragElement.value = null
    clearTouchDropPlacement()

    document.body.classList.remove('touch-dragging')

    return result
  }

  function cancelDrag() {
    if (dragElement.value) {
      dragElement.value.classList.remove('dragging')
      dragElement.value.style.opacity = ''
    }
    if (dragClone.value) {
      dragClone.value.remove()
      dragClone.value = null
    }
    currentDropTarget.value = null
    document.querySelectorAll('.bottom-drop-zone.drop-active').forEach((el) => {
      el.classList.remove('drop-active')
    })
    document.querySelectorAll('.efs-trash-drop.drag-over').forEach((el) => {
      el.classList.remove('drag-over')
    })

    isDragging.value = false
    isOverTrash.value = false
    dragData.value = null
    dragElement.value = null
    clearTouchDropPlacement()

    document.body.classList.remove('touch-dragging')
  }

  // Force cleanup any stuck drag state (can be called externally)
  function forceCleanup() {
    // Remove any stuck clones
    document.querySelectorAll('.drag-clone').forEach(el => el.remove())

    // Remove trash / misc drag-over highlights
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'))

    // Remove bottom-slot highlights
    document.querySelectorAll('.bottom-drop-zone.drop-active').forEach(el => el.classList.remove('drop-active'))

    // Reset dragging elements
    document.querySelectorAll('.flight-strip, .info-strip').forEach(el => {
      el.classList.remove('dragging')
      ;(el as HTMLElement).style.opacity = ''
    })

    // Reset state
    isDragging.value = false
    isOverBottomZone.value = false
    dragData.value = null
    dragElement.value = null
    dragClone.value = null
    currentDropTarget.value = null
    clearTouchDropPlacement()

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
    isOverBottomZone,
    dragData,
    touchDropPlacement,
    startDrag,
    moveDrag,
    endDrag,
    cancelDrag,
    forceCleanup
  }
}

/** Read-only placement ref for section components (HTML5 + touch share the line). */
export function useTouchDropPlacement() {
  return touchDropPlacement
}

/** For create-from-bottom-bar touch drag: drive the same insert line / bottom slot. */
export function setTouchDropPlacementFromPoint(clientX: number, clientY: number, hideEl?: HTMLElement | null) {
  if (hideEl) hideEl.style.display = 'none'
  const elementUnder = document.elementFromPoint(clientX, clientY)
  if (hideEl) hideEl.style.display = ''
  applyTouchDropPlacement(elementUnder, clientY)
}

export function clearTouchDropPlacementIndicators() {
  clearTouchDropPlacement()
}

// Singleton instance for global access
let instance: ReturnType<typeof useTouchDrag> | null = null

export function getTouchDragInstance() {
  if (!instance) {
    instance = useTouchDrag()
  }
  return instance
}

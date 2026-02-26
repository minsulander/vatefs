<template>
  <StripCreationDialog
    v-model="dialogOpen"
    :strip-type="dialogStripType"
    @create="onDialogCreate"
  />

  <div class="efs-bottom-bar">
    <div class="tiny-strips">
      <template v-if="store.myAirports.length > 0">
        <div
          class="tiny-strip tiny-strip-vfrdep"
          draggable="true"
          @dragstart="(e) => onTinyDragStart(e, 'vfrDep')"
          @dragend="onTinyDragEnd"
          @click="() => onTinyClick('vfrDep')"
          @touchstart="(e) => onTinyTouchStart(e, 'vfrDep')"
          @touchmove.prevent="onTinyTouchMove"
          @touchend="(e) => onTinyTouchEnd(e, 'vfrDep')"
          @touchcancel="onTinyTouchCancel"
        >
          <div class="tiny-indicator tiny-dep"></div>
          <span class="tiny-label">VFR DEP</span>
        </div>

        <div
          class="tiny-strip tiny-strip-vfrarr"
          draggable="true"
          @dragstart="(e) => onTinyDragStart(e, 'vfrArr')"
          @dragend="onTinyDragEnd"
          @click="() => onTinyClick('vfrArr')"
          @touchstart="(e) => onTinyTouchStart(e, 'vfrArr')"
          @touchmove.prevent="onTinyTouchMove"
          @touchend="(e) => onTinyTouchEnd(e, 'vfrArr')"
          @touchcancel="onTinyTouchCancel"
        >
          <div class="tiny-indicator tiny-arr"></div>
          <span class="tiny-label">VFR ARR</span>
        </div>

        <div
          class="tiny-strip tiny-strip-cross"
          draggable="true"
          @dragstart="(e) => onTinyDragStart(e, 'cross')"
          @dragend="onTinyDragEnd"
          @click="() => onTinyClick('cross')"
          @touchstart="(e) => onTinyTouchStart(e, 'cross')"
          @touchmove.prevent="onTinyTouchMove"
          @touchend="(e) => onTinyTouchEnd(e, 'cross')"
          @touchcancel="onTinyTouchCancel"
        >
          <div class="tiny-indicator tiny-cross"></div>
          <span class="tiny-label">CROSS</span>
        </div>
      </template>

      <div
        class="tiny-strip tiny-strip-note"
        draggable="true"
        @dragstart="(e) => onTinyDragStart(e, 'note')"
        @dragend="onTinyDragEnd"
        @click="() => onTinyClick('note')"
        @touchstart="(e) => onTinyTouchStart(e, 'note')"
        @touchmove.prevent="onTinyTouchMove"
        @touchend="(e) => onTinyTouchEnd(e, 'note')"
        @touchcancel="onTinyTouchCancel"
      >
        <div class="tiny-indicator tiny-note"></div>
        <span class="tiny-label">NOTE</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useEfsStore } from '@/store/efs'
import StripCreationDialog from './StripCreationDialog.vue'

type SpecialStripType = 'vfrDep' | 'vfrArr' | 'cross' | 'note'

const store = useEfsStore()

const dialogOpen = ref(false)
const dialogStripType = ref<SpecialStripType>('vfrDep')
const dialogTargetBayId = ref<string | undefined>(undefined)
const dialogTargetSectionId = ref<string | undefined>(undefined)
const dialogTargetPosition = ref<number | undefined>(undefined)
const dialogTargetIsBottom = ref<boolean>(false)
const dialogTargetGapIndex = ref<number | undefined>(undefined)
const dialogTargetGapSize = ref<number>(0)

// Touch drag state
let touchStarted = false
let touchDragging = false
let touchClone: HTMLElement | null = null
let touchStartX = 0
let touchStartY = 0
const DRAG_THRESHOLD = 10

function onTinyClick(type: SpecialStripType) {
  if (type === 'note') {
    store.createStrip('note')
    return
  }
  dialogStripType.value = type
  dialogTargetBayId.value = undefined
  dialogTargetSectionId.value = undefined
  dialogTargetPosition.value = undefined
  dialogTargetIsBottom.value = false
  dialogTargetGapIndex.value = undefined
  dialogTargetGapSize.value = 0
  dialogOpen.value = true
}

function onDialogCreate(data: { callsign: string; aircraftType?: string; airport?: string }) {
  store.createStrip(
    dialogStripType.value, data.callsign, data.aircraftType, data.airport,
    dialogTargetBayId.value, dialogTargetSectionId.value,
    dialogTargetPosition.value, dialogTargetIsBottom.value
  )
  if (
    dialogTargetGapIndex.value !== undefined &&
    dialogTargetGapSize.value >= store.GAP_BUFFER &&
    dialogTargetBayId.value && dialogTargetSectionId.value
  ) {
    store.setGapAtIndex(dialogTargetBayId.value, dialogTargetSectionId.value, dialogTargetGapIndex.value, dialogTargetGapSize.value)
  }
}

function onTinyDragStart(event: DragEvent, type: SpecialStripType) {
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'copy'
    event.dataTransfer.setData('application/efs-create', type)
  }
}

function onTinyDragEnd() {
  // Drag ended without drop — nothing to do
}

// Touch handlers for tiny strips
function onTinyTouchStart(event: TouchEvent, _type: SpecialStripType) {
  if (event.touches.length !== 1) return
  const touch = event.touches[0]!
  touchStarted = true
  touchDragging = false
  touchStartX = touch.clientX
  touchStartY = touch.clientY
}

function onTinyTouchMove(event: TouchEvent) {
  if (!touchStarted || event.touches.length !== 1) return
  const touch = event.touches[0]!

  if (!touchDragging) {
    const dx = Math.abs(touch.clientX - touchStartX)
    const dy = Math.abs(touch.clientY - touchStartY)
    if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) {
      touchDragging = true
      document.body.classList.add('touch-dragging')

      // Create a visual clone
      const el = event.target as HTMLElement
      const tinyEl = el.closest('.tiny-strip') as HTMLElement
      if (tinyEl) {
        touchClone = tinyEl.cloneNode(true) as HTMLElement
        touchClone.classList.add('tiny-strip-clone')
        const rect = tinyEl.getBoundingClientRect()
        touchClone.style.width = `${rect.width}px`
        touchClone.style.left = `${touch.clientX - rect.width / 2}px`
        touchClone.style.top = `${touch.clientY - 20}px`
        document.body.appendChild(touchClone)
      }
    }
  }

  if (touchDragging && touchClone) {
    const rect = touchClone.getBoundingClientRect()
    touchClone.style.left = `${touch.clientX - rect.width / 2}px`
    touchClone.style.top = `${touch.clientY - 20}px`

    // Highlight drop target section
    highlightDropTarget(touch.clientX, touch.clientY)
  }
}

function onTinyTouchEnd(event: TouchEvent, type: SpecialStripType) {
  if (touchDragging) {
    const touch = event.changedTouches[0]
    if (touch) {
      const target = findDropTarget(touch.clientX, touch.clientY)
      if (target) {
        if (type === 'note') {
          store.createStrip(
            'note', undefined, undefined, undefined,
            target.bayId, target.sectionId, target.position, target.isBottom
          )
          if (target.gapIndex !== undefined && target.gapSize >= store.GAP_BUFFER) {
            store.setGapAtIndex(target.bayId, target.sectionId, target.gapIndex, target.gapSize)
          }
        } else {
          dialogStripType.value = type
          dialogTargetBayId.value = target.bayId
          dialogTargetSectionId.value = target.sectionId
          dialogTargetPosition.value = target.position
          dialogTargetIsBottom.value = target.isBottom
          dialogTargetGapIndex.value = target.gapIndex
          dialogTargetGapSize.value = target.gapSize
          dialogOpen.value = true
        }
      }
    }
    cleanupTouchDrag()
  }

  touchStarted = false
  touchDragging = false
}

function onTinyTouchCancel() {
  cleanupTouchDrag()
  touchStarted = false
  touchDragging = false
}

function cleanupTouchDrag() {
  if (touchClone) {
    touchClone.remove()
    touchClone = null
  }
  document.body.classList.remove('touch-dragging')
  clearDropHighlights()
}

function highlightDropTarget(x: number, y: number) {
  clearDropHighlights()
  const el = document.elementFromPoint(x, y)
  const sectionContent = el?.closest('.section-content')
  if (sectionContent) {
    sectionContent.classList.add('drag-over')
  }
}

function clearDropHighlights() {
  document.querySelectorAll('.section-content.drag-over').forEach(el => {
    el.classList.remove('drag-over')
  })
}

const HALF_STRIP_HEIGHT = 22

interface DropTarget {
  bayId: string
  sectionId: string
  position: number
  isBottom: boolean
  gapIndex?: number
  gapSize: number
}

function findDropTarget(x: number, y: number): DropTarget | null {
  const el = document.elementFromPoint(x, y)
  const sectionEl = el?.closest('.efs-section')
  const bayEl = sectionEl?.closest('.efs-bay')
  if (!sectionEl || !bayEl) return null

  const sectionId = sectionEl.getAttribute('data-section-id')
  const bayId = bayEl.getAttribute('data-bay-id')
  if (!sectionId || !bayId) return null

  // Check if dropped on the bottom-drop-zone or bottom-strips-container
  const bottomZone = el?.closest('.bottom-drop-zone')
  const bottomStrips = el?.closest('.bottom-strips-container')

  if (bottomZone) {
    return { bayId, sectionId, position: 0, isBottom: true, gapSize: 0 }
  }

  if (bottomStrips) {
    const stripElements = Array.from(bottomStrips.querySelectorAll('.flight-strip'))
    let position = stripElements.length
    for (let i = 0; i < stripElements.length; i++) {
      const rect = stripElements[i]!.getBoundingClientRect()
      if (y < rect.top + rect.height / 2) {
        position = i
        break
      }
    }
    return { bayId, sectionId, position, isBottom: true, gapSize: 0 }
  }

  // Top zone position computation
  const container = sectionEl.querySelector('.top-strips-container')
  if (!container) return { bayId, sectionId, position: 0, isBottom: false, gapSize: 0 }

  const allStripElements = Array.from(container.querySelectorAll('.flight-strip'))
  const draggedStripTop = y - HALF_STRIP_HEIGHT

  let position = allStripElements.length
  let droppedBelowLastStrip = false
  let distanceBelowLastStrip = 0
  let droppedIntoEmptySection = false
  let distanceFromTop = 0

  if (allStripElements.length > 0) {
    const lastStrip = allStripElements[allStripElements.length - 1]!
    const lastRect = lastStrip.getBoundingClientRect()
    if (draggedStripTop > lastRect.bottom) {
      droppedBelowLastStrip = true
      distanceBelowLastStrip = draggedStripTop - lastRect.bottom
    }
  } else {
    const containerRect = container.getBoundingClientRect()
    distanceFromTop = draggedStripTop - containerRect.top
    if (distanceFromTop >= store.GAP_BUFFER) {
      droppedIntoEmptySection = true
    }
  }

  for (let i = 0; i < allStripElements.length; i++) {
    const rect = allStripElements[i]!.getBoundingClientRect()
    if (y < rect.top + rect.height / 2) {
      position = i
      droppedBelowLastStrip = false
      break
    }
  }

  let gapIndex: number | undefined
  let gapSize = 0

  if (droppedBelowLastStrip && distanceBelowLastStrip >= store.GAP_BUFFER) {
    gapIndex = position
    gapSize = distanceBelowLastStrip
  } else if (droppedIntoEmptySection) {
    gapIndex = 0
    gapSize = distanceFromTop
  }

  return { bayId, sectionId, position, isBottom: false, gapIndex, gapSize }
}
</script>

<style scoped>
.efs-bottom-bar {
  height: 46px;
  background: #2b2d31;
  display: flex;
  align-items: center;
  justify-content: center;
  border-top: 1px solid #3a3e42;
  flex-shrink: 0;
  padding-bottom: 10px;
}

.tiny-strips {
  display: flex;
  gap: 12px;
  align-items: center;
}

.tiny-strip {
  display: flex;
  align-items: center;
  background: #f0ebe0;
  border: 1px solid #888;
  height: 24px;
  padding: 0 8px 0 0;
  cursor: grab;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  transition: all 0.12s ease;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
}

.tiny-strip:hover {
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
  transform: translateY(-1px);
}

.tiny-strip:active {
  transform: translateY(0);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
}

.tiny-indicator {
  width: 6px;
  height: 100%;
  margin-right: 6px;
  flex-shrink: 0;
}

.tiny-dep { background: #3b7dd8; }
.tiny-arr { background: #daa520; }
.tiny-cross { background: #9b59b6; }
.tiny-note { background: #888; }

.tiny-label {
  font-size: 10px;
  font-weight: 700;
  color: #333;
  letter-spacing: 0.5px;
  white-space: nowrap;
}
</style>

<style>
/* Floating clone for touch drag */
.tiny-strip-clone {
  position: fixed;
  z-index: 10000;
  pointer-events: none;
  opacity: 0.85;
  transform: scale(1.1);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
}
</style>

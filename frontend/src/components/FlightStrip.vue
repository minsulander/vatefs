<template>
  <div
    ref="stripElement"
    class="flight-strip"
    :class="[stripTypeClass, { dragging: isDragging, 'is-bottom': strip.bottom }]"
    :style="stripStyle"
    :data-strip-id="strip.id"
    draggable="true"
    @dragstart="onDragStart"
    @dragend="onDragEnd"
    @touchstart="onDragAreaTouchStart"
      @touchmove.prevent="onDragAreaTouchMove"
      @touchend="onDragAreaTouchEnd"
      @touchcancel="onDragAreaTouchCancel"
    @contextmenu.prevent
    @click="onStripClick"
  >
    <!-- Color indicator bar on left -->
    <div class="strip-indicator"></div>

    <!-- Left section: Callsign block (always visible) -->
    <div
      class="strip-left"
    >
      <div class="callsign">{{ strip.callsign }}</div>
      <div class="callsign-sub">
        <span class="flight-rules">{{ strip.flightRules }}</span>
        <span class="aircraft-type">{{ strip.aircraftType }}{{ strip.wakeTurbulence }}</span>
      </div>
      <div class="squawk" v-if="strip.squawk">{{ strip.squawk }}</div>
    </div>

    <!-- Middle section (horizontally scrollable) -->
    <div class="strip-middle">
      <div class="strip-middle-content">
        <!-- Time section -->
        <div class="strip-section strip-time">
          <div class="time-value">{{ displayTime }}</div>
          <div class="time-label" v-if="strip.stripType === 'departure'">EOBT</div>
          <div class="time-label" v-else>ETA</div>
        </div>

        <div class="strip-divider"></div>

        <!-- SID/Clearance section -->
        <div class="strip-section strip-sid">
          <div class="sid-value">{{ strip.sid || '' }}</div>
          <div class="cleared-data" v-if="strip.clearedAltitude || strip.assignedHeading">
            <span v-if="strip.clearedAltitude" class="alt">{{ strip.clearedAltitude }}</span>
            <span v-if="strip.assignedHeading" class="hdg">H{{ strip.assignedHeading }}</span>
          </div>
        </div>

        <div class="strip-divider"></div>

        <!-- Airports section -->
        <div class="strip-section strip-airports">
          <div class="airport adep" :class="{ highlight: strip.stripType === 'departure' }">
            <span class="icao">{{ strip.adep }}</span>
          </div>
          <div class="airport ades" :class="{ highlight: strip.stripType === 'arrival' }">
            <span class="icao">{{ strip.ades }}</span>
          </div>
        </div>

        <div class="strip-divider"></div>

        <!-- Route & RFL section -->
        <div class="strip-section strip-route">
          <div class="route-text">{{ strip.route || '' }}</div>
          <div class="rfl" v-if="strip.rfl">{{ strip.rfl }}</div>
        </div>

        <div class="strip-divider"></div>

        <!-- Stand/Remarks section -->
        <div class="strip-section strip-stand">
          <div class="stand-value" v-if="strip.stand">{{ strip.stand }}</div>
          <div class="runway-value" v-if="strip.runway">{{ strip.runway }}</div>
        </div>
      </div>
    </div>

    <!-- Right section: Action button or status indicator -->
    <div v-if="strip.clearedForTakeoff" class="strip-right">
      <div class="takeoff-indicator">
        <svg viewBox="0 0 24 24" class="takeoff-triangle">
          <polygon points="12,4 22,20 2,20" />
        </svg>
      </div>
    </div>
    <div v-else-if="strip.defaultAction" class="strip-right">
      <button
        class="action-button"
        @click.stop="onActionClick"
        @touchend.stop="onActionTouch"
      >
        <span class="action-text">{{ strip.defaultAction }}</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { FlightStrip } from '@/types/efs'
import { useEfsStore } from '@/store/efs'
import { getTouchDragInstance } from '@/composables/useTouchDrag'

const props = defineProps<{
  strip: FlightStrip
  sectionId: string
  bayId: string
}>()

const store = useEfsStore()
const stripElement = ref<HTMLElement | null>(null)
const isDragging = ref(false)

// Touch drag state
let touchStarted = false
let longPressTimer: number | null = null
const LONG_PRESS_DELAY = 150 // ms before drag starts

const touchDrag = getTouchDragInstance()

const stripTypeClass = computed(() => `strip-${props.strip.stripType}`)

const stripStyle = computed(() => {
  const style: Record<string, string> = {}
  return style
})

const displayTime = computed(() => {
  if (props.strip.stripType === 'departure') {
    return props.strip.eobt || ''
  }
  return props.strip.eta || ''
})

// Mouse/pointer drag handlers (desktop)
function onDragStart(event: DragEvent) {
  isDragging.value = true
  if (event.dataTransfer && stripElement.value) {
    const rect = stripElement.value.getBoundingClientRect()
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('application/json', JSON.stringify({
      stripId: props.strip.id,
      bayId: props.bayId,
      sectionId: props.sectionId,
      isBottom: props.strip.bottom,
      originalTop: rect.top,
      originalBottom: rect.bottom,
      stripHeight: rect.height,
      dragOffsetY: event.clientY - rect.top // Offset from cursor to strip top
    }))
  }
}

function onDragEnd() {
  isDragging.value = false
}

// Touch drag handlers for drag areas (strip-left)
function onDragAreaTouchStart(event: TouchEvent) {
  if (event.touches.length !== 1) return

  touchStarted = true

  const touch = event.touches[0]

  // Start drag after a short delay to distinguish from scroll
  longPressTimer = window.setTimeout(() => {
    if (touchStarted && stripElement.value && touch) {
      // Prevent context menu by stopping the event chain early
      event.preventDefault()
      isDragging.value = true
      const rect = stripElement.value.getBoundingClientRect()
      touchDrag.startDrag(stripElement.value, {
        stripId: props.strip.id,
        bayId: props.bayId,
        sectionId: props.sectionId,
        isBottom: props.strip.bottom,
        originalTop: rect.top,
        originalBottom: rect.bottom,
        stripHeight: rect.height,
        dragOffsetY: touch.clientY - rect.top
      }, touch)
    }
  }, LONG_PRESS_DELAY)
}

function onDragAreaTouchMove(event: TouchEvent) {
  if (!touchStarted) return

  if (isDragging.value && event.touches.length === 1 && event.touches[0]) {
    touchDrag.moveDrag(event.touches[0])
  }
}

function onDragAreaTouchEnd(event: TouchEvent) {
  if (longPressTimer) {
    clearTimeout(longPressTimer)
    longPressTimer = null
  }

  if (isDragging.value) {
    const result = touchDrag.endDrag()

    if (result.dropTarget && result.data) {
      // Find the section info from the drop target
      const sectionEl = result.dropTarget.closest('.efs-section')
      const bayEl = sectionEl?.closest('.efs-bay')

      if (sectionEl && bayEl) {
        const targetSectionId = sectionEl.getAttribute('data-section-id')
        const targetBayId = bayEl.getAttribute('data-bay-id')

        if (targetSectionId && targetBayId) {
          if (result.isBottomDrop) {
            // Move to bottom strips - no gap logic for bottom strips
            store.moveStripToBottom(
              result.data.stripId,
              targetBayId,
              targetSectionId,
              result.dropPosition
            )
          } else {
            // Apply gap logic (same as desktop onTopDrop)
            handleTouchDropWithGaps(
              result.data,
              targetBayId,
              targetSectionId,
              result.dropTarget,
              result.draggedStripTop,
              result.touchY
            )
          }
        }
      }
    }

    isDragging.value = false
  }

  touchStarted = false
}

// Handle touch drop with full gap logic (mirrors EfsSection.vue onTopDrop)
function handleTouchDropWithGaps(
  data: { stripId: string; bayId: string; sectionId: string; isBottom?: boolean; originalTop?: number; originalBottom?: number; stripHeight?: number; dragOffsetY?: number },
  targetBayId: string,
  targetSectionId: string,
  dropTarget: HTMLElement,
  draggedStripTop: number,
  touchY: number
) {
  const { stripId, bayId: sourceBayId, sectionId: sourceSectionId, originalTop, originalBottom, stripHeight, dragOffsetY } = data

  // Find the top-strips-container within the drop target
  const container = dropTarget.querySelector('.top-strips-container') || dropTarget
  if (!container) {
    store.moveStripToSection(stripId, targetBayId, targetSectionId, 0)
    return
  }

  // Only consider "same section" if strip is in top zone of same section
  // Strips from bottom zone don't leave a space in top zone, so treat as cross-section move
  const isSameSection = sourceBayId === targetBayId && sourceSectionId === targetSectionId && !data.isBottom
  const allStripElements = Array.from(container.querySelectorAll('.flight-strip'))
  const allGapElements = Array.from(container.querySelectorAll('.strip-gap'))

  const draggedStripHeight = stripHeight || 50

  // Find the dragged strip's current index
  let draggedIndex = -1
  for (let i = 0; i < allStripElements.length; i++) {
    const el = allStripElements[i]
    if (el && el.getAttribute('data-strip-id') === stripId) {
      draggedIndex = i
      break
    }
  }

  // Check if drop happened on a gap
  let droppedOnGap = false
  let gapIndex = -1
  let gapRect: DOMRect | null = null
  let dropOnTopHalf = false

  for (const gapEl of allGapElements) {
    const rect = gapEl.getBoundingClientRect()
    if (touchY >= rect.top && touchY <= rect.bottom) {
      droppedOnGap = true
      gapIndex = parseInt(gapEl.getAttribute('data-gap-index') || '-1')
      gapRect = rect
      dropOnTopHalf = touchY < rect.top + rect.height / 2
      break
    }
  }

  // Handle drop on gap
  if (droppedOnGap && gapIndex !== -1 && gapRect) {
    const currentGapSize = store.getGapAtIndex(targetBayId, targetSectionId, gapIndex)

    // Check if the dragged strip was adjacent to this gap
    const wasAboveGap = isSameSection && draggedIndex === gapIndex - 1
    const wasBelowGap = isSameSection && draggedIndex === gapIndex

    // Calculate new gap size
    let newGapSize: number
    if (wasBelowGap && originalTop !== undefined) {
      // Strip below gap dragged upward - reduce gap by the distance dragged up
      const draggedUpDistance = originalTop - draggedStripTop
      newGapSize = draggedUpDistance > 0 ? Math.max(0, currentGapSize - draggedUpDistance) : currentGapSize
    } else if (wasAboveGap) {
      // Strip above gap dropped on gap - keep gap unchanged
      newGapSize = currentGapSize
    } else {
      // Strip from elsewhere - reduce gap by strip height
      newGapSize = currentGapSize - draggedStripHeight
    }

    // Remove the gap before moving (so adjustGapsForMove doesn't affect it)
    store.removeGapAtIndex(targetBayId, targetSectionId, gapIndex)

    // Determine insert position based on which half of the gap was hit
    let insertPosition: number

    if (dropOnTopHalf) {
      if (isSameSection && draggedIndex < gapIndex) {
        insertPosition = gapIndex - 1
      } else {
        insertPosition = gapIndex
      }
    } else {
      if (isSameSection && draggedIndex < gapIndex) {
        insertPosition = gapIndex - 1
      } else {
        insertPosition = gapIndex
      }
    }

    // Move the strip
    store.moveStripToSection(stripId, targetBayId, targetSectionId, insertPosition)

    // Re-add the gap at the correct position with the new size
    if (newGapSize >= store.GAP_BUFFER) {
      if (dropOnTopHalf) {
        store.setGapAtIndex(targetBayId, targetSectionId, insertPosition + 1, newGapSize)
      } else {
        store.setGapAtIndex(targetBayId, targetSectionId, insertPosition, newGapSize)
      }
    }

    return
  }

  // Calculate position, skipping the dragged strip for same-section moves
  const stripElements = isSameSection
    ? allStripElements.filter(el => el.getAttribute('data-strip-id') !== stripId)
    : allStripElements

  // Find drop position and check if dropping below last strip
  let position = stripElements.length
  let droppedBelowLastStrip = false
  let distanceBelowLastStrip = 0
  let droppedIntoEmptySection = false
  let distanceFromTop = 0

  if (stripElements.length > 0) {
    const lastStrip = stripElements[stripElements.length - 1]
    if (lastStrip) {
      const lastRect = lastStrip.getBoundingClientRect()
      if (draggedStripTop > lastRect.bottom) {
        droppedBelowLastStrip = true
        distanceBelowLastStrip = draggedStripTop - lastRect.bottom
      }
    }
  } else {
    // Empty section - check distance from container top
    const containerRect = container.getBoundingClientRect()
    distanceFromTop = draggedStripTop - containerRect.top
    if (distanceFromTop >= store.GAP_BUFFER) {
      droppedIntoEmptySection = true
    }
  }

  // Find position based on midpoints (using touchY for consistency with desktop using clientY)
  for (let i = 0; i < stripElements.length; i++) {
    const element = stripElements[i]
    if (!element) continue

    const rect = element.getBoundingClientRect()
    const midpoint = rect.top + rect.height / 2

    if (touchY < midpoint) {
      position = i
      droppedBelowLastStrip = false
      break
    }
  }

  // Handle same-section gap adjustments
  if (isSameSection && draggedIndex !== -1) {
    const currentGap = store.getGapAtIndex(targetBayId, targetSectionId, draggedIndex)

    // Check if position is effectively unchanged
    if (position === draggedIndex || (position === draggedIndex + 1 && draggedIndex === stripElements.length)) {
      if (originalTop !== undefined && originalBottom !== undefined) {
        const stripTopY = draggedStripTop

        // Get the position of the strip above
        const prevStripEl = draggedIndex > 0 ? allStripElements[draggedIndex - 1] : null
        const measureFromY = prevStripEl
          ? prevStripEl.getBoundingClientRect().bottom
          : container.getBoundingClientRect().top

        // Dragging down = increase gap (only for last strip)
        if (stripTopY > measureFromY + store.GAP_BUFFER && draggedIndex == stripElements.length) {
          const newGap = stripTopY - measureFromY
          store.setGapAtIndex(targetBayId, targetSectionId, draggedIndex, newGap)
          return
        }

        // Dragging up = decrease gap
        if (stripTopY < originalTop && currentGap > 0) {
          const delta = originalTop - stripTopY
          store.setGapAtIndex(targetBayId, targetSectionId, draggedIndex, Math.max(0, currentGap - delta))
          return
        }
      }

      // Dropped within original bounds - no change
      return
    }
  }

  // Move the strip
  store.moveStripToSection(stripId, targetBayId, targetSectionId, position)

  // Create gap if dropped below last strip with enough distance
  if (droppedBelowLastStrip && distanceBelowLastStrip >= store.GAP_BUFFER) {
    const gapSize = isSameSection
      ? distanceBelowLastStrip + draggedStripHeight
      : distanceBelowLastStrip
    store.setGapAtIndex(targetBayId, targetSectionId, position, gapSize)
  }

  // Create gap if dropped into empty section below the buffer distance
  if (droppedIntoEmptySection) {
    store.setGapAtIndex(targetBayId, targetSectionId, 0, distanceFromTop)
  }
}

function onDragAreaTouchCancel() {
  if (longPressTimer) {
    clearTimeout(longPressTimer)
    longPressTimer = null
  }

  if (isDragging.value) {
    touchDrag.cancelDrag()
    isDragging.value = false
  }

  touchStarted = false
}

// Action button handlers
function onActionClick() {
  if (props.strip.defaultAction) {
    store.sendStripAction(props.strip.id, props.strip.defaultAction)
  }
}

function onActionTouch(event: TouchEvent) {
  event.preventDefault()
  if (props.strip.defaultAction) {
    store.sendStripAction(props.strip.id, props.strip.defaultAction)
  }
}

function onStripClick() {
  // Future: open strip detail/edit modal
}
</script>

<style scoped>
.flight-strip {
  display: grid;
  grid-template-columns: 10px auto 1fr auto;
  background: #f0ebe0;
  border: 1px solid #888;
  margin: 2px 4px;
  min-height: 44px;
  cursor: move;
  transition: all 0.12s ease;
  font-family: 'Consolas', 'Monaco', 'Lucida Console', monospace;
  font-size: 11px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
}

.flight-strip:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
  transform: translateY(-1px);
  z-index: 10;
}

.flight-strip.dragging {
  opacity: 0.4;
  transform: scale(0.98);
}

/* Strip type color indicators */
.strip-indicator {
  transition: filter 0.15s ease;
}

/* Departure - Blue */
.strip-departure .strip-indicator {
  background: #3b7dd8;
}

/* Arrival - Yellow/Amber */
.strip-arrival .strip-indicator {
  background: #daa520;
}

/* Local - Red */
.strip-local .strip-indicator {
  background: #cc4444;
}

/* VFR - Green */
.strip-vfr .strip-indicator {
  background: #3d9e3d;
}

/* Left section - Callsign block (always visible) */
.strip-left {
  width: 75px;
  min-width: 75px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 2px 4px;
  background: #fff;
  border-right: 1px solid #999;
  touch-action: none;
  cursor: move;
}

.callsign {
  font-weight: bold;
  font-size: 13px;
  color: #000;
  letter-spacing: 0.3px;
  line-height: 1.2;
}

.callsign-sub {
  display: flex;
  gap: 4px;
  font-size: 9px;
  color: #555;
  margin-top: 1px;
}

.flight-rules {
  font-weight: 600;
  color: #333;
}

.aircraft-type {
  color: #666;
}

.squawk {
  font-size: 10px;
  color: #444;
  font-weight: 500;
  margin-top: 1px;
}

/* Middle section - horizontally scrollable */
.strip-middle {
  /*touch-action: pan-x; 
  overflow-x: auto;*/
  overflow-x: hidden;
  overflow-y: hidden;
  background: #f5f2ea;
  scrollbar-width: none; /* Firefox */
  -ms-overflow-style: none; /* IE/Edge */
}

.strip-middle::-webkit-scrollbar {
  display: none; /* Chrome/Safari */
}

.strip-middle-content {
  display: flex;
  align-items: stretch;
  min-width: max-content;
  height: 100%;
}

/* Vertical dividers */
.strip-divider {
  width: 1px;
  background: #aaa;
  margin: 2px 0;
  flex-shrink: 0;
}

.strip-section {
  flex-shrink: 0;
}

/* Time section */
.strip-time {
  width: 42px;
  min-width: 42px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  padding: 2px;
}

.time-value {
  font-weight: 600;
  font-size: 11px;
  color: #222;
}

.time-label {
  font-size: 7px;
  color: #888;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* SID/Clearance section */
.strip-sid {
  width: 65px;
  min-width: 65px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 2px 4px;
}

.sid-value {
  font-weight: 600;
  font-size: 10px;
  color: #0055aa;
}

.cleared-data {
  display: flex;
  gap: 4px;
  font-size: 9px;
  margin-top: 2px;
}

.alt {
  color: #0066cc;
  font-weight: 500;
}

.hdg {
  color: #666;
}

/* Airports section */
.strip-airports {
  width: 80px;
  min-width: 80px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 2px 4px;
}

.airport {
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: 10px;
  line-height: 1.3;
}

.airport.highlight .icao {
  font-weight: bold;
  color: #000;
}

.icao {
  font-weight: 500;
  color: #444;
  letter-spacing: 0.3px;
}

/* Route section */
.strip-route {
  width: 100px;
  min-width: 100px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 2px 4px;
}

.route-text {
  font-size: 9px;
  color: #555;
  white-space: nowrap;
}

.rfl {
  font-weight: 600;
  font-size: 10px;
  color: #0055aa;
  margin-top: 1px;
}

/* Stand section */
.strip-stand {
  width: 40px;
  min-width: 40px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  padding: 2px;
  background: #e8e4d8;
}

.stand-value {
  font-weight: bold;
  font-size: 12px;
  color: #333;
}

.runway-value {
  font-size: 9px;
  color: #666;
  font-weight: 500;
}

/* Right section - Action button */
.strip-right {
  display: flex;
  align-items: stretch;
  border-left: 1px solid #999;
}

.action-button {
  min-width: 36px;
  width: auto;
  padding: 0 4px;
  border: none;
  background: linear-gradient(to bottom, #e8e8e8, #c8c8c8);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s ease;
  touch-action: manipulation;
}

.action-button:hover {
  background: linear-gradient(to bottom, #f0f0f0, #d8d8d8);
}

.action-button:active {
  background: linear-gradient(to bottom, #c0c0c0, #a8a8a8);
}

.action-text {
  font-size: 9px;
  font-weight: bold;
  color: #333;
  letter-spacing: 0.3px;
}

/* Takeoff indicator - green triangle */
.takeoff-indicator {
  min-width: 36px;
  width: auto;
  padding: 0 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f5f2ea;
}

.takeoff-triangle {
  width: 20px;
  height: 20px;
}

.takeoff-triangle polygon {
  fill: #31bb31;
  stroke: #2e8b2e;
  stroke-width: 1;
}
</style>

<template>
  <div
    ref="stripElement"
    class="flight-strip"
    :class="[stripTypeClass, { dragging: isDragging, 'is-bottom': isBottom }]"
    :style="stripStyle"
    :data-strip-id="strip.id"
    draggable="true"
    @dragstart="onDragStart"
    @dragend="onDragEnd"
    @contextmenu.prevent
    @click="onStripClick"
  >
    <!-- Color indicator bar on left -->
    <div class="strip-indicator"></div>

    <!-- Left section: Callsign block (always visible) -->
    <div
      class="strip-left"
      @touchstart="onDragAreaTouchStart"
      @touchmove.prevent="onDragAreaTouchMove"
      @touchend="onDragAreaTouchEnd"
      @touchcancel="onDragAreaTouchCancel"
    >
      <div class="callsign">{{ strip.callsign }}</div>
      <div class="callsign-sub">
        <span class="flight-rules">{{ strip.flightRules }}</span>
        <span class="aircraft-type">{{ strip.aircraftType }}{{ strip.wakeTurbulence }}</span>
      </div>
      <div class="squawk" v-if="strip.squawk">{{ strip.squawk }}</div>
    </div>

    <!-- Middle section (horizontally scrollable) -->
    <div
      class="strip-middle"
      ref="stripMiddle"
      @mousedown="onMiddleMouseDown"
      @dragstart="onMiddleDragStart"
      @dragend="onMiddleDragEnd"
    >
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

    <!-- Right section: Action button (always visible) -->
    <div class="strip-right">
      <button
        class="action-button"
        @click.stop="onActionClick"
        @touchend.stop="onActionTouch"
      >
        <span class="action-icon">›</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { FlightStrip } from '@/types/efs'
import { useEfsStore } from '@/store/efs'
import { getTouchDragInstance } from '@/composables/useTouchDrag'

const props = withDefaults(defineProps<{
  strip: FlightStrip
  sectionId: string
  bayId: string
  isBottom?: boolean
}>(), {
  isBottom: false
})

const store = useEfsStore()
const stripElement = ref<HTMLElement | null>(null)
const stripMiddle = ref<HTMLElement | null>(null)
const isDragging = ref(false)

// Touch drag state
let touchStarted = false
let touchMoved = false
let longPressTimer: number | null = null
const LONG_PRESS_DELAY = 150 // ms before drag starts

// Middle section mouse scroll state
let middleMouseState: 'idle' | 'pending' | 'scrolling' | 'dragging' = 'idle'
let middleStartX = 0
let middleStartY = 0
let middleScrollStart = 0
const DIRECTION_THRESHOLD = 5 // pixels to determine direction

const touchDrag = getTouchDragInstance()

const stripTypeClass = computed(() => `strip-${props.strip.stripType}`)

const stripStyle = computed(() => {
  const style: Record<string, string> = {}
  if (props.strip.gapBefore && props.strip.gapBefore > 0) {
    style.marginTop = `${props.strip.gapBefore}px`
  }
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
      originalTop: rect.top,
      originalBottom: rect.bottom
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
  touchMoved = false

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
        originalTop: rect.top,
        originalBottom: rect.bottom
      }, touch)
    }
  }, LONG_PRESS_DELAY)
}

function onDragAreaTouchMove(event: TouchEvent) {
  if (!touchStarted) return

  touchMoved = true

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
          const isSameSection = result.data.bayId === targetBayId &&
                               result.data.sectionId === targetSectionId

          if (result.isBottomDrop) {
            // Move to bottom strips
            store.moveStripToBottom(
              result.data.stripId,
              targetBayId,
              targetSectionId,
              result.dropPosition
            )
          } else if (isSameSection &&
                     result.data.originalTop !== undefined &&
                     result.data.originalBottom !== undefined) {
            // Same section - check position first, then gap adjustment
            const dropY = result.touchY
            const originalTop = result.data.originalTop
            const originalBottom = result.data.originalBottom
            const currentGap = props.strip.gapBefore || 0

            // First check if position changed (crossed another strip's midpoint)
            if (result.dropPosition !== props.strip.position) {
              // Position changed - do reorder
              store.moveStripToSection(
                result.data.stripId,
                targetBayId,
                targetSectionId,
                result.dropPosition
              )
            }
            // Same position - handle gap adjustment based on drag direction
            else if (dropY > originalBottom) {
              // Dragging down = increase gap
              const delta = dropY - originalBottom
              store.setStripGap(result.data.stripId, currentGap + delta)
            }
            else if (dropY < originalTop && currentGap > 0) {
              // Dragging up with existing gap = decrease gap
              const delta = originalTop - dropY
              store.setStripGap(result.data.stripId, Math.max(0, currentGap - delta))
            }
            // else: dropped within original bounds at same position = no change
          } else {
            store.moveStripToSection(
              result.data.stripId,
              targetBayId,
              targetSectionId,
              result.dropPosition
            )
          }
        }
      }
    }

    isDragging.value = false
  }

  touchStarted = false
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

// Middle section mouse handlers for horizontal scroll vs vertical drag
function onMiddleMouseDown(event: MouseEvent) {
  if (event.button !== 0) return // Only left click

  middleMouseState = 'pending'
  middleStartX = event.clientX
  middleStartY = event.clientY
  middleScrollStart = stripMiddle.value?.scrollLeft ?? 0

  // Add document-level listeners
  document.addEventListener('mousemove', onMiddleMouseMove)
  document.addEventListener('mouseup', onMiddleMouseUp)
}

function onMiddleMouseMove(event: MouseEvent) {
  if (middleMouseState === 'idle') return

  const deltaX = event.clientX - middleStartX
  const deltaY = event.clientY - middleStartY

  if (middleMouseState === 'pending') {
    // Determine direction based on which threshold is crossed first
    const absX = Math.abs(deltaX)
    const absY = Math.abs(deltaY)

    if (absX > DIRECTION_THRESHOLD && absX > absY) {
      // Horizontal dominant - enter scroll mode
      middleMouseState = 'scrolling'
      event.preventDefault()
    } else if (absY > DIRECTION_THRESHOLD && absY >= absX) {
      // Vertical dominant - let drag happen, stop tracking
      middleMouseState = 'idle'
      cleanupMiddleMouseListeners()
      return
    }
  }

  if (middleMouseState === 'scrolling' && stripMiddle.value) {
    // Scroll the middle section
    stripMiddle.value.scrollLeft = middleScrollStart - deltaX
    event.preventDefault()
  }
}

function onMiddleMouseUp() {
  cleanupMiddleMouseListeners()
  middleMouseState = 'idle'
}

function cleanupMiddleMouseListeners() {
  document.removeEventListener('mousemove', onMiddleMouseMove)
  document.removeEventListener('mouseup', onMiddleMouseUp)
}

function onMiddleDragStart(event: DragEvent) {
  // Prevent drag if we're in scroll mode
  if (middleMouseState === 'scrolling') {
    event.preventDefault()
    event.stopPropagation()
    return
  }
  // Clean up and let drag proceed
  cleanupMiddleMouseListeners()
  middleMouseState = 'idle'
}

function onMiddleDragEnd() {
  // Ensure state is reset after drag completes
  cleanupMiddleMouseListeners()
  middleMouseState = 'idle'
}

// Action button handlers
function onActionClick() {
  store.moveStripToNextSection(props.strip.id)
}

function onActionTouch(event: TouchEvent) {
  event.preventDefault()
  store.moveStripToNextSection(props.strip.id)
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
  overflow-x: auto;
  overflow-y: hidden;
  background: #f5f2ea;
  touch-action: pan-x;
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
  width: 28px;
  border: none;
  background: linear-gradient(to bottom, #f8f8f8, #e0e0e0);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s ease;
  touch-action: manipulation;
}

.action-button:hover {
  background: linear-gradient(to bottom, #fff, #e8e8e8);
}

.action-button:active {
  background: linear-gradient(to bottom, #d0d0d0, #c0c0c0);
}

.action-icon {
  font-size: 18px;
  font-weight: bold;
  color: #555;
  line-height: 1;
}

/* Strip type specific action button colors */
.strip-departure .action-button {
  background: linear-gradient(to bottom, #5a9be8, #3b7dd8);
}
.strip-departure .action-button:hover {
  background: linear-gradient(to bottom, #6aabf8, #4b8de8);
}
.strip-departure .action-button .action-icon {
  color: #fff;
}

.strip-arrival .action-button {
  background: linear-gradient(to bottom, #eab530, #daa520);
}
.strip-arrival .action-button:hover {
  background: linear-gradient(to bottom, #fac540, #eab530);
}
.strip-arrival .action-button .action-icon {
  color: #fff;
}

.strip-local .action-button {
  background: linear-gradient(to bottom, #dc5454, #cc4444);
}
.strip-local .action-button:hover {
  background: linear-gradient(to bottom, #ec6464, #dc5454);
}
.strip-local .action-button .action-icon {
  color: #fff;
}

.strip-vfr .action-button {
  background: linear-gradient(to bottom, #4dae4d, #3d9e3d);
}
.strip-vfr .action-button:hover {
  background: linear-gradient(to bottom, #5dbe5d, #4dae4d);
}
.strip-vfr .action-button .action-icon {
  color: #fff;
}
</style>

<template>
  <ClearanceDialog v-model="clncDialogOpen" :strip="strip" />
  <FlightplanDialog v-model="fplDialogOpen" :strip="strip" />

  <v-dialog v-model="deleteDialogOpen" max-width="300" content-class="delete-dialog-wrapper">
    <div class="delete-dialog">
      <div class="delete-dialog-text">Delete strip for flight {{ strip.callsign }}?</div>
      <div class="delete-dialog-actions">
        <button class="delete-dialog-btn delete-dialog-cancel" @click="deleteDialogOpen = false">Cancel</button>
        <button class="delete-dialog-btn delete-dialog-confirm" @click="onDeleteConfirm">DELETE</button>
      </div>
    </div>
  </v-dialog>

  <v-menu v-model="menuOpen" :target="menuPosition" location="end" :close-on-content-click="true">
    <v-list density="compact" class="strip-context-menu">
      <v-list-item v-if="isDeparture" @click="onClncMenuClick">
        <v-list-item-title>Clearance</v-list-item-title>
      </v-list-item>
      <v-list-item v-if="!isNote" @click="onFplClick">
        <v-list-item-title>Flightplan</v-list-item-title>
      </v-list-item>
      <v-list-item @click="onDeleteClick">
        <v-list-item-title>Delete</v-list-item-title>
      </v-list-item>
    </v-list>
  </v-menu>

  <div ref="stripElement" class="flight-strip"
    :class="[stripTypeClass, { dragging: isDragging, 'is-bottom': strip.bottom, 'strip-note-layout': isNote }]" :style="stripStyle"
    :data-strip-id="strip.id" draggable="true" @dragstart="onDragStart" @dragend="onDragEnd"
    @touchstart="onDragAreaTouchStart" @touchmove.prevent="onDragAreaTouchMove" @touchend="onDragAreaTouchEnd"
    @touchcancel="onDragAreaTouchCancel" @contextmenu.prevent="onContextMenu" @click="onStripClick">
    <!-- Color indicator bar on left -->
    <div class="strip-indicator"></div>

    <!-- NOTE STRIP: Editable text layout -->
    <template v-if="isNote">
      <div class="note-content" @click.stop="onNoteClick" @touchend="onNoteTouch">
        <input
          v-if="noteEditing"
          ref="noteInput"
          v-model="noteText"
          class="note-input"
          placeholder="Type a note..."
          @input="onNoteInput"
          @blur="onNoteBlur"
          @keydown.enter="onNoteBlur"
          @keydown.escape="onNoteBlur"
        />
        <span v-else class="note-display" :class="{ 'note-empty': !strip.noteText }">
          {{ strip.noteText || 'Click to add note...' }}
        </span>
      </div>
    </template>

    <!-- NORMAL STRIP LAYOUT -->
    <template v-else>
    <!-- Left section: Callsign block (always visible) -->
    <div class="strip-left">
      <div class="callsign" :class="{ 'callsign-no-match': strip.hasMatchingFlight === false }" @click.stop="onCallsignClick" @touchend.stop.prevent="onCallsignTouch">{{ strip.callsign }}</div>
      <div class="callsign-sub">
        <span class="flight-rules">{{ strip.flightRules }}</span>
        <span class="aircraft-type">{{ strip.aircraftType }} {{ strip.wakeTurbulence }}</span>
      </div>
      <div class="squawk-stand-row">
        <span class="squawk" v-if="strip.squawk">{{ strip.squawk }}</span>
        <span class="squawk" :class="{ 'squawk-empty': strip.canResetSquawk }" v-else
          @click.stop="strip.canResetSquawk && onResetSquawk()">----</span>
        <span class="stand" v-if="strip.stand">{{ strip.stand }}</span>
      </div>
    </div>

    <!-- Middle section (truncatable) -->
    <div class="strip-middle">
      <div class="strip-middle-content">
        <!-- Time section / clearance triangle -->
        <div class="strip-section strip-time">
          <template v-if="strip.clearedForTakeoff || strip.clearedToLand">
            <svg v-if="strip.clearedForTakeoff" viewBox="0 0 24 24" class="clearance-triangle takeoff">
              <polygon points="12,4 22,20 2,20" />
            </svg>
            <svg v-else viewBox="0 0 24 24" class="clearance-triangle landing">
              <polygon points="12,20 22,4 2,4" />
            </svg>
          </template>
          <template v-else>
            <div class="time-value">{{ displayTime }}</div>
            <div class="time-label" v-if="strip.stripType === 'departure' || strip.stripType === 'local'">EOBT</div>
            <div class="time-label" v-else>ETA</div>
          </template>
        </div>
        <div class="strip-divider"></div>

        <!-- SID section -->
        <template  v-if="strip.stripType === 'departure'">
          <div class="strip-section strip-sid">
              <div class="sid-value">{{ strip.sid || '' }}</div>
              <div class="cleared-data" v-if="strip.clearedAltitude || strip.assignedHeading">
                <span v-if="strip.clearedAltitude" class="alt">{{ strip.clearedAltitude }}</span>
                <span v-if="strip.assignedHeading" class="hdg">H{{ strip.assignedHeading }}</span>
              </div>
          </div>
          <div class="strip-divider"></div>
        </template>

        <!-- Airports section -->
        <div class="strip-section strip-airports">
          <template v-if="store.myAirports.length > 1">
            <div class="airport adep" :class="{ highlight: strip.stripType === 'departure' || strip.stripType === 'local' }">
              <span class="icao">{{ strip.adep }}</span>
            </div>
            <div class="airport ades" :class="{ highlight: strip.stripType === 'arrival' || strip.stripType === 'local' }">
              <span class="icao">{{ strip.ades }}</span>
            </div>
          </template>
          <template v-else>
            <div class="airport highlight single-airport">
              <span class="icao">{{ (strip.stripType === 'arrival' || strip.stripType === 'local') ? strip.adep : strip.ades }}</span>
            </div>
          </template>
        </div>

      </div>
    </div>

    <!-- Runway section (always visible, right-aligned) -->
    <div class="strip-runway-fixed" v-if="strip.runway">
      <div class="runway-value" v-if="strip.runway">{{ strip.runway }}</div>
    </div>

    <!-- Right section: Action button(s) (hidden in observer mode) -->
    <template v-if="store.isController">
      <div v-if="(strip.actions && strip.actions.length > 0) || showGoaButton" class="strip-right"
        :class="{ 'multi-action': effectiveActionCount > 1 }">
        <button v-for="action in strip.actions" :key="action" class="action-button"
          :class="actionButtonClass(action)"
          @click.stop="() => onActionClick(action)" @touchend.stop="(e) => onActionTouch(e, action)">
          <span class="action-text">{{ action }}</span>
          <span v-if="(action === 'XFER' || action === 'READY') && strip.xferFrequency" class="action-freq">{{ strip.xferFrequency }}</span>
        </button>
        <button v-if="showGoaButton" class="action-button action-goa"
          @click.stop="onGoaClick" @touchend.stop="onGoaTouch">
          <span class="action-text">GOA</span>
        </button>
      </div>
      <div v-else class="strip-right strip-right-empty"></div>
    </template>
    </template><!-- end v-else (normal strip layout) -->
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted } from 'vue'
import type { FlightStrip } from '@/types/efs'
import { useEfsStore } from '@/store/efs'
import { getTouchDragInstance } from '@/composables/useTouchDrag'
import ClearanceDialog from './ClearanceDialog.vue'
import FlightplanDialog from './FlightplanDialog.vue'

const props = defineProps<{
  strip: FlightStrip
  sectionId: string
  bayId: string
}>()

const store = useEfsStore()
const stripElement = ref<HTMLElement | null>(null)
const isDragging = ref(false)

// Context menu state
const menuOpen = ref(false)
const menuPosition = ref<[number, number]>([0, 0])

// Dialog state
const clncDialogOpen = ref(false)
const fplDialogOpen = ref(false)
const deleteDialogOpen = ref(false)

// Note strip state
const isNote = computed(() => props.strip.stripType === 'note')
const isDeparture = computed(() => props.strip.stripType === 'departure' || props.strip.stripType === 'local')
const showGoaButton = computed(() => !isNote.value && !!props.strip.clearedToLand && !props.strip.missedApproach)
const effectiveActionCount = computed(() => (props.strip.actions?.length ?? 0) + (showGoaButton.value ? 1 : 0))
const noteEditing = ref(false)
const noteText = ref('')
const noteInitialText = ref('')
const noteDirty = ref(false)
const noteInput = ref<HTMLInputElement | null>(null)

function onNoteClick() {
  // Keep in-progress text if already editing; avoid resetting from stale strip.noteText.
  // Still re-focus the input (important for touch interactions).
  if (noteEditing.value) {
    nextTick(() => {
      noteInput.value?.focus()
    })
    return
  }
  noteText.value = props.strip.noteText ?? ''
  noteInitialText.value = noteText.value
  noteDirty.value = false
  noteEditing.value = true
  nextTick(() => {
    noteInput.value?.focus()
  })
}

function onNoteInput() {
  noteDirty.value = true
}

function onNoteTouch(event: TouchEvent) {
  if (isDragging.value) return // Let the strip's touchend handler clean up the drag
  // Cancel any pending drag timer that touchstart may have started
  if (longPressTimer) {
    clearTimeout(longPressTimer)
    longPressTimer = null
  }
  touchStarted = false
  event.stopPropagation()
  event.preventDefault()
  onNoteClick()
}

function onNoteBlur() {
  noteEditing.value = false
  if (!noteDirty.value) return
  const text = noteText.value.trim()
  if (text !== noteInitialText.value) {
    store.updateNote(props.strip.id, text)
  }
}

// Auto-focus note strips that are newly created (empty text)
onMounted(() => {
  if (isNote.value && !props.strip.noteText) {
    onNoteClick()
  }
})

// Touch drag state
let touchStarted = false
let longPressTimer: number | null = null
const LONG_PRESS_DELAY = 150 // ms before drag starts

const touchDrag = getTouchDragInstance()

const stripTypeClass = computed(() => `strip-${props.strip.stripType}`)

const stripStyle = computed(() => {
  const style: Record<string, string> = {}
  if (!store.isController) {
    style['grid-template-columns'] = '10px auto minmax(0, 1fr) auto'
  }
  return style
})

const displayTime = computed(() => {
  if (props.strip.stripType === 'departure' || props.strip.stripType === 'local') {
    return props.strip.eobt || ''
  }
  return props.strip.eta || ''
})

// DCL button coloring + action highlight
function actionButtonClass(action: string): Record<string, boolean> {
  const classes: Record<string, boolean> = {}

  // Highlight actions (TXI, PARK, XFER)
  if (props.strip.highlightActions?.includes(action)) {
    classes['action-highlight'] = true
  }

  // ASSUME needs condensed text
  if (action === 'ASSUME') {
    classes['action-assume'] = true
  }

  // DCL status coloring for CLNC button
  if (action === 'CLNC') {
    const status = props.strip.dclStatus
    classes['action-dcl-request'] = status === 'REQUEST'
    classes['action-dcl-error'] = status === 'INVALID' || status === 'UNABLE' || status === 'REJECTED'
    classes['action-dcl-sent'] = status === 'SENT'
  }

  return classes
}

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

  // Don't start drag when touching interactive elements
  const target = event.target as HTMLElement
  if (target.closest('.action-button') || target.closest('.squawk-empty') || target.closest('.callsign') || target.closest('.note-input')) return

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
function onActionClick(action: string) {
  if (action === 'CLNC') {
    clncDialogOpen.value = true
    return
  }
  store.sendStripAction(props.strip.id, action)
}

function onActionTouch(event: TouchEvent, action: string) {
  event.preventDefault()
  if (action === 'CLNC') {
    clncDialogOpen.value = true
    return
  }
  store.sendStripAction(props.strip.id, action)
}

function onGoaClick() {
  store.sendStripAction(props.strip.id, 'GOA')
}

function onGoaTouch(event: TouchEvent) {
  event.preventDefault()
  store.sendStripAction(props.strip.id, 'GOA')
}

function onResetSquawk() {
  store.sendStripAction(props.strip.id, 'resetSquawk')
}

function onStripClick() {
  // Future: open strip detail/edit modal
}

function onContextMenu(event: MouseEvent) {
  menuPosition.value = [event.clientX, event.clientY]
  menuOpen.value = true
}

function onCallsignClick(event: MouseEvent) {
  menuPosition.value = [event.clientX, event.clientY]
  menuOpen.value = true
}

function onCallsignTouch(event: TouchEvent) {
  const touch = event.changedTouches[0]
  if (touch) {
    menuPosition.value = [touch.clientX, touch.clientY]
    menuOpen.value = true
  }
}

function onFplClick() {
  fplDialogOpen.value = true
  menuOpen.value = false
}

function onClncMenuClick() {
  clncDialogOpen.value = true
  menuOpen.value = false
}

function onDeleteClick() {
  menuOpen.value = false
  if (isNote.value) {
    store.deleteStrip(props.strip.id)
    return
  }
  deleteDialogOpen.value = true
}

function onDeleteConfirm() {
  store.deleteStrip(props.strip.id)
  deleteDialogOpen.value = false
}
</script>

<style scoped>
.flight-strip {
  display: grid;
  grid-template-columns: 10px auto minmax(0, 1fr) auto auto;
  background: #f0ebe0;
  border: 1px solid #888;
  margin: 2px 4px;
  min-height: 44px;
  cursor: move;
  transition: all 0.12s ease;
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

/* Cross - Purple */
.strip-cross .strip-indicator {
  background: #9b59b6;
}

/* Note - Grey */
.strip-note .strip-indicator {
  background: #888;
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
  cursor: pointer;
  touch-action: manipulation;
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

.squawk-stand-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 1px;
}

.squawk-stand-row .squawk {
  font-size: 10px;
  color: #444;
  font-weight: 500;
}

.squawk-stand-row .squawk-empty {
  cursor: pointer;
  color: #444;
}

.squawk-stand-row .squawk-empty:hover {
  color: #0055aa;
}

.squawk-stand-row .stand {
  font-size: 10px;
  color: #333;
  font-weight: bold;
}

/* Middle section - truncatable */
.strip-middle {
  overflow: hidden;
  background: #f5f2ea;
  min-width: 0;
  /* Allow shrinking below content size */
}

.strip-middle-content {
  display: flex;
  align-items: stretch;
  height: 100%;
}

/* Vertical dividers */
.strip-divider {
  width: 1px;
  background: #ddd;
  margin: 2px 0;
  flex-shrink: 0;
}

.strip-section {
  flex-shrink: 0;
}

/* Time section - fixed width, important info */
.strip-time {
  width: 32px;
  min-width: 32px;
  flex-shrink: 0;
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
  width: 70px;
  min-width: 60px;
  flex-shrink: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 2px 4px;
  overflow: hidden;
}

.sid-value {
  font-weight: 600;
  font-size: 10px;
  color: #0055aa;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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

/* Airports section - important, try to keep visible */
.strip-airports {
  width: 80px;
  min-width: 45px;
  flex-shrink: 1;
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

/* Runway section - fixed on right, always visible */
.strip-runway-fixed {
  min-width: 32px;
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  gap: 2px;
  padding: 2px 4px;
  background: #e8e4d8;
  border-left: 1px solid #aaa;
}

.strip-runway-fixed .runway-value {
  font-weight: bold;
  font-size: 12px;
  color: #333;
}

/* Clearance triangles (takeoff/landing) - shown in time section */
.clearance-triangle {
  width: 24px;
  height: 24px;
}

.clearance-triangle.takeoff polygon {
  fill: #31bb31;
  stroke: #2e8b2e;
  stroke-width: 1;
}

.clearance-triangle.landing polygon {
  fill: #31bb31;
  stroke: #2e8b2e;
  stroke-width: 1;
}

.single-airport {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
}

/* Right section - Action button(s) */
.strip-right {
  width: 40px;
  display: flex;
  align-items: stretch;
  border-left: 1px solid #999;
}

.strip-right-empty {
  background: #e8e4d8;
}

/* Multiple actions: stack vertically */
.strip-right.multi-action {
  flex-direction: column;
}

.strip-right.multi-action .action-button {
  flex: 1;
  border-bottom: 1px solid #999;
}

.strip-right.multi-action .action-button:last-child {
  border-bottom: none;
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
  font-size: 10px;
  font-weight: bold;
  color: #333;
  letter-spacing: 0.3px;
}

.action-assume .action-text {
  font-size: 10px;
  letter-spacing: -0.8px;
  font-stretch: condensed;
}

.action-freq {
  font-size: 10px;
  font-weight: 600;
  color: #555;
  line-height: 1;
  font-stretch: condensed;
}

.action-button:has(.action-freq) {
  flex-direction: column;
  gap: 0px;
  padding: 1px 2px;
}

/* Highlight action buttons (TXI, PARK, XFER) */
.action-highlight {
  background: linear-gradient(to bottom, #fdd835, #f9a825) !important;
}

.action-highlight:hover {
  background: linear-gradient(to bottom, #ffee58, #fbc02d) !important;
}

/* DCL status coloring for CLNC button */
.action-dcl-request {
  background: linear-gradient(to bottom, #fdd835, #f9a825) !important;
  animation: dcl-flash 0.8s ease-in-out infinite;
}

.action-dcl-request:hover {
  background: linear-gradient(to bottom, #ffee58, #fbc02d) !important;
  animation: none;
}

@keyframes dcl-flash {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.action-dcl-error {
  background: linear-gradient(to bottom, #ef5350, #c62828) !important;
}

.action-dcl-error:hover {
  background: linear-gradient(to bottom, #e57373, #d32f2f) !important;
}

.action-dcl-error .action-text {
  color: #fff;
}

.action-dcl-sent {
  background: linear-gradient(to bottom, #66bb6a, #2e7d32) !important;
}

.action-dcl-sent:hover {
  background: linear-gradient(to bottom, #81c784, #388e3c) !important;
}

.action-dcl-sent .action-text {
  color: #fff;
}

/* Greyed-out callsign (no matching flight) */
.callsign-no-match {
  color: #999 !important;
  font-style: italic;
}

/* Note strip layout */
.strip-note-layout {
  grid-template-columns: 10px 1fr !important;
}

.note-content {
  display: flex;
  align-items: center;
  padding: 2px 8px;
  min-height: 40px;
  cursor: text;
}

.note-input {
  width: 100%;
  background: transparent;
  border: none;
  border-bottom: 1px solid #aaa;
  color: #333;
  font-size: 12px;
  font-weight: 500;
  outline: none;
  padding: 2px 0;
  font-family: 'Segoe UI', 'Arial', sans-serif;
}

.note-display {
  font-size: 12px;
  font-weight: 500;
  color: #333;
  word-break: break-word;
}

.note-empty {
  color: #999;
  font-style: italic;
}

/* Context menu styling */
.strip-context-menu {
  min-width: 100px;
  font-size: 12px;
}

.strip-context-menu .v-list-item {
  min-height: 32px;
}


</style>

<style>
/* Delete confirmation dialog - unscoped because v-dialog teleports */
.delete-dialog-wrapper {
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5) !important;
}

.delete-dialog {
  background: #2a2a2e;
  border: 2px solid #555;
  padding: 0;
}

.delete-dialog-text {
  padding: 16px;
  color: #e0e0e0;
  font-size: 13px;
  font-weight: 600;
  text-align: center;
}

.delete-dialog-actions {
  display: flex;
  border-top: 1px solid #555;
}

.delete-dialog-btn {
  flex: 1;
  padding: 8px 0;
  border: none;
  font-size: 12px;
  font-weight: bold;
  cursor: pointer;
  letter-spacing: 0.5px;
}

.delete-dialog-cancel {
  background: #555;
  color: #ccc;
  border-right: 1px solid #666;
}

.delete-dialog-cancel:hover {
  background: #666;
}

.delete-dialog-confirm {
  background: #c62828;
  color: #fff;
}

.delete-dialog-confirm:hover {
  background: #e53935;
}
</style>

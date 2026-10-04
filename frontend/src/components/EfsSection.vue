<template>
  <StripCreationDialog
    v-model="createDialogOpen"
    :strip-type="createDialogType"
    :initial-airport="createDialogAirport"
    @create="onDialogCreate"
  />
  <div
    class="efs-section"
    :data-section-id="section.id"
    :style="sectionStyle"
  >
    <div
      class="section-header"
      :class="{ 'no-resize': isFirstSection }"
      @mousedown="onResizeStart"
      @touchstart="onResizeStart"
    >
      <span class="section-title">{{ sectionDisplayTitle }}</span>
      <div class="section-header-right">
        <div
          v-if="showTimeSortControls"
          class="section-sort-controls"
          @mousedown.stop
          @touchstart.stop
        >
          <button
            type="button"
            class="section-sort-btn"
            :title="timeSortFieldTitle"
            :disabled="!showTsatSortOption"
            @click.stop="toggleTimeSortField"
          >SORT {{ timeSortFieldLabel }}</button>
          <button
            type="button"
            class="section-sort-btn section-sort-dir-btn"
            :title="timeSortDirTitle"
            @click.stop="toggleTimeSortDir"
          >{{ timeSortDir === 'asc' ? '▲' : '▼' }}</button>
        </div>
        <div v-if="!isFirstSection" class="resize-handle"></div>
      </div>
    </div>
    <div
      class="section-content"
      :class="{ 'drag-over': isDragOver }"
    >
      <!-- Top strips container (scrollable) -->
      <div
        ref="topContainer"
        class="top-strips-container"
        @dragover.prevent="onTopDragOver"
        @dragenter="onTopDragEnter"
        @dragleave="onTopDragLeave"
        @drop="onTopDrop"
      >
        <template v-for="(strip, index) in topStrips" :key="strip.id">
          <!-- Gap before this strip (if any); skipped while auto time-sorted -->
          <div
            v-if="showGaps && sectionGaps[index]"
            class="strip-gap"
            :data-gap-index="index"
            :style="{ height: sectionGaps[index] + 'px' }"
            @click="onGapClick(index)"
          ></div>
          <FlightStrip
            :strip="strip"
            :section-id="section.id"
            :bay-id="bayId"
          />
        </template>
        <div v-if="topStrips.length === 0 && bottomStrips.length === 0" class="empty-section">
          Empty
        </div>
      </div>

      <!-- Bottom drop zone -->
      <div
        class="bottom-drop-zone"
        :class="{ 'drop-active': isBottomDragOver, 'has-bottom': bottomStrips.length > 0 }"
        @dragover.prevent="onBottomDragOver"
        @dragenter="onBottomDragEnter"
        @dragleave="onBottomDragLeave"
        @drop="onBottomDrop"
      ></div>

      <!-- Bottom strips container (pinned) -->
      <div
        v-if="bottomStrips.length > 0"
        class="bottom-strips-container"
        @dragover.prevent="onBottomStripsDragOver"
        @drop="onBottomStripsDrop"
      >
        <FlightStrip
          v-for="strip in bottomStrips"
          :key="strip.id"
          :strip="strip"
          :section-id="section.id"
          :bay-id="bayId"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { FlightStrip as FlightStripData, Section } from '@/types/efs'
import { useEfsStore } from '@/store/efs'
import { useSectionResize } from '@/composables/useSectionResize'
import FlightStrip from './FlightStrip.vue'
import StripCreationDialog from './StripCreationDialog.vue'

type SpecialStripType = 'vfrDep' | 'vfrArr' | 'cross' | 'note'
type TimeSortField = 'etobt' | 'tsat'
type TimeSortDir = 'asc' | 'desc'

const TIME_SORT_FIELD_KEY = 'efs/depTimeSort'
const TIME_SORT_DIR_KEY = 'efs/depTimeSortDir'
const TIME_SORT_SECTIONS = new Set(['pending_dep', 'cleared'])

const props = withDefaults(defineProps<{
  section: Section
  bayId: string
  isFirstSection?: boolean
  isLastSection?: boolean
}>(), {
  isFirstSection: false,
  isLastSection: false
})

const createDialogOpen = ref(false)
const createDialogType = ref<SpecialStripType>('vfrDep')
const createDialogAirport = ref<string | undefined>(undefined)

// Pending create info (stored while dialog is open, applied on dialog OK)
const pendingCreatePosition = ref<number | undefined>(undefined)
const pendingCreateIsBottom = ref<boolean>(false)
const pendingCreateGapIndex = ref<number | undefined>(undefined)
const pendingCreateGapSize = ref<number>(0)

const store = useEfsStore()
const { startResize } = useSectionResize()

const bayAirport = computed(() => {
  const bay = store.layout.bays.find(b => b.id === props.bayId)
  return bay?.airport
})

const isDragOver = ref(false)
const isBottomDragOver = ref(false)
const topContainer = ref<HTMLElement | null>(null)

const isTimeSortedSection = computed(() => TIME_SORT_SECTIONS.has(props.section.id))
const hasEssa = computed(() =>
  store.myAirports.some((a) => a.toUpperCase() === 'ESSA'),
)
/** Exactly ESSA — not multi-airport or another field */
const onlyEssa = computed(() => {
  const airports = store.myAirports.map((a) => a.toUpperCase())
  return airports.length === 1 && airports[0] === 'ESSA'
})
/** Sort controls only when ESSA is active (CDM times); TSAT↔E/TOBT toggle needs ESSA */
const showTimeSortControls = computed(() => isTimeSortedSection.value && hasEssa.value)
const showTsatSortOption = computed(() => hasEssa.value)
/** GNG-style: PENDING DEP → TSAT when only ESSA and sort controls are shown */
const sectionDisplayTitle = computed(() => {
  if (
    props.section.id === 'pending_dep' &&
    onlyEssa.value &&
    showTimeSortControls.value
  ) {
    return 'TSAT'
  }
  return props.section.title
})

function loadTimeSortField(): TimeSortField {
  // Migrate older pending-dep-only key if present
  const stored = localStorage.getItem(TIME_SORT_FIELD_KEY) ?? localStorage.getItem('efs/pendingDepSort')
  return stored === 'tsat' ? 'tsat' : 'etobt'
}

function loadTimeSortDir(): TimeSortDir {
  return localStorage.getItem(TIME_SORT_DIR_KEY) === 'desc' ? 'desc' : 'asc'
}

const timeSortField = ref<TimeSortField>(loadTimeSortField())
const timeSortDir = ref<TimeSortDir>(loadTimeSortDir())
const lastSortKeys = ref<Map<string, number>>(new Map())

function activeTimeSortField(): TimeSortField {
  return hasEssa.value ? timeSortField.value : 'etobt'
}

const timeSortFieldLabel = computed(() =>
  activeTimeSortField() === 'tsat' ? 'TSAT' : 'E/TOBT',
)

const timeSortFieldTitle = computed(() => {
  if (!showTsatSortOption.value) return 'Sorting by E/TOBT'
  return activeTimeSortField() === 'tsat'
    ? 'Sorting by TSAT — click to sort by E/TOBT'
    : 'Sorting by E/TOBT — click to sort by TSAT'
})

const timeSortDirTitle = computed(() =>
  timeSortDir.value === 'asc'
    ? 'Earliest at top — click for earliest at bottom'
    : 'Earliest at bottom — click for earliest at top',
)

const preferManualOrder = computed(() =>
  isTimeSortedSection.value && store.hasManualOrder(props.bayId, props.section.id),
)

function clearManualAndPersist() {
  store.clearManualOrder(props.bayId, props.section.id)
}

function toggleTimeSortField() {
  if (!showTsatSortOption.value) return
  timeSortField.value = timeSortField.value === 'tsat' ? 'etobt' : 'tsat'
  localStorage.setItem(TIME_SORT_FIELD_KEY, timeSortField.value)
  clearManualAndPersist()
}

function toggleTimeSortDir() {
  timeSortDir.value = timeSortDir.value === 'asc' ? 'desc' : 'asc'
  localStorage.setItem(TIME_SORT_DIR_KEY, timeSortDir.value)
  clearManualAndPersist()
}

/** Minutes since midnight for HHMM / HHMMSS; missing/invalid → +∞ (sort last in asc) */
function hhmmSortKey(hhmm: string | undefined): number {
  if (!hhmm) return Number.POSITIVE_INFINITY
  const digits = hhmm.replace(/\D/g, '')
  if (digits.length < 3) return Number.POSITIVE_INFINITY
  const normalized = digits.length === 3 ? digits.padStart(4, '0') : digits.slice(0, 4)
  const h = Number(normalized.slice(0, 2))
  const m = Number(normalized.slice(2, 4))
  if (h > 23 || m > 59) return Number.POSITIVE_INFINITY
  return h * 60 + m
}

function depTimeSortKey(strip: FlightStripData, field: TimeSortField): number {
  if (field === 'tsat') return hhmmSortKey(strip.tsat)
  return hhmmSortKey(strip.tobt || strip.eobt)
}

function collectTopStrips(): FlightStripData[] {
  const list: FlightStripData[] = []
  store.strips.forEach((strip) => {
    if (strip.bayId === props.bayId && strip.sectionId === props.section.id && !strip.bottom) {
      list.push(strip)
    }
  })
  return list
}

function sortByDepTime(
  list: FlightStripData[],
  field: TimeSortField,
  dir: TimeSortDir,
): FlightStripData[] {
  return [...list].sort((a, b) => {
    // asc: earliest at top; desc: earliest at bottom; missing times stay at the far end
    const d = dir === 'asc'
      ? depTimeSortKey(a, field) - depTimeSortKey(b, field)
      : depTimeSortKey(b, field) - depTimeSortKey(a, field)
    if (d !== 0) return d
    const cs = a.callsign.localeCompare(b.callsign)
    if (cs !== 0) return cs
    return a.position - b.position
  })
}

/** Gaps only when not in auto time-sort mode */
const showGaps = computed(() => !isTimeSortedSection.value || preferManualOrder.value)

const topStrips = computed(() => {
  void store.stripsVersion
  const list = collectTopStrips()

  if (isTimeSortedSection.value && !preferManualOrder.value) {
    return sortByDepTime(list, activeTimeSortField(), timeSortDir.value)
  }

  return list.sort((a, b) => a.position - b.position)
})

// When E/TOBT or TSAT changes for a strip in this section, drop manual order and re-sort by time
watch(
  () => [store.stripsVersion, timeSortField.value, timeSortDir.value, hasEssa.value] as const,
  () => {
    if (!isTimeSortedSection.value) return
    const field = activeTimeSortField()
    const list = collectTopStrips()
    const nextKeys = new Map<string, number>()
    let keyChanged = false
    for (const strip of list) {
      const key = depTimeSortKey(strip, field)
      nextKeys.set(strip.id, key)
      if (lastSortKeys.value.has(strip.id) && lastSortKeys.value.get(strip.id) !== key) {
        keyChanged = true
      }
    }
    lastSortKeys.value = nextKeys
    if (keyChanged) {
      store.clearManualOrder(props.bayId, props.section.id)
    }
  },
)

const bottomStrips = computed(() => store.getBottomStrips(props.bayId, props.section.id))
const sectionGaps = computed(() => store.getGapsForSection(props.bayId, props.section.id))


const sectionStyle = computed(() => {
  // Last section always flexes to fill remaining space
  if (props.isLastSection) {
    return { flex: '1 1 auto', minHeight: '80px' }
  }
  // Other sections: apply stored height, don't grow or shrink
  // Using flex: 0 0 auto prevents other sections from "bumping" during resize
  if (props.section.height) {
    return {
      height: `${props.section.height}px`,
      flex: '0 0 auto'  // don't grow, don't shrink
    }
  }
  return {}
})

// Resize handling
function onResizeStart(event: MouseEvent | TouchEvent) {
  // First section header is not resizable (no section above to resize)
  if (props.isFirstSection) return

  const sectionEl = (event.currentTarget as HTMLElement).closest('.efs-section')
  if (!sectionEl) return

  const bayEl = sectionEl.closest('.efs-bay')
  if (!bayEl) return

  // Find the section above this one
  const allSections = Array.from(bayEl.querySelectorAll('.efs-section'))
  const currentIndex = allSections.indexOf(sectionEl)
  if (currentIndex <= 0) return // No section above

  const sectionAbove = allSections[currentIndex - 1]
  const sectionAboveId = sectionAbove?.getAttribute('data-section-id')
  if (!sectionAbove || !sectionAboveId) return

  // Only fix height on the section above (the one we're resizing)
  // Don't touch other sections to avoid unintended layout shifts
  const aboveHeight = sectionAbove.getBoundingClientRect().height
  store.setSectionHeight(props.bayId, sectionAboveId, aboveHeight)

  // For the current section, only fix height if it's NOT the last section
  // Last section always flexes to fill remaining space
  const belowHeight = sectionEl.getBoundingClientRect().height
  if (!props.isLastSection) {
    store.setSectionHeight(props.bayId, props.section.id, belowHeight)
  }

  // Start resize: section above grows/shrinks, current section does the inverse
  startResize(event, props.bayId, sectionAboveId, aboveHeight, props.section.id, belowHeight, props.isLastSection)
}

// Gap click handler - remove the gap
function onGapClick(index: number) {
  store.removeGapAtIndex(props.bayId, props.section.id, index)
}

// Approximate half-height of a flight strip (for estimating "strip top" from cursor Y)
const HALF_STRIP_HEIGHT = 22

// Compute position + gap info for a new strip drop in the top zone
function computeTopZoneCreateDrop(event: DragEvent): { position: number; gapIndex?: number; gapSize: number } {
  const container = topContainer.value
  if (!container) return { position: 0, gapSize: 0 }

  const allStripElements = Array.from(container.querySelectorAll('.flight-strip'))
  const draggedStripTop = event.clientY - HALF_STRIP_HEIGHT

  let position = allStripElements.length
  let droppedBelowLastStrip = false
  let distanceBelowLastStrip = 0
  let droppedIntoEmptySection = false
  let distanceFromTop = 0

  if (allStripElements.length > 0) {
    const lastStrip = allStripElements[allStripElements.length - 1]
    if (lastStrip) {
      const lastRect = lastStrip.getBoundingClientRect()
      if (draggedStripTop > lastRect.bottom) {
        droppedBelowLastStrip = true
        distanceBelowLastStrip = draggedStripTop - lastRect.bottom
      }
    }
  } else {
    const containerRect = container.getBoundingClientRect()
    distanceFromTop = draggedStripTop - containerRect.top
    if (distanceFromTop >= store.GAP_BUFFER) {
      droppedIntoEmptySection = true
    }
  }

  for (let i = 0; i < allStripElements.length; i++) {
    const element = allStripElements[i]
    if (!element) continue
    const rect = element.getBoundingClientRect()
    const midpoint = rect.top + rect.height / 2
    if (event.clientY < midpoint) {
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

  return { position, gapIndex, gapSize }
}

// Compute position for a new strip drop in the bottom strips zone
function computeBottomStripsDrop(event: DragEvent): number {
  const bottomContainer = (event.currentTarget as HTMLElement)
  const stripElements = Array.from(bottomContainer.querySelectorAll('.flight-strip'))
  let position = stripElements.length

  for (let i = 0; i < stripElements.length; i++) {
    const element = stripElements[i]
    if (!element) continue
    const rect = element.getBoundingClientRect()
    const midpoint = rect.top + rect.height / 2
    if (event.clientY < midpoint) {
      position = i
      break
    }
  }

  return position
}

// Apply a pending create (note or dialog) with position + gap
function applyCreate(
  type: SpecialStripType,
  callsign?: string,
  aircraftType?: string,
  airport?: string,
  position?: number,
  isBottom?: boolean,
  gapIndex?: number,
  gapSize?: number
) {
  store.createStrip(type, callsign, aircraftType, airport, props.bayId, props.section.id, position, isBottom)
  if (gapIndex !== undefined && gapSize && gapSize >= store.GAP_BUFFER) {
    store.setGapAtIndex(props.bayId, props.section.id, gapIndex, gapSize)
  }
}

// Handle create from StripCreationDialog
function onDialogCreate(data: { callsign: string; aircraftType?: string; airport?: string }) {
  applyCreate(
    createDialogType.value,
    data.callsign,
    data.aircraftType,
    data.airport,
    pendingCreatePosition.value,
    pendingCreateIsBottom.value,
    pendingCreateGapIndex.value,
    pendingCreateGapSize.value
  )
}

// Open the dialog with pending position/gap info
function openCreateDialog(type: SpecialStripType, position?: number, isBottom = false, gapIndex?: number, gapSize = 0) {
  createDialogType.value = type
  createDialogAirport.value = bayAirport.value
  pendingCreatePosition.value = position
  pendingCreateIsBottom.value = isBottom
  pendingCreateGapIndex.value = gapIndex
  pendingCreateGapSize.value = gapSize

  // Note dialog only asks for airport (RTC). Otherwise create immediately.
  if (type === 'note' && !store.multiAirport) {
    applyCreate('note', undefined, undefined, bayAirport.value, position, isBottom, gapIndex, gapSize)
    return
  }

  createDialogOpen.value = true
}

// Top strips drag handling
function onTopDragOver(event: DragEvent) {
  event.preventDefault()
  if (event.dataTransfer) {
    // Set appropriate dropEffect based on drag source
    const isCreateDrag = event.dataTransfer.types.includes('application/efs-create')
    event.dataTransfer.dropEffect = isCreateDrag ? 'copy' : 'move'
  }
}

function onTopDragEnter() {
  isDragOver.value = true
}

function onTopDragLeave(event: DragEvent) {
  const target = event.currentTarget as HTMLElement
  const relatedTarget = event.relatedTarget as HTMLElement
  if (!target.contains(relatedTarget)) {
    isDragOver.value = false
  }
}

function onTopDrop(event: DragEvent) {
  event.preventDefault()
  isDragOver.value = false

  if (!event.dataTransfer) return

  // Handle create-strip drops from bottom bar
  const createType = event.dataTransfer.getData('application/efs-create')
  if (createType) {
    const type = createType as SpecialStripType
    const { position, gapIndex, gapSize } = computeTopZoneCreateDrop(event)
    openCreateDialog(type, position, false, gapIndex, gapSize)
    return
  }

  try {
    const data = JSON.parse(event.dataTransfer.getData('application/json'))
    const { stripId, bayId: sourceBayId, sectionId: sourceSectionId, isBottom: sourceIsBottom, originalTop, originalBottom, stripHeight, dragOffsetY } = data

    const container = topContainer.value
    if (!container) return

    // Only consider "same section" if strip is in top zone of same section
    // Strips from bottom zone don't leave a space in top zone, so treat as cross-section move
    const isSameSection = sourceBayId === props.bayId && sourceSectionId === props.section.id && !sourceIsBottom
    const allStripElements = Array.from(container.querySelectorAll('.flight-strip'))
    const allGapElements = Array.from(container.querySelectorAll('.strip-gap'))

    // Calculate where the strip's top would be based on cursor and drag offset
    const draggedStripTop = event.clientY - (dragOffsetY || 0)
    const draggedStripHeight = stripHeight || 50 // Use from drag data, fallback to 50

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
      if (event.clientY >= rect.top && event.clientY <= rect.bottom) {
        droppedOnGap = true
        gapIndex = parseInt(gapEl.getAttribute('data-gap-index') || '-1')
        gapRect = rect
        dropOnTopHalf = event.clientY < rect.top + rect.height / 2
        break
      }
    }

    // Handle drop on gap
    if (droppedOnGap && gapIndex !== -1 && gapRect) {
      const currentGapSize = sectionGaps.value[gapIndex] || 0

      // Check if the dragged strip was adjacent to this gap
      // Gap at index N: strip at N-1 is above, strip at N is below
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
      store.removeGapAtIndex(props.bayId, props.section.id, gapIndex)

      // Determine insert position based on which half of the gap was hit
      // Gap at index N means it's before the strip at position N
      let insertPosition: number

      if (dropOnTopHalf) {
        // Strip goes above the gap (at position gapIndex, pushing others down)
        if (isSameSection && draggedIndex < gapIndex) {
          // Dragged strip was above the gap, after removal it shifts indices
          insertPosition = gapIndex - 1
        } else {
          insertPosition = gapIndex
        }
      } else {
        // Strip goes below the gap (at position gapIndex, but gap stays before it)
        if (isSameSection && draggedIndex < gapIndex) {
          insertPosition = gapIndex - 1
        } else {
          insertPosition = gapIndex
        }
      }

      store.syncTimeSortSectionFromDom(props.bayId, props.section.id, topContainer.value)
      store.moveStripToSection(stripId, props.bayId, props.section.id, insertPosition)

      // Re-add the gap at the correct position with the new size
      if (newGapSize >= store.GAP_BUFFER) {
        if (dropOnTopHalf) {
          // Gap goes after the inserted strip (before the strip that was originally below the gap)
          store.setGapAtIndex(props.bayId, props.section.id, insertPosition + 1, newGapSize)
        } else {
          // Gap stays before the inserted strip
          store.setGapAtIndex(props.bayId, props.section.id, insertPosition, newGapSize)
        }
      }

      return
    }

    // Calculate position, skipping the dragged strip for same-section moves
    const stripElements = isSameSection
      ? allStripElements.filter(el => el.getAttribute('data-strip-id') !== stripId)
      : allStripElements

    // Find drop position and check if dropping below last strip (or into empty section)
    let position = stripElements.length
    let droppedBelowLastStrip = false
    let distanceBelowLastStrip = 0
    let droppedIntoEmptySection = false
    let distanceFromTop = 0

    if (stripElements.length > 0) {
      const lastStrip = stripElements[stripElements.length - 1]
      if (lastStrip) {
        const lastRect = lastStrip.getBoundingClientRect()
        // Use the dragged strip's top position (not cursor) to calculate gap
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

    // Find position based on midpoints
    for (let i = 0; i < stripElements.length; i++) {
      const element = stripElements[i]
      if (!element) continue

      const rect = element.getBoundingClientRect()
      const midpoint = rect.top + rect.height / 2

      if (event.clientY < midpoint) {
        position = i
        droppedBelowLastStrip = false
        break
      }
    }

    // Handle same-section gap adjustments
    if (isSameSection && draggedIndex !== -1) {
      const currentGap = store.getGapAtIndex(props.bayId, props.section.id, draggedIndex)

      // Check if position is effectively unchanged (dropped at same index)
      if (position === draggedIndex || (position === draggedIndex + 1 && draggedIndex === stripElements.length)) {
        // Same position - handle gap adjustment
        if (originalTop !== undefined && originalBottom !== undefined) {
          // Use strip top position for gap calculation
          const stripTopY = draggedStripTop

          // Get the position of the strip above (not the dragged strip's placeholder)
          // This is where the gap should be measured from
          const prevStripEl = draggedIndex > 0 ? allStripElements[draggedIndex - 1] : null
          const measureFromY = prevStripEl
            ? prevStripEl.getBoundingClientRect().bottom
            : container.getBoundingClientRect().top

          // Dragging down = increase gap
          // Check distance from strip above (not from self placeholder)
          if (stripTopY > measureFromY + store.GAP_BUFFER && draggedIndex == stripElements.length) {
            // Gap = distance from strip above + strip height (accounts for placeholder)
            const newGap = (stripTopY - measureFromY)// + draggedStripHeight
            store.setGapAtIndex(props.bayId, props.section.id, draggedIndex, newGap)
            return
          }

          // Dragging up (strip top above original top) = decrease gap
          if (stripTopY < originalTop && currentGap > 0) {
            const delta = originalTop - stripTopY
            store.setGapAtIndex(props.bayId, props.section.id, draggedIndex, Math.max(0, currentGap - delta))
            return
          }
        }

        // Dropped within original bounds - no change
        return
      }
    }

    store.syncTimeSortSectionFromDom(props.bayId, props.section.id, topContainer.value)
    store.moveStripToSection(stripId, props.bayId, props.section.id, position)

    // Create gap if dropped below last strip with enough distance
    if (droppedBelowLastStrip && distanceBelowLastStrip >= store.GAP_BUFFER) {
      // The strip is now at the last position, create gap before it
      // For same-section moves, add strip height to account for the space freed up
      // when the strip moves from its original position
      const gapSize = isSameSection
        ? distanceBelowLastStrip + draggedStripHeight
        : distanceBelowLastStrip
      store.setGapAtIndex(props.bayId, props.section.id, position, gapSize)
    }

    // Create gap if dropped into empty section below the buffer distance
    if (droppedIntoEmptySection) {
      // Strip is at position 0, create gap before it
      store.setGapAtIndex(props.bayId, props.section.id, 0, distanceFromTop)
    }
  } catch (error) {
    console.error('Error handling drop:', error)
  }
}

// Bottom drop zone handling
function onBottomDragOver(event: DragEvent) {
  event.preventDefault()
  if (event.dataTransfer) {
    const isCreateDrag = event.dataTransfer.types.includes('application/efs-create')
    event.dataTransfer.dropEffect = isCreateDrag ? 'copy' : 'move'
  }
}

function onBottomDragEnter() {
  isBottomDragOver.value = true
}

function onBottomDragLeave(event: DragEvent) {
  const target = event.currentTarget as HTMLElement
  const relatedTarget = event.relatedTarget as HTMLElement
  if (!target.contains(relatedTarget)) {
    isBottomDragOver.value = false
  }
}

function onBottomDrop(event: DragEvent) {
  event.preventDefault()
  isBottomDragOver.value = false

  if (!event.dataTransfer) return

  // Handle create-strip drops from bottom bar
  const createType = event.dataTransfer.getData('application/efs-create')
  if (createType) {
    const type = createType as SpecialStripType
    openCreateDialog(type, 0, true)
    return
  }

  try {
    const data = JSON.parse(event.dataTransfer.getData('application/json'))
    const { stripId } = data

    // Move to bottom strips at the beginning
    store.moveStripToBottom(stripId, props.bayId, props.section.id, 0)
  } catch (error) {
    console.error('Error handling bottom drop:', error)
  }
}

// Bottom strips container drop handling
function onBottomStripsDragOver(event: DragEvent) {
  event.preventDefault()
  if (event.dataTransfer) {
    const isCreateDrag = event.dataTransfer.types.includes('application/efs-create')
    event.dataTransfer.dropEffect = isCreateDrag ? 'copy' : 'move'
  }
}

function onBottomStripsDrop(event: DragEvent) {
  event.preventDefault()

  if (!event.dataTransfer) return

  // Handle create-strip drops from bottom bar
  const createType = event.dataTransfer.getData('application/efs-create')
  if (createType) {
    const type = createType as SpecialStripType
    const position = computeBottomStripsDrop(event)
    openCreateDialog(type, position, true)
    return
  }

  try {
    const data = JSON.parse(event.dataTransfer.getData('application/json'))
    const { stripId } = data

    // Find position within bottom strips
    const position = computeBottomStripsDrop(event)

    store.moveStripToBottom(stripId, props.bayId, props.section.id, position)
  } catch (error) {
    console.error('Error handling bottom strips drop:', error)
  }
}
</script>

<style scoped>
.efs-section {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 80px;
  border-bottom: 1px solid #2b2d31;
  border-right: 1px solid #2b2d31;
  border-left: 1px solid #2b2d31;
}

.efs-section:last-child {
  border-bottom: none;
}

.section-header {
  background: #1a1d20;
  padding: 4px 8px;
  border-bottom: 1px solid #3a3e42;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  cursor: ns-resize;
  user-select: none;
}

.section-header.no-resize {
  cursor: default;
}

.section-title {
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 1.5px;
  color: #8a9199;
  text-transform: uppercase;
  font-family: 'Segoe UI', 'Arial', sans-serif;
}

.section-header-right {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}

.section-sort-controls {
  display: flex;
  align-items: center;
  gap: 2px;
}

.section-sort-btn {
  font-size: 0.6rem;
  font-weight: 700;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  color: #c5ccd3;
  background: #2a2e33;
  border: 1px solid #4a5058;
  border-radius: 2px;
  padding: 1px 6px;
  cursor: pointer;
  line-height: 1.3;
  font-family: 'Segoe UI', 'Arial', sans-serif;
}

.section-sort-dir-btn {
  min-width: 1.4rem;
  padding-left: 4px;
  padding-right: 4px;
  font-size: 0.65rem;
}

.section-sort-btn:hover:not(:disabled) {
  background: #3a4048;
  color: #fff;
}

.section-sort-btn:disabled {
  cursor: default;
  opacity: 0.85;
}

.resize-handle {
  width: 20px;
  height: 4px;
  background: linear-gradient(
    to bottom,
    transparent 0px,
    #3a3e42 0px,
    #3a3e42 1px,
    transparent 1px,
    transparent 3px,
    #3a3e42 3px,
    #3a3e42 4px
  );
  opacity: 0.6;
}

.section-header:hover .resize-handle {
  opacity: 1;
}

.section-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: #12151a;
  transition: background 0.2s ease;
}

.section-content.drag-over {
  background: rgba(0, 150, 180, 0.1);
}

/* Top strips container - scrollable */
.top-strips-container {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 2px 0;
  min-height: 0;

  /* Firefox scrollbar styling */
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
}

/* Webkit (Chrome, Safari, Edge) scrollbar styling - overlay style */
.top-strips-container::-webkit-scrollbar {
  width: 6px;
  background: transparent;
}

.top-strips-container::-webkit-scrollbar-track {
  background: transparent;
}

.top-strips-container::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.15);
  border-radius: 3px;
}

.top-strips-container::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.3);
}

/* Bottom drop zone */
.bottom-drop-zone {
  height: 25px;
  flex-shrink: 0;
  transition: background 0.2s ease, border-top 0.2s ease;
  border-top: 1px dashed transparent;
  background: transparent;
}

.bottom-drop-zone.has-bottom {
  border-top: 1px dashed #2a2e32;
}

.bottom-drop-zone.drop-active {
  background: rgba(0, 150, 180, 0.3);
  border-top: 1px dashed rgba(0, 150, 180, 0.6);
}

/* Bottom strips container - pinned */
.bottom-strips-container {
  flex-shrink: 0;
  padding: 2px 0;
  background: rgba(0, 100, 130, 0.1);
  border-top: 1px solid rgba(0, 150, 180, 0.3);
}

.empty-section {
  text-align: center;
  padding: 15px;
  color: #3a3e42;
  font-size: 0.75rem;
  font-style: normal;
  text-transform: uppercase;
  letter-spacing: 1px;
}

/* Strip gap - clickable area between strips */
.strip-gap {
  margin: 0 4px;
  background: rgba(100, 150, 180, 0.15);
  border: 1px rgba(100, 150, 180, 0.4);
  border-radius: 2px;
  cursor: pointer;
  transition: all 0.15s ease;
  min-height: 10px;
}

.strip-gap:hover {
  background: rgba(100, 150, 180, 0.25);
  border: 1px dashed rgba(100, 150, 180, 0.6);
}
</style>

<style>
/* Global styles for resize state */
body.section-resizing {
  cursor: ns-resize !important;
  user-select: none !important;
}

body.section-resizing * {
  cursor: ns-resize !important;
}
</style>

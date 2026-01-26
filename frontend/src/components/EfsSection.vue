<template>
  <div
    class="efs-section"
    :data-section-id="section.id"
    :style="sectionStyle"
  >
    <div
      class="section-header"
      @mousedown="onResizeStart"
      @touchstart="onResizeStart"
    >
      <span class="section-title">{{ section.title }}</span>
      <div class="resize-handle"></div>
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
          <!-- Gap before this strip (if any) -->
          <div
            v-if="section.gaps[index]"
            class="strip-gap"
            :data-gap-index="index"
            :style="{ height: section.gaps[index] + 'px' }"
            @click="onGapClick(index)"
          ></div>
          <FlightStrip
            :strip="strip"
            :section-id="section.id"
            :bay-id="bayId"
            :is-bottom="false"
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
          :is-bottom="true"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { Section } from '@/types/efs'
import { useEfsStore } from '@/store/efs'
import { useSectionResize } from '@/composables/useSectionResize'
import FlightStrip from './FlightStrip.vue'

const props = defineProps<{
  section: Section
  bayId: string
}>()

const store = useEfsStore()
const { startResize } = useSectionResize()

const isDragOver = ref(false)
const isBottomDragOver = ref(false)
const topContainer = ref<HTMLElement | null>(null)

const topStrips = computed(() => store.getTopStrips(props.bayId, props.section.id))
const bottomStrips = computed(() => store.getBottomStrips(props.bayId, props.section.id))

const sectionStyle = computed(() => {
  if (props.section.height) {
    return { height: `${props.section.height}px`, flex: 'none' }
  }
  return {}
})

// Resize handling
function onResizeStart(event: MouseEvent | TouchEvent) {
  const sectionEl = (event.currentTarget as HTMLElement).closest('.efs-section')
  if (!sectionEl) return
  const currentHeight = sectionEl.getBoundingClientRect().height
  startResize(event, props.bayId, props.section.id, currentHeight)
}

// Gap click handler - remove the gap
function onGapClick(index: number) {
  store.removeGapAtIndex(props.bayId, props.section.id, index)
}

// Top strips drag handling
function onTopDragOver(event: DragEvent) {
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move'
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

  try {
    const data = JSON.parse(event.dataTransfer.getData('application/json'))
    const { stripId, bayId: sourceBayId, sectionId: sourceSectionId, originalTop, originalBottom, stripHeight, dragOffsetY } = data

    const container = topContainer.value
    if (!container) return

    const isSameSection = sourceBayId === props.bayId && sourceSectionId === props.section.id
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
      const currentGapSize = props.section.gaps[gapIndex] || 0

      // Check if the dragged strip was adjacent to this gap
      // Gap at index N: strip at N-1 is above, strip at N is below
      const wasAboveGap = isSameSection && draggedIndex === gapIndex - 1
      const wasBelowGap = isSameSection && draggedIndex === gapIndex
      const wasAdjacent = wasAboveGap || wasBelowGap

      // Calculate new gap size (only reduce if not adjacent)
      const newGapSize = wasAdjacent ? currentGapSize : currentGapSize - draggedStripHeight

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

      // Move the strip
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

          // Dragging down (strip top below original bottom) = increase gap
          if (stripTopY > originalBottom + store.GAP_BUFFER) {
            const newGap = stripTopY - originalBottom
            store.setGapAtIndex(props.bayId, props.section.id, draggedIndex, currentGap + newGap)
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

    // Move the strip
    store.moveStripToSection(stripId, props.bayId, props.section.id, position)

    // Create gap if dropped below last strip with enough distance
    if (droppedBelowLastStrip && distanceBelowLastStrip >= store.GAP_BUFFER) {
      // The strip is now at the last position, create gap before it
      store.setGapAtIndex(props.bayId, props.section.id, position, distanceBelowLastStrip)
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
    event.dataTransfer.dropEffect = 'move'
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
    event.dataTransfer.dropEffect = 'move'
  }
}

function onBottomStripsDrop(event: DragEvent) {
  event.preventDefault()

  if (!event.dataTransfer) return

  try {
    const data = JSON.parse(event.dataTransfer.getData('application/json'))
    const { stripId } = data

    // Find position within bottom strips
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
  border-bottom: 1px solid #2a2e32;
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

.section-title {
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 1.5px;
  color: #8a9199;
  text-transform: uppercase;
  font-family: 'Segoe UI', 'Arial', sans-serif;
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
  overflow-y: scroll;
  overflow-x: hidden;
  padding: 2px 0;
  min-height: 0;
  scrollbar-gutter: stable;
}

/* Always-visible scrollbar styling */
.top-strips-container::-webkit-scrollbar {
  -webkit-appearance: none;
  width: 8px;
}

.top-strips-container::-webkit-scrollbar-track {
  background: #12151a;
}

.top-strips-container::-webkit-scrollbar-thumb {
  background: #3a3e42;
  border-radius: 4px;
  border: 1px solid #12151a;
}

.top-strips-container::-webkit-scrollbar-thumb:hover {
  background: #4a4e52;
}

/* Bottom drop zone */
.bottom-drop-zone {
  height: 25px;
  flex-shrink: 0;
  transition: all 0.2s ease;
  border-top: 1px dashed transparent;
}

.bottom-drop-zone.has-bottom {
  border-top: 1px dashed #2a2e32;
}

.bottom-drop-zone.drop-active {
  background: rgba(0, 150, 180, 0.3);
  border-top: 1px dashed rgba(0, 150, 180, 0.6);
  height: 16px;
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

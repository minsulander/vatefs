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
        @click="onContainerClick"
        @dragover.prevent="onTopDragOver"
        @dragenter="onTopDragEnter"
        @dragleave="onTopDragLeave"
        @drop="onTopDrop"
      >
        <FlightStrip
          v-for="strip in topStrips"
          :key="strip.id"
          :strip="strip"
          :section-id="section.id"
          :bay-id="bayId"
          :is-bottom="false"
        />
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

// Click handler to detect clicks in gap areas
function onContainerClick(event: MouseEvent) {
  const container = topContainer.value
  if (!container) return

  const clickY = event.clientY
  const strips = store.getTopStrips(props.bayId, props.section.id)
  const stripElements = Array.from(container.querySelectorAll('.flight-strip'))

  for (let i = 0; i < stripElements.length; i++) {
    const el = stripElements[i]
    if (!el) continue

    const strip = strips[i]
    if (!strip || !strip.gapBefore || strip.gapBefore <= 0) continue

    const rect = el.getBoundingClientRect()
    // The gap area is above the strip element (marginTop creates space above)
    // Gap area: from (rect.top - gapBefore) to rect.top
    const gapTop = rect.top - strip.gapBefore
    const gapBottom = rect.top

    if (clickY >= gapTop && clickY < gapBottom) {
      // Click was in the gap area - remove the gap
      store.setStripGap(strip.id, 0)
      event.stopPropagation()
      return
    }
  }
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
    const { stripId, bayId: sourceBayId, sectionId: sourceSectionId, originalTop, originalBottom } = data

    const container = topContainer.value
    if (!container) return

    const isSameSection = sourceBayId === props.bayId && sourceSectionId === props.section.id
    const allStripElements = Array.from(container.querySelectorAll('.flight-strip'))

    // Find the dragged strip's current index and element
    let draggedIndex = -1
    let draggedEl: Element | null = null
    for (let i = 0; i < allStripElements.length; i++) {
      const el = allStripElements[i]
      if (el && el.getAttribute('data-strip-id') === stripId) {
        draggedIndex = i
        draggedEl = el
        break
      }
    }

    // Calculate position, skipping the dragged strip for same-section moves
    const stripElements = isSameSection
      ? allStripElements.filter(el => el.getAttribute('data-strip-id') !== stripId)
      : allStripElements

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

    // For same-section: check if position is effectively unchanged
    if (isSameSection && draggedIndex !== -1) {
      // Account for the removed element: if position >= draggedIndex, the actual position is the same
      const effectivePosition = position >= draggedIndex ? position : position

      if (position === draggedIndex && draggedEl && originalTop !== undefined && originalBottom !== undefined) {
        // Same position - handle gap adjustment
        const dropY = event.clientY
        const strip = store.getTopStrips(props.bayId, props.section.id)[draggedIndex]
        if (!strip) return

        const currentGap = strip.gapBefore || 0

        // Dragging down (drop below original bottom) = increase gap
        if (dropY > originalBottom) {
          const delta = dropY - originalBottom
          store.setStripGap(stripId, currentGap + delta)
          return
        }

        // Dragging up (drop above original top) = decrease gap
        if (dropY < originalTop && currentGap > 0) {
          const delta = originalTop - dropY
          store.setStripGap(stripId, Math.max(0, currentGap - delta))
          return
        }

        // Dropped within original bounds - no change
        return
      }

      // Adjust position for the reorder (account for removed element)
      if (position > draggedIndex) {
        // Position doesn't need adjustment, but we're inserting after removal
      }
    }

    store.moveStripToSection(stripId, props.bayId, props.section.id, position)
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
  height: 10px;
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

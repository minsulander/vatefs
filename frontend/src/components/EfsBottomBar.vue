<template>
  <StripCreationDialog
    v-model="dialogOpen"
    :strip-type="dialogStripType"
    :initial-airport="dialogInitialAirport"
    @create="onDialogCreate"
  />
  <TrashDialog v-model="trashOpen" />

  <div class="efs-bottom-bar">
    <div class="bottom-left-cluster">
      <button
        type="button"
        class="bar-icon-btn trash-btn efs-trash-drop"
        :class="{ 'drag-over': trashDragOver }"
        title="Recover deleted strip · drop strip to delete"
        @click="onTrashClick"
        @dragover.prevent="onTrashDragOver"
        @dragenter.prevent="onTrashDragEnter"
        @dragleave="onTrashDragLeave"
        @drop.prevent="onTrashDrop"
      >
        <v-icon :size="barIconSize">mdi-trash-can-outline</v-icon>
      </button>

      <v-menu
        v-model="infoMenuOpen"
        location="top"
        :offset="8"
        :close-on-content-click="false"
      >
        <template #activator="{ props: menuProps }">
          <button
            type="button"
            class="bar-icon-btn info-strips-btn"
            :class="{ 'has-restore': hasDismissedAvailable }"
            title="Info strips"
            v-bind="menuProps"
          >
            <v-icon :size="barIconSize">mdi-information-outline</v-icon>
            <span v-if="hasDismissedAvailable" class="info-dot" aria-hidden="true" />
          </button>
        </template>

        <div class="info-strips-menu" @click.stop>
          <div class="info-strips-menu-header">Info strips</div>
          <div
            v-for="entry in infoEntries"
            :key="entry.id"
            class="info-strips-row"
            :class="{ unavailable: !entry.available }"
          >
            <div class="info-strips-row-main">
              <span class="info-strips-label">{{ entry.label }}</span>
              <span v-if="!entry.available" class="info-strips-status">Not available</span>
              <span v-else-if="entry.dismissed" class="info-strips-status hidden">Hidden</span>
              <span v-else class="info-strips-status shown">Shown</span>
            </div>
            <div v-if="entry.available" class="info-strips-row-actions">
              <button
                v-if="entry.dismissed"
                type="button"
                class="info-strips-action primary"
                @click="onShowInfoStrip(entry)"
              >
                Show
              </button>
              <button
                v-else-if="entry.hasCustomPlacement"
                type="button"
                class="info-strips-action"
                @click="onResetInfoPlacement(entry)"
              >
                Reset position
              </button>
              <span v-else class="info-strips-action-spacer" />
            </div>
          </div>
        </div>
      </v-menu>
    </div>

    <div class="tiny-strips">
      <template v-if="store.myAirports.length > 0">
        <div
          class="tiny-strip tiny-strip-dep"
          draggable="true"
          @dragstart="(e) => onTinyDragStart(e, 'vfrDep')"
          @dragend="onTinyDragEnd"
          @click="() => onTinyClick('vfrDep')"
          @touchstart="(e) => onTinyTouchStart(e, 'vfrDep')"
          @touchmove.prevent="onTinyTouchMove"
          @touchend="(e) => onTinyTouchEnd(e, 'vfrDep')"
          @touchcancel="onTinyTouchCancel"
        >
          <div class="tiny-body">
            <span class="tiny-label">VFR DEP</span>
          </div>
        </div>

        <div
          class="tiny-strip tiny-strip-arr"
          draggable="true"
          @dragstart="(e) => onTinyDragStart(e, 'vfrArr')"
          @dragend="onTinyDragEnd"
          @click="() => onTinyClick('vfrArr')"
          @touchstart="(e) => onTinyTouchStart(e, 'vfrArr')"
          @touchmove.prevent="onTinyTouchMove"
          @touchend="(e) => onTinyTouchEnd(e, 'vfrArr')"
          @touchcancel="onTinyTouchCancel"
        >
          <div class="tiny-body">
            <span class="tiny-label">VFR ARR</span>
          </div>
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
          <div class="tiny-body">
            <span class="tiny-label">VFR CRS</span>
          </div>
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
        <div class="tiny-body">
          <span class="tiny-label">NOTE</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useEfsStore } from '@/store/efs'
import { useEfsScaleValue } from '@/composables/useEfsUiScale'
import {
  useInfoStripMenu,
  type InfoStripMenuEntry,
} from '@/composables/useInfoStrips'
import StripCreationDialog from './StripCreationDialog.vue'
import TrashDialog from './TrashDialog.vue'

type SpecialStripType = 'vfrDep' | 'vfrArr' | 'cross' | 'note'

const store = useEfsStore()
const efsScale = useEfsScaleValue()
const barIconSize = computed(() => Math.max(22, Math.round(22 * efsScale.value)))

const {
  entries: infoEntries,
  hasDismissedAvailable,
  showEntry,
  resetPlacement,
} = useInfoStripMenu()

const trashOpen = ref(false)
const trashDragOver = ref(false)
const infoMenuOpen = ref(false)
const dialogOpen = ref(false)
/** Suppress click-open after a strip was dropped on the trash */
let suppressTrashClick = false

function onTrashClick() {
  if (suppressTrashClick) {
    suppressTrashClick = false
    return
  }
  trashOpen.value = true
}

function onShowInfoStrip(entry: InfoStripMenuEntry) {
  showEntry(entry)
  infoMenuOpen.value = false
}

function onResetInfoPlacement(entry: InfoStripMenuEntry) {
  resetPlacement(entry)
}

function onTrashDragOver(event: DragEvent) {
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  trashDragOver.value = true
}

function onTrashDragEnter() {
  trashDragOver.value = true
}

function onTrashDragLeave(event: DragEvent) {
  const related = event.relatedTarget as Node | null
  const btn = event.currentTarget as HTMLElement
  if (related && btn.contains(related)) return
  trashDragOver.value = false
}

function onTrashDrop(event: DragEvent) {
  trashDragOver.value = false
  suppressTrashClick = true
  const raw = event.dataTransfer?.getData('application/json')
  if (!raw) return
  try {
    const data = JSON.parse(raw) as { stripId?: string }
    if (data.stripId) store.deleteStrip(data.stripId)
  } catch {
    // ignore malformed drag payload
  }
}
const dialogStripType = ref<SpecialStripType>('vfrDep')
const dialogInitialAirport = ref<string | undefined>(undefined)
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

function airportForBay(bayId: string | undefined): string | undefined {
  if (!bayId) return undefined
  const bay = store.layout.bays.find(b => b.id === bayId)
  return bay?.airport ?? undefined
}

function openCreateDialog(type: SpecialStripType, target?: {
  bayId?: string
  sectionId?: string
  position?: number
  isBottom?: boolean
  gapIndex?: number
  gapSize?: number
}) {
  dialogStripType.value = type
  dialogTargetBayId.value = target?.bayId
  dialogTargetSectionId.value = target?.sectionId
  dialogTargetPosition.value = target?.position
  dialogTargetIsBottom.value = target?.isBottom ?? false
  dialogTargetGapIndex.value = target?.gapIndex
  dialogTargetGapSize.value = target?.gapSize ?? 0
  dialogInitialAirport.value = airportForBay(target?.bayId)

  // Note dialog only asks for airport (RTC). Otherwise create immediately.
  if (type === 'note' && !store.multiAirport) {
    store.createStrip(
      'note',
      undefined,
      undefined,
      dialogInitialAirport.value ?? store.myAirports[0],
      dialogTargetBayId.value,
      dialogTargetSectionId.value,
      dialogTargetPosition.value,
      dialogTargetIsBottom.value
    )
    if (
      dialogTargetGapIndex.value !== undefined &&
      dialogTargetGapSize.value >= store.GAP_BUFFER &&
      dialogTargetBayId.value && dialogTargetSectionId.value
    ) {
      store.setGapAtIndex(dialogTargetBayId.value, dialogTargetSectionId.value, dialogTargetGapIndex.value, dialogTargetGapSize.value)
    }
    return
  }

  dialogOpen.value = true
}

function onTinyClick(type: SpecialStripType) {
  openCreateDialog(type)
}

function onDialogCreate(data: { callsign: string; aircraftType?: string; airport?: string }) {
  store.createStrip(
    dialogStripType.value, data.callsign || undefined, data.aircraftType, data.airport,
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
        openCreateDialog(type, {
          bayId: target.bayId,
          sectionId: target.sectionId,
          position: target.position,
          isBottom: target.isBottom,
          gapIndex: target.gapIndex,
          gapSize: target.gapSize,
        })
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
  height: max(52px, calc(52px * var(--efs-scale, 1)));
  background: #2b2d31;
  display: flex;
  align-items: center;
  justify-content: center;
  border-top: 1px solid #3a3e42;
  flex-shrink: 0;
  padding: 0;
  position: relative;
}

.bottom-left-cluster {
  position: absolute;
  left: calc(10px * var(--efs-scale, 1));
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  gap: calc(6px * var(--efs-scale, 1));
}

.bar-icon-btn {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: max(32px, calc(32px * var(--efs-scale, 1)));
  height: max(32px, calc(32px * var(--efs-scale, 1)));
  padding: 0;
  border: 1px solid #4a4e54;
  background: #35373c;
  color: #9ca3af;
  cursor: pointer;
  border-radius: 2px;
}

.bar-icon-btn:hover {
  color: #e8e8e8;
  border-color: #6b7280;
  background: #3f4248;
}

.trash-btn.drag-over {
  color: #fecaca;
  border-color: #ef4444;
  background: #5c2a2a;
  box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.35);
}

.info-strips-btn.has-restore {
  color: #93c5fd;
  border-color: #5b7a9e;
}

.info-dot {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #60a5fa;
  box-shadow: 0 0 0 1px #35373c;
}

.tiny-strips {
  display: flex;
  gap: calc(14px * var(--efs-scale, 1));
  align-items: center;
}

/* Mini flight strips — thicker L/R frame, thinner T/B */
.tiny-strip {
  --tiny-type: #888;
  --tiny-side: calc(14px * var(--efs-scale, 1));
  --tiny-tb: calc(3px * var(--efs-scale, 1));
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  background: #ebebeb;
  border-style: solid;
  border-color: var(--tiny-type);
  border-width: var(--tiny-tb) var(--tiny-side);
  height: max(36px, calc(34px * var(--efs-scale, 1)));
  min-width: calc(148px * var(--efs-scale, 1));
  margin: 0;
  cursor: grab;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  font-family: system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  transition: box-shadow 0.12s ease, transform 0.12s ease;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
}

.tiny-strip-dep { --tiny-type: #3b7dd8; }
.tiny-strip-arr { --tiny-type: #daa520; }
.tiny-strip-cross { --tiny-type: #881fe0; }
.tiny-strip-note { --tiny-type: #888; }

.tiny-body {
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 calc(10px * var(--efs-scale, 1));
  min-height: 0;
}

.tiny-strip:hover {
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
  transform: translateY(-1px);
}

.tiny-strip:active {
  transform: translateY(0);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
}

.tiny-label {
  font-size: calc(17px * var(--efs-scale, 1));
  font-weight: 700;
  color: #222;
  letter-spacing: 0.3px;
  white-space: nowrap;
  line-height: 1;
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

/* Teleported v-menu content */
.info-strips-menu {
  min-width: 240px;
  background: #2b2d31;
  border: 1px solid #4a4e54;
  border-radius: 4px;
  padding: 6px 0;
  color: #d1d5db;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
}

.info-strips-menu-header {
  padding: 4px 12px 8px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #9ca3af;
}

.info-strips-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px;
}

.info-strips-row.unavailable {
  opacity: 0.45;
}

.info-strips-row-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.info-strips-label {
  font-size: 13px;
  font-weight: 600;
  color: #e5e7eb;
}

.info-strips-status {
  font-size: 11px;
  color: #9ca3af;
}

.info-strips-status.hidden {
  color: #fbbf24;
}

.info-strips-status.shown {
  color: #86efac;
}

.info-strips-row-actions {
  flex-shrink: 0;
}

.info-strips-action {
  border: 1px solid #4a4e54;
  background: #35373c;
  color: #d1d5db;
  font-size: 12px;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 2px;
  cursor: pointer;
}

.info-strips-action:hover {
  background: #3f4248;
  border-color: #6b7280;
  color: #fff;
}

.info-strips-action.primary {
  background: #1e3a5f;
  border-color: #3b82f6;
  color: #bfdbfe;
}

.info-strips-action.primary:hover {
  background: #254a75;
  color: #fff;
}

.info-strips-action-spacer {
  display: inline-block;
  min-width: 48px;
}
</style>

<template>
  <StripCreationDialog
    v-model="dialogOpen"
    :strip-type="dialogStripType"
    :initial-airport="dialogInitialAirport"
    @create="onDialogCreate"
  />
  <TrashDialog v-model="trashOpen" />
  <PrintDialog v-model="printOpen" />

  <div class="efs-bottom-bar">
    <div class="bottom-bar-side bottom-bar-left">
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
        :disabled="store.isPaperLook"
      >
        <template #activator="{ props: menuProps }">
          <button
            type="button"
            class="bar-icon-btn info-strips-btn"
            :class="{ 'has-restore': hasMenuRestoreHint && !store.isPaperLook }"
            :disabled="store.isPaperLook"
            :title="
              store.isPaperLook
                ? 'Info strips — use Print for blank / HINDER / etc. (ESGG)'
                : 'Info strips'
            "
            v-bind="store.isPaperLook ? undefined : menuProps"
          >
            <v-icon :size="barIconSize">mdi-information-outline</v-icon>
            <span v-if="hasMenuRestoreHint && !store.isPaperLook" class="info-dot" aria-hidden="true" />
          </button>
        </template>

        <div class="efs-popup-menu efs-popup-menu--wide" @click.stop>
          <div class="efs-popup-header">Info strips</div>
          <div class="efs-popup-list">
            <div
              v-for="entry in infoEntries"
              :key="entry.id"
              class="efs-popup-item efs-popup-item--stack efs-popup-item--start"
              :class="{ 'efs-popup-muted is-disabled': !entry.available }"
            >
              <span class="efs-popup-item-title">{{ entry.label }}</span>
              <span class="efs-popup-item-sub">
                <template v-if="!entry.available">{{ entry.unavailableReason || 'Not available' }}</template>
                <template v-else-if="entry.dismissed">Hidden</template>
                <template v-else>Shown</template>
              </span>
              <div v-if="entry.available" class="info-strips-row-actions">
                <button
                  v-if="entry.dismissed"
                  type="button"
                  class="efs-popup-chip active"
                  @click="onShowInfoStrip(entry)"
                >Show</button>
                <button
                  v-else-if="entry.hasCustomPlacement"
                  type="button"
                  class="efs-popup-chip"
                  @click="onResetInfoPlacement(entry)"
                >Reset</button>
              </div>
            </div>
          </div>

          <template v-if="showRwyFlagTable">
            <div class="efs-popup-section">RWY flags</div>
            <table class="efs-popup-table">
              <thead>
                <tr>
                  <th scope="col">RWY</th>
                  <th scope="col" title="Occupied by vehicle">OCC</th>
                  <th scope="col" title="Closed (AVSTÄNGD)">CLSD</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in rwyFlagRows" :key="row.sectionId">
                  <th scope="row">{{ row.label }}</th>
                  <td>
                    <button
                      type="button"
                      class="efs-popup-chip"
                      :class="{ active: row.occupied }"
                      :title="row.occupied ? 'Hide occupied flag' : 'Show occupied flag'"
                      @click="onToggleRwyFlag(row.sectionId, 'rwyOccupied')"
                    >{{ row.occupied ? 'ON' : 'OFF' }}</button>
                  </td>
                  <td>
                    <button
                      type="button"
                      class="efs-popup-chip"
                      :class="{ active: row.closed }"
                      :title="row.closed ? 'Hide closed flag' : 'Show closed flag'"
                      @click="onToggleRwyFlag(row.sectionId, 'rwyClosed')"
                    >{{ row.closed ? 'ON' : 'OFF' }}</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </template>
        </div>
      </v-menu>

      <div
        v-if="!store.isPaperLook"
        class="bay-bg-slider"
        title="Strip bay background · double-click to reset"
        @pointerdown.stop
        @dblclick="onBayBgReset"
      >
        <v-icon class="bay-bg-slider-icon bay-bg-slider-moon" :size="bayBgIconSize"
          >mdi-moon-waning-crescent</v-icon
        >
        <input
          class="bay-bg-slider-input"
          type="range"
          min="0"
          max="100"
          step="1"
          :value="bayBgBrightness"
          @input="onBayBgInput"
          @dblclick.stop="onBayBgReset"
        />
        <v-icon class="bay-bg-slider-icon bay-bg-slider-sun" :size="bayBgIconSize"
          >mdi-white-balance-sunny</v-icon
        >
      </div>
    </div>

    <div class="tiny-strips">
      <!-- Paper look: printer sits where ESSA strip-create buttons are (center) -->
      <button
        v-if="showPrintQueue"
        type="button"
        class="bar-icon-btn print-btn tiny-print-btn"
        :class="{ 'has-pending': pendingPrintCount > 0 }"
        title="Print strip"
        @click="printOpen = true"
      >
        <v-icon :size="barIconSize">mdi-printer</v-icon>
        <span v-if="pendingPrintCount > 0" class="print-badge">{{ pendingPrintCount }}</span>
      </button>

      <template v-if="!store.isPaperLook">
        <div
          class="tiny-strip tiny-strip-vehicle"
          draggable="true"
          @dragstart="(e) => onTinyDragStart(e, 'vehicle')"
          @dragend="onTinyDragEnd"
          @click="() => onTinyClick('vehicle')"
          @touchstart="(e) => onTinyTouchStart(e, 'vehicle')"
          @touchmove.prevent="onTinyTouchMove"
          @touchend="(e) => onTinyTouchEnd(e, 'vehicle')"
          @touchcancel="onTinyTouchCancel"
        >
          <div class="tiny-body">
            <span class="tiny-label">VEHICLE</span>
          </div>
        </div>

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
      </template>
    </div>

    <div class="bottom-bar-side bottom-bar-right">
      <Clock />
      <img
        class="vatsim-logo"
        src="@/assets/vatsim-scandinavia.png"
        alt="VATSIM Scandinavia"
        draggable="false"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useEfsStore } from '@/store/efs'
import { useEfsChromeScaleValue } from '@/composables/useEfsUiScale'
import {
  useInfoStripMenu,
  type InfoStripMenuEntry,
} from '@/composables/useInfoStrips'
import {
  useRwyFlagMenu,
  type RwyFlagKind,
} from '@/composables/useRunwayFlagStrips'
import {
  BAY_BG_BRIGHTNESS_DEFAULT,
  setBayBgBrightness,
  useBayBgBrightness,
} from '@/composables/useBayBackground'
import {
  clearTouchDropPlacementIndicators,
  setTouchDropPlacementFromPoint,
} from '@/composables/useTouchDrag'
import Clock from './Clock.vue'
import StripCreationDialog from './StripCreationDialog.vue'
import TrashDialog from './TrashDialog.vue'
import PrintDialog from './PrintDialog.vue'

type SpecialStripType = 'vfrDep' | 'vfrArr' | 'cross' | 'note' | 'vehicle'

const store = useEfsStore()
const chromeScale = useEfsChromeScaleValue()
const barIconSize = computed(() => Math.max(14, Math.round(18 * chromeScale.value)))
const bayBgIconSize = computed(() => Math.max(16, Math.round(22 * chromeScale.value)))
const bayBgBrightness = useBayBgBrightness()
const printOpen = ref(false)
const showPrintQueue = computed(() => store.isPaperLook)
const pendingPrintCount = computed(() =>
  store.stripPrintMode === 'manual' ? store.pendingPrintFlights.length : 0,
)

function onBayBgInput(event: Event) {
  const el = event.target as HTMLInputElement
  setBayBgBrightness(Number(el.value))
}

function onBayBgReset() {
  setBayBgBrightness(BAY_BG_BRIGHTNESS_DEFAULT)
}

const {
  entries: infoEntries,
  hasDismissedAvailable,
  showEntry,
  resetPlacement,
} = useInfoStripMenu()

const {
  showTable: showRwyFlagTable,
  rows: rwyFlagRows,
  hasInactive: hasInactiveRwyFlags,
  toggle: toggleRwyFlag,
} = useRwyFlagMenu()

const hasMenuRestoreHint = computed(
  () => hasDismissedAvailable.value || hasInactiveRwyFlags.value,
)

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

function onToggleRwyFlag(sectionId: string, kind: RwyFlagKind) {
  toggleRwyFlag(sectionId, kind)
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

/** First section in the visible client layout (ESSA-filtered). */
function firstVisiblePlacement(): { bayId: string; sectionId: string } | undefined {
  for (const bay of store.layout.bays) {
    const section = bay.sections[0]
    if (section) return { bayId: bay.id, sectionId: section.id }
  }
  return undefined
}

function openCreateDialog(type: SpecialStripType, target?: {
  bayId?: string
  sectionId?: string
  position?: number
  isBottom?: boolean
  gapIndex?: number
  gapSize?: number
}) {
  const fallback = firstVisiblePlacement()
  const bayId = target?.bayId ?? fallback?.bayId
  const sectionId = target?.sectionId ?? fallback?.sectionId

  dialogStripType.value = type
  dialogTargetBayId.value = bayId
  dialogTargetSectionId.value = sectionId
  dialogTargetPosition.value = target?.position
  dialogTargetIsBottom.value = target?.isBottom ?? false
  dialogTargetGapIndex.value = target?.gapIndex
  dialogTargetGapSize.value = target?.gapSize ?? 0
  dialogInitialAirport.value = airportForBay(bayId)

  // Vehicle: always create immediately into a visible section (no ES / no dialog).
  // Note: immediate unless multi-airport RTC needs an airport column choice.
  if (type === 'vehicle' || (type === 'note' && !store.multiAirport)) {
    store.createStrip(
      type,
      undefined,
      undefined,
      dialogInitialAirport.value ?? store.myAirports[0],
      bayId,
      sectionId,
      dialogTargetPosition.value,
      dialogTargetIsBottom.value
    )
    if (
      dialogTargetGapIndex.value !== undefined &&
      dialogTargetGapSize.value >= store.GAP_BUFFER &&
      bayId && sectionId
    ) {
      store.setGapAtIndex(bayId, sectionId, dialogTargetGapIndex.value, dialogTargetGapSize.value)
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

    // Insert line / bottom-slot (no full-bay highlight)
    setTouchDropPlacementFromPoint(touch.clientX, touch.clientY, touchClone)
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
  clearTouchDropPlacementIndicators()
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
  --bb: var(--efs-chrome-scale, var(--efs-scale, 1));
  --bar-h: var(--efs-bottom-bar-h, calc(40px * var(--bb)));
  height: var(--bar-h);
  min-height: var(--bar-h);
  max-height: var(--bar-h);
  background: #000000;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  column-gap: calc(6px * var(--bb));
  border-top: 1px solid #3a3e42;
  flex-shrink: 0;
  padding: 0 calc(6px * var(--bb));
  box-sizing: border-box;
  overflow: hidden;
}

.bottom-bar-side {
  display: flex;
  align-items: center;
  gap: calc(4px * var(--bb));
  min-width: 0;
  min-height: 0;
  height: 100%;
  max-height: 100%;
  overflow: hidden;
}

.bottom-bar-left {
  justify-content: flex-start;
}

.bottom-bar-right {
  justify-content: flex-end;
  gap: calc(10px * var(--bb));
  padding-right: calc(2px * var(--bb));
}

.vatsim-logo {
  display: block;
  height: 100%;
  max-height: 100%;
  width: auto;
  object-fit: contain;
  object-position: right center;
  flex-shrink: 0;
  align-self: stretch;
  min-width: 0;
  min-height: 0;
  user-select: none;
  -webkit-user-drag: none;
}

.bar-icon-btn {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: calc(28px * var(--bb));
  height: calc(28px * var(--bb));
  padding: 0;
  border: 1px solid #4a4e54;
  background: #35373c;
  color: #9ca3af;
  cursor: pointer;
  border-radius: 2px;
}

.bar-icon-btn:hover:not(:disabled) {
  color: #e8e8e8;
  border-color: #6b7280;
  background: #3f4248;
}

.bar-icon-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
  color: #6b7280;
}

.trash-btn.drag-over,
.trash-btn.trash-receiving {
  color: #fecaca;
  border-color: #ef4444;
  background: #5c2a2a;
  box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.35);
}

.trash-btn.trash-receiving {
  animation: trash-receive-pulse 0.45s ease-out;
}

@keyframes trash-receive-pulse {
  0% {
    transform: scale(1);
  }
  40% {
    transform: scale(1.12);
  }
  100% {
    transform: scale(1);
  }
}

.tiny-print-btn {
  width: calc(36px * var(--bb));
  height: calc(28px * var(--bb));
}

.print-btn.has-pending {
  color: #f6d365;
  border-color: #a8842a;
}

.print-badge {
  position: absolute;
  top: calc(-4px * var(--bb));
  right: calc(-6px * var(--bb));
  min-width: calc(14px * var(--bb));
  height: calc(14px * var(--bb));
  padding: 0 3px;
  border-radius: 7px;
  background: #c9a227;
  color: #1e2022;
  font-size: calc(9px * var(--bb));
  font-weight: 700;
  line-height: calc(14px * var(--bb));
  text-align: center;
  box-shadow: 0 0 0 1px #35373c;
}

.info-strips-btn.has-restore {
  color: #93c5fd;
  border-color: #5b7a9e;
}

.info-dot {
  position: absolute;
  top: calc(4px * var(--bb));
  right: calc(4px * var(--bb));
  width: calc(7px * var(--bb));
  height: calc(7px * var(--bb));
  border-radius: 50%;
  background: #60a5fa;
  box-shadow: 0 0 0 1px #35373c;
}

.bay-bg-slider {
  display: flex;
  align-items: center;
  flex: 1 1 auto;
  min-width: calc(140px * var(--bb));
  max-width: calc(280px * var(--bb));
  align-self: stretch;
  gap: calc(8px * var(--bb));
  height: 100%;
  padding: 0 calc(10px * var(--bb));
  border: none;
  border-radius: 0;
  background: linear-gradient(90deg, #000000 0%, #c8c8ce 100%);
  box-sizing: border-box;
}

.bay-bg-slider-icon {
  flex: 0 0 auto;
  opacity: 0.9;
}

.bay-bg-slider-moon {
  color: #d1d5db;
  transform: rotate(-25deg);
}

.bay-bg-slider-sun {
  color: #000;
}

.bay-bg-slider-input {
  -webkit-appearance: none;
  appearance: none;
  flex: 1 1 auto;
  width: 100%;
  min-width: calc(100px * var(--bb));
  height: calc(6px * var(--bb));
  margin: 0;
  border-radius: 3px;
  background: #3a3a40;
  outline: none;
  cursor: pointer;
}

.bay-bg-slider-input::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: calc(20px * var(--bb));
  height: calc(20px * var(--bb));
  border-radius: 50%;
  background: #b0b0b6;
  border: 1px solid #2a2a2e;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.45);
  cursor: pointer;
}

.bay-bg-slider-input::-moz-range-thumb {
  width: calc(20px * var(--bb));
  height: calc(20px * var(--bb));
  border-radius: 50%;
  background: #b0b0b6;
  border: 1px solid #2a2a2e;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.45);
  cursor: pointer;
}

.bay-bg-slider-input::-moz-range-track {
  height: calc(6px * var(--bb));
  border-radius: 3px;
  background: #3a3a40;
}

.tiny-strips {
  display: flex;
  gap: calc(5px * var(--bb));
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

/* Mini flight strips — compact so brightness slider keeps room */
.tiny-strip {
  --tiny-type: #888;
  --tiny-side: calc(8px * var(--bb));
  --tiny-tb: calc(2px * var(--bb));
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  background: #ebebeb;
  border-style: solid;
  border-color: var(--tiny-type);
  border-width: var(--tiny-tb) var(--tiny-side);
  height: calc(28px * var(--bb));
  min-width: calc(88px * var(--bb));
  margin: 0;
  cursor: grab;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  font-family: system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  transition: box-shadow 0.12s ease, transform 0.12s ease;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
}

.tiny-strip-dep { --tiny-type: #3a72d4; }
.tiny-strip-arr { --tiny-type: #daa520; }
.tiny-strip-cross { --tiny-type: #881fe0; }
.tiny-strip-note { --tiny-type: #888; }
.tiny-strip-vehicle { --tiny-type: #4a4a4a; }

.tiny-body {
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 calc(6px * var(--bb));
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
  font-size: calc(12px * var(--bb));
  font-weight: 700;
  color: #222;
  letter-spacing: 0.2px;
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

.info-strips-row-actions {
  margin-top: 2px;
  align-self: flex-start;
}
</style>

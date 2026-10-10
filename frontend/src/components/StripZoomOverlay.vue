<template>
  <Teleport to="body">
    <div
      v-if="modelValue"
      ref="overlayEl"
      class="strip-zoom-overlay"
      tabindex="-1"
      @pointerdown.self="close"
      @keydown.escape.prevent="onEscape"
    >
      <div
        class="strip-zoom-shell"
        :style="shellStyle"
        @pointerdown.stop
      >
        <div class="strip-zoom-row">
          <div ref="stageEl" class="strip-zoom-panel">
            <FlightStrip
              :strip="strip"
              :bay-id="bayId"
              :section-id="sectionId"
              is-large-view
              :active-scribble-stroke="activeStroke"
              @close-large-view="close"
            />

            <!-- Capture only: ink renders on FlightStrip band SVGs (seamless across expanders) -->
            <svg
              ref="drawEl"
              class="strip-zoom-draw"
              :class="{ 'pen-active': penActive }"
              @pointerdown="onDrawPointerDown"
              @pointermove="onDrawPointerMove"
              @pointerup="onDrawPointerUp"
              @pointercancel="onDrawPointerCancel"
            >
              <rect width="100%" height="100%" fill="transparent" />
            </svg>
          </div>

          <div class="strip-zoom-keys" :style="{ width: keyColWidth + 'px' }">
            <button
              v-if="scribbleMode === 'toggle' && !isNote"
              type="button"
              class="zoom-key"
              :class="{ active: penMode }"
              :title="penMode ? 'Pen on - tap to use strip controls' : 'Enable scribble'"
              @click="togglePen"
            >
              <v-icon :size="toolIconSize" class="zoom-key-icon">{{ penMode ? 'mdi-check' : 'mdi-pencil' }}</v-icon>
            </button>
            <button
              type="button"
              class="zoom-key"
              title="Undo last scribble"
              :disabled="!hasScribbles"
              @click="undoStroke"
            >
              <v-icon :size="toolIconSize" class="zoom-key-icon">mdi-undo</v-icon>
            </button>
            <button
              type="button"
              class="zoom-key"
              title="Clear all scribbles"
              :disabled="!hasScribbles"
              @click="clearStrokes"
            >
              <v-icon :size="toolIconSize" class="zoom-key-icon">mdi-eraser</v-icon>
            </button>
            <button
              type="button"
              class="zoom-key zoom-key-close"
              title="Close zoomed strip"
              @click="close"
            >
              <v-icon :size="toolIconSize" class="zoom-key-icon">mdi-close</v-icon>
            </button>
          </div>
        </div>

        <div class="strip-zoom-scale" @pointerdown.stop>
          <span class="zoom-scale-label">Size</span>
          <input
            class="zoom-scale-slider"
            type="range"
            :min="ZOOM_STRIP_SCALE_PERCENT_MIN"
            :max="ZOOM_STRIP_SCALE_PERCENT_MAX"
            :step="ZOOM_STRIP_SCALE_PERCENT_STEP"
            :value="sliderPercent"
            @input="onZoomScaleDrag"
            @change="onZoomScaleCommit"
          />
          <span class="zoom-scale-value">{{ sliderPercent }}%</span>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import type { FlightStrip as FlightStripData } from '@/types/efs'
import { useEfsScaleValue } from '@/composables/useEfsUiScale'
import { useStripScribbleMode } from '@/composables/useStripScribbleMode'
import { useStripExpanders } from '@/composables/useStripExpanders'
import {
  ZOOM_STRIP_SCALE_PERCENT_MAX,
  ZOOM_STRIP_SCALE_PERCENT_MIN,
  ZOOM_STRIP_SCALE_PERCENT_STEP,
  setZoomStripScalePercent,
  useZoomStripScalePercent,
} from '@/composables/useStripZoomScale'
import {
  type ScribbleBandScreen,
  clearStripScribbles,
  clientToScribble,
  measureScribbleBands,
  pushStripScribble,
  undoStripScribble,
  useStripScribbles,
} from '@/composables/useStripScribbles'
import FlightStrip from './FlightStrip.vue'

export interface StripZoomAnchor {
  left: number
  top: number
  width: number
  height: number
}

/** Design width at zoom-strip scale 100% */
const ZOOM_REF_WIDTH_PX = 780
const KEY_COL_REF_PX = 44
/** Tight bottom-right size bar — tracks Settings UI scale only, not zoomed-strip size */
const SCALE_BAR_REF_H = 22
const SCALE_BAR_REF_W = 350
const DRAW_MOVE_THRESHOLD_PX = 8

const props = defineProps<{
  modelValue: boolean
  strip: FlightStripData
  bayId: string
  sectionId: string
  anchorRect?: StripZoomAnchor | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const overlayEl = ref<HTMLElement | null>(null)
const stageEl = ref<HTMLElement | null>(null)
const drawEl = ref<SVGSVGElement | null>(null)

const efsScale = useEfsScaleValue()
const zoomScalePercent = useZoomStripScalePercent()
/** Draft while dragging — strip size applies only on release (`change`). */
const sliderPercent = ref(zoomScalePercent.value)
const scribbleMode = useStripScribbleMode()
const stripId = computed(() => props.strip.id)
/** Notes always draw in zoom (no pen toggle). Vehicles match aircraft (pen toggle). */
const isNote = computed(() => props.strip.stripType === 'note')
const { hasScribbles } = useStripScribbles(stripId)
const { topExpanded, bottomExpanded } = useStripExpanders(stripId)

const penMode = ref(false)
const activeStroke = ref<string | null>(null)
const drawing = ref(false)
const stageHeight = ref(0)
const bands = ref<ScribbleBandScreen[]>([])

let pointerPending = false
let pendingPointerId: number | null = null
let pendingStartX = 0
let pendingStartY = 0

let stageResizeObs: ResizeObserver | null = null

const zoomFactor = computed(() => zoomScalePercent.value / 100)

const panelWidth = computed(() => {
  const scaled = Math.round(ZOOM_REF_WIDTH_PX * zoomFactor.value)
  const max =
    typeof window !== 'undefined'
      ? Math.floor(window.innerWidth * 0.94 - keyColWidth.value)
      : scaled
  return Math.max(280, Math.min(scaled, max))
})

const keyColWidth = computed(() =>
  Math.max(44, Math.round(KEY_COL_REF_PX * zoomFactor.value)),
)

/** Compact bottom-right slider chrome — Settings UI scale only. */
const scaleBarHeight = computed(() =>
  Math.max(18, Math.round(SCALE_BAR_REF_H * efsScale.value)),
)
const scaleBarWidth = computed(() =>
  Math.max(120, Math.round(SCALE_BAR_REF_W * efsScale.value)),
)

const toolIconSize = computed(() => Math.max(18, Math.round(18 * zoomFactor.value)))

const penActive = computed(
  () => isNote.value || scribbleMode.value === 'always' || penMode.value,
)

const shellStyle = computed(() => {
  const pw = panelWidth.value
  const totalW = pw + keyColWidth.value
  const barH = scaleBarHeight.value
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280
  const anchor = props.anchorRect

  const stageH =
    stageHeight.value > 0
      ? stageHeight.value
      : anchor
        ? Math.max(72, anchor.height * (pw / Math.max(1, anchor.width)))
        : 120
  const estH = stageH + barH

  let left: number
  let top: number
  if (anchor) {
    const cx = anchor.left + anchor.width / 2
    const cy = anchor.top + anchor.height / 2
    left = cx - pw / 2
    top = cy - stageH / 2
  } else {
    left = (vw - totalW) / 2
    top = Math.max(16, (vh - estH) / 3)
  }

  left = Math.max(4, Math.min(left, vw - totalW - 4))
  top = Math.max(4, Math.min(top, vh - estH - 4))
  return {
    left: `${Math.round(left)}px`,
    top: `${Math.round(top)}px`,
    width: `${totalW}px`,
    '--zoom-panel-w': `${pw}px`,
    '--zoom-scale-bar-h': `${barH}px`,
    '--zoom-scale-bar-w': `${scaleBarWidth.value}px`,
  }
})

function onZoomScaleDrag(event: Event) {
  const el = event.target as HTMLInputElement
  sliderPercent.value = Number(el.value)
}

function onZoomScaleCommit(event: Event) {
  const el = event.target as HTMLInputElement
  const next = Number(el.value)
  sliderPercent.value = next
  setZoomStripScalePercent(next)
}

watch(zoomScalePercent, (v) => {
  sliderPercent.value = v
})

function measureStage() {
  const stage = stageEl.value
  if (!stage) {
    bands.value = []
    return
  }
  if (stage.clientHeight > 0) stageHeight.value = stage.clientHeight
  bands.value = measureScribbleBands(stage)
}

function togglePen() {
  penMode.value = !penMode.value
  if (!penMode.value) resetDrawPointerState()
}

function resetDrawPointerState() {
  drawing.value = false
  activeStroke.value = null
  pointerPending = false
  pendingPointerId = null
}

function clickThroughToStrip(clientX: number, clientY: number) {
  const svg = drawEl.value
  if (!svg) return
  svg.style.pointerEvents = 'none'
  const el = document.elementFromPoint(clientX, clientY) as HTMLElement | null
  window.setTimeout(() => svg.style.removeProperty('pointer-events'), 450)
  if (!el) return
  const target =
    (el.closest(
      'button, a, input, select, textarea, [role="button"], .action-button, .callsign-box, .cell, .vehicle-cell, .exp-chip, .ctrl-arrow, .exp-assr, .exp-rmk, .strip-time',
    ) as HTMLElement | null) ?? el
  target.focus?.({ preventScroll: true })
  target.dispatchEvent(
    new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX,
      clientY,
      screenX: clientX,
      screenY: clientY,
      button: 0,
    }),
  )
  nextTick(() => {
    requestAnimationFrame(measureStage)
  })
}

function undoStroke() {
  undoStripScribble(props.strip.id)
}

function clearStrokes() {
  activeStroke.value = null
  clearStripScribbles(props.strip.id)
}

function close() {
  penMode.value = false
  resetDrawPointerState()
  emit('update:modelValue', false)
}

function onEscape() {
  if (scribbleMode.value === 'toggle' && penMode.value) {
    penMode.value = false
    resetDrawPointerState()
    return
  }
  close()
}

function toScribble(clientX: number, clientY: number, remountBands = false) {
  // Freeze band rects while drawing — remounting every move shakes ink at 200% zoom
  if (remountBands && stageEl.value) bands.value = measureScribbleBands(stageEl.value)
  return clientToScribble(clientX, clientY, bands.value)
}

function beginStrokeAt(clientX: number, clientY: number, pointerId: number) {
  const pt = toScribble(clientX, clientY, true)
  if (!pt) return
  drawing.value = true
  pointerPending = false
  activeStroke.value = `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`
  try {
    drawEl.value?.setPointerCapture(pointerId)
  } catch {
    /* ignore */
  }
}

function onDrawPointerDown(event: PointerEvent) {
  if (!penActive.value || event.button !== 0) return
  pointerPending = true
  pendingPointerId = event.pointerId
  pendingStartX = event.clientX
  pendingStartY = event.clientY
  drawing.value = false
  activeStroke.value = null
  try {
    drawEl.value?.setPointerCapture(event.pointerId)
  } catch {
    /* ignore */
  }
}

function onDrawPointerMove(event: PointerEvent) {
  if (!penActive.value) return
  if (pointerPending && !drawing.value && event.pointerId === pendingPointerId) {
    const dx = event.clientX - pendingStartX
    const dy = event.clientY - pendingStartY
    if (dx * dx + dy * dy >= DRAW_MOVE_THRESHOLD_PX * DRAW_MOVE_THRESHOLD_PX) {
      event.preventDefault()
      beginStrokeAt(pendingStartX, pendingStartY, event.pointerId)
      const pt = toScribble(event.clientX, event.clientY)
      if (pt && activeStroke.value) {
        activeStroke.value += ` ${pt.x.toFixed(1)},${pt.y.toFixed(1)}`
      }
    }
    return
  }
  if (!drawing.value || !activeStroke.value) return
  event.preventDefault()
  const pt = toScribble(event.clientX, event.clientY)
  if (!pt) return
  activeStroke.value += ` ${pt.x.toFixed(1)},${pt.y.toFixed(1)}`
}

function onDrawPointerUp(event: PointerEvent) {
  if (pendingPointerId != null && event.pointerId !== pendingPointerId && !drawing.value) {
    return
  }
  try {
    drawEl.value?.releasePointerCapture(event.pointerId)
  } catch {
    /* already released */
  }

  if (drawing.value) {
    if (activeStroke.value && activeStroke.value.includes(' ')) {
      pushStripScribble(props.strip.id, activeStroke.value)
    }
    resetDrawPointerState()
    return
  }

  if (pointerPending) {
    const x = event.clientX
    const y = event.clientY
    resetDrawPointerState()
    clickThroughToStrip(x, y)
    return
  }

  resetDrawPointerState()
}

function onDrawPointerCancel(event: PointerEvent) {
  try {
    drawEl.value?.releasePointerCapture(event.pointerId)
  } catch {
    /* ignore */
  }
  resetDrawPointerState()
}

async function afterOpenMeasure() {
  await nextTick()
  overlayEl.value?.focus()
  measureStage()
  requestAnimationFrame(() => {
    measureStage()
    requestAnimationFrame(measureStage)
  })
  if (stageEl.value && typeof ResizeObserver !== 'undefined') {
    stageResizeObs?.disconnect()
    stageResizeObs = new ResizeObserver(() => {
      // Remeasuring mid-stroke causes scribble shake at high zoom
      if (drawing.value || pointerPending) return
      measureStage()
    })
    stageResizeObs.observe(stageEl.value)
  }
}

watch(
  () => props.modelValue,
  async (open) => {
    if (!open) {
      stageResizeObs?.disconnect()
      stageResizeObs = null
      bands.value = []
      return
    }
    penMode.value = false
    resetDrawPointerState()
    await afterOpenMeasure()
  },
)

watch([topExpanded, bottomExpanded], async () => {
  if (!props.modelValue) return
  await nextTick()
  measureStage()
})

watch(zoomScalePercent, async () => {
  if (!props.modelValue) return
  await nextTick()
  measureStage()
})

watch(scribbleMode, (mode) => {
  if (mode === 'always') penMode.value = false
})

onUnmounted(() => {
  stageResizeObs?.disconnect()
  stageResizeObs = null
})
</script>

<style scoped>
.strip-zoom-overlay {
  position: fixed;
  inset: 0;
  z-index: 2400;
  background: transparent;
  outline: none;
}

.strip-zoom-shell {
  position: absolute;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0;
  /* No shell shadow — empty space left of the short Size bar would ghost it */
  box-shadow: none;
  background: transparent;
  pointer-events: none;
}

.strip-zoom-row {
  display: grid;
  grid-template-columns: var(--zoom-panel-w, 560px) auto;
  grid-template-rows: auto;
  gap: 0;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45);
  pointer-events: auto;
}

.strip-zoom-panel {
  position: relative;
  grid-column: 1;
  grid-row: 1;
  width: 100%;
  border: 1px solid #888;
  border-right: none;
  background: #12151a;
  touch-action: none;
}

.strip-zoom-scale {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  align-self: flex-end;
  gap: calc(6px * var(--efs-scale, 1));
  width: var(--zoom-scale-bar-w, 350px);
  max-width: 100%;
  height: var(--zoom-scale-bar-h, 22px);
  margin-top: -1px;
  padding: 0 calc(8px * var(--efs-scale, 1));
  box-sizing: border-box;
  background: #d8d8d8;
  border: 1px solid #888;
  color: #000;
  font-family: system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  user-select: none;
  -webkit-user-select: none;
  pointer-events: auto;
}

.zoom-scale-label,
.zoom-scale-value {
  flex: 0 0 auto;
  font-size: calc(10px * var(--efs-scale, 1));
  font-weight: 700;
  letter-spacing: 0.3px;
  text-transform: uppercase;
}

.zoom-scale-value {
  min-width: 2.8em;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.zoom-scale-slider {
  flex: 1 1 auto;
  min-width: 0;
  width: 0;
  height: calc(14px * var(--efs-scale, 1));
  margin: 0;
  accent-color: #666;
  cursor: pointer;
}

.strip-zoom-draw {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 5;
  pointer-events: none;
  touch-action: none;
}

.strip-zoom-draw.pen-active {
  pointer-events: all;
  cursor: crosshair;
}

.strip-zoom-keys {
  grid-column: 2;
  grid-row: 1;
  display: flex;
  flex-direction: column;
  justify-content: stretch;
  align-items: stretch;
  align-self: stretch;
  gap: 0;
  background: #d8d8d8;
  border: 1px solid #888;
  box-sizing: border-box;
}

.zoom-key {
  flex: 1 1 0;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 0;
  width: 100%;
  margin: 0;
  padding: 0;
  border: none;
  border-radius: 0;
  border-bottom: 1px solid #666;
  appearance: none;
  -webkit-appearance: none;
  background: #d8d8d8;
  color: #000;
  cursor: pointer;
}

.zoom-key:last-child {
  border-bottom: none;
}

.zoom-key:hover:not(:disabled) {
  background: #e8e8e8;
}

.zoom-key:disabled {
  color: #888;
  cursor: default;
  background: #c8c8c8;
}

.zoom-key:disabled .zoom-key-icon {
  color: #888;
  opacity: 1;
}

.zoom-key.active {
  background: #f0c040;
  color: #000;
}

.zoom-key-icon {
  color: #000;
  opacity: 1;
}

.zoom-key-close:hover:not(:disabled) {
  background: #e8e8e8;
}
</style>

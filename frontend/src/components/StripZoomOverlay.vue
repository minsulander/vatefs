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
              :active-scribble-color="drawInk"
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
            <!-- Paper + toggle: off → blue → red → off -->
            <button
              v-if="useMergedPenTool && isPaperLook"
              type="button"
              class="zoom-key zoom-key-ink"
              :class="penToolInkClass"
              :title="penToolTitle"
              @click="cyclePenTool"
            >
              <v-icon :size="toolIconSize" class="zoom-key-icon zoom-ink-icon">{{ penToolIcon }}</v-icon>
            </button>
            <!-- SAAB + toggle: off ↔ black only -->
            <button
              v-else-if="useMergedPenTool"
              type="button"
              class="zoom-key zoom-key-ink"
              :class="penMode ? 'ink-black' : 'ink-off'"
              :title="penMode ? 'Pen on - tap to turn off' : 'Pen off - tap to scribble'"
              @click="togglePenBlack"
            >
              <v-icon :size="toolIconSize" class="zoom-key-icon zoom-ink-icon">{{
                penMode ? 'mdi-pencil' : 'mdi-pencil-off'
              }}</v-icon>
            </button>
            <!-- Paper always-on / notes: blue ↔ red -->
            <button
              v-else-if="isPaperLook"
              type="button"
              class="zoom-key zoom-key-ink"
              :class="penColor === 'blue' ? 'ink-blue' : 'ink-red'"
              :title="penColor === 'blue' ? 'Blue pen - tap for red' : 'Red pen - tap for blue'"
              @click="togglePenColor"
            >
              <v-icon :size="toolIconSize" class="zoom-key-icon zoom-ink-icon">mdi-pencil</v-icon>
            </button>
            <!-- SAAB always-on: no colour control (always black) -->
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
  type PaperScribbleTag,
  type ScribbleBandScreen,
  type ScribbleInk,
  type ScribbleRect,
  clearStripScribbles,
  clientToScribble,
  getClrScribbleTags,
  getStripScribbles,
  hasClrScribble,
  hasShapeMatchedPaperScribble,
  measureScribbleBands,
  pushStripScribble,
  strokeMatchesClrBox,
  strokeMatchesRisingDiagonal,
  undoStripScribble,
  useStripScribbles,
} from '@/composables/useStripScribbles'
import { useEfsStore } from '@/store/efs'
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

const store = useEfsStore()
const efsScale = useEfsScaleValue()
const zoomScalePercent = useZoomStripScalePercent()
/** Draft while dragging — strip size applies only on release (`change`). */
const sliderPercent = ref(zoomScalePercent.value)
const scribbleMode = useStripScribbleMode()
const stripId = computed(() => props.strip.id)
/** Notes always draw in zoom (no pen toggle). Vehicles match aircraft (pen toggle). */
const isNote = computed(() => props.strip.stripType === 'note')
const isPaperLook = computed(() => store.isPaperLook)
const { hasScribbles } = useStripScribbles(stripId)
const { topExpanded, bottomExpanded } = useStripExpanders(stripId)

const penMode = ref(false)
/** Paper ink; reset to blue every time zoom opens. SAAB always draws black. */
const penColor = ref<ScribbleInk>('blue')
const activeStroke = ref<string | null>(null)
const drawing = ref(false)

/** Effective ink for new strokes */
const drawInk = computed<ScribbleInk>(() =>
  isPaperLook.value ? penColor.value : 'black',
)

/** Settings “pen button” (toggle) — merge enable + colour into one control */
const useMergedPenTool = computed(
  () => scribbleMode.value === 'toggle' && !isNote.value,
)

const penToolIcon = computed(() => (penMode.value ? 'mdi-pencil' : 'mdi-pencil-off'))
const penToolInkClass = computed(() => {
  if (!penMode.value) return 'ink-off'
  return penColor.value === 'blue' ? 'ink-blue' : 'ink-red'
})
const penToolTitle = computed(() => {
  if (!penMode.value) return 'Pen off - tap for blue'
  if (penColor.value === 'blue') return 'Blue pen - tap for red'
  return 'Red pen - tap to turn off'
})
const stageHeight = ref(0)
/** Locked shell position — avoid recentering on every strip-height RO tick (zoom twitch). */
const shellLeft = ref(0)
const shellTop = ref(0)
const bands = ref<ScribbleBandScreen[]>([])

let pointerPending = false
let pendingPointerId: number | null = null
let pendingStartX = 0
let pendingStartY = 0

let stageResizeObs: ResizeObserver | null = null

const zoomFactor = computed(() => zoomScalePercent.value / 100)

const keyColWidth = computed(() =>
  Math.max(44, Math.round(KEY_COL_REF_PX * zoomFactor.value)),
)

const panelWidth = computed(() => {
  // Wide paper bays can exceed ZOOM_REF — size from the bay strip so zoom is never narrower
  const anchorW = Math.round(props.anchorRect?.width ?? 0)
  const refW = Math.max(ZOOM_REF_WIDTH_PX, Math.round(anchorW * 1.15))
  const scaled = Math.round(refW * zoomFactor.value)
  const max =
    typeof window !== 'undefined'
      ? Math.floor(window.innerWidth * 0.94 - keyColWidth.value)
      : scaled
  return Math.max(280, anchorW, Math.min(scaled, max))
})

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
  return {
    left: `${shellLeft.value}px`,
    top: `${shellTop.value}px`,
    width: `${totalW}px`,
    '--zoom-panel-w': `${pw}px`,
    /** Deterministic strip scale for zoom (avoids RO width dither → --strip-scale twitch) */
    '--zoom-strip-scale': String(Math.round((pw / 400) * 50) / 50),
    '--zoom-scale-bar-h': `${scaleBarHeight.value}px`,
    '--zoom-scale-bar-w': `${scaleBarWidth.value}px`,
  }
})

/** Place shell from anchor / viewport. Call on open + Size % commit — not on height RO. */
function placeShell() {
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

  shellLeft.value = Math.round(Math.max(4, Math.min(left, vw - totalW - 4)))
  shellTop.value = Math.round(Math.max(4, Math.min(top, vh - estH - 4)))
}

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

const STAGE_HEIGHT_DEADBAND_PX = 3

function measureStage(opts?: { relocate?: boolean }) {
  const stage = stageEl.value
  if (!stage) {
    bands.value = []
    return
  }
  const h = stage.clientHeight
  if (h > 0 && Math.abs(h - stageHeight.value) >= STAGE_HEIGHT_DEADBAND_PX) {
    stageHeight.value = h
  }
  bands.value = measureScribbleBands(stage)
  if (opts?.relocate) placeShell()
}

/** Paper toggle mode: off → blue → red → off */
function cyclePenTool() {
  if (!penMode.value) {
    penMode.value = true
    penColor.value = 'blue'
    return
  }
  if (penColor.value === 'blue') {
    penColor.value = 'red'
    return
  }
  penMode.value = false
  penColor.value = 'blue'
  resetDrawPointerState()
}

/** SAAB toggle mode: off ↔ on (black ink only) */
function togglePenBlack() {
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
      'button, a, input, select, textarea, [role="button"], .action-button, .callsign-box, .cell, .vehicle-cell, .exp-chip, .ctrl-arrow, .exp-assr, .exp-rmk, .strip-time, .pg-clr-check, .pg-cto-check, .pg-atis-qnh',
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
    requestAnimationFrame(() => measureStage())
  })
}

function togglePenColor() {
  penColor.value = penColor.value === 'blue' ? 'red' : 'blue'
}

function onEscapePenOff() {
  if (useMergedPenTool.value && penMode.value) {
    penMode.value = false
    penColor.value = 'blue'
    resetDrawPointerState()
    return true
  }
  return false
}

function undoStroke() {
  const id = props.strip.id
  const strokes = getStripScribbles(id)
  const last = strokes[strokes.length - 1]
  undoStripScribble(id)
  // Diagonal / that triggered UTFLYGNING→APP XFER: undo cancels the pending outbound (re-assume)
  if (
    last?.tag === 'xfer-app' &&
    store.isPaperLook &&
    !hasClrScribble(id, 'xfer-app')
  ) {
    const s = store.strips.get(id) ?? props.strip
    if (s.transferPending === 'out') {
      store.sendStripAction(id, 'ASSUME')
    }
  }
}

function clearStrokes() {
  activeStroke.value = null
  clearStripScribbles(props.strip.id)
}

/**
 * Apply CLR / CTO / transfer-refuse from tagged scribbles only when zoom closes —
 * avoids auto-move while still zoomed.
 * Flag is set only when freehand ink roughly matches the generated mark;
 * mismatched ink stays tagged so clickzones can still clear it.
 */
function flushHotspotFlagsFromScribbles() {
  const id = props.strip.id
  const tags = getClrScribbleTags(id)
  if (
    !tags.read &&
    !tags.correct &&
    !tags.cto &&
    !tags.ctl &&
    !tags.goa &&
    !tags.xferRefuse &&
    !tags.xferApp
  ) {
    return
  }
  const s = store.strips.get(id) ?? props.strip
  // Other-owned: only allow refuse scribble on inbound transfer (same as drag/clickspots)
  const canToggleClrCto = store.allowMoveOwnedStrip(s)
  if (canToggleClrCto) {
    if (tags.read && hasShapeMatchedPaperScribble(id, 'clr-read')) {
      const alreadyOn = !!(s.clearance || s.clearanceReadback || s.clearanceRead)
      if (!alreadyOn) store.sendStripAction(id, 'toggleClearanceRead')
    }
    if (tags.correct && hasShapeMatchedPaperScribble(id, 'clr-correct')) {
      const alreadyOn = !!(s.clearance || s.clearanceReadback)
      if (!alreadyOn) store.sendStripAction(id, 'toggleClearanceReadback')
    }
    if (tags.cto && !s.clearedForTakeoff && hasShapeMatchedPaperScribble(id, 'cto')) {
      store.sendStripAction(id, 'CTO')
    }
    if (tags.ctl && !s.clearedToLand && hasShapeMatchedPaperScribble(id, 'ctl')) {
      store.sendStripAction(id, 'CTL')
    }
    // ARR go-around arrow → soft GA (EFSGA, not TopSky MISAP_)
    if (tags.goa && !s.missedApproach && hasShapeMatchedPaperScribble(id, 'goa')) {
      store.sendStripAction(id, 'softGA')
    }
  }
  // ESGG paper: rising diagonal in leftmost col refuses pending inbound transfer
  if (
    tags.xferRefuse &&
    store.isPaperLook &&
    s.transferPending === 'in' &&
    hasShapeMatchedPaperScribble(id, 'xfer-refuse')
  ) {
    store.sendStripAction(id, 'REFUSE')
  }
  // ESGG paper: rising diagonal in UTFLYGNING / G/A → XFER to APP (pin bottom)
  // Skip if already pending out (e.g. bay/zoom clickspot already fired)
  if (
    tags.xferApp &&
    store.isPaperLook &&
    canToggleClrCto &&
    s.transferPending !== 'in' &&
    s.transferPending !== 'out' &&
    hasShapeMatchedPaperScribble(id, 'xfer-app') &&
    (s.missedApproach ||
      s.sectionId === 'ctr_dep' ||
      s.sectionId.endsWith('_ctr_dep'))
  ) {
    store.sendStripAction(id, 'XFER')
  }
}

function close() {
  penMode.value = false
  resetDrawPointerState()
  flushHotspotFlagsFromScribbles()
  emit('update:modelValue', false)
}

function onEscape() {
  if (onEscapePenOff()) return
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

/** Map a hotspot element into canonical scribble space. */
function hotspotScribbleRect(el: Element | null): ScribbleRect | null {
  if (!el || bands.value.length === 0) return null
  const r = el.getBoundingClientRect()
  if (r.width <= 0 || r.height <= 0) return null
  const corners = [
    clientToScribble(r.left, r.top, bands.value),
    clientToScribble(r.right, r.top, bands.value),
    clientToScribble(r.left, r.bottom, bands.value),
    clientToScribble(r.right, r.bottom, bands.value),
  ]
  if (corners.some((c) => !c)) return null
  const xs = corners.map((c) => c!.x)
  const ys = corners.map((c) => c!.y)
  return {
    x0: Math.min(...xs),
    y0: Math.min(...ys),
    x1: Math.max(...xs),
    y1: Math.max(...ys),
  }
}

/** Tag stroke if mostly in a paper hotspot (flags applied on zoom close). */
function commitStrokeMaybeClr(points: string) {
  const root = stageEl.value
  if (!root) {
    pushStripScribble(props.strip.id, points, drawInk.value)
    return
  }

  // ESGG: rising / in leftmost column → refuse inbound, or UTFLYGNING/G/A → APP XFER
  const leftRect = hotspotScribbleRect(root.querySelector('.pg-left'))
  const live = store.strips.get(props.strip.id) ?? props.strip
  const pendingIn = store.isPaperLook && live.transferPending === 'in'
  if (pendingIn && leftRect && strokeMatchesRisingDiagonal(points, leftRect)) {
    pushStripScribble(props.strip.id, points, drawInk.value, 'xfer-refuse')
    return
  }
  const utflygningOrGoa =
    store.isPaperLook &&
    live.transferPending !== 'in' &&
    store.allowMoveOwnedStrip(live) &&
    (!!live.missedApproach ||
      live.sectionId === 'ctr_dep' ||
      live.sectionId.endsWith('_ctr_dep'))
  if (utflygningOrGoa && leftRect && strokeMatchesRisingDiagonal(points, leftRect)) {
    pushStripScribble(props.strip.id, points, drawInk.value, 'xfer-app')
    return
  }

  // ARR: CTL (col 2) / go-around arrow (col 3 bottom) — same box test as CLR
  if (props.strip.stripType === 'arrival') {
    const ctlRect = hotspotScribbleRect(
      root.querySelector('[data-paper-flag="ctl"]') ?? root.querySelector('.pg-cto-check'),
    )
    const goaRect = hotspotScribbleRect(root.querySelector('[data-paper-flag="goa"]'))
    if (ctlRect && strokeMatchesClrBox(points, ctlRect)) {
      pushStripScribble(props.strip.id, points, drawInk.value, 'ctl')
      return
    }
    if (goaRect && strokeMatchesClrBox(points, goaRect)) {
      pushStripScribble(props.strip.id, points, drawInk.value, 'goa')
      return
    }
    pushStripScribble(props.strip.id, points, drawInk.value)
    return
  }

  // DEP: CLR / CFTO / ATD hotspots
  const readRect = hotspotScribbleRect(root.querySelector('.pg-adep .pg-clr-check'))
  const correctRect = hotspotScribbleRect(root.querySelector('.pg-ades .pg-clr-check'))
  const ctoRect = hotspotScribbleRect(
    root.querySelector('[data-paper-flag="cfto"]') ?? root.querySelector('.pg-cto-check'),
  )
  const atdRect = hotspotScribbleRect(root.querySelector('.pg-atd-cell'))

  let tag: PaperScribbleTag | undefined
  // Prefer correct (col 5) / CFTO over neighbours when stroke straddles a divider.
  if (correctRect && strokeMatchesClrBox(points, correctRect)) tag = 'clr-correct'
  else if (readRect && strokeMatchesClrBox(points, readRect)) tag = 'clr-read'
  else if (ctoRect && strokeMatchesClrBox(points, ctoRect)) tag = 'cto'
  else if (atdRect && strokeMatchesClrBox(points, atdRect)) tag = 'atd'

  pushStripScribble(props.strip.id, points, drawInk.value, tag)
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
      commitStrokeMaybeClr(activeStroke.value)
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
  placeShell()
  measureStage({ relocate: true })
  requestAnimationFrame(() => {
    measureStage({ relocate: true })
    requestAnimationFrame(() => measureStage({ relocate: true }))
  })
  if (stageEl.value && typeof ResizeObserver !== 'undefined') {
    stageResizeObs?.disconnect()
    stageResizeObs = new ResizeObserver(() => {
      // Remeasuring mid-stroke causes scribble shake at high zoom
      if (drawing.value || pointerPending) return
      // Height-only: update bands / stageHeight deadband — do not relocate shell
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
      stageHeight.value = 0
      return
    }
    penMode.value = false
    penColor.value = 'blue'
    resetDrawPointerState()
    await afterOpenMeasure()
  },
)

watch([topExpanded, bottomExpanded], async () => {
  if (!props.modelValue) return
  await nextTick()
  // Expanders change height; keep top locked so shell doesn't jump
  measureStage()
})

watch(zoomScalePercent, async () => {
  if (!props.modelValue) return
  await nextTick()
  measureStage({ relocate: true })
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
  /* Paper WTC scribble / type frame may paint slightly outside the strip box */
  overflow: visible;
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

.zoom-key-ink.ink-off .zoom-ink-icon {
  color: #666;
}

.zoom-key-ink.ink-blue .zoom-ink-icon {
  color: #1565c0;
}

.zoom-key-ink.ink-red .zoom-ink-icon {
  color: #c62828;
}

.zoom-key-ink.ink-black .zoom-ink-icon {
  color: #1a1a1a;
}
</style>

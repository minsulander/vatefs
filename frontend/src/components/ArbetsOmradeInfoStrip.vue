<template>
  <InfoStrip
    v-if="visible"
    ref="stripRef"
    :strip-id="instanceKey"
    @close="dismiss"
  >
    <div class="ao" data-no-strip-drag>
      <div
        class="ao-label"
        title="Zoom to scribble"
        @pointerdown.stop
        @mousedown.stop
        @click.stop="openZoom"
      >
        <span>Arbets</span>
        <span>område</span>
      </div>

      <div class="ao-body">
        <div v-if="mode === 'text'" class="ao-text">
          <input
            v-for="(_, i) in lines"
            :key="i"
            class="ao-line"
            type="text"
            spellcheck="false"
            autocomplete="off"
            :value="lines[i]"
            @input="onLineInput(i, $event)"
            @pointerdown.stop
            @mousedown.stop
          />
        </div>

        <!-- Bay: strokes visible, scribble disabled (zoom via red label) -->
        <svg
          v-else
          class="ao-scribble ao-scribble--readonly"
          viewBox="0 0 1000 250"
          preserveAspectRatio="none"
        >
          <polyline
            v-for="(stroke, i) in strokes"
            :key="i"
            class="ao-stroke"
            fill="none"
            :points="stroke.points"
            :stroke="inkHex(stroke.color)"
          />
        </svg>
      </div>
    </div>
    <template #actions>
      <button
        type="button"
        class="ao-mode-btn"
        :title="mode === 'text' ? 'Scribble mode' : 'Text mode'"
        draggable="false"
        @pointerdown.stop
        @mousedown.stop
        @touchstart.stop
        @dragstart.prevent
        @click.stop="toggleMode"
      >
        <svg v-if="mode === 'text'" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M2 12 L10 4 L12 6 L4 14 L2 14 Z M10.5 3.5 L12.5 1.5 L14.5 3.5 L12.5 5.5 Z"
            fill="currentColor"
          />
        </svg>
        <svg v-else viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M2 11 Q5 3 8 8 T14 5"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
          />
        </svg>
      </button>
    </template>
  </InfoStrip>

  <Teleport to="body">
    <div
      v-if="visible && zoomOpen"
      ref="overlayEl"
      class="ao-zoom-overlay"
      tabindex="-1"
      @pointerdown.self="closeZoom"
      @keydown.escape.prevent="closeZoom"
    >
      <div class="ao-zoom-shell" :style="shellStyle" @pointerdown.stop>
        <div class="ao-zoom-row">
          <div class="ao-zoom-keys" :style="{ width: keyColWidth + 'px' }">
            <!-- ESSA/SAAB: black ink only — no colour control (same as other ESSA strips) -->
            <button
              type="button"
              class="zoom-key"
              title="Undo last scribble"
              :disabled="strokes.length === 0"
              @click="undoStroke"
            >
              <v-icon :size="toolIconSize" class="zoom-key-icon">mdi-undo</v-icon>
            </button>
            <button
              type="button"
              class="zoom-key"
              title="Clear all scribbles"
              :disabled="strokes.length === 0"
              @click="clearStrokes"
            >
              <v-icon :size="toolIconSize" class="zoom-key-icon">mdi-eraser</v-icon>
            </button>
            <button
              type="button"
              class="zoom-key zoom-key-close"
              title="Close zoomed strip"
              @click="closeZoom"
            >
              <v-icon :size="toolIconSize" class="zoom-key-icon">mdi-close</v-icon>
            </button>
          </div>

          <div class="ao-zoom-panel" :style="{ '--strip-scale': String(zoomStripScale) }">
            <div class="ao ao--zoom">
              <div class="ao-label" aria-hidden="true">
                <span>Arbets</span>
                <span>område</span>
              </div>
              <div class="ao-body">
                <div v-if="mode === 'text'" class="ao-text">
                  <input
                    v-for="(_, i) in lines"
                    :key="'z' + i"
                    class="ao-line"
                    type="text"
                    spellcheck="false"
                    autocomplete="off"
                    :value="lines[i]"
                    @input="onLineInput(i, $event)"
                  />
                </div>
                <svg
                  v-else
                  ref="zoomSvgEl"
                  class="ao-scribble"
                  viewBox="0 0 1000 250"
                  preserveAspectRatio="none"
                  @pointerdown.prevent="onDrawStart"
                  @pointermove.prevent="onDrawMove"
                  @pointerup.prevent="onDrawEnd"
                  @pointercancel.prevent="onDrawEnd"
                >
                  <polyline
                    v-for="(stroke, i) in strokes"
                    :key="i"
                    class="ao-stroke"
                    fill="none"
                    :points="stroke.points"
                    :stroke="inkHex(stroke.color)"
                  />
                  <polyline
                    v-if="activeStroke"
                    class="ao-stroke"
                    fill="none"
                    :points="activeStroke"
                    :stroke="inkHex('black')"
                  />
                </svg>
              </div>
            </div>
          </div>
        </div>

        <div class="ao-zoom-scale" @pointerdown.stop>
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
import { computed, nextTick, ref, watch } from 'vue'
import InfoStrip from './InfoStrip.vue'
import {
  ARBETS_OMRADE_INFO_KIND,
  type ArbetsOmradeStroke,
  dismissArbetsOmradeAirport,
  getArbetsOmradeContent,
  getActiveArbetsOmradeVariants,
  infoStripInstanceKey,
  patchArbetsOmradeContent,
} from '@/composables/useInfoStrips'
import { useEfsScaleValue } from '@/composables/useEfsUiScale'
import { SCRIBBLE_INK_HEX, type ScribbleInk } from '@/composables/useStripScribbles'
import {
  ZOOM_STRIP_SCALE_PERCENT_MAX,
  ZOOM_STRIP_SCALE_PERCENT_MIN,
  ZOOM_STRIP_SCALE_PERCENT_STEP,
  setZoomStripScalePercent,
  useZoomStripScalePercent,
} from '@/composables/useStripZoomScale'

const props = defineProps<{
  airport?: string
}>()

const airport = computed(() => (props.airport || 'ESSA').toUpperCase())

const variant = computed(
  () => getActiveArbetsOmradeVariants().find((v) => v.airport === airport.value) ?? null,
)
const visible = computed(() => !!variant.value)
const instanceKey = computed(() =>
  infoStripInstanceKey(ARBETS_OMRADE_INFO_KIND, airport.value),
)

const content = computed(() => getArbetsOmradeContent(airport.value))
const mode = computed(() => content.value.mode)
const lines = computed(() => content.value.lines)
const strokes = computed(() => content.value.strokes)

const stripRef = ref<InstanceType<typeof InfoStrip> | null>(null)
const overlayEl = ref<HTMLElement | null>(null)
const zoomOpen = ref(false)
const zoomAnchor = ref<{ left: number; top: number; width: number; height: number } | null>(null)

const efsScale = useEfsScaleValue()
const zoomScalePercent = useZoomStripScalePercent()
const sliderPercent = ref(zoomScalePercent.value)

const zoomFactor = computed(() => zoomScalePercent.value / 100)
const keyColWidth = computed(() => Math.max(44, Math.round(44 * zoomFactor.value)))
const toolIconSize = computed(() => Math.max(18, Math.round(18 * zoomFactor.value)))
const scaleBarHeight = computed(() => Math.max(18, Math.round(22 * efsScale.value)))
const scaleBarWidth = computed(() => Math.max(120, Math.round(350 * efsScale.value)))

const panelWidth = computed(() => {
  const anchorW = Math.round(zoomAnchor.value?.width ?? 0)
  const refW = Math.max(560, Math.round(anchorW * 2.2))
  const scaled = Math.round(refW * zoomFactor.value)
  return Math.max(320, Math.min(scaled, Math.max(280, window.innerWidth - keyColWidth.value - 16)))
})

/** Deterministic strip scale for zoom panel height / fonts */
const zoomStripScale = computed(() => Math.round((panelWidth.value / 400) * 50) / 50)

const shellStyle = computed(() => {
  const a = zoomAnchor.value
  const pw = panelWidth.value
  const totalW = pw + keyColWidth.value
  const barH = scaleBarHeight.value
  const stageH = Math.max(72, Math.round(50 * zoomStripScale.value))
  const estH = stageH + barH

  let left: number
  let top: number
  if (a) {
    left = a.left + a.width / 2 - pw / 2
    top = a.top + a.height / 2 - stageH / 2
  } else {
    left = (window.innerWidth - totalW) / 2
    top = Math.max(16, (window.innerHeight - estH) / 3)
  }
  left = Math.max(0, Math.min(left, window.innerWidth - totalW))
  top = Math.max(0, Math.min(top, window.innerHeight - estH))

  return {
    left: `${Math.round(left)}px`,
    top: `${Math.round(top)}px`,
    width: `${totalW}px`,
    '--zoom-panel-w': `${pw}px`,
    '--zoom-scale-bar-h': `${scaleBarHeight.value}px`,
    '--zoom-scale-bar-w': `${scaleBarWidth.value}px`,
  }
})

const zoomSvgEl = ref<SVGSVGElement | null>(null)
const activeStroke = ref<string | null>(null)
let drawing = false

function inkHex(color: ScribbleInk | undefined): string {
  return SCRIBBLE_INK_HEX[color ?? 'black']
}

function dismiss() {
  closeZoom()
  dismissArbetsOmradeAirport(airport.value)
}

function toggleMode() {
  patchArbetsOmradeContent(airport.value, {
    mode: mode.value === 'text' ? 'scribble' : 'text',
  })
}

function onLineInput(index: number, event: Event) {
  const el = event.target as HTMLInputElement
  const next: [string, string, string] = [...lines.value] as [string, string, string]
  next[index] = el.value
  patchArbetsOmradeContent(airport.value, { lines: next })
}

function openZoom() {
  const el =
    (stripRef.value as unknown as { $el?: HTMLElement })?.$el ??
    (document.querySelector(`[data-info-strip-id="${instanceKey.value}"]`) as HTMLElement | null)
  if (el) {
    const r = el.getBoundingClientRect()
    zoomAnchor.value = { left: r.left, top: r.top, width: r.width, height: r.height }
  } else {
    zoomAnchor.value = null
  }
  if (mode.value !== 'scribble') {
    patchArbetsOmradeContent(airport.value, { mode: 'scribble' })
  }
  sliderPercent.value = zoomScalePercent.value
  zoomOpen.value = true
  nextTick(() => overlayEl.value?.focus())
}

function closeZoom() {
  zoomOpen.value = false
  activeStroke.value = null
  drawing = false
}

function undoStroke() {
  if (strokes.value.length === 0) return
  patchArbetsOmradeContent(airport.value, {
    strokes: strokes.value.slice(0, -1),
  })
}

function clearStrokes() {
  activeStroke.value = null
  patchArbetsOmradeContent(airport.value, { strokes: [] })
}

function onZoomScaleDrag(event: Event) {
  sliderPercent.value = Number((event.target as HTMLInputElement).value)
}

function onZoomScaleCommit(event: Event) {
  const next = Number((event.target as HTMLInputElement).value)
  sliderPercent.value = next
  setZoomStripScalePercent(next)
}

watch(zoomScalePercent, (v) => {
  sliderPercent.value = v
})

function svgPoint(event: PointerEvent): string | null {
  const svg = zoomSvgEl.value
  if (!svg) return null
  const pt = svg.createSVGPoint()
  pt.x = event.clientX
  pt.y = event.clientY
  const ctm = svg.getScreenCTM()
  if (!ctm) return null
  const local = pt.matrixTransform(ctm.inverse())
  return `${Math.round(local.x * 10) / 10},${Math.round(local.y * 10) / 10}`
}

function onDrawStart(event: PointerEvent) {
  if (!zoomOpen.value || mode.value !== 'scribble') return
  if (event.button != null && event.button !== 0) return
  const p = svgPoint(event)
  if (!p) return
  drawing = true
  activeStroke.value = p
  zoomSvgEl.value?.setPointerCapture(event.pointerId)
}

function onDrawMove(event: PointerEvent) {
  if (!drawing || !activeStroke.value) return
  const p = svgPoint(event)
  if (!p) return
  activeStroke.value = `${activeStroke.value} ${p}`
}

function onDrawEnd(event: PointerEvent) {
  if (!drawing) return
  drawing = false
  try {
    zoomSvgEl.value?.releasePointerCapture(event.pointerId)
  } catch {
    /* ignore */
  }
  const pts = activeStroke.value
  activeStroke.value = null
  if (!pts || pts.split(/\s+/).length < 2) return
  const stroke: ArbetsOmradeStroke = { points: pts, color: 'black' }
  patchArbetsOmradeContent(airport.value, {
    strokes: [...strokes.value, stroke],
  })
}
</script>

<style scoped>
.ao {
  display: flex;
  flex-direction: row;
  align-items: stretch;
  width: 100%;
  min-width: 0;
  height: 100%;
}

.ao-label {
  /* Match MAP/DEP runway colour box width */
  flex: 0 0 calc(96px * var(--strip-scale, 1));
  width: calc(96px * var(--strip-scale, 1));
  min-width: calc(96px * var(--strip-scale, 1));
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: calc(1px * var(--strip-scale, 1));
  background: #c62828;
  color: #000;
  font-size: calc(16px * var(--strip-scale, 1));
  font-weight: 600;
  letter-spacing: 0.02em;
  line-height: 1.05;
  text-transform: none;
  user-select: none;
  cursor: pointer;
}

.ao-label:hover {
  filter: brightness(1.06);
}

.ao-body {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: #e8e8e8;
}

.ao-text {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 0 calc(6px * var(--strip-scale, 1));
}

.ao-line {
  flex: 1 1 0;
  width: 100%;
  min-width: 0;
  min-height: 0;
  margin: 0;
  padding: 0 calc(2px * var(--strip-scale, 1));
  border: none;
  border-bottom: 1px solid rgba(0, 0, 0, 0.22);
  border-radius: 0;
  background: transparent;
  color: #000;
  font-family: system-ui, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  font-size: calc(12px * var(--strip-scale, 1));
  font-weight: 600;
  line-height: 1;
  outline: none;
}

.ao-line:last-child {
  border-bottom: none;
}

.ao-scribble {
  flex: 1 1 auto;
  width: 100%;
  min-height: 0;
  display: block;
  touch-action: none;
  cursor: crosshair;
  background: #e8e8e8;
}

.ao-scribble--readonly {
  pointer-events: none;
  cursor: default;
}

.ao-stroke {
  stroke-width: 3.5;
  stroke-linecap: round;
  stroke-linejoin: round;
  vector-effect: non-scaling-stroke;
}

/* Same column / size / chrome as StripCloseButton (X) */
.ao-mode-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  width: calc(14px * var(--strip-scale, 1));
  height: calc(14px * var(--strip-scale, 1));
  margin: auto 0 0;
  padding: 0;
  border: 1px solid #b0b0b0;
  border-radius: 1px;
  background: #e0e0e0;
  color: #222;
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
  flex-shrink: 0;
}

.ao-mode-btn:hover {
  background: #d0d0d0;
  border-color: #888;
}

.ao-mode-btn svg {
  width: 70%;
  height: 70%;
  display: block;
}

/* --- Zoom chrome (match StripZoomOverlay) --- */
.ao-zoom-overlay {
  position: fixed;
  inset: 0;
  z-index: 2400;
  background: transparent;
  outline: none;
}

.ao-zoom-shell {
  position: absolute;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0;
  box-shadow: none;
  background: transparent;
  pointer-events: none;
}

.ao-zoom-row {
  display: grid;
  grid-template-columns: var(--zoom-panel-w, 560px) auto;
  grid-template-areas: 'panel keys';
  gap: 0;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45);
  pointer-events: auto;
}

.ao-zoom-panel {
  grid-area: panel;
  width: 100%;
  border: 1px solid #888;
  border-right: none;
  background: #ebebeb;
  height: calc(50px * var(--strip-scale, 1.4));
  min-height: calc(50px * var(--strip-scale, 1.4));
  max-height: calc(50px * var(--strip-scale, 1.4));
  box-sizing: border-box;
  overflow: hidden;
}

.ao--zoom {
  height: 100%;
}

.ao-zoom-keys {
  grid-area: keys;
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

.zoom-key-icon {
  color: #000;
  opacity: 1;
}

.ao-zoom-scale {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  align-self: flex-start;
  gap: calc(6px * var(--efs-scale, 1));
  width: var(--zoom-scale-bar-w, 350px);
  max-width: var(--zoom-panel-w, 100%);
  height: var(--zoom-scale-bar-h, 22px);
  margin-top: -1px;
  margin-left: max(
    0px,
    calc(var(--zoom-panel-w, 560px) - min(var(--zoom-scale-bar-w, 350px), var(--zoom-panel-w, 560px)))
  );
  padding: 0 calc(8px * var(--efs-scale, 1));
  box-sizing: border-box;
  background: #d8d8d8;
  border: 1px solid #888;
  color: #000;
  font-family: system-ui, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
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
</style>

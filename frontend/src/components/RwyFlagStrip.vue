<template>
  <div
    v-if="active"
    ref="rootEl"
    class="rwy-flag-strip"
    :class="[`flag-${kind}`, { 'graphics-end': graphicsAfterText }]"
    :data-rwy-flag-id="id"
  >
    <div class="rwy-flag-body">
      <!--
        01L/19R: [icon][raster] … text
        01R/19L & 08/26 (mirror): text … [raster][icon]
      -->
      <div
        v-if="!graphicsAfterText"
        class="rwy-flag-graphics rwy-flag-graphics-start"
        aria-hidden="true"
      >
        <div class="rwy-flag-icon">
          <RwyFlagTypeIcon :kind="kind" />
        </div>
        <div class="rwy-flag-raster">
          <EssaRwyRaster
            :section-id="sectionId"
            :label="label"
            :closed="kind === 'rwyClosed'"
          />
        </div>
      </div>
      <div class="rwy-flag-text" :class="{ closed: kind === 'rwyClosed' }">
        <span class="rwy-flag-rwy">{{ label }}</span>
        <span v-if="kind === 'rwyClosed'" class="rwy-flag-avstangd">AVSTÄNGD</span>
      </div>
      <div
        v-if="graphicsAfterText"
        class="rwy-flag-graphics rwy-flag-graphics-end"
        aria-hidden="true"
      >
        <div class="rwy-flag-raster">
          <EssaRwyRaster
            :section-id="sectionId"
            :label="label"
            :closed="kind === 'rwyClosed'"
          />
        </div>
        <div class="rwy-flag-icon">
          <RwyFlagTypeIcon :kind="kind" />
        </div>
      </div>
    </div>
    <div class="rwy-flag-actions">
      <StripCloseButton @click="dismiss" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, toRef, watch } from 'vue'
import { ESSA_PHYSICAL_RWY_PAIRS, essaRunwaySectionId } from '@vatefs/common'
import StripCloseButton from './StripCloseButton.vue'
import EssaRwyRaster from './EssaRwyRaster.vue'
import RwyFlagTypeIcon from './RwyFlagTypeIcon.vue'
import {
  type RwyFlagKind,
  useRwyFlagStrip,
} from '@/composables/useRunwayFlagStrips'

const props = defineProps<{
  kind: RwyFlagKind
  sectionId: string
  sectionTitle?: string
}>()

const homeSectionId = toRef(props, 'sectionId')
const sectionTitleRef = toRef(props, 'sectionTitle')
const { id, label, active, dismiss, kind } = useRwyFlagStrip(
  props.kind,
  homeSectionId,
  sectionTitleRef,
)

/** 01R/19L and 08/26: mirror of 01L — text then raster then vehicle/cone. */
const graphicsAfterText = computed(() => {
  const sid = props.sectionId
  for (const pair of ESSA_PHYSICAL_RWY_PAIRS) {
    if (pair.id === '01L_19R') continue
    if (sid === pair.id || sid === essaRunwaySectionId(pair)) return true
  }
  const lab = (label.value || '').replace(/\s+/g, '').toUpperCase()
  return lab === '01R/19L' || lab === '08/26'
})

const rootEl = ref<HTMLElement | null>(null)
let resizeObs: ResizeObserver | null = null
let scaleRaf = 0
let lastScaleWidth = 0
/** Same design ref as FlightStrip — body 50px at scale 1 */
const STRIP_REF_WIDTH_PX = 400
/** Match FlightStrip — ignore scrollbar appear/disappear width jitter */
const SCROLLBAR_WIDTH_DEADBAND_PX = 18

function quantizeStripScale(raw: number): number {
  const clamped = Math.max(0.55, Math.min(2.2, raw))
  return Math.round(clamped * 50) / 50
}

/** Prefer peer flight-strip scale so flags always match aircraft strip height. */
function peerFlightStripScale(el: HTMLElement): number | null {
  const section = el.closest('.efs-section')
  const bay = el.closest('.efs-bay')
  const peer =
    (section?.querySelector('.flight-strip') as HTMLElement | null) ||
    (bay?.querySelector('.flight-strip') as HTMLElement | null)
  if (!peer) return null
  const raw =
    peer.style.getPropertyValue('--strip-scale').trim() ||
    getComputedStyle(peer).getPropertyValue('--strip-scale').trim()
  const n = parseFloat(raw)
  return Number.isFinite(n) && n > 0 ? n : null
}

function applyScale(s: number, width: number) {
  const el = rootEl.value
  if (!el) return
  lastScaleWidth = width
  el.style.setProperty('--strip-scale', String(s))
}

function updateScale(force = false) {
  const el = rootEl.value
  if (!el) return
  const w = el.clientWidth
  if (w <= 0) return

  const peer = peerFlightStripScale(el)
  if (peer != null) {
    applyScale(quantizeStripScale(peer), w)
    return
  }

  if (!force && Math.abs(w - lastScaleWidth) < 1) return
  if (
    !force &&
    lastScaleWidth > 0 &&
    Math.abs(w - lastScaleWidth) <= SCROLLBAR_WIDTH_DEADBAND_PX
  ) {
    return
  }
  applyScale(quantizeStripScale(w / STRIP_REF_WIDTH_PX), w)
}

function detachScaleObserver() {
  resizeObs?.disconnect()
  resizeObs = null
}

function attachScaleObserver() {
  detachScaleObserver()
  const el = rootEl.value
  if (!el || typeof ResizeObserver === 'undefined') return
  resizeObs = new ResizeObserver((entries) => {
    const entry = entries[0]
    const w =
      entry?.contentBoxSize?.[0]?.inlineSize ??
      entry?.contentRect?.width ??
      rootEl.value?.clientWidth ??
      0
    if (w <= 0) return
    if (Math.abs(w - lastScaleWidth) < 1) return
    if (
      lastScaleWidth > 0 &&
      Math.abs(w - lastScaleWidth) <= SCROLLBAR_WIDTH_DEADBAND_PX
    ) {
      return
    }
    scheduleScale()
  })
  resizeObs.observe(el)
}

function scheduleScale(force = false) {
  if (scaleRaf) cancelAnimationFrame(scaleRaf)
  scaleRaf = requestAnimationFrame(() => {
    scaleRaf = 0
    updateScale(force)
  })
}

/** v-if remounts the root — must re-measure and re-observe every time it appears. */
async function onStripShown() {
  lastScaleWidth = 0
  await nextTick()
  attachScaleObserver()
  updateScale(true)
  requestAnimationFrame(() => {
    updateScale(true)
    requestAnimationFrame(() => updateScale(true))
  })
}

watch(active, (on) => {
  if (!on) {
    detachScaleObserver()
    return
  }
  void onStripShown()
})

onMounted(() => {
  if (active.value) void onStripShown()
})

onUnmounted(() => {
  if (scaleRaf) cancelAnimationFrame(scaleRaf)
  detachScaleObserver()
})
</script>

<style scoped>
.rwy-flag-strip {
  /* Match FlightStrip outer size; no contrasting type-frame — solid red throughout */
  --strip-scale: 1;
  --frame-side: calc(8px * var(--strip-scale));
  --frame-tb: calc(var(--frame-side) / 4);
  --strip-body-h: calc(50px * var(--strip-scale));
  --fs-cs: calc(26px * var(--strip-scale));
  /* Midpoint of #8b1515 … #c62828 */
  --rwy-flag-red: #a81e1e;
  position: relative;
  display: flex;
  flex-direction: row;
  align-items: stretch;
  box-sizing: border-box;
  height: calc(var(--strip-body-h) + 2 * var(--frame-tb));
  min-height: calc(var(--strip-body-h) + 2 * var(--frame-tb));
  max-height: calc(var(--strip-body-h) + 2 * var(--frame-tb));
  margin: 1px 4px;
  background: var(--rwy-flag-red);
  border-style: solid;
  border-color: var(--rwy-flag-red);
  border-width: var(--frame-tb) var(--frame-side);
  font-family: system-ui, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  user-select: none;
  -webkit-user-select: none;
  cursor: default;
}

.rwy-flag-body {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  height: var(--strip-body-h);
  min-height: var(--strip-body-h);
  max-height: var(--strip-body-h);
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: 0 calc(1px * var(--strip-scale));
  overflow: hidden;
  box-sizing: border-box;
}

.rwy-flag-graphics {
  position: relative;
  z-index: 1;
  flex: 0 0 auto;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: calc(6px * var(--strip-scale));
}

.rwy-flag-graphics-start {
  margin-right: auto;
}

.rwy-flag-graphics-end {
  margin-left: auto;
}

.rwy-flag-icon {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  width: calc(42px * var(--strip-scale));
  height: calc(48px * var(--strip-scale));
}

.rwy-flag-raster {
  flex: 0 0 auto;
  width: calc(48px * var(--strip-scale));
  height: calc(42px * var(--strip-scale));
  display: flex;
  align-items: center;
  justify-content: center;
}

/* True horizontal center of the strip body (not remaining flex space) */
.rwy-flag-text {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  z-index: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0;
  pointer-events: none;
  max-width: 78%;
}

/* Mirror of start cluster: just right of centered designator */
.rwy-flag-strip.graphics-end .rwy-flag-graphics-end {
  position: absolute;
  left: calc(50% + 5em);
  top: 50%;
  transform: translateY(-50%);
  margin: 0;
}

.rwy-flag-rwy {
  font-size: calc(28px * var(--strip-scale));
  font-weight: 700;
  letter-spacing: 0.02em;
  line-height: 1;
  color: #fff;
  white-space: nowrap;
  text-shadow: 1px 1px 1px rgba(0, 0, 0, 0.35);
}

.rwy-flag-text.closed {
  gap: 0;
}

.rwy-flag-text.closed .rwy-flag-rwy,
.rwy-flag-avstangd {
  font-size: calc(22px * var(--strip-scale));
}

.rwy-flag-avstangd {
  font-weight: 700;
  letter-spacing: 0.04em;
  line-height: 1;
  color: #fff;
  text-transform: uppercase;
  white-space: nowrap;
  text-shadow: 1px 1px 1px rgba(0, 0, 0, 0.35);
}

.rwy-flag-actions {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: flex-start;
  height: var(--strip-body-h);
  padding: 0;
  background: var(--rwy-flag-red);
  cursor: default;
  touch-action: manipulation;
  box-sizing: border-box;
}

.rwy-flag-actions :deep(.strip-close-btn) {
  border-color: #e0a0a0;
  background: #e8e8e8;
  color: #1b5e20;
}
</style>

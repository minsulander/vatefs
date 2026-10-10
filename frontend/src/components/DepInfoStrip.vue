<template>
  <InfoStrip v-if="visible && variant" :strip-id="kind" @close="dismiss">
    <div class="dep-strip">
      <div class="dep-rwy" aria-hidden="true">
        <!-- LT: arrow left of designator; RT: arrow right -->
        <svg
          v-if="variant.turn === 'LEFT'"
          class="dep-turn left"
          viewBox="-2 -3.5 32 37.5"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <!-- Filled LT: viewBox flush to stem base (y=34) so it meets designator bottom -->
          <path
            fill="currentColor"
            d="M23 34 H18 V18 Q18 10.5 13 10.5 H6 V16 L-2 6.25 L6 -3.5 V2 H13 Q23 2 23 18 Z"
          />
        </svg>
        <span class="dep-rwy-text">{{ variant.runway }}</span>
        <svg
          v-if="variant.turn === 'RIGHT'"
          class="dep-turn right"
          viewBox="-2 -3.5 32 37.5"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <!-- Filled RT: viewBox flush to stem base (y=34) so it meets designator bottom -->
          <path
            fill="currentColor"
            d="M5 34 H10 V18 Q10 10.5 15 10.5 H22 V16 L30 6.25 L22 -3.5 V2 H15 Q5 2 5 18 Z"
          />
        </svg>
      </div>
      <div class="dep-main">
        <div class="dep-top">
          <span class="dep-primary-freq" :title="primaryCallsignTitle">{{ primaryFreqLabel }}</span>
          <div ref="holdEl" class="dep-hold" :style="{ '--hold-font': holdFontPx + 'px' }">
            <div ref="holdLine0El" class="dep-hold-line dark">{{ holdLine0 }}</div>
            <div ref="holdLine1El" class="dep-hold-line green">{{ holdLine1 }}</div>
          </div>
        </div>
        <div v-for="(row, i) in variant.rows" :key="i" class="dep-row" :class="row.tone">
          <span class="dep-row-label">{{ row.label }}</span>
          <span class="dep-row-freq" :title="rowCallsignTitle(row)">{{ rowFreq(row) }}</span>
        </div>
      </div>
    </div>
  </InfoStrip>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import InfoStrip from './InfoStrip.vue'
import { useDepInfoStrip } from '@/composables/useInfoStrips'
import { useEfsStore } from '@/store/efs'
import type { DepInfoRow, EssaDepInfo } from '@/data/essa-dep-info'

const store = useEfsStore()
const { variant: baseVariant, visible, dismiss, kind } = useDepInfoStrip()

/** Live payload from backend (freqs + exit rows). Falls back to base runway shell. */
const live = ref<EssaDepInfo | null>(null)
let pollTimer: ReturnType<typeof setInterval> | null = null
const POLL_MS = 30_000

const holdEl = ref<HTMLElement | null>(null)
const holdLine0El = ref<HTMLElement | null>(null)
const holdLine1El = ref<HTMLElement | null>(null)
/** Fitted hold font size (px); shrinks so full phrase fits without ellipsis. */
const HOLD_FONT_MAX = 9.5
const HOLD_FONT_MIN = 5.5
const holdFontPx = ref(HOLD_FONT_MAX)
let holdResizeObs: ResizeObserver | null = null

const variant = computed(() => {
  const base = baseVariant.value
  if (!base) return null
  if (live.value && live.value.configId === base.configId) {
    return { ...base, ...live.value, id: base.id }
  }
  return base
})

const primaryFreqLabel = computed(() => {
  const v = variant.value
  if (!v) return ''
  return v.primaryFreq || v.primaryDefaultFreq || ''
})

const primaryCallsignTitle = computed(() => {
  const cs = variant.value?.primaryCallsign
  return cs && cs.trim() ? cs.trim() : undefined
})

const holdLine0 = computed(() => variant.value?.holdLines?.[0] ?? '')
const holdLine1 = computed(() => variant.value?.holdLines?.[1] ?? '')

function rowFreq(row: DepInfoRow): string {
  return row.frequency || row.defaultFreq || ''
}

function rowCallsignTitle(row: DepInfoRow): string | undefined {
  const cs = row.callsign
  return cs && cs.trim() ? cs.trim() : undefined
}

function applyHoldFont(px: number) {
  const scaleAttr = holdEl.value?.closest('.info-strip') as HTMLElement | null
  const scaleRaw = scaleAttr?.style.getPropertyValue('--strip-scale') || '1'
  const scale = Number(scaleRaw) || 1
  const cssPx = `${px * scale}px`
  if (holdLine0El.value) holdLine0El.value.style.fontSize = cssPx
  if (holdLine1El.value) holdLine1El.value.style.fontSize = cssPx
}

function fitHoldText() {
  const box = holdEl.value
  const l0 = holdLine0El.value
  const l1 = holdLine1El.value
  if (!box || !l0 || !l1) return

  const avail = box.clientWidth
  if (avail <= 0) return

  // Binary search --hold-font so both lines fit in full (set DOM directly for measure)
  let lo = HOLD_FONT_MIN
  let hi = HOLD_FONT_MAX
  let best = HOLD_FONT_MIN
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2
    applyHoldFont(mid)
    void l0.offsetWidth
    const fits = l0.scrollWidth <= avail + 0.5 && l1.scrollWidth <= avail + 0.5
    if (fits) {
      best = mid
      lo = mid
    } else {
      hi = mid
    }
  }
  const rounded = Math.round(best * 100) / 100
  holdFontPx.value = rounded
  applyHoldFont(rounded)
}

function scheduleFitHold() {
  void nextTick(() => fitHoldText())
}

async function refreshDepInfo() {
  const base = baseVariant.value
  if (!base || !visible.value) {
    live.value = null
    return
  }
  try {
    const res = await fetch(`/api/essa-dep-info?config=${encodeURIComponent(base.configId)}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as EssaDepInfo
    if (data && data.runway) {
      live.value = data
    }
  } catch {
    // keep previous / shell
  }
}

function startPoll() {
  stopPoll()
  pollTimer = setInterval(() => {
    void refreshDepInfo()
  }, POLL_MS)
}

function stopPoll() {
  if (pollTimer != null) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

watch(
  () =>
    [
      visible.value,
      baseVariant.value?.configId,
      store.controllers.length,
      store.showAppDepXcFrequency,
      store.controllers.map((c) => `${c.callsign}:${c.frequency}`).join('|'),
    ] as const,
  ([isVisible]) => {
    if (isVisible) {
      void refreshDepInfo()
      startPoll()
      scheduleFitHold()
    } else {
      stopPoll()
      live.value = null
    }
  },
  { immediate: true },
)

watch(
  () => [holdLine0.value, holdLine1.value, visible.value, primaryFreqLabel.value] as const,
  () => scheduleFitHold(),
)

onMounted(() => {
  scheduleFitHold()
  if (typeof ResizeObserver !== 'undefined') {
    holdResizeObs = new ResizeObserver(() => fitHoldText())
    if (holdEl.value) holdResizeObs.observe(holdEl.value)
    watch(holdEl, (el, prev) => {
      if (prev) holdResizeObs?.unobserve(prev)
      if (el) {
        holdResizeObs?.observe(el)
        scheduleFitHold()
      }
    })
  }
})

onUnmounted(() => {
  stopPoll()
  holdResizeObs?.disconnect()
  holdResizeObs = null
})
</script>

<style scoped>
.dep-strip {
  display: flex;
  flex-direction: row;
  align-items: stretch;
  width: 100%;
  min-width: 0;
  height: 100%;
}

.dep-rwy {
  position: relative;
  flex: 0 0 calc(96px * var(--strip-scale, 1));
  width: calc(96px * var(--strip-scale, 1));
  min-width: calc(96px * var(--strip-scale, 1));
  background: #2f6fb5;
  color: #fff;
  overflow: hidden;
  align-self: stretch;
  box-sizing: border-box;
}

.dep-rwy-text {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, calc(-50% - 2px * var(--strip-scale, 1)));
  font-size: calc(42px * var(--strip-scale, 1));
  font-weight: 500;
  letter-spacing: -0.03em;
  line-height: 1;
  white-space: nowrap;
  z-index: 1;
  pointer-events: none;
}

.dep-turn {
  position: absolute;
  /* Align base with designator; inset from cell edges */
  top: 50%;
  width: calc(22px * var(--strip-scale, 1));
  height: calc(38px * var(--strip-scale, 1));
  transform: translateY(calc(-50% - 1px * var(--strip-scale, 1)));
  color: #fff;
  overflow: visible;
  display: block;
  z-index: 0;
}

.dep-turn.left {
  left: calc(4px * var(--strip-scale, 1));
}

.dep-turn.right {
  right: calc(4px * var(--strip-scale, 1));
}

.dep-main {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 0;
  /* Small gap before X — hold text stops short of the button */
  padding: calc(1px * var(--strip-scale, 1)) calc(2px * var(--strip-scale, 1))
    calc(1px * var(--strip-scale, 1)) calc(3px * var(--strip-scale, 1));
  background: #ebebeb;
}

.dep-top {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: calc(3px * var(--strip-scale, 1));
  min-width: 0;
  width: 100%;
}

.dep-primary-freq {
  flex: 0 0 calc(52px * var(--strip-scale, 1));
  width: calc(52px * var(--strip-scale, 1));
  max-width: calc(52px * var(--strip-scale, 1));
  font-size: calc(16px * var(--strip-scale, 1));
  font-weight: 500;
  color: #1a3a7a;
  font-variant-numeric: tabular-nums;
  line-height: 1;
  letter-spacing: -0.06em;
  white-space: nowrap;
  overflow: hidden;
  text-align: left;
  padding: 0;
  margin: 0;
  cursor: default;
}

.dep-hold {
  flex: 1 1 auto;
  min-width: 0;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 0;
  overflow: hidden;
}

.dep-hold-line {
  /* font-size set by fitHoldText(); fallback uses --hold-font */
  font-size: calc(var(--hold-font, 9.5px) * var(--strip-scale, 1));
  font-weight: 500;
  line-height: 1.12;
  letter-spacing: -0.015em;
  white-space: nowrap;
  overflow: visible;
  text-transform: uppercase;
  width: max-content;
  max-width: none;
}

.dep-hold-line.dark {
  color: #444;
}

.dep-hold-line.green {
  color: #1a9a3a;
}

.dep-row {
  display: flex;
  flex-direction: row;
  align-items: baseline;
  justify-content: space-between;
  gap: calc(8px * var(--strip-scale, 1));
  min-width: 0;
  padding-right: calc(1px * var(--strip-scale, 1));
}

.dep-row-label {
  flex: 1 1 auto;
  min-width: 0;
  font-size: calc(11px * var(--strip-scale, 1));
  font-weight: 500;
  line-height: 1.15;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dep-row-freq {
  flex: 0 0 auto;
  font-size: calc(11px * var(--strip-scale, 1));
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  line-height: 1.15;
  cursor: default;
}

.dep-row.east .dep-row-label,
.dep-row.east .dep-row-freq {
  color: #8b1a2b;
}

.dep-row.slow .dep-row-label,
.dep-row.slow .dep-row-freq {
  color: #1a1a1a;
}
</style>

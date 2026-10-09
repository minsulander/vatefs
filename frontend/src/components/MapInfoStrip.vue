<template>
  <InfoStrip v-if="visible && variant" :strip-id="kind" @close="dismiss">
    <div class="map-strip">
      <div class="map-rwy" aria-hidden="true">
        <span class="map-rwy-text">{{ variant.runway }}</span>
      </div>
      <div class="map-main">
        <div class="map-proc" :class="{ highlight: variant.highlightProc }">
          <div v-for="(line, i) in variant.mapLines" :key="i" class="map-proc-line">
            {{ line }}
          </div>
        </div>
        <div class="map-box">
          <span class="map-box-item map-box-twr">
            <span class="map-box-label">TWR:</span>
            <span class="map-climb" aria-hidden="true" />
            <span class="map-box-val">{{ variant.twrDme }}</span>
          </span>
          <span class="map-box-right">
            <span class="map-box-item">
              <span class="map-turn" aria-hidden="true" />
              <span class="map-box-val">{{ headingLabel }}</span>
            </span>
            <span class="map-box-item">
              <span class="map-box-label">fq:</span>
              <span class="map-box-val">{{ freqLabel }}</span>
            </span>
          </span>
        </div>
      </div>
    </div>
  </InfoStrip>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import InfoStrip from './InfoStrip.vue'
import { useMapInfoStrip } from '@/composables/useInfoStrips'
import { useEfsStore } from '@/store/efs'

const store = useEfsStore()
const { variant, visible, dismiss, kind } = useMapInfoStrip()

const headingLabel = computed(() => {
  const h = variant.value?.heading
  if (h == null) return ''
  return `${String(h).padStart(3, '0')}°`
})

/** Live freq from backend (ESE OWNER + AFV XC); fallback to static default. */
const resolvedFreq = ref<string | null>(null)
let freqPollTimer: ReturnType<typeof setInterval> | null = null
const FREQ_POLL_MS = 30_000

async function refreshMapFreq() {
  const v = variant.value
  if (!v || !visible.value) {
    resolvedFreq.value = null
    return
  }
  try {
    const res = await fetch(`/api/essa-map-freq?config=${encodeURIComponent(v.configId)}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as { frequency?: string | null }
    resolvedFreq.value = typeof data.frequency === 'string' && data.frequency ? data.frequency : null
  } catch {
    // keep previous / fall through to default
  }
}

const freqLabel = computed(() => {
  const v = variant.value
  if (!v) return ''
  return resolvedFreq.value || v.defaultFreq
})

function startFreqPoll() {
  stopFreqPoll()
  freqPollTimer = setInterval(() => {
    void refreshMapFreq()
  }, FREQ_POLL_MS)
}

function stopFreqPoll() {
  if (freqPollTimer != null) {
    clearInterval(freqPollTimer)
    freqPollTimer = null
  }
}

watch(
  () =>
    [
      visible.value,
      variant.value?.configId,
      store.controllers.length,
      store.showAppDepXcFrequency,
      // Re-check when any controller freq/callsign changes (XC / login)
      store.controllers.map((c) => `${c.callsign}:${c.frequency}`).join('|'),
    ] as const,
  ([isVisible]) => {
    if (isVisible) {
      void refreshMapFreq()
      startFreqPoll()
    } else {
      stopFreqPoll()
      resolvedFreq.value = null
    }
  },
  { immediate: true },
)

onUnmounted(() => {
  stopFreqPoll()
})
</script>

<style scoped>
.map-strip {
  display: flex;
  flex-direction: row;
  align-items: stretch;
  width: 100%;
  min-width: 0;
  height: 100%;
}

.map-rwy {
  flex: 0 0 calc(96px * var(--strip-scale, 1));
  width: calc(96px * var(--strip-scale, 1));
  min-width: calc(96px * var(--strip-scale, 1));
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  background: #e06a38;
  color: #fff;
  overflow: hidden;
}

.map-rwy-text {
  display: block;
  font-size: calc(49px * var(--strip-scale, 1));
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1;
  white-space: nowrap;
  /* Optical vertical center for large caps (fonts sit low) */
  transform: translateY(calc(-2px * var(--strip-scale, 1)));
}

.map-main {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: calc(2px * var(--strip-scale, 1));
  /* Tight right edge — close button sits immediately beside */
  padding: calc(2px * var(--strip-scale, 1)) calc(2px * var(--strip-scale, 1)) calc(2px * var(--strip-scale, 1)) calc(6px * var(--strip-scale, 1));
  background: #ebebeb;
}

.map-proc {
  display: flex;
  flex-direction: column;
  gap: 0;
  min-width: 0;
  width: 100%;
}

.map-proc-line {
  font-size: calc(9.5px * var(--strip-scale, 1));
  font-weight: 600;
  color: #1a1a1a;
  line-height: 1.2;
  letter-spacing: -0.01em;
  white-space: nowrap;
  overflow: visible;
}

.map-proc.highlight .map-proc-line {
  color: #8b1a2b;
  font-weight: 800;
}

.map-box {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  flex-wrap: nowrap;
  gap: calc(12px * var(--strip-scale, 1));
  align-self: stretch;
  padding: calc(2px * var(--strip-scale, 1)) calc(8px * var(--strip-scale, 1));
  border: 1px solid #333;
  background: #e4e4e4;
  min-height: calc(18px * var(--strip-scale, 1));
}

.map-box-right {
  display: inline-flex;
  align-items: center;
  gap: calc(16px * var(--strip-scale, 1));
  margin-left: auto;
}

.map-box-item {
  display: inline-flex;
  align-items: center;
  gap: calc(4px * var(--strip-scale, 1));
  color: #8b1a2b;
  font-size: calc(12px * var(--strip-scale, 1));
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
}

.map-box-label {
  color: #8b1a2b;
}

.map-box-val {
  color: #8b1a2b;
  font-variant-numeric: tabular-nums;
}

/* Climb arrow (head + stem) */
.map-climb {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  width: calc(11px * var(--strip-scale, 1));
  height: calc(14px * var(--strip-scale, 1));
  flex-shrink: 0;
}

.map-climb::before {
  content: '';
  width: 0;
  height: 0;
  border-left: calc(5px * var(--strip-scale, 1)) solid transparent;
  border-right: calc(5px * var(--strip-scale, 1)) solid transparent;
  border-bottom: calc(6.5px * var(--strip-scale, 1)) solid #8b1a2b;
  margin-bottom: -1px;
}

.map-climb::after {
  content: '';
  width: calc(3.5px * var(--strip-scale, 1));
  height: calc(7px * var(--strip-scale, 1));
  background: #8b1a2b;
  border-radius: 0.5px;
}

/* Right-turn delivery symbol — shorter horizontal arm, slightly thicker stroke */
.map-turn {
  display: inline-block;
  width: calc(8px * var(--strip-scale, 1));
  height: calc(12px * var(--strip-scale, 1));
  border-left: 3.25px solid #8b1a2b;
  border-top: 3.25px solid #8b1a2b;
  border-top-left-radius: 1px;
  position: relative;
  margin-right: 1px;
  box-sizing: border-box;
}

.map-turn::after {
  content: '';
  position: absolute;
  right: -1.5px;
  top: -6px;
  width: 0;
  height: 0;
  border-left: 6px solid #8b1a2b;
  border-top: 4.5px solid transparent;
  border-bottom: 4.5px solid transparent;
}
</style>

<script setup lang="ts">
import { computed } from 'vue'
import type { FlightStrip } from '@vatefs/common'
import { useEfsStore } from '@/store/efs'
import {
  compactRfl,
  routeWords,
  airportCode,
} from '@/strip/stdStripFields'

const props = defineProps<{ strip: FlightStrip }>()
const emit = defineEmits<{
  'callsign-click': [event: MouseEvent]
  'callsign-context': [event: MouseEvent]
  'callsign-touch': [event: TouchEvent]
}>()
const store = useEfsStore()

function hhmm(raw: string | undefined): string {
  if (!raw) return ''
  const digits = raw.replace(/\D/g, '')
  if (digits.length < 3) return ''
  return digits.length === 3 ? digits.padStart(4, '0') : digits.slice(0, 4)
}

const timeText = computed(() =>
  hhmm(props.strip.stripType === 'arrival' ? props.strip.eta : props.strip.eobt),
)
const ctot = computed(() => hhmm(props.strip.ctot))

const adep = computed(() => airportCode(props.strip.adep))
const ades = computed(() => airportCode(props.strip.ades))
const points = computed(() => routeWords(props.strip.route))
const rfl = computed(() => compactRfl(props.strip.rfl))
const clrRead = computed(() => !!(props.strip.clearance || props.strip.clearanceReadback))

const isArrival = computed(() => props.strip.stripType === 'arrival')

/** Sector box: ESMS is Malmö ACC sector L (ZZZL). Other airports are ZZ + ICAO suffix. */
const sectorCode = computed(() => {
  const icao = (props.strip.ades || '').trim().toUpperCase()
  if (!icao || icao === '????') return ''
  if (icao === 'ESMS') return 'ZZZL'
  return icao.length >= 2 ? `ZZ${icao.slice(-2)}` : ''
})

/** ETN as UTC HHmm: now plus minutes until sector entry. */
const etnText = computed(() => {
  const min = props.strip.sectorEntryMin
  if (min == null || !Number.isFinite(min) || min < 0) return ''
  const t = new Date(Date.now() + min * 60_000)
  const hh = String(t.getUTCHours()).padStart(2, '0')
  const mm = String(t.getUTCMinutes()).padStart(2, '0')
  return `${hh}${mm}`
})
const depCoord = computed(
  () => props.strip.stripType === 'departure' || props.strip.stripType === 'local',
)
const clrCoordinated = computed(() =>
  depCoord.value ? !!props.strip.coo : props.strip.stdMark1 === '✓',
)

function onCoordinatedClick() {
  if (depCoord.value) {
    store.setCoo(props.strip.id, !props.strip.coo)
    return
  }
  const on = props.strip.stdMark1 === '✓'
  store.updateStdMark(props.strip.id, 1, on ? '' : '✓')
}

function onClrReadClick() {
  store.sendStripAction(props.strip.id, 'toggleClearanceReadback')
}
</script>

<template>
  <div class="std-strip">
    <div class="std-col std-id">
      <div
        class="std-cs"
        :title="strip.callsign"
        @click.stop="emit('callsign-click', $event)"
        @contextmenu.stop.prevent="emit('callsign-context', $event)"
        @touchend="emit('callsign-touch', $event)"
      >
        <span class="std-glyph std-glyph-left">{{ strip.callsign }}</span>
      </div>
      <div class="std-tas"><span class="std-glyph std-glyph-right">{{ strip.tas || '' }}</span></div>
      <div class="std-type">
        <span class="std-glyph std-glyph-right std-type-line">
          <span class="std-frul" title="Flight rules">{{ strip.flightRules || 'I' }}</span>
          <span>{{ strip.aircraftType }}<template v-if="strip.wakeTurbulence">/{{ strip.wakeTurbulence }}</template></span>
        </span>
      </div>
      <div class="std-sq" title="ASSR"><span class="std-glyph std-glyph-right">{{ strip.squawk || '' }}</span></div>
    </div>

    <div class="std-col std-split">
      <div class="std-cell std-time"><span class="std-glyph">{{ timeText }}</span></div>
      <div class="std-cell" />
    </div>

    <div class="std-col std-sid" />

    <div class="std-col std-split std-adep">
      <div v-if="isArrival" class="std-cell std-entry" title="Sector / ETN">
        <span class="std-glyph">{{ sectorCode }}</span>
        <span class="std-glyph">{{ etnText }}</span>
      </div>
      <button
        v-else
        type="button"
        class="std-cell std-mark"
        title="CLR Coordinated"
        @pointerdown.stop
        @click.stop="onCoordinatedClick"
      >
        <svg
          v-if="clrCoordinated"
          class="std-clr-mark"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path d="M4 13.5 L10 19.5 L20.5 5.5" />
        </svg>
      </button>
      <div class="std-cell std-ad" :title="strip.adepName || strip.adep"><span class="std-glyph">{{ adep }}</span></div>
    </div>

    <div class="std-col std-split">
      <button
        type="button"
        class="std-cell std-mark"
        title="CLR Read"
        @pointerdown.stop
        @click.stop="onClrReadClick"
      >
        <svg
          v-if="clrRead"
          class="std-clr-mark"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path d="M4 13.5 L10 19.5 L20.5 5.5" />
        </svg>
      </button>
      <div class="std-cell std-ad" :title="strip.adesName || strip.ades"><span class="std-glyph">{{ ades }}</span></div>
    </div>

    <div class="std-col std-split">
      <div class="std-cell" />
      <div class="std-cell std-pts">
        <div class="std-pt"><span class="std-glyph std-glyph-left">{{ points[0] }}</span></div>
        <div class="std-pt"><span class="std-glyph std-glyph-left">{{ points[1] }}</span></div>
      </div>
    </div>

    <div class="std-col std-col7 std-last">
      <div class="std-q">
        <span v-if="ctot" class="std-glyph std-glyph-left std-ctot">{{ ctot }}</span>
      </div>
      <div class="std-q" />
      <div class="std-q std-q-top">
        <span v-if="strip.oat" class="std-glyph std-glyph-left" title="OAT">*</span>
      </div>
      <div class="std-q">
        <span class="std-glyph std-glyph-left">{{ rfl }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.std-strip {
  --std-line: calc(1px * var(--strip-scale, 1));
  --std-glyph-x: 1.1;
  display: grid;
  /* Equivalent widths 400 : 250 : 460 : 200 : 200 : 250 : 500. */
  grid-template-columns:
    minmax(0, 400fr)
    minmax(0, 250fr)
    minmax(0, 460fr)
    minmax(0, 200fr)
    minmax(0, 200fr)
    minmax(0, 250fr)
    minmax(0, 500fr);
  flex: 1;
  min-width: 0;
  min-height: 0;
  height: 100%;
  background: #fff;
  color: #000;
  font-family: "Avrile Sans", "Segoe UI", Arial, sans-serif;
  font-size: calc(9.5px * var(--strip-scale, 1));
  font-weight: 400;
  line-height: 1;
  box-sizing: border-box;
  overflow: hidden;
}
.std-col {
  min-width: 0;
  border-right: var(--std-line) solid #111;
}
.std-last {
  border-right: none;
}
.std-id {
  display: grid;
  /* Four rows, no rules: C/S left, TAS · FRUL+type · ASSR right. */
  grid-template-rows: repeat(4, minmax(0, 1fr));
  padding:
    0
    calc(2px * var(--strip-scale, 1))
    0
    calc(2px * var(--strip-scale, 1));
  overflow: hidden;
}
.std-cs,
.std-tas,
.std-ctot {
  font-weight: 600;
}
.std-cs {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  overflow: hidden;
  text-overflow: clip;
  white-space: nowrap;
  cursor: pointer;
}
.std-tas,
.std-type,
.std-time,
.std-sq,
.std-ad {
  display: flex;
  align-items: center;
  min-width: 0;
  overflow: hidden;
}
.std-tas,
.std-type,
.std-sq {
  justify-content: flex-end;
}
.std-glyph {
  display: inline-block;
  white-space: nowrap;
  transform: scaleX(var(--std-glyph-x));
  transform-origin: center center;
}
.std-glyph-left {
  transform-origin: left center;
}
.std-glyph-right {
  transform-origin: right center;
}
.std-type-line {
  display: inline-flex;
  align-items: center;
  gap: calc(5px * var(--strip-scale, 1));
}
.std-frul {
  font-family: inherit;
  font-weight: inherit;
}
.std-col7 {
  display: grid;
  grid-template-rows: repeat(4, minmax(0, 1fr));
  overflow: hidden;
}
.std-q {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  padding-left: calc(2px * var(--strip-scale, 1));
}
.std-q-top {
  align-items: flex-start;
}
.std-split {
  display: grid;
  grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
  overflow: hidden;
}
.std-cell {
  min-width: 0;
  min-height: 0;
}
.std-split:not(.std-last) .std-cell:first-child {
  border-bottom: var(--std-line) solid #111;
}
.std-time {
  display: grid;
  grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
  justify-items: center;
  align-items: center;
}
.std-time .std-glyph {
  grid-row: 2;
}
.std-col.std-adep {
  border-right: none;
}
.std-ad {
  display: grid;
  grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
  justify-items: center;
  align-items: center;
}
.std-ad .std-glyph {
  grid-row: 2;
}
.std-clr-mark {
  width: calc(20px * var(--strip-scale, 1));
  height: calc(20px * var(--strip-scale, 1));
  overflow: visible;
  pointer-events: none;
}
.std-clr-mark path {
  fill: none;
  stroke: #1565c0;
  stroke-width: 1.15;
  stroke-opacity: 0.95;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.std-mark {
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.std-adep > .std-mark,
.std-adep > .std-entry {
  border-right: var(--std-line) solid #111;
}
.std-entry {
  display: grid;
  grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
  justify-items: center;
  align-items: center;
  min-width: 0;
  overflow: hidden;
}
.std-pts {
  display: grid;
  grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
  min-width: 0;
  overflow: hidden;
}
.std-pt {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  padding-left: calc(2px * var(--strip-scale, 1));
}
</style>

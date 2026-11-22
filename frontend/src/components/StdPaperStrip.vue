<script setup lang="ts">
import { computed } from 'vue'
import type { FlightStrip } from '@vatefs/common'
import { useEfsStore } from '@/store/efs'
import {
  compactRfl,
  routeWords,
  airportDisplayParts,
} from '@/strip/stdStripFields'
import {
  removeClrScribbles,
  useStripScribbles,
} from '@/composables/useStripScribbles'

const props = defineProps<{ strip: FlightStrip }>()
const emit = defineEmits<{
  'callsign-click': [event: MouseEvent]
  'callsign-context': [event: MouseEvent]
  'callsign-touch': [event: TouchEvent]
}>()
const store = useEfsStore()

const stripIdRef = computed(() => props.strip.id)
const { hasClrReadScribble, hasClrCorrectScribble } = useStripScribbles(
  stripIdRef,
  'paper',
)

function hhmm(raw: string | undefined): string {
  if (!raw) return ''
  const digits = raw.replace(/\D/g, '')
  if (digits.length < 3) return ''
  return digits.length === 3 ? digits.padStart(4, '0') : digits.slice(0, 4)
}

const timeText = computed(() =>
  hhmm(props.strip.stripType === 'arrival' ? props.strip.eta : props.strip.eobt),
)
const eobtText = computed(() => hhmm(props.strip.eobt))
/**
 * Local: EOBT + filed EET (FPL) → calculated arrival (UTC HHmm).
 * Both from flight plan — missing either → blank.
 */
const localArrivalText = computed(() => {
  const eobt = eobtText.value
  const eet = hhmm(props.strip.filedEet)
  if (!eobt || !eet) return ''
  const depMin = parseInt(eobt.slice(0, 2), 10) * 60 + parseInt(eobt.slice(2, 4), 10)
  const eetMin = parseInt(eet.slice(0, 2), 10) * 60 + parseInt(eet.slice(2, 4), 10)
  if (!Number.isFinite(depMin) || !Number.isFinite(eetMin)) return ''
  const total = depMin + eetMin
  const outHh = String(Math.floor(total / 60) % 24).padStart(2, '0')
  const outMm = String(total % 60).padStart(2, '0')
  return `${outHh}${outMm}`
})
const ctot = computed(() => hhmm(props.strip.ctot))

/** Own aerodrome from login callsign / myAirports — blank on T strips. */
function isOwnAirport(icao: string | undefined): boolean {
  const code = (icao || '').trim().toUpperCase()
  if (!code || code === '????' || code === 'ZZZZ') return false
  if (store.myAirports.some((a) => a.toUpperCase() === code)) return true
  const cs = (store.myCallsign || '').trim().toUpperCase()
  return !!cs && cs.startsWith(code)
}

const adepParts = computed(() =>
  isOwnAirport(props.strip.adep)
    ? { prefix: '', visible: '' }
    : airportDisplayParts(props.strip.adep),
)
const adesParts = computed(() =>
  isOwnAirport(props.strip.ades)
    ? { prefix: '', visible: '' }
    : airportDisplayParts(props.strip.ades),
)
const points = computed(() =>
  routeWords(props.strip.route, props.strip.stripType === 'arrival'),
)
const rfl = computed(() => compactRfl(props.strip.rfl))

/** FRUL: hide IFR (I); only show V / Y / Z. */
const frulText = computed(() => {
  const r = (props.strip.flightRules || '').trim().toUpperCase()
  return r === 'V' || r === 'Y' || r === 'Z' ? r : ''
})

const isArrival = computed(() => props.strip.stripType === 'arrival')
const isLocal = computed(() => props.strip.stripType === 'local')
const isDepLayout = computed(
  () => props.strip.stripType === 'departure' || props.strip.stripType === 'local',
)

/** CLR Received — local only on std (not lockstep with Given / ES CLR). */
const clrReceived = computed(
  () => !!props.strip.clearanceRead && !props.strip.paperClrReadSuppressed,
)

/** CLR Given — ES clearance / readback correct. */
const clrGiven = computed(
  () => !!(props.strip.clearance || props.strip.clearanceReadback),
)

const canUseClrBoxes = computed(
  () => store.isController && store.allowMoveOwnedStrip(props.strip),
)

function onClrReceivedClick() {
  if (!isDepLayout.value || !canUseClrBoxes.value) return
  if (hasClrReadScribble.value) {
    removeClrScribbles(props.strip.id, 'clr-read')
    // Std: Received is independent — clear local mark even if Given is on
    if (props.strip.clearanceRead) {
      store.sendStripAction(props.strip.id, 'toggleClearanceRead')
    }
    return
  }
  if (props.strip.paperClrReadSuppressed) {
    store.sendStripAction(props.strip.id, 'restorePaperClrRead')
    return
  }
  store.sendStripAction(props.strip.id, 'toggleClearanceRead')
}

function onClrGivenClick() {
  if (!isDepLayout.value || !canUseClrBoxes.value) return
  if (hasClrCorrectScribble.value) {
    removeClrScribbles(props.strip.id, 'clr-correct')
    if (clrGiven.value) {
      store.sendStripAction(props.strip.id, 'toggleClearanceReadback')
    }
    return
  }
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
          <span v-if="frulText" class="std-frul" title="Flight rules">{{ frulText }}</span>
          <span>{{ strip.aircraftType }}<template v-if="strip.wakeTurbulence">/{{ strip.wakeTurbulence }}</template></span>
        </span>
      </div>
      <div class="std-sq" title="ASSR"><span class="std-glyph std-glyph-right">{{ strip.squawk || '' }}</span></div>
    </div>

    <div class="std-col std-split">
      <!-- Local: EOBT top · EOBT+ETE (calculated arrival) bottom -->
      <div class="std-cell std-time">
        <span class="std-glyph">{{ isLocal ? eobtText : timeText }}</span>
      </div>
      <div
        v-if="isLocal"
        class="std-cell std-time"
        title="EOBT + EET (FPL)"
      >
        <span class="std-glyph">{{ localArrivalText }}</span>
      </div>
      <div v-else class="std-cell" />
    </div>

    <div class="std-col std-sid" />

    <div class="std-ad-block">
      <div class="std-col std-split std-adep">
        <!-- ARR: keep std-entry (right rule); no ZZ**/ETN text on T strips -->
        <div v-if="isArrival" class="std-cell std-entry" aria-hidden="true" />
        <button
          v-else
          type="button"
          class="std-cell std-mark"
          data-paper-flag="clr-read"
          title="CLR Received"
          :disabled="!canUseClrBoxes"
          @pointerdown.stop
          @click.stop="onClrReceivedClick"
        >
          <svg
            v-if="clrReceived && !hasClrReadScribble"
            class="std-clr-mark"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d="M4 13.5 L10 19.5 L20.5 5.5" />
          </svg>
        </button>
        <div
          class="std-cell std-ad"
          :title="adepParts.visible ? strip.adepName || strip.adep : undefined"
        >
          <span class="std-glyph">
            <span v-if="adepParts.prefix" class="std-ad-es" aria-hidden="true">{{ adepParts.prefix }}</span>{{ adepParts.visible }}
          </span>
        </div>
      </div>

      <div class="std-col std-split">
        <button
          v-if="isDepLayout"
          type="button"
          class="std-cell std-mark"
          data-paper-flag="clr-correct"
          title="CLR Given"
          :disabled="!canUseClrBoxes"
          @pointerdown.stop
          @click.stop="onClrGivenClick"
        >
          <svg
            v-if="clrGiven && !hasClrCorrectScribble"
            class="std-clr-mark"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d="M4 13.5 L10 19.5 L20.5 5.5" />
          </svg>
        </button>
        <div v-else class="std-cell" aria-hidden="true" />
        <div
          class="std-cell std-ad"
          :title="adesParts.visible ? strip.adesName || strip.ades : undefined"
        >
          <span class="std-glyph">
            <span v-if="adesParts.prefix" class="std-ad-es" aria-hidden="true">{{ adesParts.prefix }}</span>{{ adesParts.visible }}
          </span>
        </div>
      </div>

      <div v-if="strip.sts" class="std-sts" :title="`STS/${strip.sts}`">
        <span class="std-glyph">{{ strip.sts }}</span>
      </div>
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
.std-ad-block {
  grid-column: span 2;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
  height: 100%;
  position: relative;
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
/* Invisible ES keeps PA/GG/… in the same slot as a full four-letter ICAO */
.std-ad-es {
  visibility: hidden;
}
/* Item 18 STS/ — center of ADEP/ADES box, top half of the airport row */
.std-sts {
  position: absolute;
  left: 50%;
  top: 62.5%;
  transform: translate(-50%, -50%);
  z-index: 1;
  pointer-events: none;
  line-height: 1;
  white-space: nowrap;
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
.std-mark:disabled {
  cursor: default;
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

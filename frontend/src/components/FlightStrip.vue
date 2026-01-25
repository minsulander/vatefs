<template>
  <div
    class="flight-strip"
    :class="[stripTypeClass, { dragging: isDragging }]"
    draggable="true"
    @dragstart="onDragStart"
    @dragend="onDragEnd"
    @click="onStripClick"
  >
    <!-- Color indicator bar on left -->
    <div class="strip-indicator" @click.stop="onEdgeClick"></div>

    <!-- Main strip content - structured grid layout -->
    <div class="strip-body">
      <!-- Left section: Callsign block -->
      <div class="strip-left">
        <div class="callsign">{{ strip.callsign }}</div>
        <div class="callsign-sub">
          <span class="flight-rules">{{ strip.flightRules }}</span>
          <span class="aircraft-type">{{ strip.aircraftType }}{{ strip.wakeTurbulence }}</span>
        </div>
        <div class="squawk" v-if="strip.squawk">{{ strip.squawk }}</div>
      </div>

      <!-- Divider -->
      <div class="strip-divider"></div>

      <!-- Time section -->
      <div class="strip-time">
        <div class="time-value">{{ displayTime }}</div>
        <div class="time-label" v-if="strip.stripType === 'departure'">EOBT</div>
        <div class="time-label" v-else>ETA</div>
      </div>

      <!-- Divider -->
      <div class="strip-divider"></div>

      <!-- SID/Clearance section -->
      <div class="strip-sid">
        <div class="sid-value">{{ strip.sid || '' }}</div>
        <div class="cleared-data" v-if="strip.clearedAltitude || strip.assignedHeading">
          <span v-if="strip.clearedAltitude" class="alt">{{ strip.clearedAltitude }}</span>
          <span v-if="strip.assignedHeading" class="hdg">H{{ strip.assignedHeading }}</span>
        </div>
      </div>

      <!-- Divider -->
      <div class="strip-divider"></div>

      <!-- Airports section -->
      <div class="strip-airports">
        <div class="airport adep" :class="{ highlight: strip.stripType === 'departure' }">
          <span class="icao">{{ strip.adep }}</span>
        </div>
        <div class="airport ades" :class="{ highlight: strip.stripType === 'arrival' }">
          <span class="icao">{{ strip.ades }}</span>
        </div>
      </div>

      <!-- Divider -->
      <div class="strip-divider"></div>

      <!-- Route & RFL section -->
      <div class="strip-route">
        <div class="route-text">{{ strip.route || '' }}</div>
        <div class="rfl" v-if="strip.rfl">{{ strip.rfl }}</div>
      </div>

      <!-- Divider -->
      <div class="strip-divider"></div>

      <!-- Stand/Remarks section -->
      <div class="strip-stand">
        <div class="stand-value" v-if="strip.stand">{{ strip.stand }}</div>
        <div class="runway-value" v-if="strip.runway">{{ strip.runway }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { FlightStrip } from '@/types/efs'
import { useEfsStore } from '@/store/efs'

const props = defineProps<{
  strip: FlightStrip
  sectionId: string
  bayId: string
}>()

const store = useEfsStore()
const isDragging = ref(false)

const stripTypeClass = computed(() => `strip-${props.strip.stripType}`)

const displayTime = computed(() => {
  if (props.strip.stripType === 'departure') {
    return props.strip.eobt || ''
  }
  return props.strip.eta || ''
})

function onDragStart(event: DragEvent) {
  isDragging.value = true
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('application/json', JSON.stringify({
      stripId: props.strip.id,
      bayId: props.bayId,
      sectionId: props.sectionId
    }))
  }
}

function onDragEnd() {
  isDragging.value = false
}

function onEdgeClick() {
  store.moveStripToNextSection(props.strip.id)
}

function onStripClick() {
  // Future: open strip detail/edit modal
}
</script>

<style scoped>
.flight-strip {
  display: grid;
  grid-template-columns: 10px 1fr;
  background: #f0ebe0;
  border: 1px solid #888;
  margin: 2px 4px;
  min-height: 44px;
  cursor: move;
  transition: all 0.12s ease;
  font-family: 'Consolas', 'Monaco', 'Lucida Console', monospace;
  font-size: 11px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
}

.flight-strip:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
  transform: translateY(-1px);
  z-index: 10;
}

.flight-strip.dragging {
  opacity: 0.4;
  transform: scale(0.98);
}

/* Strip type color indicators */
.strip-indicator {
  cursor: pointer;
  transition: filter 0.15s ease;
}

.strip-indicator:hover {
  filter: brightness(1.15);
}

/* Departure - Blue */
.strip-departure .strip-indicator {
  background: #3b7dd8;
}

/* Arrival - Yellow/Amber */
.strip-arrival .strip-indicator {
  background: #daa520;
}

/* Local - Red */
.strip-local .strip-indicator {
  background: #cc4444;
}

/* VFR - Green */
.strip-vfr .strip-indicator {
  background: #3d9e3d;
}

/* Strip body layout */
.strip-body {
  display: flex;
  align-items: stretch;
  background: #f5f2ea;
}

/* Vertical dividers */
.strip-divider {
  width: 1px;
  background: #aaa;
  margin: 2px 0;
}

/* Left section - Callsign block */
.strip-left {
  width: 75px;
  min-width: 75px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 2px 4px;
  background: #fff;
  border-right: 1px solid #999;
}

.callsign {
  font-weight: bold;
  font-size: 13px;
  color: #000;
  letter-spacing: 0.3px;
  line-height: 1.2;
}

.callsign-sub {
  display: flex;
  gap: 4px;
  font-size: 9px;
  color: #555;
  margin-top: 1px;
}

.flight-rules {
  font-weight: 600;
  color: #333;
}

.aircraft-type {
  color: #666;
}

.squawk {
  font-size: 10px;
  color: #444;
  font-weight: 500;
  margin-top: 1px;
}

/* Time section */
.strip-time {
  width: 42px;
  min-width: 42px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  padding: 2px;
}

.time-value {
  font-weight: 600;
  font-size: 11px;
  color: #222;
}

.time-label {
  font-size: 7px;
  color: #888;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* SID/Clearance section */
.strip-sid {
  width: 65px;
  min-width: 65px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 2px 4px;
}

.sid-value {
  font-weight: 600;
  font-size: 10px;
  color: #0055aa;
}

.cleared-data {
  display: flex;
  gap: 4px;
  font-size: 9px;
  margin-top: 2px;
}

.alt {
  color: #0066cc;
  font-weight: 500;
}

.hdg {
  color: #666;
}

/* Airports section */
.strip-airports {
  width: 80px;
  min-width: 80px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 2px 4px;
}

.airport {
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: 10px;
  line-height: 1.3;
}

.airport.highlight .icao {
  font-weight: bold;
  color: #000;
}

.icao {
  font-weight: 500;
  color: #444;
  letter-spacing: 0.3px;
}

/* Route section */
.strip-route {
  flex: 1;
  min-width: 80px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 2px 4px;
  overflow: hidden;
}

.route-text {
  font-size: 9px;
  color: #555;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.rfl {
  font-weight: 600;
  font-size: 10px;
  color: #0055aa;
  margin-top: 1px;
}

/* Stand section */
.strip-stand {
  width: 40px;
  min-width: 40px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  padding: 2px;
  background: #e8e4d8;
}

.stand-value {
  font-weight: bold;
  font-size: 12px;
  color: #333;
}

.runway-value {
  font-size: 9px;
  color: #666;
  font-weight: 500;
}

/* Heavy wake turbulence highlighting */
.strip-departure .aircraft-type:has(+ .wtc-heavy),
.strip-arrival .aircraft-type:has(+ .wtc-heavy) {
  color: #cc0000;
}
</style>

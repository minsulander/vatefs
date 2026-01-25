<template>
  <div
    class="flight-strip"
    :class="{ dragging: isDragging }"
    draggable="true"
    @dragstart="onDragStart"
    @dragend="onDragEnd"
  >
    <div class="strip-edge" @click="onEdgeClick"></div>
    <div class="strip-content">
      <div class="strip-header">
        <span class="callsign">{{ strip.callsign }}</span>
        <span class="aircraft-type">{{ strip.aircraftType }}</span>
      </div>
      <div class="strip-route">
        <span class="airport">{{ strip.origin }}</span>
        <span class="arrow">→</span>
        <span class="airport">{{ strip.destination }}</span>
      </div>
      <div class="strip-details">
        <span v-if="strip.altitude" class="detail">{{ strip.altitude }}</span>
        <span v-if="strip.speed" class="detail">{{ strip.speed }}kt</span>
        <span v-if="strip.squawk" class="detail squawk">{{ strip.squawk }}</span>
      </div>
      <div class="strip-times">
        <span v-if="strip.departureTime" class="time">DEP {{ strip.departureTime }}</span>
        <span v-if="strip.arrivalTime" class="time">ARR {{ strip.arrivalTime }}</span>
      </div>
      <div v-if="strip.route" class="strip-route-detail">{{ strip.route }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { FlightStrip } from '@/types/efs'
import { useEfsStore } from '@/store/efs'

const props = defineProps<{
  strip: FlightStrip
  sectionId: string
  bayId: string
}>()

const store = useEfsStore()
const isDragging = ref(false)

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
</script>

<style scoped>
.flight-strip {
  display: grid;
  grid-template-columns: 30px 1fr;
  background: linear-gradient(135deg, #1e2226 0%, #2a2e32 100%);
  border: 1px solid #3a3e42;
  border-left: 3px solid rgb(var(--v-theme-primary));
  margin: 2px 4px;
  border-radius: 2px;
  cursor: move;
  transition: all 0.2s ease;
  font-family: 'Roboto', sans-serif;
}

.flight-strip:hover {
  border-color: rgb(var(--v-theme-primary));
  box-shadow: 0 2px 8px rgba(0, 133, 148, 0.3);
}

.flight-strip.dragging {
  opacity: 0.5;
}

.strip-edge {
  background: rgba(var(--v-theme-primary), 0.1);
  cursor: pointer;
  transition: background 0.2s ease;
  border-right: 1px solid #3a3e42;
}

.strip-edge:hover {
  background: rgba(var(--v-theme-primary), 0.3);
}

.strip-content {
  padding: 6px 8px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 0.85rem;
}

.strip-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.callsign {
  color: #00e5ff;
  font-weight: 600;
  font-size: 0.95rem;
  letter-spacing: 0.5px;
}

.aircraft-type {
  color: #bbb;
  font-size: 0.8rem;
}

.strip-route {
  display: flex;
  gap: 6px;
  align-items: center;
  color: #ddd;
  font-size: 0.8rem;
}

.airport {
  font-weight: 500;
  letter-spacing: 0.5px;
}

.arrow {
  color: #888;
}

.strip-details {
  display: flex;
  gap: 8px;
  color: #aaa;
  font-size: 0.75rem;
}

.detail {
  padding: 1px 4px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 2px;
}

.squawk {
  color: #ffa726;
  font-weight: 500;
}

.strip-times {
  display: flex;
  gap: 8px;
  font-size: 0.75rem;
}

.time {
  color: #ffa726;
  font-weight: 500;
}

.strip-route-detail {
  color: #999;
  font-size: 0.7rem;
  font-family: 'Roboto Mono', monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>

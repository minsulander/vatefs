<template>
  <div class="efs-bay-container" @click="onContainerClick">
    <EfsTopBar />
    <div class="efs-bay-content">
      <div
        class="bay-row"
        :class="{
          'bay-row--multi': store.multiAirport,
          'bay-row--choosing': store.pendingIdleSwap != null,
        }"
      >
        <div
          v-for="(bay, index) in bays"
          :key="bay.id"
          class="bay-column"
          :class="{
            'bay-column--multi': store.multiAirport,
            'bay-column--empty': store.multiAirport && !store.columnAirports[index],
            'bay-column--swap-target': store.pendingIdleSwap != null,
            'bay-column--flash': store.flashingColumnIndex === index,
          }"
          :style="store.multiAirport ? { '--bay-accent': columnAccent(index) } : undefined"
          @click="onColumnClick(index, $event)"
        >
          <div
            v-if="store.pendingIdleSwap"
            class="swap-overlay"
          >
            <span class="swap-overlay-label">{{ store.pendingIdleSwap }}</span>
            <span class="swap-overlay-hint">click to place</span>
          </div>
          <EfsBay :bay="bay" :column-index="index" />
        </div>
      </div>
    </div>
    <EfsBottomBar />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useEfsStore } from '@/store/efs'
import EfsBay from './EfsBay.vue'
import EfsTopBar from './EfsTopBar.vue'
import EfsBottomBar from './EfsBottomBar.vue'

const store = useEfsStore()
const bays = computed(() => store.getBays)

function columnAccent(index: number): string {
  return store.columnAirports[index] ? store.columnColor(index) : '#616161'
}

function onColumnClick(columnIndex: number, event: MouseEvent) {
  if (!store.pendingIdleSwap) return
  event.stopPropagation()
  store.applyPendingIdleToColumn(columnIndex)
}

function onContainerClick() {
  if (store.pendingIdleSwap) store.clearPendingIdleSwap()
}
</script>

<style scoped>
.efs-bay-container {
  height: 100vh;
  overflow: hidden;
  background: #080a0c;
  display: flex;
  flex-direction: column;
}

.efs-bay-content {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.bay-row {
  display: flex;
  flex: 1;
  min-height: 0;
  height: 100%;
}

.bay-row--multi {
  gap: 0;
  padding: 0;
  box-sizing: border-box;
}

.bay-column {
  flex: 1 1 0;
  min-width: 0;
  height: 100%;
  overflow: hidden;
  box-sizing: border-box;
  position: relative;
}

/* Full coloured frame around each column — multi-airport only */
.bay-column--multi {
  border: 2px solid var(--bay-accent, #444);
  border-top-width: 5px;
  border-radius: 0;
  background: #080a0c;
}

.bay-column--empty {
  background: #121417;
}

.bay-row--choosing .bay-column--swap-target {
  cursor: pointer;
  box-shadow: inset 0 0 0 2px rgba(144, 202, 249, 0.55);
  animation: swap-pulse 1.4s ease-in-out infinite;
}

.bay-row--choosing .bay-column--swap-target:hover {
  animation: none;
  box-shadow:
    inset 0 0 0 3px #90caf9,
    0 0 18px rgba(144, 202, 249, 0.35);
  background: rgba(144, 202, 249, 0.08);
  z-index: 2;
}

.bay-column--flash {
  z-index: 3;
  animation: column-flash 0.4s ease-in-out 3;
}

.swap-overlay {
  pointer-events: none;
  position: absolute;
  inset: 0;
  z-index: 5;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  background: rgba(8, 10, 12, 0.35);
  opacity: 0;
  transition: opacity 0.12s ease;
}

.bay-column--swap-target:hover .swap-overlay {
  opacity: 1;
  background: rgba(25, 60, 95, 0.45);
}

.swap-overlay-label {
  color: #fff;
  font-size: 28px;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.6);
}

.swap-overlay-hint {
  color: #90caf9;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

@keyframes swap-pulse {
  0%, 100% {
    box-shadow: inset 0 0 0 2px rgba(144, 202, 249, 0.35);
  }
  50% {
    box-shadow: inset 0 0 0 2px rgba(144, 202, 249, 0.85);
  }
}

@keyframes column-flash {
  0%, 100% {
    box-shadow: inset 0 0 0 2px transparent;
    filter: brightness(1);
  }
  50% {
    box-shadow:
      inset 0 0 0 3px #fff,
      0 0 22px color-mix(in srgb, var(--bay-accent) 70%, white);
    filter: brightness(1.35);
  }
}
</style>

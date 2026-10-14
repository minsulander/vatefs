<template>
  <div
    class="efs-bay-container"
    :class="{ 'efs-bay-container--paper': store.isPaperLook }"
    @click="onContainerClick"
  >
    <EfsTopBar />
    <div
      ref="scrollEl"
      class="efs-bay-content"
      :class="{ 'efs-bay-content--table-scroll': tableScroll }"
    >
      <div
        class="bay-row"
        :class="{
          'bay-row--multi': store.multiAirport,
          'bay-row--choosing': store.pendingIdleSwap != null,
          'bay-row--paper': store.isPaperLook,
          'bay-row--table-scroll': tableScroll,
        }"
        :style="tableScroll ? { '--efs-bay-col-width': colWidthPx } : undefined"
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
            'bay-column--paper': store.isPaperLook,
            'bay-column--table-fixed': tableScroll,
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
    <div
      v-if="store.notifyVisible"
      class="efs-notify"
      :class="store.notifyLevel === 'error' ? 'efs-notify--error' : 'efs-notify--info'"
      @click="store.dismissNotify()"
    >{{ store.notifyText }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useEfsStore } from '@/store/efs'
import EfsBay from './EfsBay.vue'
import EfsTopBar from './EfsTopBar.vue'
import EfsBottomBar from './EfsBottomBar.vue'

const store = useEfsStore()
const bays = computed(() => store.getBays)
const scrollEl = ref<HTMLElement | null>(null)
const colWidthPx = ref('25%')

const visibleCols = computed(() => {
  const n = store.esggVisibleColumns
  return n >= 2 && n <= 5 ? n : 4
})

/**
 * Physical strip table: column width = window / visibleCols (2–5);
 * scrollbar pans when more bays exist (layout/roles unchanged).
 */
const tableScroll = computed(() => store.isPaperLook && store.esggRolesMode)

/**
 * Covering GND on a 5-col board (GND/CD staffed with TWR): pan so INBOUND
 * is one column off-screen. Solo TWR covering GND stays 4-col — no pan.
 */
const panHideInbound = computed(() => {
  if (!tableScroll.value) return false
  const covering = store.esggRoles ?? []
  if (!covering.includes('GND')) return false
  if (bays.value.length < 5) return false
  return bays.value.some((b) => b.sections.some((s) => s.id === 'inbound'))
})

function measureColWidth() {
  const el = scrollEl.value
  if (!el || !tableScroll.value) {
    colWidthPx.value = `${100 / visibleCols.value}%`
    return
  }
  const w = el.clientWidth
  if (w <= 0) return
  colWidthPx.value = `${Math.floor(w / visibleCols.value)}px`
}

let applyingDefaultScroll = false

function applyDefaultScroll() {
  measureColWidth()
  const el = scrollEl.value
  if (!el || !tableScroll.value) return
  const colW = el.clientWidth / visibleCols.value
  // GND working the right side of the table: hide INBOUND, keep scroll available
  applyingDefaultScroll = true
  el.scrollLeft = panHideInbound.value ? Math.round(colW) : 0
  requestAnimationFrame(() => {
    applyingDefaultScroll = false
  })
}

let ro: ResizeObserver | null = null
let userScrolled = false

function onScroll() {
  if (applyingDefaultScroll) return
  userScrolled = true
}

onMounted(() => {
  applyDefaultScroll()
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => {
      measureColWidth()
      // Keep GND pan after resize unless the user already scrolled
      if (!userScrolled && panHideInbound.value) applyDefaultScroll()
    })
    if (scrollEl.value) ro.observe(scrollEl.value)
  }
  window.addEventListener('resize', measureColWidth)
  scrollEl.value?.addEventListener('scroll', onScroll, { passive: true })
})

onBeforeUnmount(() => {
  ro?.disconnect()
  window.removeEventListener('resize', measureColWidth)
  scrollEl.value?.removeEventListener('scroll', onScroll)
})

watch(
  [tableScroll, bays, panHideInbound, visibleCols, () => store.esggRoles.join(',')],
  () => {
    userScrolled = false
    requestAnimationFrame(applyDefaultScroll)
  },
)

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
  position: relative;
  height: 100vh;
  overflow: hidden;
  background: var(--efs-bay-bg, #3b3c41);
  display: flex;
  flex-direction: column;
}

.efs-bay-container--paper {
  /* Desk floor palette — mixed via soft gradients on each bay */
  --efs-paper-bay-light: #c7a778;
  --efs-paper-bay-mid-light: #ad926b;
  --efs-paper-bay-mid: #89653b;
  --efs-paper-bay-dark: #513a26;
  --efs-paper-bay-floor: var(--efs-paper-bay-mid);
  --efs-paper-panel: #2c241c;
  background: var(--efs-paper-panel);
}

.efs-bay-content {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

/* Physical table: 4 bay-widths visible; scrollbar along the bottom for bay5 */
.efs-bay-content--table-scroll {
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-gutter: stable;
  scrollbar-width: thin;
  scrollbar-color: rgba(201, 166, 107, 0.55) rgba(0, 0, 0, 0.25);
}

.efs-bay-content--table-scroll::-webkit-scrollbar {
  height: 10px;
}

.efs-bay-content--table-scroll::-webkit-scrollbar-track {
  background: rgba(0, 0, 0, 0.28);
}

.efs-bay-content--table-scroll::-webkit-scrollbar-thumb {
  background: rgba(201, 166, 107, 0.55);
  border-radius: 5px;
}

.efs-bay-content--table-scroll::-webkit-scrollbar-thumb:hover {
  background: rgba(201, 166, 107, 0.75);
}

.bay-row {
  display: flex;
  flex: 1;
  min-height: 0;
  height: 100%;
}

.bay-row--table-scroll {
  flex: 0 0 100%;
  height: 100%;
  width: max-content;
  min-width: 100%;
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

.bay-column--table-fixed {
  flex: 0 0 var(--efs-bay-col-width, 25%);
  width: var(--efs-bay-col-width, 25%);
  min-width: var(--efs-bay-col-width, 25%);
  max-width: var(--efs-bay-col-width, 25%);
}

/* Paper: keep flush columns (no visible inter-bay gap); pipes live inside each bay */
.bay-row--paper {
  gap: 0;
  padding: 0;
}

.bay-column--paper {
  background: transparent;
}

/* Full coloured frame around each column — multi-airport only */
.bay-column--multi {
  border: 2px solid var(--bay-accent, #444);
  border-top-width: 5px;
  border-radius: 0;
  /* Uses dimmable --efs-bay-bg from bay brightness slider */
  background: var(--efs-bay-bg, #3b3c41);
}

.bay-column--empty {
  background: color-mix(in srgb, var(--efs-bay-bg, #3b3c41) 65%, black);
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
  gap: calc(4px * var(--efs-scale, 1));
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
  font-size: calc(28px * var(--efs-scale, 1));
  font-weight: 800;
  letter-spacing: 0.1em;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.6);
}

.swap-overlay-hint {
  color: #90caf9;
  font-size: calc(12px * var(--efs-scale, 1));
  font-weight: 600;
  letter-spacing: 0.04em;
}

@keyframes swap-pulse {
  0%,
  100% {
    box-shadow: inset 0 0 0 2px rgba(144, 202, 249, 0.35);
  }
  50% {
    box-shadow: inset 0 0 0 2px rgba(144, 202, 249, 0.7);
  }
}

@keyframes column-flash {
  0%,
  100% {
    filter: brightness(1);
  }
  50% {
    filter: brightness(1.25);
  }
}

.efs-notify {
  position: absolute;
  left: 50%;
  bottom: calc(56px * var(--efs-scale, 1));
  transform: translateX(-50%);
  z-index: 40;
  max-width: min(90vw, 520px);
  padding: calc(10px * var(--efs-scale, 1)) calc(16px * var(--efs-scale, 1));
  border-radius: 4px;
  font-size: calc(14px * var(--efs-scale, 1));
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.45);
}

.efs-notify--info {
  background: #1565c0;
  color: #fff;
}

.efs-notify--error {
  background: #c62828;
  color: #fff;
}
</style>

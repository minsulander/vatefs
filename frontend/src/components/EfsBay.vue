<template>
  <div
    ref="bayEl"
    class="efs-bay"
    :class="{ 'efs-bay--empty': store.multiAirport && isEmpty }"
    :data-bay-id="bay.id"
  >
    <div
      v-if="store.multiAirport"
      ref="bayHeader"
      class="bay-header"
      :class="{ 'bay-header--empty': isEmpty }"
      :style="{ background: accent }"
    >
      <button
        ref="pickerBtn"
        type="button"
        class="airport-picker-btn"
        :class="{ 'airport-picker-btn--empty': isEmpty, 'airport-picker-btn--open': pickerOpen }"
        @click="onPickerClick"
      >
        <span class="airport-picker-icao">{{ selectedAirport ?? '—' }}</span>
        <v-icon size="10" class="airport-picker-menu-icon">mdi-menu-down</v-icon>
      </button>

      <Teleport to="body">
        <div
          v-if="pickerOpen"
          ref="pickerPanel"
          class="airport-picker-panel"
          :style="pickerStyle"
          @click.stop
        >
          <div class="airport-picker-search">
            <v-icon size="14" class="search-icon">mdi-magnify</v-icon>
            <input
              ref="searchInput"
              v-model="searchQuery"
              class="search-input"
              type="text"
              placeholder="Enter ICAO…"
              maxlength="4"
              autocomplete="off"
              spellcheck="false"
              @keydown.enter.prevent="onSearchEnter"
              @keydown.esc.stop="closePicker"
            />
            <button
              v-if="selectedAirport"
              type="button"
              class="clear-btn"
              title="Clear column"
              @click="selectAirport(null)"
            >
              Clear
            </button>
          </div>

          <div class="airport-picker-list">
            <button
              v-for="opt in filteredOptions"
              :key="opt.icao"
              type="button"
              class="airport-picker-item"
              :class="{
                'airport-picker-item--active': opt.icao === selectedAirport,
                'airport-picker-item--taken': opt.taken,
                'airport-picker-item--busy': opt.isActive && opt.total > 0,
                'airport-picker-item--inactive': !opt.isActive,
              }"
              @click="selectAirport(opt.icao)"
            >
              <span class="item-icao">{{ opt.icao }}</span>
              <span class="item-meta">
                <span v-if="opt.name" class="item-name">{{ opt.name }}</span>
                <span v-if="opt.country" class="item-country">{{ opt.country }}</span>
              </span>
              <span class="item-traffic">
                <span v-if="opt.dep" class="traffic-dep">↑{{ opt.dep }}</span>
                <span v-if="opt.arr" class="traffic-arr">↓{{ opt.arr }}</span>
              </span>
              <span v-if="opt.taken" class="item-taken">swap</span>
              <v-icon
                v-else-if="opt.icao === selectedAirport"
                size="14"
                class="item-check"
              >mdi-check</v-icon>
            </button>
            <div v-if="filteredOptions.length === 0" class="airport-picker-empty">
              No airports match
            </div>
          </div>
        </div>
      </Teleport>
    </div>
    <EfsSection
      v-for="(section, index) in bay.sections"
      :key="section.id"
      :section="section"
      :bay-id="bay.id"
      :is-first-section="index === 0"
      :is-last-section="index === bay.sections.length - 1"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, nextTick, computed, watch } from 'vue'
import type { Bay } from '@/types/efs'
import { useEfsStore } from '@/store/efs'
import EfsSection from './EfsSection.vue'

const props = defineProps<{
  bay: Bay
  columnIndex?: number
}>()

const BAY_REF_WIDTH_PX = 400
const BAY_SCALE_MIN = 0.55
const BAY_SCALE_MAX = 2.2

const store = useEfsStore()
const bayEl = ref<HTMLElement | null>(null)
const bayHeader = ref<HTMLElement | null>(null)
let bayResizeObs: ResizeObserver | null = null
let bayScaleRaf = 0

function updateBayScale() {
  const el = bayEl.value
  if (!el) return
  const w = el.clientWidth
  if (w <= 0) return
  const s = Math.max(BAY_SCALE_MIN, Math.min(BAY_SCALE_MAX, w / BAY_REF_WIDTH_PX))
  el.style.setProperty('--bay-scale', String(s))
}

function scheduleBayScale() {
  if (bayScaleRaf) cancelAnimationFrame(bayScaleRaf)
  bayScaleRaf = requestAnimationFrame(() => {
    bayScaleRaf = 0
    updateBayScale()
  })
}
const pickerOpen = ref(false)
const searchQuery = ref('')
const searchInput = ref<HTMLInputElement | null>(null)
const pickerBtn = ref<HTMLButtonElement | null>(null)
const pickerPanel = ref<HTMLElement | null>(null)
const pickerStyle = ref<Record<string, string>>({})

const columnIndex = computed(() => props.columnIndex ?? 0)
const selectedAirport = computed(() =>
  store.columnAirports[columnIndex.value] ?? props.bay.airport ?? props.bay.title ?? null
)
const isEmpty = computed(() => !selectedAirport.value)
const accent = computed(() =>
  isEmpty.value ? '#757575' : store.columnColor(columnIndex.value)
)

const pickerOptions = computed(() => {
  const opts = new Set<string>([
    ...store.airportOptions.map((a) => a.icao),
    ...store.activeAirports,
    ...store.columnAirports.filter((a): a is string => !!a),
  ])
  return [...opts]
    .map(icao => {
      const meta = store.airportMeta(icao)
      const isActive = store.isAirportRelevant(icao)
      const counts = isActive ? store.airportTrafficCounts(icao) : { arr: 0, dep: 0 }
      const { arr, dep } = counts
      const total = arr + dep
      const taken = isTakenElsewhere(icao)
      // Relevant/ES first; traffic only affects sort among relevant airports
      const priority = (isActive ? 0 : 2) + (isActive && total > 0 ? 0 : 1)
      return {
        icao,
        name: meta?.name,
        country: meta?.country,
        arr,
        dep,
        total,
        isActive,
        taken,
        priority,
      }
    })
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority
      if (b.total !== a.total) return b.total - a.total
      if (b.dep !== a.dep) return b.dep - a.dep
      if (b.arr !== a.arr) return b.arr - a.arr
      return a.icao.localeCompare(b.icao)
    })
})

const filteredOptions = computed(() => {
  const q = searchQuery.value.trim().toUpperCase()
  if (!q) return pickerOptions.value
  return pickerOptions.value.filter((o) =>
    o.icao.includes(q) ||
    (o.name?.toUpperCase().includes(q) ?? false) ||
    (o.country?.toUpperCase().includes(q) ?? false)
  )
})

function isTakenElsewhere(icao: string): boolean {
  return store.columnAirports.some((a, i) => a === icao && i !== columnIndex.value)
}

function selectAirport(airport: string | null) {
  if (airport && !store.activeAirports.includes(airport)) {
    store.addActiveAirport(airport)
  }
  store.assignAirportToColumn(columnIndex.value, airport)
  store.clearPendingIdleSwap()
  closePicker()
}

function onPickerClick(event: MouseEvent) {
  // During idle→column placement, let the click bubble to the column
  if (store.pendingIdleSwap) return
  event.stopPropagation()
  pickerOpen.value = !pickerOpen.value
}

function onSearchEnter() {
  const q = searchQuery.value.trim().toUpperCase()
  if (!/^[A-Z]{4}$/.test(q)) return
  const exact = filteredOptions.value.find(o => o.icao === q)
  const first = filteredOptions.value[0]
  const pick = exact?.icao ?? (first && first.icao.startsWith(q) ? first.icao : q)
  selectAirport(pick)
}

function closePicker() {
  pickerOpen.value = false
  searchQuery.value = ''
}

function updatePickerPosition() {
  const header = bayHeader.value
  if (!header) return
  const rect = header.getBoundingClientRect()
  pickerStyle.value = {
    position: 'fixed',
    top: `${Math.round(rect.bottom + 4)}px`,
    left: `${Math.round(rect.left + rect.width / 2)}px`,
    transform: 'translateX(-50%)',
    zIndex: '2000',
  }
}

function focusSearchField() {
  const el = searchInput.value
  if (!el) return
  el.focus({ preventScroll: true })
  el.select()
}

/** Capture-phase: strip clicks use stopPropagation and block bubble-phase outside-close. */
function onOutsidePointerDown(event: PointerEvent) {
  if (!pickerOpen.value) return
  const target = event.target as Node | null
  if (!target) return
  if (pickerBtn.value?.contains(target)) return
  if (pickerPanel.value?.contains(target)) return
  closePicker()
}

function bindPickerListeners() {
  document.addEventListener('pointerdown', onOutsidePointerDown, true)
  window.addEventListener('resize', updatePickerPosition)
  window.addEventListener('scroll', updatePickerPosition, true)
}

function unbindPickerListeners() {
  document.removeEventListener('pointerdown', onOutsidePointerDown, true)
  window.removeEventListener('resize', updatePickerPosition)
  window.removeEventListener('scroll', updatePickerPosition, true)
}

watch(pickerOpen, (open) => {
  if (!open) {
    searchQuery.value = ''
    unbindPickerListeners()
    return
  }
  bindPickerListeners()
  nextTick(() => {
    updatePickerPosition()
    focusSearchField()
    requestAnimationFrame(() => {
      updatePickerPosition()
      focusSearchField()
    })
    setTimeout(focusSearchField, 50)
  })
})

onBeforeUnmount(() => {
  unbindPickerListeners()
  bayResizeObs?.disconnect()
  bayResizeObs = null
  if (bayScaleRaf) cancelAnimationFrame(bayScaleRaf)
})

// After first render, lock all non-last sections to their actual pixel heights
// so they don't shift when strip content changes.
onMounted(() => {
  updateBayScale()
  if (bayEl.value && typeof ResizeObserver !== 'undefined') {
    bayResizeObs = new ResizeObserver(() => scheduleBayScale())
    bayResizeObs.observe(bayEl.value)
  }

  nextTick(() => {
    if (!bayEl.value) return
    const sections = props.bay.sections
    const sectionEls = bayEl.value.querySelectorAll('.efs-section')
    for (let i = 0; i < sections.length - 1; i++) {
      const section = sections[i]
      const el = sectionEls[i]
      if (section && !section.height && el) {
        const height = el.getBoundingClientRect().height
        store.setSectionHeight(props.bay.id, section.id, height, false)
      }
    }
  })
})
</script>

<style scoped>
.efs-bay {
  --bay-scale: 1;
  display: flex;
  flex-direction: column;
  height: 100%;
}

.efs-bay--empty {
  opacity: 0.55;
}

.bay-header {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 calc(4px * var(--bay-scale));
  flex-shrink: 0;
  min-height: 0;
  /* Floor with --efs-scale so large UI % stays usable on narrow columns */
  height: max(calc(18px * var(--bay-scale)), calc(20px * var(--efs-scale, 1)));
}

.airport-picker-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: calc(2px * var(--bay-scale));
  min-width: 0;
  background: transparent;
  color: #fff;
  border: none;
  border-radius: 0;
  font-family: inherit;
  padding: 0;
  cursor: pointer;
  text-align: center;
}

.airport-picker-btn--empty {
  color: rgba(255, 255, 255, 0.55);
}

.airport-picker-btn--open .airport-picker-menu-icon {
  opacity: 0.9;
}

.airport-picker-icao {
  font-size: max(calc(13px * var(--bay-scale)), calc(14px * var(--efs-scale, 1)));
  font-weight: 700;
  letter-spacing: 0.06em;
  line-height: 1;
}

.airport-picker-menu-icon {
  opacity: 0.55;
  flex-shrink: 0;
  margin: 0;
  width: max(calc(12px * var(--bay-scale)), calc(12px * var(--efs-scale, 1))) !important;
  height: max(calc(12px * var(--bay-scale)), calc(12px * var(--efs-scale, 1))) !important;
  font-size: max(calc(12px * var(--bay-scale)), calc(12px * var(--efs-scale, 1))) !important;
}

.traffic-dep {
  color: #4dd0e1;
  font-size: calc(12px * var(--efs-scale, 1));
  font-weight: 700;
}

.traffic-arr {
  color: #ffb74d;
  font-size: calc(12px * var(--efs-scale, 1));
  font-weight: 700;
}

.airport-picker-panel {
  background: #1e2126;
  border: 1px solid #3a3f46;
  border-radius: calc(4px * var(--efs-scale, 1));
  width: min(calc(340px * var(--efs-scale, 1)), calc(100vw - 16px));
  max-height: calc(360px * var(--efs-scale, 1));
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.airport-picker-search {
  display: flex;
  align-items: center;
  gap: calc(6px * var(--efs-scale, 1));
  padding: calc(6px * var(--efs-scale, 1)) calc(8px * var(--efs-scale, 1));
  border-bottom: 1px solid #2f343b;
  background: #25292f;
}

.search-icon {
  color: #888;
  flex-shrink: 0;
}

.search-input {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: none;
  outline: none;
  color: #eee;
  font-size: calc(13px * var(--efs-scale, 1));
  font-family: inherit;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.search-input::placeholder {
  color: #666;
  text-transform: none;
  letter-spacing: normal;
}

.clear-btn {
  flex-shrink: 0;
  background: transparent;
  border: 1px solid #555;
  color: #bbb;
  border-radius: 2px;
  font-size: calc(11px * var(--efs-scale, 1));
  padding: calc(1px * var(--efs-scale, 1)) calc(6px * var(--efs-scale, 1));
  cursor: pointer;
  font-family: inherit;
}

.clear-btn:hover {
  color: #fff;
  border-color: #888;
}

.airport-picker-list {
  max-height: calc(280px * var(--efs-scale, 1));
  overflow-y: auto;
  padding: calc(4px * var(--efs-scale, 1)) 0;
}

.airport-picker-item {
  display: flex;
  align-items: center;
  gap: calc(8px * var(--efs-scale, 1));
  width: 100%;
  padding: calc(5px * var(--efs-scale, 1)) calc(10px * var(--efs-scale, 1));
  background: transparent;
  border: none;
  color: #ddd;
  font-family: inherit;
  font-size: calc(13px * var(--efs-scale, 1));
  cursor: pointer;
  text-align: left;
}

.airport-picker-item:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.08);
}

.airport-picker-item--active {
  background: rgba(144, 202, 249, 0.15);
}

.airport-picker-item--busy .item-icao {
  color: #fff;
  font-weight: 700;
}

.airport-picker-item--inactive {
  opacity: 0.45;
}

.airport-picker-item--inactive:hover {
  opacity: 0.75;
}

.airport-picker-item--taken {
  opacity: 0.85;
}

.airport-picker-item--taken:hover {
  background: rgba(255, 183, 77, 0.12);
}

.item-icao {
  font-weight: 600;
  letter-spacing: 0.05em;
  min-width: calc(42px * var(--efs-scale, 1));
  flex-shrink: 0;
}

.item-meta {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  flex: 1;
}

.item-name {
  font-size: calc(12px * var(--efs-scale, 1));
  color: #bbb;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.item-country {
  font-size: calc(11px * var(--efs-scale, 1));
  color: #888;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.item-traffic {
  display: flex;
  gap: calc(6px * var(--efs-scale, 1));
  flex-shrink: 0;
  margin-left: auto;
}

.item-taken {
  margin-left: auto;
  font-size: calc(11px * var(--efs-scale, 1));
  color: #ffb74d;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.item-check {
  margin-left: auto;
  color: #90caf9;
}

.airport-picker-empty {
  padding: calc(12px * var(--efs-scale, 1));
  text-align: center;
  color: #777;
  font-size: calc(12px * var(--efs-scale, 1));
}
</style>

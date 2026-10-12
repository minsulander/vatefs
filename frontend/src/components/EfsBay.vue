<template>
  <div
    ref="bayEl"
    class="efs-bay"
    :class="{
      'efs-bay--empty': store.multiAirport && isEmpty,
      'efs-bay--paper': store.isPaperLook,
    }"
    :data-bay-id="bay.id"
  >
    <!-- ESGG paper board: dark edge panels + one pipe each side (same layer, under strips) -->
    <template v-if="store.isPaperLook">
      <div class="bay-edge bay-edge--left" aria-hidden="true" />
      <div class="bay-edge bay-edge--right" aria-hidden="true" />
      <div class="bay-rail bay-rail--left" aria-hidden="true">
        <span class="bay-pipe" />
      </div>
      <div class="bay-rail bay-rail--right" aria-hidden="true">
        <span class="bay-pipe" />
      </div>
    </template>

    <div class="bay-body">
      <div
        v-if="store.multiAirport"
        ref="bayHeader"
        class="bay-header"
        :class="{
          'bay-header--empty': isEmpty,
          'bay-header--warm-accent': warmAccentHeader,
        }"
        :style="{ background: accent }"
      >
        <button
          ref="pickerBtn"
          type="button"
          class="airport-picker-btn"
          :class="{ 'airport-picker-btn--empty': isEmpty, 'airport-picker-btn--open': pickerOpen }"
          @click="onPickerClick"
        >
          <span class="airport-picker-icao">{{ selectedAirport ?? '-' }}</span>
          <v-icon size="10" class="airport-picker-menu-icon">mdi-menu-down</v-icon>
        </button>
        <div v-if="!isEmpty && (headerAtis || headerQnh)" class="bay-header-meta">
          <span
            v-if="headerAtis"
            class="bay-header-atis"
            :class="{ 'bay-header-atis--flash': atisLetterFlash }"
            :title="`ATIS ${headerAtis}`"
          >{{ headerAtis }}</span>
          <button
            v-if="headerQnh"
            type="button"
            class="bay-header-qnh"
            :class="{ 'bay-header-qnh--changed': headerQnhChanged }"
            :title="headerQnhChanged ? `QNH ${headerQnh} - click to acknowledge` : `QNH ${headerQnh}`"
            @click.stop="onHeaderQnhClick"
          >{{ headerQnh }}</button>
        </div>

        <Teleport to="body">
          <div
            v-if="pickerOpen"
            ref="pickerPanel"
            class="efs-popup-menu airport-picker-panel"
            :style="pickerStyle"
            @click.stop
          >
            <div class="efs-popup-header">Airport</div>
            <div class="efs-popup-search">
              <input
                ref="searchInput"
                v-model="searchQuery"
                class="efs-popup-search-input"
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
                class="efs-popup-chip"
                title="Clear column"
                @click="selectAirport(null)"
              >Clear</button>
            </div>

            <div class="efs-popup-list airport-picker-list">
              <button
                v-for="opt in filteredOptions"
                :key="opt.icao"
                type="button"
                class="efs-popup-item efs-popup-item--start"
                :class="{
                  selected: opt.icao === selectedAirport,
                  'efs-popup-muted': !opt.isActive,
                }"
                @click="selectAirport(opt.icao)"
              >
                <span class="item-icao">{{ opt.icao }}</span>
                <span class="item-right">
                  <span v-if="opt.taken" class="item-taken">swap</span>
                  <span class="item-traffic">
                    <span v-if="opt.arr" class="traffic-arr">↓{{ opt.arr }}</span>
                    <span v-if="opt.dep" class="traffic-dep">↑{{ opt.dep }}</span>
                  </span>
                </span>
              </button>
              <div v-if="filteredOptions.length === 0" class="efs-popup-meta">
                No airports match
              </div>
            </div>
          </div>
        </Teleport>
      </div>
      <!-- Empty column: no section chrome — click body to pick an airport -->
      <button
        v-if="store.multiAirport && isEmpty"
        type="button"
        class="efs-bay-empty-body"
        title="Select airport"
        @click="onEmptyBodyClick"
      >
        <span class="efs-bay-empty-hint">Select airport</span>
      </button>
      <template v-else>
        <EfsSection
          v-for="(section, index) in bay.sections"
          :key="section.id"
          :section="section"
          :bay-id="bay.id"
          :is-first-section="index === 0"
          :is-last-section="index === bay.sections.length - 1"
        />
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, nextTick, computed, watch } from 'vue'
import type { Bay } from '@/types/efs'
import { useEfsStore } from '@/store/efs'
import { buildRtcAirportList } from '@/composables/rtcAirportList'
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
/** Orange (col 2) / red (col 4) — amber QNH-changed washes out; use lime instead */
const warmAccentHeader = computed(
  () => !isEmpty.value && (columnIndex.value === 1 || columnIndex.value === 3),
)

const airportAtis = computed(() => {
  const icao = selectedAirport.value
  if (!icao) return null
  return store.atisInfo.find((a) => a.airport === icao) ?? null
})

const headerQnh = computed(() => {
  const q = airportAtis.value?.qnh
  return q != null && q > 0 ? String(q) : null
})

/** ATIS letter(s) for this column airport — single, or ARR/DEP when split */
const headerAtis = computed(() => {
  const info = airportAtis.value
  if (!info) return null
  const single = (info.atis || '').trim().toUpperCase()
  if (single) return single
  const arr = (info.arrAtis || '').trim().toUpperCase()
  const dep = (info.depAtis || '').trim().toUpperCase()
  if (arr && dep) return arr === dep ? arr : `${arr}/${dep}`
  return arr || dep || null
})

const atisLetterFlash = computed(() => {
  const icao = selectedAirport.value
  return !!icao && store.isAtisLetterChanged(icao)
})

const headerQnhChanged = computed(() => {
  const icao = selectedAirport.value
  return !!icao && store.isQnhChanged(icao)
})

function onHeaderQnhClick() {
  const icao = selectedAirport.value
  if (!icao || !headerQnhChanged.value) return
  store.acknowledgeQnh(icao)
}

const pickerOptions = computed(() =>
  buildRtcAirportList({ excludeColumnIndex: columnIndex.value }),
)

const filteredOptions = computed(() => {
  const q = searchQuery.value.trim().toUpperCase()
  if (!q) return pickerOptions.value
  return pickerOptions.value.filter((o) => o.icao.includes(q))
})

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

function onEmptyBodyClick(event: MouseEvent) {
  if (store.pendingIdleSwap) return
  event.stopPropagation()
  pickerOpen.value = true
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
      // Headerless zones size to content — do not lock pixel height
      if (section && !section.height && !section.hideHeader && el) {
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
  background: var(--efs-bay-bg, #3b3c41);
}

.bay-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
}

.efs-bay--empty {
  opacity: 0.55;
}

.efs-bay-empty-body {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  color: rgba(255, 255, 255, 0.35);
  font: inherit;
}
.efs-bay-empty-body:hover {
  color: rgba(255, 255, 255, 0.55);
  background: rgba(255, 255, 255, 0.03);
}
.efs-bay-empty-hint {
  font-size: max(calc(12px * var(--bay-scale, 1)), calc(13px * var(--efs-scale, 1)));
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  user-select: none;
}

/* ——— ESGG paper FPS board ———
 * Layering (bottom → top): tan floor → (panels + pipes) → strips/headers.
 * Body is full-width + transparent so overflow:hidden strip lists don't clip
 * coloured strip edges behind the rails.
 */
.efs-bay--paper {
  --bay-pipe-w: max(20px, calc(25px * var(--bay-scale, 1)));
  /* Dark brown edge panels (between bays / outer edges); pipes sit just inside */
  --bay-panel-w: max(12px, calc(14px * var(--bay-scale, 1)));
  --bay-pipe-gap: max(4px, calc(5px * var(--bay-scale, 1)));
  --bay-pipe-inset: calc(var(--bay-panel-w) + var(--bay-pipe-gap));
  /* Vertical only: same gap between strips and above/below headers */
  --paper-strip-gap: max(2px, calc(2px * var(--bay-scale, 1)));
  position: relative;
  overflow: hidden;
  /* Soft desk shading: brighter center, darker borders */
  background-color: var(--efs-paper-bay-mid, #89653b);
  background-image:
    radial-gradient(
      ellipse 80% 75% at 50% 48%,
      var(--efs-paper-bay-light, #c7a778) 0%,
      var(--efs-paper-bay-mid-light, #ad926b) 42%,
      transparent 100%
    ),
    radial-gradient(
      ellipse 100% 100% at 50% 50%,
      transparent 48%,
      color-mix(in srgb, var(--efs-paper-bay-mid, #89653b) 55%, transparent) 75%,
      color-mix(in srgb, var(--efs-paper-bay-dark, #513a26) 55%, var(--efs-paper-bay-mid, #89653b)) 100%
    ),
    linear-gradient(
      180deg,
      var(--efs-paper-bay-mid-light, #ad926b) 0%,
      var(--efs-paper-bay-mid, #89653b) 55%,
      color-mix(in srgb, var(--efs-paper-bay-dark, #513a26) 40%, var(--efs-paper-bay-mid, #89653b)) 100%
    );
}

.efs-bay--paper .bay-body {
  position: relative;
  z-index: 2;
  background: transparent;
}

/* Same layer as pipes — flush columns → double panel width between bays */
.bay-edge {
  position: absolute;
  top: 0;
  bottom: 0;
  z-index: 1;
  width: var(--bay-panel-w);
  background: var(--efs-paper-panel, #2c241c);
  pointer-events: none;
}

.bay-edge--left {
  left: 0;
}

.bay-edge--right {
  right: 0;
}

/* Pipes above floor, below strips — inset past the edge panels */
.bay-rail {
  position: absolute;
  top: 0;
  bottom: 0;
  z-index: 1;
  width: var(--bay-pipe-w);
  display: flex;
  pointer-events: none;
}

.bay-rail--left {
  left: var(--bay-pipe-inset);
}

.bay-rail--right {
  right: var(--bay-pipe-inset);
}

.bay-pipe {
  display: block;
  width: 100%;
  height: 100%;
  /* No end rounding — full width top to bottom; cylinder from side gradient only */
  border-radius: 0;
  background: linear-gradient(
    90deg,
    #3a3a3a 0%,
    #111 30%,
    #000 50%,
    #1a1a1a 70%,
    #333 100%
  );
  box-shadow: inset 0 0 1px rgba(255, 255, 255, 0.1);
}

/* No section side borders — pipes replace the old hairlines */
.efs-bay--paper :deep(.efs-section) {
  border-left: none;
  border-right: none;
  border-bottom-color: rgba(0, 0, 0, 0.12);
}

.efs-bay--paper :deep(.section-content) {
  background: transparent;
}

/* SAAB 400×50 body ratio; bay-scale so notes/vehicles match flight strips + headers */
.efs-bay--paper :deep(.flight-strip) {
  --strip-body-h: calc(50px * var(--bay-scale, var(--strip-scale)));
}

/* Vertical spacing only — strip↔strip = strip↔header; sideways unchanged */
.efs-bay--paper :deep(.top-strips-container),
.efs-bay--paper :deep(.bottom-strips-container) {
  display: flex;
  flex-direction: column;
  padding: var(--paper-strip-gap) 2px;
  gap: var(--paper-strip-gap);
  box-sizing: border-box;
}
.efs-bay--paper :deep(.top-strips-container .flight-strip.look-paper),
.efs-bay--paper :deep(.top-strips-container .flight-strip.paper-info-holder),
.efs-bay--paper :deep(.bottom-strips-container .flight-strip.look-paper),
.efs-bay--paper :deep(.bottom-strips-container .flight-strip.paper-info-holder) {
  margin-top: 0;
  margin-bottom: 0;
}

.bay-header {
  position: relative;
  display: block;
  padding: 0 calc(4px * var(--bay-scale));
  flex-shrink: 0;
  min-height: 0;
  /* Floor with --efs-scale so large UI % stays usable on narrow columns */
  height: max(calc(18px * var(--bay-scale)), calc(20px * var(--efs-scale, 1)));
}

/* ICAO centred; QNH/ATIS overlay on the right */
.airport-picker-btn {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  z-index: 1;
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
/* Empty column: whole header is the pick control */
.bay-header--empty .airport-picker-btn {
  inset: 0;
  left: 0;
  top: 0;
  transform: none;
  width: 100%;
  height: 100%;
}

.bay-header-meta {
  position: absolute;
  right: calc(4px * var(--bay-scale));
  top: 0;
  bottom: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: calc(6px * var(--bay-scale));
  min-width: 0;
  max-width: 42%;
  color: #fff;
  font-weight: 700;
  letter-spacing: 0.04em;
  line-height: 1;
  user-select: none;
  pointer-events: none;
}
.bay-header-meta .bay-header-qnh {
  pointer-events: auto;
}

.bay-header-atis,
.bay-header-qnh {
  /* Match .section-hdr-rwy */
  font-size: max(calc(11px * var(--bay-scale, 1)), calc(12px * var(--efs-scale, 1)));
  font-weight: 800;
  letter-spacing: 0.06em;
  line-height: 1;
  opacity: 0.92;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.bay-header-atis {
  pointer-events: none;
  min-width: 0.9em;
  text-align: center;
}

.bay-header-qnh {
  margin: 0;
  padding: 0;
  border: none;
  background: transparent;
  color: inherit;
  font-family: inherit;
  cursor: default;
  appearance: none;
  -webkit-appearance: none;
}

.bay-header-qnh--changed {
  color: #f59e0b;
  opacity: 1;
  cursor: pointer;
}

/* Warm accents (orange/red): amber blends into header — bright lime, not white */
.bay-header--warm-accent .bay-header-qnh--changed {
  color: #c8f542;
}

.bay-header-atis--flash {
  animation: bay-atis-flash 0.55s ease-in-out 3;
}

@keyframes bay-atis-flash {
  0%,
  100% {
    opacity: 0.92;
    color: #fff;
  }
  50% {
    opacity: 1;
    color: #ffe082;
  }
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

.airport-picker-panel {
  width: min(calc(168px * var(--efs-scale, 1)), calc(100vw - 16px));
  min-width: calc(148px * var(--efs-scale, 1));
  max-height: calc(360px * var(--efs-scale, 1));
  display: flex;
  flex-direction: column;
}

.airport-picker-list {
  max-height: calc(280px * var(--efs-scale, 1));
}

.item-icao {
  font-weight: 800;
  letter-spacing: 0.05em;
  min-width: calc(42px * var(--efs-scale, 1));
  flex-shrink: 0;
}

.item-right {
  display: flex;
  align-items: center;
  gap: calc(6px * var(--efs-scale, 1));
  margin-left: auto;
  flex-shrink: 0;
}

.item-traffic {
  display: flex;
  gap: calc(5px * var(--efs-scale, 1));
  flex-shrink: 0;
  font-weight: 800;
  min-width: calc(36px * var(--efs-scale, 1));
  justify-content: flex-end;
}

.item-taken {
  font-size: calc(10px * var(--efs-scale, 1));
  font-weight: 800;
  letter-spacing: 0.06em;
}

.traffic-dep,
.traffic-arr {
  color: inherit;
  font-size: calc(11px * var(--efs-scale, 1));
  font-weight: 800;
}
</style>

<template>
  <div
    ref="bayEl"
    class="efs-bay"
    :class="{
      'efs-bay--empty': store.multiAirport && isEmpty,
      'efs-bay--paper': store.isPaperLook,
      'efs-bay--workspace': workspaceMode,
      'efs-bay--ws-section-drag': workspaceMode && !!ws.draggingSectionId.value,
    }"
    :data-bay-id="bay.id"
    :data-ws-column="columnIndex"
    @dragover="onWorkspaceBayDragOver"
    @drop="onWorkspaceBayDrop"
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
        <!-- Left: trash (global trash lives on top bar only when not RTC) -->
        <button
          type="button"
          class="bay-trash-btn top-menu-btn efs-trash-drop"
          :class="{ 'drag-over': trashDragOver }"
          title="Trash — open recover · drop strip to delete"
          @click="trashOpen = true"
          @dragover.prevent="onTrashDragOver"
          @dragenter.prevent="onTrashDragEnter"
          @dragleave="onTrashDragLeave"
          @drop.prevent="onTrashDrop"
        >
          <span class="bay-menu-tri" aria-hidden="true" />
        </button>
        <TrashDialog v-model="trashOpen" />

        <!-- Local TWR/AFIS when AFV RX-selected (never ES Primfreq / RTC common) — left of ICAO -->
        <span
          v-if="!isEmpty && headerRxFreq"
          class="bay-header-rx"
          :title="headerRxFreqTitle"
        >{{ headerRxFreqDisplay }}</span>

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
        <div
          v-if="!isEmpty && (headerAtis || headerQnh)"
          class="bay-header-meta"
        >
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
            :title="headerQnhTitle"
            @pointerdown.stop="onHeaderQnhPointerDown"
            @pointerup.stop="onHeaderQnhPointerUp"
            @pointerleave="onHeaderQnhPointerCancel"
            @pointercancel="onHeaderQnhPointerCancel"
            @click.stop="onHeaderQnhClick"
          >{{ headerQnh }}</button>
        </div>

        <!-- Right: catalog (Sections / info / RWY strips) -->
        <RtcColumnCatalogMenu
          v-if="!isEmpty"
          :bay="bay"
          :airport="selectedAirport"
        />

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
        <!-- Continuous flow: empty top / empty column = extension of previous bay -->
        <div
          v-if="workspaceMode && (columnTopGap > 0 || displaySections.length === 0)"
          class="ws-overflow-gap"
          :class="{ 'ws-overflow-gap--fill': displaySections.length === 0 }"
          :style="overflowGapStyle"
          :title="'Overflow from previous bay'"
          @dragover="onWorkspaceBayDragOver"
          @drop="onWorkspaceBayDrop"
        >
          <WsOverflowHost
            v-if="overflowHost"
            :strip-ids="overflowHost.stripIds"
            :source-section-id="overflowHost.sourceSectionId"
            :source-bay-id="overflowHost.sourceBayId"
            :allow-scroll="overflowHost.allowScroll"
          />
        </div>
        <EfsSection
          v-for="(section, index) in displaySections"
          :key="workspaceInstanceId(section.id) || section.id"
          :section="section"
          :bay-id="bay.id"
          :is-first-section="index === 0"
          :is-last-section="index === displaySections.length - 1"
          :workspace-mode="workspaceMode"
          :workspace-instance-id="workspaceInstanceId(section.id)"
          :workspace-column-index="columnIndex ?? 0"
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
import {
  mergeRtcBaySections,
  rtcExtrasVersion,
  setRtcBayBodyHeight,
} from '@/composables/rtcColumnExtras'
import { getWorkspace, type DtransVariantId } from '@/workspace'
import EfsSection from './EfsSection.vue'
import WsOverflowHost from './WsOverflowHost.vue'
import TrashDialog from './TrashDialog.vue'
import RtcColumnCatalogMenu from './RtcColumnCatalogMenu.vue'

const props = defineProps<{
  bay: Bay
  columnIndex?: number
  workspaceMode?: boolean
}>()

const store = useEfsStore()
const ws = getWorkspace()

/** Server sections + RTC empty dividers / unhide overlay */
const displaySections = computed(() => {
  if (!store.multiAirport) return props.bay.sections
  void rtcExtrasVersion()
  return mergeRtcBaySections(props.bay)
})

const columnTopGap = computed(() => {
  if (!props.workspaceMode || props.columnIndex == null) return 0
  // Depend on layout + body height so empty columns get full overflow capacity
  void ws.activeLayout.value
  void ws.overflowPack.value
  return ws.getColumnTopGap(props.columnIndex)
})

const overflowHost = computed(() => {
  if (!props.workspaceMode || props.columnIndex == null) return undefined
  void ws.overflowPack.value
  return ws.getColumnOverflowHost(props.columnIndex)
})

const overflowGapStyle = computed(() => {
  if (displaySections.value.length === 0) {
    // Empty column: flex-fill the body (height already = body via getColumnTopGap)
    return { flex: '1 1 auto', minHeight: 0 }
  }
  return { height: columnTopGap.value + 'px' }
})

function workspaceInstanceId(sectionId: string): string | undefined {
  if (!props.workspaceMode) return undefined
  const hit = ws.sections.value.find(
    (s) => s.instanceId === sectionId || s.sectionId === sectionId,
  )
  return hit?.instanceId
}

function onWorkspaceBayDragOver(e: DragEvent) {
  if (!props.workspaceMode) return
  const types = e.dataTransfer?.types
  if (!types) return
  const ok =
    types.includes('application/x-efs-section') ||
    types.includes('application/x-vatefs-catalog-section') ||
    types.includes('application/x-vatefs-catalog-dtrans')
  if (!ok) return
  e.preventDefault()
  e.stopPropagation()
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect =
      types.includes('application/x-vatefs-catalog-section') ||
      types.includes('application/x-vatefs-catalog-dtrans')
        ? 'copy'
        : 'move'
  }
}

function onWorkspaceBayDrop(e: DragEvent) {
  if (!props.workspaceMode) return
  const dtransRaw = e.dataTransfer?.getData('application/x-vatefs-catalog-dtrans')
  if (dtransRaw) {
    e.preventDefault()
    e.stopPropagation()
    try {
      const data = JSON.parse(dtransRaw) as { variant?: string }
      if (data.variant) {
        ws.addDtransDivider(data.variant as DtransVariantId, props.columnIndex ?? 0)
      }
    } catch {
      /* ignore */
    }
    return
  }
  const catalogRaw = e.dataTransfer?.getData('application/x-vatefs-catalog-section')
  if (catalogRaw) {
    e.preventDefault()
    e.stopPropagation()
    try {
      const sec = JSON.parse(catalogRaw) as { sectionId?: string; title?: string }
      if (sec.sectionId && sec.title) {
        const col = props.columnIndex ?? 0
        ws.addSectionFromCatalog(sec.sectionId, sec.title, col, store.layout)
        if (store.saabLayoutsMode) {
          const bayId = store.layout.bays[col]?.id ?? props.bay.id
          if (sec.sectionId === 'ctr' && sec.title === 'CTR') {
            store.saabEnsureSection('ctr_arr', 'CTR', { bayId })
            store.saabEnsureSection('ctr_dep', 'CTR', { bayId })
          } else {
            store.saabEnsureSection(sec.sectionId, sec.title, { bayId })
            if (sec.sectionId === 'pending_dep' && sec.title === 'DEP') {
              store.saabEnsureSection('cleared', 'DEP', { bayId })
            }
            if (sec.sectionId === 'ctr_arr' && sec.title === 'TMA / CTR') {
              store.saabEnsureSection('ctr_dep', 'TMA / CTR', { bayId })
              store.saabEnsureSection('tma', 'TMA / CTR', { bayId })
            }
            if (sec.sectionId === 'tma' && sec.title === 'TMA') {
              store.saabEnsureSection('tma', 'TMA', { bayId })
            }
            if (sec.sectionId === 'pending_dep' && sec.title === 'PENDING CLR') {
              store.saabEnsureSection('pending_dep', 'PENDING CLR', { bayId })
            }
            if (sec.sectionId === 'cleared' && sec.title === 'CLEARED') {
              store.saabEnsureSection('cleared', 'CLEARED', { bayId })
            }
          }
        }
      }
    } catch {
      /* ignore */
    }
    return
  }
  const dragged = e.dataTransfer?.getData('application/x-efs-section')
  if (!dragged) return
  e.preventDefault()
  e.stopPropagation()
  ws.moveSectionByClientY(dragged, props.columnIndex ?? 0, e.clientY)
  ws.endSectionDrag()
}

const BAY_REF_WIDTH_PX = 400
const BAY_SCALE_MIN = 0.55
const BAY_SCALE_MAX = 2.2

const bayEl = ref<HTMLElement | null>(null)

const trashOpen = ref(false)
const trashDragOver = ref(false)

function onTrashDragOver() {
  trashDragOver.value = true
}
function onTrashDragEnter() {
  trashDragOver.value = true
}
function onTrashDragLeave(e: DragEvent) {
  const related = e.relatedTarget as Node | null
  if (related && (e.currentTarget as HTMLElement)?.contains(related)) return
  trashDragOver.value = false
}
function onTrashDrop(e: DragEvent) {
  trashDragOver.value = false
  const raw = e.dataTransfer?.getData('application/json')
  if (!raw) return
  try {
    const data = JSON.parse(raw) as { stripId?: string }
    if (data.stripId) store.deleteStrip(data.stripId)
  } catch {
    /* ignore */
  }
}
const bayHeader = ref<HTMLElement | null>(null)
let bayResizeObs: ResizeObserver | null = null
let bayBodyResizeObs: ResizeObserver | null = null
let bayScaleRaf = 0

function updateBayScale() {
  const el = bayEl.value
  if (!el) return
  const w = el.clientWidth
  if (w <= 0) return
  const s = Math.max(BAY_SCALE_MIN, Math.min(BAY_SCALE_MAX, w / BAY_REF_WIDTH_PX))
  el.style.setProperty('--bay-scale', String(s))
}

function reportBayBodyHeight() {
  const body = bayEl.value?.querySelector('.bay-body') as HTMLElement | null
  if (!body) return
  if (props.workspaceMode && props.columnIndex != null) {
    ws.setColumnBodyHeight(props.columnIndex, body.clientHeight)
  }
  if (store.multiAirport) {
    setRtcBayBodyHeight(props.bay.id, body.clientHeight)
  }
}

function scheduleBayScale() {
  if (bayScaleRaf) cancelAnimationFrame(bayScaleRaf)
  bayScaleRaf = requestAnimationFrame(() => {
    bayScaleRaf = 0
    updateBayScale()
    reportBayBodyHeight()
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

/** Local ATS freq string from status when AFV has it RX-selected for this column. */
const headerRxFreq = computed(() => {
  const icao = selectedAirport.value
  if (!icao) return null
  const raw = store.airportRxFrequencies[icao.toUpperCase()]
  return raw && raw.trim() ? raw.trim() : null
})

/** Compact display e.g. 118.75 — tweak via .bay-header-rx CSS */
const headerRxFreqDisplay = computed(() => {
  const f = headerRxFreq.value
  if (!f) return ''
  const n = parseFloat(f)
  if (!Number.isFinite(n)) return f
  // Drop trailing zero on hundredths when clean (118.750 → 118.75)
  return n.toFixed(3).replace(/0$/, '').replace(/\.$/, '')
})

/** Hover: local freq with full value (not ellipsis) */
const headerRxFreqTitle = computed(() => {
  const full = headerRxFreq.value
  if (!full) return ''
  return `local freq ${full}`
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

const headerQnhTitle = computed(() => {
  const q = headerQnh.value
  if (!q) return 'QNH'
  if (headerQnhChanged.value) {
    return `QNH ${q} — click to acknowledge · hold to stamp all strips`
  }
  return `QNH ${q} — hold to stamp all strips`
})

/** Long-hold (~600ms): stamp qnhGiven on every strip for this airport */
const QNH_LONG_HOLD_MS = 600
let headerQnhHoldTimer: ReturnType<typeof setTimeout> | null = null
let headerQnhLongHeld = false

function clearHeaderQnhHold() {
  if (headerQnhHoldTimer != null) {
    clearTimeout(headerQnhHoldTimer)
    headerQnhHoldTimer = null
  }
}

function onHeaderQnhPointerDown(e: PointerEvent) {
  if (e.button != null && e.button !== 0) return
  const icao = selectedAirport.value
  if (!icao || !headerQnh.value) return
  headerQnhLongHeld = false
  clearHeaderQnhHold()
  headerQnhHoldTimer = setTimeout(() => {
    headerQnhHoldTimer = null
    headerQnhLongHeld = true
    store.stampQnhGivenForAirport(icao)
  }, QNH_LONG_HOLD_MS)
}

function onHeaderQnhPointerUp() {
  clearHeaderQnhHold()
}

function onHeaderQnhPointerCancel() {
  clearHeaderQnhHold()
  headerQnhLongHeld = false
}

function onHeaderQnhClick() {
  if (headerQnhLongHeld) {
    headerQnhLongHeld = false
    return
  }
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
  bayBodyResizeObs?.disconnect()
  bayBodyResizeObs = null
  if (bayScaleRaf) cancelAnimationFrame(bayScaleRaf)
  clearHeaderQnhHold()
})

// After first render, lock all non-last sections to their actual pixel heights
// so they don't shift when strip content changes.
onMounted(() => {
  updateBayScale()
  if (bayEl.value && typeof ResizeObserver !== 'undefined') {
    bayResizeObs = new ResizeObserver(() => scheduleBayScale())
    bayResizeObs.observe(bayEl.value)
  }
  const body = bayEl.value?.querySelector('.bay-body') as HTMLElement | null
  if (
    body &&
    typeof ResizeObserver !== 'undefined' &&
    (props.workspaceMode || store.multiAirport)
  ) {
    bayBodyResizeObs = new ResizeObserver(() => reportBayBodyHeight())
    bayBodyResizeObs.observe(body)
    reportBayBodyHeight()
  }

  nextTick(() => {
    if (!bayEl.value) return
    // Workspace: snapshot header Ys from the equal-flex first paint so later
    // removes keep positions (top gap = overflow from previous bay).
    // Defer until the bay body has real height — early sync freezes a header stack at y≈0.
    if (props.workspaceMode && props.columnIndex != null) {
      reportBayBodyHeight()
      const col = props.columnIndex
      const tryFreeze = () => {
        const already = ws.sectionsInColumn(col).some((s) => s.y != null)
        if (already) return true
        const body = bayEl.value?.querySelector('.bay-body') as HTMLElement | null
        if (!body || body.clientHeight < 80) return false
        if (ws.syncColumnYsFromDom(col)) {
          ws.persistHeights()
          return true
        }
        return false
      }
      if (!tryFreeze()) {
        requestAnimationFrame(() => {
          reportBayBodyHeight()
          if (!tryFreeze()) {
            // Last resort on next resize (setColumnBodyHeight also heals/syncs)
            reportBayBodyHeight()
          }
        })
      }
      ws.scheduleOverflowRepack()
      return
    }
    // RTC: never lock equal-flex pixel heights — with 5 sections that
    // squashes DEP/last strips, and free-Y drag owns heights via sectionYs.
    if (store.multiAirport) return
    const sections = props.bay.sections
    const sectionEls = bayEl.value.querySelectorAll('.efs-section')
    for (let i = 0; i < sections.length - 1; i++) {
      const section = sections[i]
      const el = sectionEls[i] as HTMLElement | undefined
      // Headerless zones size to content — do not lock pixel height
      if (!section || section.height || section.hideHeader || !el) continue
      const height = el.getBoundingClientRect().height
      store.setSectionHeight(props.bay.id, section.id, height, false)
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

/*
 * ESSA workspace: column side borders live on the bay so empty columns (no headers)
 * still show the same frame as populated ones. Sections drop their own L/R borders.
 */
.efs-bay--workspace {
  border-left: 1px solid #2b2d31;
  border-right: 1px solid #2b2d31;
  box-sizing: border-box;
}
.efs-bay--workspace :deep(.efs-section) {
  border-left: none;
  border-right: none;
}

.bay-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
}

/* ESSA continuous-flow: never let overflow-gap / floor-parked headers paint past the bay */
.efs-bay--workspace .bay-body {
  overflow: hidden;
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
  /* Room for sideways klack past the column edge into the neighbour bay */
  --paper-klack-bleed: calc(40px * var(--bay-scale, 1));
  position: relative;
  /*
   * Vertical clip flush with bay; expand clip box horizontally so klack can
   * paint into the adjacent column (overflow-clip-margin is unreliable on
   * overflow-y:auto scrollports).
   */
  overflow: visible;
  clip-path: inset(0 calc(-1 * var(--paper-klack-bleed)));
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
  overflow: visible;
  isolation: isolate;
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
  overflow: visible;
  position: relative;
  z-index: 1;
}

/* Same-column headers cover klacked strips that slide under them */
.efs-bay--paper :deep(.section-header) {
  position: relative;
  z-index: 4;
}

/*
 * Vertical scroll. Widen the scrollport with padding + negative margin so
 * sideways klack paints into the padding (still inside this box) and can reach
 * the bay clip-path bleed / neighbour column — without using overflow-x:visible
 * (which would compute to auto when overflow-y is auto).
 */
.efs-bay--paper :deep(.section-content) {
  background: transparent;
  overflow-x: clip;
  overflow-y: auto;
  margin-left: calc(-1 * var(--paper-klack-bleed));
  margin-right: calc(-1 * var(--paper-klack-bleed));
  padding-left: var(--paper-klack-bleed);
  padding-right: var(--paper-klack-bleed);
  min-height: 0;
  position: relative;
  z-index: 1;
}

/* SAAB 400×50 body ratio; bay-scale so notes/vehicles match flight strips + headers */
.efs-bay--paper :deep(.flight-strip) {
  --strip-body-h: calc(50px * var(--bay-scale, var(--strip-scale)));
}

/* Compact half-height SAAB — respect 25px body (do not force full height via bay) */
.efs-bay:not(.efs-bay--paper) :deep(.flight-strip.strip-compact) {
  --strip-body-h: calc(25px * var(--bay-scale, var(--strip-scale)));
}

/* Strip list: under headers; horizontal klack clipped at bay with side bleed only */
.efs-bay--paper :deep(.top-strips-container),
.efs-bay--paper :deep(.bottom-strips-container) {
  display: flex;
  flex-direction: column;
  padding: var(--paper-strip-gap) 2px;
  gap: var(--paper-strip-gap);
  box-sizing: border-box;
  overflow: visible;
  position: relative;
  z-index: 1;
  flex: 1 1 auto;
  min-height: 0;
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

.bay-trash-btn {
  position: absolute;
  left: calc(2px * var(--bay-scale));
  top: 50%;
  transform: translateY(-50%);
  z-index: 3;
  color: rgba(255, 255, 255, 0.9);
  background: transparent;
  border: none;
  padding: 2px 4px;
  cursor: pointer;
  appearance: none;
}
.bay-trash-btn:hover {
  filter: brightness(1.2);
}
.bay-trash-btn.drag-over {
  color: #f44336;
  outline: 1px solid #f44336;
}
.bay-menu-tri {
  display: block;
  width: 0;
  height: 0;
  border-style: solid;
  /* Point right (inward from left edge) */
  border-width: 5px 0 5px 7px;
  border-color: transparent transparent transparent currentColor;
}
.bay-header :deep(.bay-catalog-btn) {
  position: absolute;
  right: calc(2px * var(--bay-scale));
  top: 50%;
  transform: translateY(-50%);
  z-index: 3;
  margin-left: 0;
}

/* ICAO centred; RX left of ICAO; QNH/ATIS overlay on the right (inboard of catalog) */
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
  /* Leave room for catalog triangle on the right */
  right: calc(26px * var(--bay-scale));
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

/**
 * Local AFV-RX frequency (not Primfreq) — left of column ICAO.
 * Easy visual tweaks: color / opacity / font-size / letter-spacing / left inset
 */
.bay-header-rx {
  position: absolute;
  /* Inboard of trash triangle on the left */
  left: calc(22px * var(--bay-scale));
  top: 50%;
  transform: translateY(-50%);
  z-index: 2;
  max-width: 28%;
  color: #fff;
  /* Allow native title tooltip (was pointer-events: none) */
  pointer-events: auto;
  cursor: default;
  user-select: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: max(calc(11px * var(--bay-scale, 1)), calc(12px * var(--efs-scale, 1)));
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
  line-height: 1;
  opacity: 0.85;
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

/* Header DnD: never show strip drop markers (teal insert line / header / bottom slot) */
/* Gap above first header / empty column — paints continuation strips from previous bay */
.ws-overflow-gap {
  flex: 0 0 auto;
  min-height: 0;
  max-height: 100%;
  display: flex;
  flex-direction: column;
  background: transparent;
  pointer-events: auto;
  overflow: hidden;
}
.ws-overflow-gap--fill {
  flex: 1 1 auto;
}

.efs-bay--ws-section-drag :deep(.drop-placement-line) {
  display: none !important;
}
.efs-bay--ws-section-drag :deep(.section-header.header-drop-active) {
  box-shadow: none !important;
}
.efs-bay--ws-section-drag :deep(.bottom-drop-zone.drop-active),
.efs-bay--ws-section-drag :deep(.bottom-drop-zone--stick-top.drop-active) {
  background: transparent !important;
  box-shadow: none !important;
  border-top-color: transparent !important;
  border-bottom-color: transparent !important;
  border-top-width: 1px !important;
  border-bottom-width: 1px !important;
}
.efs-bay--ws-section-drag :deep(.bottom-drop-zone.drop-active::before),
.efs-bay--ws-section-drag :deep(.bottom-drop-zone.drop-active::after),
.efs-bay--ws-section-drag :deep(.bottom-drop-zone--stick-top.drop-active::before),
.efs-bay--ws-section-drag :deep(.bottom-drop-zone--stick-top.drop-active::after) {
  display: none !important;
}
</style>

<template>
  <StripCreationDialog
    v-model="createDialogOpen"
    :strip-type="createDialogType"
    :initial-airport="createDialogAirport"
    @create="onDialogCreate"
  />
  <div
    ref="sectionRoot"
    class="efs-section"
    :class="{
      'efs-section--no-header': !!section.hideHeader,
      'efs-section--stick-bottom': stickBottomZone,
    }"
    :data-section-id="section.id"
    :style="sectionStyle"
  >
    <div
      v-if="!section.hideHeader"
      class="section-header"
      :class="[
        { 'no-resize': isFirstSection },
        essaHeaderClass,
        { 'section-header--paper': store.isPaperLook },
        { 'section-header--rtc': store.multiAirport && !store.isPaperLook },
        { 'section-header--rtc-rwy': !!rtcHeaderRwy },
        { 'header-drop-active': headerDropActive },
      ]"
      :title="
        store.isPaperLook && !isFirstSection
          ? 'Drag to adjust height · double-click to reset'
          : undefined
      "
      @mousedown="store.isPaperLook ? onResizeStart($event) : undefined"
      @touchstart="store.isPaperLook ? onResizeStart($event) : undefined"
      @dblclick="store.isPaperLook ? onResizeReset($event) : undefined"
      @dragover.prevent="onHeaderDragOver"
      @dragenter.prevent="onHeaderDragEnter"
      @dragleave="onHeaderDragLeave"
      @drop.prevent="onHeaderDrop"
    >
      <template v-if="!store.isPaperLook">
        <div class="section-header-left">
          <button
            type="button"
            class="section-hdr-btn section-hdr-drag"
            :class="{ 'is-inactive': isFirstSection }"
            :disabled="isFirstSection"
            :title="isFirstSection ? 'Adjust height' : 'Drag to adjust height · double-click to reset'"
            @mousedown="onResizeStart"
            @touchstart="onResizeStart"
            @dblclick="onResizeReset"
          >
            <span class="section-hdr-drag-icon" aria-hidden="true" />
          </button>
          <button
            type="button"
            class="section-hdr-btn section-hdr-search"
            disabled
            title="Search"
          >
            <svg class="section-hdr-search-icon" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="6.5" cy="6.5" r="4.25" fill="none" stroke="currentColor" stroke-width="1.75" />
              <path d="M9.6 9.6 L13.5 13.5" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="square" />
            </svg>
          </button>
          <button
            v-if="showSortModeControls"
            type="button"
            class="section-hdr-btn section-sort-btn"
            :title="sortModeTitle"
            @mousedown.stop
            @touchstart.stop
            @click.stop="toggleSortMode"
          >{{ sortModeLabel }}</button>
        </div>
      </template>
      <template v-if="store.isPaperLook && showUtflygningFreqs">
        <div class="pg-hdr-freq pg-hdr-freq-left">
          <span class="pg-hdr-freq-si">TW</span>
          <span class="pg-hdr-freq-mhz">124,205</span>
        </div>
        <span class="section-title" :class="{ 'section-title--paper-lg': paperLargeTitle }">{{ section.title }}</span>
        <div class="pg-hdr-freq pg-hdr-freq-right">
          <span class="pg-hdr-freq-si">TE</span>
          <span class="pg-hdr-freq-mhz">124,680</span>
        </div>
      </template>
      <template v-else-if="store.isPaperLook && showPabananRwy">
        <span class="section-title section-title--paper-lg section-title--paper-center">{{ section.title }}</span>
        <button
          v-if="paperRwyId"
          type="button"
          class="pg-hdr-rwy"
          title="Toggle runway designator (local display only)"
          @mousedown.stop
          @touchstart.stop
          @dblclick.stop
          @click.stop="onPaperRwyClick"
        >{{ paperRwyId }}</button>
      </template>
      <span
        v-else
        class="section-title"
        :class="{ 'section-title--paper-lg': store.isPaperLook && paperLargeTitle }"
      >{{ section.title }}</span>
      <template v-if="!store.isPaperLook">
        <div class="section-header-right">
          <span
            v-if="rtcHeaderRwy"
            class="section-hdr-rwy"
            :title="rtcHeaderRwyTitle"
          >{{ rtcHeaderRwy }}</span>
          <button
            type="button"
            class="section-hdr-btn section-hdr-close"
            disabled
            title="Close"
          >
            <svg class="section-hdr-close-icon" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M1 1 L11 11 M11 1 L1 11" />
            </svg>
          </button>
        </div>
      </template>
    </div>
    <div
      class="section-content"
      :class="{ 'section-content--stick-bottom': stickBottomZone }"
    >
      <!--
        Main list (scrollable). Stick-bottom zones: spacer pushes strips against the
        header below; pinned zone is reordered to the top via CSS (reversed stick-to).
      -->
      <div
        ref="topContainer"
        class="top-strips-container"
        @dragover.prevent="onTopDragOver"
        @dragenter="onTopDragEnter"
        @dragleave="onTopDragLeave"
        @drop="onTopDrop"
      >
        <div
          v-if="stickBottomZone"
          class="stick-bottom-spacer"
          aria-hidden="true"
        />
        <!-- RWY flags always pinned to top of this runway bay -->
        <RwyFlagStrip
          v-if="showRwyFlagControls"
          kind="rwyOccupied"
          :section-id="section.id"
          :section-title="section.title"
        />
        <RwyFlagStrip
          v-if="showRwyFlagControls"
          kind="rwyClosed"
          :section-id="section.id"
          :section-title="section.title"
        />
        <template v-for="(strip, index) in topStrips" :key="strip.id">
          <!-- Info strips first so the insert line can sit between them and the flight strip -->
          <BreakoutInfoStrip v-if="showBreakoutBeforeTopIndex(index)" />
          <MapInfoStrip v-if="showMapBeforeTopIndex(index)" />
          <DepInfoStrip v-if="showDepBeforeTopIndex(index)" />
          <TurnDepInfoStrip v-if="showTurnBeforeTopIndex(index)" />
          <Sid19LInfoStrip v-if="showSid19lBeforeTopIndex(index)" />
          <R16InfoStrip v-if="showR16BeforeTopIndex(index)" />
          <div
            v-if="dropInsertIndex === index"
            class="drop-placement-line"
            aria-hidden="true"
          />
          <!-- Gap before this strip (if any); skipped while auto time-sorted -->
          <div
            v-if="showGaps && sectionGaps[index]"
            class="strip-gap"
            :data-gap-index="index"
            :style="{ height: sectionGaps[index] + 'px' }"
            @click="onGapClick(index)"
          ></div>
          <FlightStrip
            :strip="strip"
            :section-id="section.id"
            :bay-id="bayId"
          />
        </template>
        <BreakoutInfoStrip v-if="showBreakoutAtEndOfTop" />
        <MapInfoStrip v-if="showMapAtEndOfTop" />
        <DepInfoStrip v-if="showDepAtEndOfTop" />
        <TurnDepInfoStrip v-if="showTurnAtEndOfTop" />
        <Sid19LInfoStrip v-if="showSid19lAtEndOfTop" />
        <R16InfoStrip v-if="showR16AtEndOfTop" />
        <!-- After trailing info strips so drops below DEP/ARR info work -->
        <div
          v-if="dropInsertIndex === topStrips.length"
          class="drop-placement-line"
          aria-hidden="true"
        />
      </div>

      <!-- Stick-to tray: bottom of normal sections; top of stick-bottom sections (CSS order) -->
      <div
        class="bottom-drop-zone"
        :class="{
          'drop-active': isBottomDragOver,
          'has-bottom': hasPinnedZoneContent,
          'bottom-drop-zone--stick-top': stickBottomZone,
        }"
        @dragover.prevent="onBottomDragOver"
        @dragenter="onBottomDragEnter"
        @dragleave="onBottomDragLeave"
        @drop="onBottomDrop"
      ></div>

      <!-- Pinned strips: bottom of normal sections; top of stick-bottom sections (CSS order) -->
      <div
        v-if="hasPinnedZoneContent"
        ref="bottomContainer"
        class="bottom-strips-container"
        :class="{ 'bottom-strips-container--stick-top': stickBottomZone }"
        @dragover.prevent="onBottomStripsDragOver"
        @drop="onBottomStripsDrop"
      >
        <template v-for="(strip, index) in bottomStrips" :key="strip.id">
          <BreakoutInfoStrip v-if="showBreakoutBeforeBottomIndex(index)" />
          <MapInfoStrip v-if="showMapBeforeBottomIndex(index)" />
          <DepInfoStrip v-if="showDepBeforeBottomIndex(index)" />
          <TurnDepInfoStrip v-if="showTurnBeforeBottomIndex(index)" />
          <Sid19LInfoStrip v-if="showSid19lBeforeBottomIndex(index)" />
          <R16InfoStrip v-if="showR16BeforeBottomIndex(index)" />
          <FlightStrip
            :strip="strip"
            :section-id="section.id"
            :bay-id="bayId"
          />
        </template>
        <!-- Default: bottom of bay above RUNWAY; also end of bottom list -->
        <BreakoutInfoStrip v-if="showBreakoutAtEndOfBottom" />
        <MapInfoStrip v-if="showMapAtEndOfBottom" />
        <DepInfoStrip v-if="showDepAtEndOfBottom" />
        <TurnDepInfoStrip v-if="showTurnAtEndOfBottom" />
        <Sid19LInfoStrip v-if="showSid19lAtEndOfBottom" />
        <R16InfoStrip v-if="showR16AtEndOfBottom" />
        <!-- Explicit hit target below trailing info strips -->
        <div
          class="bottom-info-drop-tail"
          @dragover.prevent="onBottomStripsDragOver"
          @dragenter.prevent="onBottomStripsDragOver"
          @drop="onBottomStripsDropAtEnd"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount, type ComputedRef, type Ref } from 'vue'
import type { FlightStrip as FlightStripData, Section } from '@/types/efs'
import { useEfsStore } from '@/store/efs'
import { useSectionResize } from '@/composables/useSectionResize'
import { useStripOrderFlip } from '@/composables/useStripOrderFlip'
import {
  autoFitApplying,
  autoFitLayoutEpoch,
  clearAutoFitState,
  isAutoFitExemptSection,
  runAutoFitStripSize,
} from '@/composables/useAutoFitStripSize'
import { isCdAllOrTsatSection } from '@/composables/useStripExpanders'
import { useUiScalePercent } from '@/composables/useEfsUiScale'
import FlightStrip from './FlightStrip.vue'
import BreakoutInfoStrip from './BreakoutInfoStrip.vue'
import MapInfoStrip from './MapInfoStrip.vue'
import DepInfoStrip from './DepInfoStrip.vue'
import TurnDepInfoStrip from './TurnDepInfoStrip.vue'
import Sid19LInfoStrip from './Sid19LInfoStrip.vue'
import R16InfoStrip from './R16InfoStrip.vue'
import RwyFlagStrip from './RwyFlagStrip.vue'
import StripCreationDialog from './StripCreationDialog.vue'
import {
  INFO_STRIP_KINDS,
  setInfoStripPlacement,
  useBreakoutInfoStrip,
  useMapInfoStrip,
  useDepInfoStrip,
  useTurnDepInfoStrip,
  useSid19LInfoStrip,
  useR16InfoStrip,
  type InfoStripPlacement,
} from '@/composables/useInfoStrips'
import {
  RWY_CLOSED_FLAG_KIND,
  RWY_OCCUPIED_FLAG_KIND,
  isRwyFlagActive,
  isRwyFlagHostSection,
} from '@/composables/useRunwayFlagStrips'
import { useTouchDropPlacement } from '@/composables/useTouchDrag'
import {
  draggingStripId,
  flightStripsIn,
  insertIndexAtClientY,
  visualIndexForInsert,
} from '@/composables/dropPlacement'
import {
  claimDropHighlight,
  dropHighlightOwnerKey,
  releaseDropHighlight,
  useDropHighlightOwner,
} from '@/composables/useDropHighlightOwner'
import { isRunwayOrderSectionId, sortRunwayLuOrder } from '@vatefs/common'
import { rtcInsertAtTop } from '@/composables/rtcStripInsert'

type SpecialStripType = 'vfrDep' | 'vfrArr' | 'cross' | 'note' | 'vehicle'
type TimeSortField = 'etobt' | 'tsat'
type TimeSortDir = 'asc' | 'desc'

const TIME_SORT_SECTIONS = new Set(['pending_dep', 'cleared', 'dep'])

/** E/TOBT–TSAT sort: pending/cleared, or RTC bay*_dep — not ctr_dep */
function isTimeSortSectionId(sectionId: string): boolean {
  if (TIME_SORT_SECTIONS.has(sectionId)) return true
  if (sectionId.endsWith('_pending_dep') || sectionId.endsWith('_cleared')) return true
  return /^(bay\d+|idle)_dep$/.test(sectionId)
}

/**
 * Any INBOUND bay (APP / TWR / GND) — header tint, dimming helpers.
 * Matches layout ids (`inbound`, `inbound_*`, `*_inbound`) and INBOUND titles.
 */
function isInboundSectionId(sectionId: string, title?: string): boolean {
  const id = sectionId.toLowerCase()
  if (id === 'inbound' || id.startsWith('inbound_') || id.endsWith('_inbound')) return true
  if (title && title.toUpperCase().startsWith('INBOUND')) return true
  return false
}

/**
 * INBOUND APP only — ETA auto-sort (earliest at bottom).
 * Plain "INBOUND" (ESGG) and "INBOUND APP" (ESSA TWR). Not INBOUND TWR-* / GND-*.
 */
function isInboundAppSectionTitle(title?: string): boolean {
  const t = (title || '').toUpperCase().trim()
  return t === 'INBOUND' || t === 'INBOUND APP'
}

function isCtrDepSectionId(sectionId: string): boolean {
  return sectionId === 'ctr_dep' || sectionId.endsWith('_ctr_dep')
}

/** RTC ARR section (bayN_arr / arr) */
function isRtcArrSectionId(sectionId: string): boolean {
  return sectionId === 'arr' || /^(bay\d+|idle)_arr$/.test(sectionId)
}

/** RTC DEP section (bayN_dep / dep) — not ctr_dep / pending_dep */
function isRtcDepSectionId(sectionId: string): boolean {
  return sectionId === 'dep' || /^(bay\d+|idle)_dep$/.test(sectionId)
}

function isClearedSectionId(sectionId: string): boolean {
  return sectionId === 'cleared' || sectionId.endsWith('_cleared')
}

function isPendingDepSectionId(sectionId: string): boolean {
  return sectionId === 'pending_dep' || sectionId.endsWith('_pending_dep')
}

const props = withDefaults(defineProps<{
  section: Section
  bayId: string
  isFirstSection?: boolean
  isLastSection?: boolean
}>(), {
  isFirstSection: false,
  isLastSection: false
})

const createDialogOpen = ref(false)
const createDialogType = ref<SpecialStripType>('vfrDep')
const createDialogAirport = ref<string | undefined>(undefined)

// Pending create info (stored while dialog is open, applied on dialog OK)
const pendingCreatePosition = ref<number | undefined>(undefined)
const pendingCreateIsBottom = ref<boolean>(false)
const pendingCreateGapIndex = ref<number | undefined>(undefined)
const pendingCreateGapSize = ref<number>(0)

const store = useEfsStore()
const { startResize } = useSectionResize()

/** Paper ESGG UTFLYGNING header: TW/TE APP frequencies flanking the title */
const showUtflygningFreqs = computed(
  () => store.isPaperLook && isCtrDepSectionId(props.section.id),
)

function isCtrArrSectionId(sectionId: string): boolean {
  return sectionId === 'ctr_arr' || sectionId.endsWith('_ctr_arr')
}

/**
 * Paper: above KLARERING — default EOBT (+ CLR read at bottom); drag sticks
 * manual order; new prints still insert by EOBT without re-sorting the bay.
 */
const paperPendingKlarering = computed(
  () =>
    store.isPaperLook &&
    isPendingDepSectionId(props.section.id) &&
    !!props.section.hideHeader,
)

function isTaxiSectionId(sectionId: string): boolean {
  return (
    sectionId === 'taxi' ||
    sectionId.endsWith('_taxi') ||
    sectionId === 'twy' ||
    sectionId.endsWith('_twy')
  )
}

function isAbovePushSectionId(sectionId: string): boolean {
  return sectionId === 'above_push'
}

/**
 * Paper zones that stick the main list to the bottom:
 * headerless INBOUND / above KLARERING / above PÅ BANAN / above START-UP (CD→GND),
 * and PÅ TAXI (mixed ARR-on-top / DEP-on-bottom stack, bottom-justified in the bay).
 * Pin tray is reversed to top via CSS.
 */
const stickBottomZone = computed(
  () =>
    store.isPaperLook &&
    ((!!props.section.hideHeader &&
      (isPendingDepSectionId(props.section.id) ||
        isAbovePushSectionId(props.section.id) ||
        isCtrArrSectionId(props.section.id) ||
        isInboundSectionId(props.section.id, props.section.title))) ||
      isTaxiSectionId(props.section.id)),
)

function isRunwaySectionId(sectionId: string): boolean {
  return sectionId === 'runway' || sectionId.startsWith('runway_') || sectionId.endsWith('_runway')
}

/** Larger title: UTFLYGNING / PÅ TAXI / PÅ BANAN */
const paperLargeTitle = computed(
  () =>
    store.isPaperLook &&
    (isCtrDepSectionId(props.section.id) ||
      isTaxiSectionId(props.section.id) ||
      isRunwaySectionId(props.section.id)),
)

const showPabananRwy = computed(
  () => store.isPaperLook && isRunwaySectionId(props.section.id),
)

/**
 * Paper/ESGG PÅ BANAN badge — only physical ends 03 / 21.
 * Gate on paper look (ESGG view), not myAirports — atis can still list ESSA.
 */
const isEsggPabananRwy = computed(() => store.isPaperLook || store.esggRolesMode)

/** Normalize to ESGG physical ends only; anything else → ''. */
function esggPabananDesignator(raw: string): '03' | '21' | '' {
  const first = (raw || '').split('/')[0]?.trim().toUpperCase() ?? ''
  const m = first.match(/^(\d{1,2})/)
  if (!m) return ''
  const n = String(parseInt(m[1]!, 10)).padStart(2, '0')
  if (n === '03') return '03'
  if (n === '21') return '21'
  return ''
}

/** Local visual override for PÅ BANAN RWY badge (does not change ES / system RWY). */
const paperRwyLocal = ref<string | null>(null)

/** Active RWY from ES — ESGG only for paper; never fall back to ESSA atis. */
const paperRwyFromEs = computed((): string => {
  if (!showPabananRwy.value) return ''

  if (isEsggPabananRwy.value) {
    const info = store.atisInfo.find((a) => a.airport.toUpperCase() === 'ESGG')
    const candidates = [...(info?.depRunways ?? []), ...(info?.arrRunways ?? [])]
    for (const r of candidates) {
      const d = esggPabananDesignator(r)
      if (d) return d
    }
    // Default so the badge/toggle always has a valid ESGG end
    return '21'
  }

  const apt = store.myAirports[0]
  const info =
    (apt ? store.atisInfo.find((a) => a.airport === apt) : undefined) ?? store.atisInfo[0]
  const dep = info?.depRunways ?? []
  const arr = info?.arrRunways ?? []
  const rwys = dep.length ? dep : arr
  if (!rwys.length) return ''
  if (dep.length && arr.length && dep.join('/') !== arr.join('/')) {
    return [...new Set([...arr, ...dep])].join('/')
  }
  return rwys.join('/')
})

/** Displayed designator: local click override, else ES — ESGG clamped to 03|21 */
const paperRwyId = computed(() => {
  if (isEsggPabananRwy.value) {
    const local = paperRwyLocal.value ? esggPabananDesignator(paperRwyLocal.value) : ''
    return local || esggPabananDesignator(paperRwyFromEs.value) || '21'
  }
  return paperRwyLocal.value ?? paperRwyFromEs.value
})

/** Reciprocal runway end (03↔21, 01L↔19R). */
function reciprocalRwy(rwy: string): string | null {
  const m = rwy.trim().toUpperCase().match(/^(\d{1,2})([LCR]?)$/)
  if (!m) return null
  const n = parseInt(m[1]!, 10)
  if (n < 1 || n > 36) return null
  const suf = m[2] || ''
  const flip = ((n - 1 + 18) % 36) + 1
  const flipSuf = suf === 'L' ? 'R' : suf === 'R' ? 'L' : suf
  return String(flip).padStart(2, '0') + flipSuf
}

function onPaperRwyClick() {
  // ESGG paper: only ever 03 ↔ 21
  if (isEsggPabananRwy.value) {
    const cur = esggPabananDesignator(paperRwyId.value) || '21'
    paperRwyLocal.value = cur === '03' ? '21' : '03'
    return
  }
  const cur = (paperRwyId.value || '').split('/')[0]?.trim()
  if (!cur) return
  const next = reciprocalRwy(cur)
  if (!next || next === cur) return
  paperRwyLocal.value = next
}

// Fresh connect / ES update: drop local override when ES RWY changes so badge tracks ES
watch(paperRwyFromEs, (es, prev) => {
  if (!es) return
  if (paperRwyLocal.value == null) return
  if (prev && prev !== es) paperRwyLocal.value = null
})

// Drop stale local overrides that aren't 03/21 (e.g. 01L from older reciprocal toggle)
watch(
  isEsggPabananRwy,
  (on) => {
    if (!on || paperRwyLocal.value == null) return
    if (!esggPabananDesignator(paperRwyLocal.value)) paperRwyLocal.value = null
  },
  { immediate: true },
)

const showRwyFlagControls = computed(() =>
  isRwyFlagHostSection(props.section.id, props.section.title),
)
const occupiedFlagActive = computed(
  () =>
    showRwyFlagControls.value &&
    isRwyFlagActive(RWY_OCCUPIED_FLAG_KIND, props.section.id),
)
const closedFlagActive = computed(
  () =>
    showRwyFlagControls.value &&
    isRwyFlagActive(RWY_CLOSED_FLAG_KIND, props.section.id),
)

const { visible: breakoutVisible, placement: breakoutPlacement } = useBreakoutInfoStrip()
const {
  visible: mapVisible,
  placement: mapPlacement,
  defaultSectionId: mapDefaultSectionId,
} = useMapInfoStrip()
const {
  visible: depVisible,
  placement: depPlacement,
  defaultSectionId: depDefaultSectionId,
} = useDepInfoStrip()
const {
  visible: turnVisible,
  placement: turnPlacement,
  defaultSectionId: turnDefaultSectionId,
} = useTurnDepInfoStrip()
const {
  visible: sid19lVisible,
  placement: sid19lPlacement,
  defaultSectionId: sid19lDefaultSectionId,
} = useSid19LInfoStrip()
const {
  visible: r16Visible,
  placement: r16Placement,
  defaultBayId: r16DefaultBayId,
  defaultSectionId: r16DefaultSectionId,
} = useR16InfoStrip()

/**
 * Host for turn / Q·E briefing strips: default at the TOP of the DEP RWY bay itself.
 * (DEP freq strip stays on the section above — see isDefaultDepHost.)
 */
function createRwyBayTopHost(
  visible: Ref<boolean> | ComputedRef<boolean>,
  placement: ComputedRef<InfoStripPlacement | null>,
  defaultSectionId: ComputedRef<string | null>,
  topList: ComputedRef<FlightStripData[]>,
  bottomList: ComputedRef<FlightStripData[]>,
  options?: {
    /** Restrict the default host to this bay (section ids repeat across bays) */
    defaultBayId?: ComputedRef<string | null>
    /** Default true; R16 shows regardless of ESSA roles mode */
    requireRolesMode?: boolean
  },
) {
  const isDefaultHost = computed(() => {
    if ((options?.requireRolesMode ?? true) && !store.essaRolesMode) return false
    if (!visible.value) return false
    const def = defaultSectionId.value
    if (!def) return false
    if (options?.defaultBayId && options.defaultBayId.value !== props.bayId) return false
    return props.section.id === def
  })
  const showHere = computed(() => {
    if (!visible.value) return false
    const p = placement.value
    if (!p) return isDefaultHost.value
    return p.bayId === props.bayId && p.sectionId === props.section.id
  })
  /** Default: top of bay. Custom placement may pin to bottom. */
  const atBottom = computed(() => {
    if (!showHere.value) return false
    const p = placement.value
    return !!p && p.bottom
  })
  const inTop = computed(() => {
    if (!showHere.value) return false
    const p = placement.value
    return !p || !p.bottom
  })
  function beforeTop(index: number): boolean {
    if (!inTop.value) return false
    const p = placement.value
    if (!p) return index === 0 // default: first slot in the RWY bay
    return p.index === index
  }
  const endTop = computed(() => {
    if (!inTop.value) return false
    const p = placement.value
    if (!p) return topList.value.length === 0
    return p.index >= topList.value.length
  })
  function beforeBottom(index: number): boolean {
    if (!atBottom.value) return false
    const p = placement.value
    if (!p) return false
    return p.index === index
  }
  const endBottom = computed(() => {
    if (!atBottom.value) return false
    const p = placement.value
    if (!p) return true
    return p.index >= bottomList.value.length
  })
  return { showHere, atBottom, beforeTop, endTop, beforeBottom, endBottom }
}

/** Default host: section immediately above RUNWAY 01R/19L. */
const isDefaultBreakoutHost = computed(() => {
  if (!store.essaRolesMode) return false
  const bay = store.layout.bays.find((b) => b.id === props.bayId)
  if (!bay) return false
  const idx = bay.sections.findIndex((s) => s.id === props.section.id)
  if (idx < 0 || idx >= bay.sections.length - 1) return false
  const nextId = bay.sections[idx + 1]?.id ?? ''
  return nextId === 'runway_01R_19L' || /runway_01R_19L/i.test(nextId)
})

/**
 * Default host: section immediately above the physical RWY bay for the MAP ARR runway
 * (same pattern as breakout above 01R/19L).
 */
const isDefaultMapHost = computed(() => {
  if (!store.essaRolesMode || !mapVisible.value) return false
  const def = mapDefaultSectionId.value
  if (!def) return false
  const bay = store.layout.bays.find((b) => b.id === props.bayId)
  if (!bay) return false
  const idx = bay.sections.findIndex((s) => s.id === props.section.id)
  if (idx < 0 || idx >= bay.sections.length - 1) return false
  return bay.sections[idx + 1]?.id === def
})

/** Default host: section immediately above the physical DEP RWY bay. */
const isDefaultDepHost = computed(() => {
  if (!store.essaRolesMode || !depVisible.value) return false
  const def = depDefaultSectionId.value
  if (!def) return false
  const bay = store.layout.bays.find((b) => b.id === props.bayId)
  if (!bay) return false
  const idx = bay.sections.findIndex((s) => s.id === props.section.id)
  if (idx < 0 || idx >= bay.sections.length - 1) return false
  return bay.sections[idx + 1]?.id === def
})

const showBreakoutHere = computed(() => {
  if (!breakoutVisible.value) return false
  const p = breakoutPlacement.value
  if (!p) return isDefaultBreakoutHost.value
  return p.bayId === props.bayId && p.sectionId === props.section.id
})

const showMapHere = computed(() => {
  if (!mapVisible.value) return false
  const p = mapPlacement.value
  if (!p) return isDefaultMapHost.value
  return p.bayId === props.bayId && p.sectionId === props.section.id
})

const showDepHere = computed(() => {
  if (!depVisible.value) return false
  const p = depPlacement.value
  if (!p) return isDefaultDepHost.value
  return p.bayId === props.bayId && p.sectionId === props.section.id
})

const showBreakoutAtBottom = computed(() => {
  if (!showBreakoutHere.value) return false
  const p = breakoutPlacement.value
  return !p || p.bottom
})

const showMapAtBottom = computed(() => {
  if (!showMapHere.value) return false
  const p = mapPlacement.value
  return !p || p.bottom
})

const showDepAtBottom = computed(() => {
  if (!showDepHere.value) return false
  const p = depPlacement.value
  return !p || p.bottom
})

const showBreakoutInTop = computed(() => showBreakoutHere.value && !!breakoutPlacement.value && !breakoutPlacement.value.bottom)
/** Default MAP: bottom of the section above the RWY bay (sits just above the header). */
const showMapInTop = computed(() => {
  if (!showMapHere.value) return false
  const p = mapPlacement.value
  return !!p && !p.bottom
})

const showDepInTop = computed(() => {
  if (!showDepHere.value) return false
  const p = depPlacement.value
  return !!p && !p.bottom
})

function showBreakoutBeforeTopIndex(index: number): boolean {
  if (!showBreakoutInTop.value || !breakoutPlacement.value) return false
  return breakoutPlacement.value.index === index
}

function showMapBeforeTopIndex(index: number): boolean {
  if (!showMapInTop.value || !mapPlacement.value) return false
  return mapPlacement.value.index === index
}

function showDepBeforeTopIndex(index: number): boolean {
  if (!showDepInTop.value || !depPlacement.value) return false
  return depPlacement.value.index === index
}

const showBreakoutAtEndOfTop = computed(() => {
  if (!showBreakoutInTop.value || !breakoutPlacement.value) return false
  return breakoutPlacement.value.index >= topStrips.value.length
})

const showMapAtEndOfTop = computed(() => {
  if (!showMapInTop.value || !mapPlacement.value) return false
  return mapPlacement.value.index >= topStrips.value.length
})

const showDepAtEndOfTop = computed(() => {
  if (!showDepInTop.value || !depPlacement.value) return false
  return depPlacement.value.index >= topStrips.value.length
})

function showBreakoutBeforeBottomIndex(index: number): boolean {
  if (!showBreakoutAtBottom.value) return false
  const p = breakoutPlacement.value
  if (!p) return false // default → end of bottom list
  return p.index === index
}

function showMapBeforeBottomIndex(index: number): boolean {
  if (!showMapAtBottom.value) return false
  const p = mapPlacement.value
  if (!p) return false // default → end of bottom (just above next RWY header)
  return p.index === index
}

function showDepBeforeBottomIndex(index: number): boolean {
  if (!showDepAtBottom.value) return false
  const p = depPlacement.value
  if (!p) return false
  return p.index === index
}

const showBreakoutAtEndOfBottom = computed(() => {
  if (!showBreakoutAtBottom.value) return false
  const p = breakoutPlacement.value
  if (!p) return true // default placement
  return p.index >= bottomStrips.value.length
})

const showMapAtEndOfBottom = computed(() => {
  if (!showMapAtBottom.value) return false
  const p = mapPlacement.value
  if (!p) return true // default: end of section above RWY bay
  return p.index >= bottomStrips.value.length
})

const showDepAtEndOfBottom = computed(() => {
  if (!showDepAtBottom.value) return false
  const p = depPlacement.value
  if (!p) return true
  return p.index >= bottomStrips.value.length
})

function placeInfoStrip(kind: string, bottom: boolean, index: number) {
  setInfoStripPlacement(kind, {
    bayId: props.bayId,
    sectionId: props.section.id,
    bottom,
    index,
  })
}

/** Drop index among flight strips by Y midpoint (info strip ignored). */
function computeFlightStripDropIndex(event: DragEvent, container: HTMLElement | null): number {
  if (!container) return 0
  const nodes = Array.from(container.querySelectorAll('.flight-strip')) as HTMLElement[]
  const y = event.clientY
  for (let i = 0; i < nodes.length; i++) {
    const rect = nodes[i]!.getBoundingClientRect()
    if (y < rect.top + rect.height / 2) return i
  }
  return nodes.length
}

function tryHandleInfoStripDrop(event: DragEvent, bottom: boolean): boolean {
  if (!event.dataTransfer) return false
  const kind =
    event.dataTransfer.getData('application/efs-info-strip') ||
    (() => {
      try {
        const data = JSON.parse(event.dataTransfer!.getData('application/json') || '{}') as {
          type?: string
          infoStripId?: string
        }
        return data.type === 'infoStrip' ? data.infoStripId : ''
      } catch {
        return ''
      }
    })()
  if (!kind || !(INFO_STRIP_KINDS as readonly string[]).includes(kind)) return false
  const sectionContent = (event.currentTarget as HTMLElement)?.closest('.section-content')
  const container = bottom
    ? (sectionContent?.querySelector('.bottom-strips-container') as HTMLElement | null)
    : topContainer.value
  const index = computeFlightStripDropIndex(event, container)
  placeInfoStrip(kind, bottom, index)
  return true
}

/** ESSA SAAB header tint: runway / inbound-from-other / other */
const essaHeaderClass = computed(() => {
  if (!store.essaRolesMode) return undefined
  const id = props.section.id.toLowerCase()
  const title = (props.section.title || '').toUpperCase()
  if (
    id.includes('runway') ||
    title === 'RUNWAY' ||
    title.startsWith('RUNWAY ')
  ) {
    return 'section-header--essa-runway'
  }
  if (isInboundSectionId(id, title)) {
    return 'section-header--essa-inbound'
  }
  return 'section-header--essa-other'
})

const bayAirport = computed(() => {
  const bay = store.layout.bays.find(b => b.id === props.bayId)
  return bay?.airport
})

/** RTC: ARR header → arr RWY(s); DEP header → dep RWY(s) */
const rtcHeaderRwy = computed(() => {
  if (!store.multiAirport || store.isPaperLook) return null
  const icao = (bayAirport.value || '').toUpperCase()
  if (!icao) return null
  const info = store.atisInfo.find((a) => a.airport === icao)
  if (!info) return null
  const id = props.section.id
  if (isRtcArrSectionId(id)) {
    const arr = info.arrRunways ?? []
    return arr.length ? arr.join('/') : null
  }
  if (isRtcDepSectionId(id)) {
    const dep = info.depRunways ?? []
    return dep.length ? dep.join('/') : null
  }
  return null
})

const rtcHeaderRwyTitle = computed(() => {
  if (!rtcHeaderRwy.value) return undefined
  if (isRtcArrSectionId(props.section.id)) return `ARR RWY ${rtcHeaderRwy.value}`
  if (isRtcDepSectionId(props.section.id)) return `DEP RWY ${rtcHeaderRwy.value}`
  return `RWY ${rtcHeaderRwy.value}`
})

/**
 * v-for index the placement line is drawn before (topStrips.length = after the last).
 * Commit index is the non-dragging count; this is that index mapped onto the full list,
 * or the post-sort slot when the section will reorder the drop.
 */
const dropInsertIndex = ref<number | null>(null)

function updateDropPlacementLine(event: DragEvent) {
  const container = topContainer.value
  if (!container) {
    dropInsertIndex.value = null
    return
  }
  // Count without the drag source — same list moveStrip splices into.
  const insert = insertIndexAtClientY(flightStripsIn(container, false), event.clientY)
  showInsertLine(insert)
}

function clearDropPlacementLine() {
  dropInsertIndex.value = null
}

const isBottomDragOver = ref(false)
/** Dropping on this section's header → insert at top of its strip list */
const headerDropActive = ref(false)
const topContainer = ref<HTMLElement | null>(null)
const bottomContainer = ref<HTMLElement | null>(null)

/** Touch/iPad drag: same insert line / bottom-slot as HTML5 dragover. */
const touchDropPlacement = useTouchDropPlacement()
let touchOwnedHighlight = false

const myDropOwnerKey = computed(() =>
  dropHighlightOwnerKey(props.bayId, props.section.id),
)
const html5DropOwner = useDropHighlightOwner()

/** Clear insert line / stick-to tray / header drop — HTML5 dragleave is flaky across sections */
function clearDragHighlights() {
  dropInsertIndex.value = null
  isBottomDragOver.value = false
  headerDropActive.value = false
  touchOwnedHighlight = false
  releaseDropHighlight(myDropOwnerKey.value)
}

function claimHtml5DropHighlight() {
  claimDropHighlight(myDropOwnerKey.value)
}

// Another section claimed the HTML5 marker → drop ours (dragleave often never fires).
watch(html5DropOwner, (owner) => {
  if (owner === myDropOwnerKey.value) return
  if (touchOwnedHighlight) return
  dropInsertIndex.value = null
  isBottomDragOver.value = false
  headerDropActive.value = false
})

watch(touchDropPlacement, (p) => {
  const mine = !!p && p.bayId === props.bayId && p.sectionId === props.section.id
  if (!mine) {
    if (touchOwnedHighlight) {
      clearDragHighlights()
    }
    return
  }
  touchOwnedHighlight = true
  // Touch owns the single global marker — clear any stale HTML5 claim elsewhere
  claimHtml5DropHighlight()
  if (p!.isBottom) {
    dropInsertIndex.value = null
    isBottomDragOver.value = true
    headerDropActive.value = false
    return
  }
  isBottomDragOver.value = false
  headerDropActive.value = p!.insertIndex === 0
  showInsertLine(p!.insertIndex ?? 0)
})

const isTimeSortedSection = computed(() => isTimeSortSectionId(props.section.id))
const isInboundAppSection = computed(() =>
  isInboundAppSectionTitle(props.section.title),
)
const isCtrDepSection = computed(() => isCtrDepSectionId(props.section.id))
const hasEssa = computed(() =>
  store.myAirports.some((a) => a.toUpperCase() === 'ESSA'),
)
/** Time-sort auto-sort: single-airport dep sections (not RTC multi columns). */
const timeSortEnabled = computed(
  () => isTimeSortedSection.value && !store.multiAirport,
)
/** INBOUND APP only: always ETA auto-sort (no sticky manual order). */
const etaSortEnabled = computed(() => isInboundAppSection.value)
/** RTC ARR: ETA + assumed-below-sequence auto-sort */
const rtcArrSortEnabled = computed(() => isRtcArrSectionId(props.section.id))
/** CTR DEP: always ATD auto-sort (earliest at top; no ATD → add sequence at bottom). */
const atdSortEnabled = computed(() => isCtrDepSection.value)
/** RUNWAY: CFTO above L/U; sticky appearance within each tier (addFromTop:false). */
const runwayLuSortEnabled = computed(() => isRunwayOrderSectionId(props.section.id))

/** CD ALL / TSAT: one toggle (TOBT↔MAN or TSAT↔MAN) right of search */
const showSortModeControls = computed(
  () => store.isModeToggleSectionId(props.section.id) && !store.multiAirport,
)

const sectionSortMode = computed(() =>
  store.getSectionSortMode(props.bayId, props.section.id),
)

/**
 * ESSA roles (CDM): TOBT / TSAT. Classic 1RWY/2RWY4BAY (and non-CDM): EOBT only.
 */
const useCdmSortLabels = computed(() => store.essaRolesMode)

const timeModeName = computed(() => {
  if (!useCdmSortLabels.value) return 'EOBT'
  return isClearedSectionId(props.section.id) ? 'TSAT' : 'TOBT'
})

/** Button label = active mode */
const sortModeLabel = computed(() =>
  sectionSortMode.value === 'man' ? 'MAN' : timeModeName.value,
)

const sortModeTitle = computed(() => {
  if (sectionSortMode.value === 'man') {
    return `Manual order - click for ${timeModeName.value}`
  }
  if (!useCdmSortLabels.value) {
    return 'Sort by EOBT - click for MAN'
  }
  return isClearedSectionId(props.section.id)
    ? 'Sort by TSAT (else EOBT) - click for MAN'
    : 'Sort by TOBT (else EOBT) - click for MAN'
})

/**
 * Fixed sort field per section:
 * - Classic (non-ESSA): always EOBT
 * - ESSA pending_dep (CD ALL): TOBT → EOBT (asc — earliest at top)
 * - ESSA cleared (TSAT): TSAT → EOBT (desc — earliest / first at bottom)
 */
function activeTimeSortField(): TimeSortField {
  if (!useCdmSortLabels.value) return 'etobt'
  if (isClearedSectionId(props.section.id)) return 'tsat'
  if (isPendingDepSectionId(props.section.id)) return 'etobt'
  return 'etobt'
}

function activeTimeSortDir(): TimeSortDir {
  // ESSA/SAAB TSAT: earliest (first in sequence) at bottom — same as INBOUND APP ETA.
  // CD ALL / classic EOBT remain earliest-at-top (asc).
  if (useCdmSortLabels.value && isClearedSectionId(props.section.id)) return 'desc'
  return 'asc'
}

/**
 * Sticky manual order: MAN mode on CD ALL/TSAT / paper pending KLARERING,
 * or drag-sticky on other time-sort sections (RTC dep).
 * INBOUND APP / CTR DEP always auto-sort (never sticky).
 * Other INBOUND (TWR/GND) use appearing order + sticky like taxi.
 */
const preferManualOrder = computed(() => {
  if (etaSortEnabled.value || atdSortEnabled.value) return false
  // Paper above-KLARERING is a time-sort section (EOBT); drag → sticky MAN
  if (!timeSortEnabled.value && !paperPendingKlarering.value) return false
  return store.hasManualOrder(props.bayId, props.section.id)
})

/** Current UTC minutes since midnight */
function utcNowMinutes(): number {
  const now = new Date()
  return now.getUTCHours() * 60 + now.getUTCMinutes()
}

/**
 * Parse HHMM / HHMMSS → minutes since midnight, or null if missing/invalid.
 */
function parseHhmmMinutes(hhmm: string | undefined): number | null {
  if (!hhmm) return null
  const digits = hhmm.replace(/\D/g, '')
  if (digits.length < 3) return null
  const normalized = digits.length === 3 ? digits.padStart(4, '0') : digits.slice(0, 4)
  const h = Number(normalized.slice(0, 2))
  const m = Number(normalized.slice(2, 4))
  if (h > 23 || m > 59) return null
  return h * 60 + m
}

/**
 * Sort key relative to "now" with midnight wrap (±12h).
 * Missing/invalid → +∞ so strips without a usable time stay at the bottom in both directions.
 */
function hhmmSortKey(hhmm: string | undefined, nowMin: number = utcNowMinutes()): number {
  const abs = parseHhmmMinutes(hhmm)
  if (abs == null) return Number.POSITIVE_INFINITY
  // Map onto a continuous timeline around now so 2350 sorts before 0010 overnight
  let delta = abs - nowMin
  if (delta > 720) delta -= 1440
  if (delta < -720) delta += 1440
  return nowMin + delta
}

/**
 * Preferred departure time for the active sort mode:
 * - Classic 1/2RWY4BAY: EOBT only (no CDM)
 * - ESSA TSAT (cleared): TSAT → EOBT
 * - ESSA TOBT (pending_dep / RTC dep): TOBT → EOBT
 */
function preferredDepTime(strip: FlightStripData, field: TimeSortField): string | undefined {
  if (!useCdmSortLabels.value) {
    return strip.eobt || undefined
  }
  if (field === 'tsat') {
    return strip.tsat || strip.eobt || undefined
  }
  return strip.tobt || strip.eobt || undefined
}

function depTimeSortKey(
  strip: FlightStripData,
  field: TimeSortField,
  nowMin: number = utcNowMinutes(),
): number {
  return hhmmSortKey(preferredDepTime(strip, field), nowMin)
}

function collectTopStrips(): FlightStripData[] {
  const list: FlightStripData[] = []
  store.strips.forEach((strip) => {
    if (strip.bayId === props.bayId && strip.sectionId === props.section.id && !strip.bottom) {
      list.push(strip)
    }
  })
  return list
}

/**
 * Mixed TAXI / RTC TWY stack: arrivals (taxi-in) above departures (taxi-out);
 * sticky appearance order within each tier.
 */
function taxiMixedStackRank(strip: FlightStripData): number {
  if (strip.stripType === 'arrival') return 0
  if (strip.stripType === 'departure') return 1
  if (strip.stripType === 'local') {
    const gs = (strip.groundstate || '').toUpperCase()
    if (gs === 'ARR' || gs === 'TXIN' || gs === 'PARK') return 0
    if (strip.clearedToLand) return 0
    return 1
  }
  return 1
}

function sortTaxiMixedStack(list: FlightStripData[]): FlightStripData[] {
  return [...list].sort((a, b) => {
    const ra = taxiMixedStackRank(a)
    const rb = taxiMixedStackRank(b)
    if (ra !== rb) return ra - rb
    if (a.position !== b.position) return a.position - b.position
    return a.callsign.localeCompare(b.callsign)
  })
}

function sortByDepTime(
  list: FlightStripData[],
  field: TimeSortField,
  dir: TimeSortDir,
): FlightStripData[] {
  const nowMin = utcNowMinutes()
  return [...list].sort((a, b) => {
    const ka = depTimeSortKey(a, field, nowMin)
    const kb = depTimeSortKey(b, field, nowMin)
    const aMiss = !Number.isFinite(ka)
    const bMiss = !Number.isFinite(kb)
    // Missing times always at the bottom, regardless of asc/desc
    if (aMiss !== bMiss) return aMiss ? 1 : -1
    // asc: earliest at top; desc: earliest at bottom
    const d = dir === 'asc' ? ka - kb : kb - ka
    if (d !== 0) return d
    const cs = a.callsign.localeCompare(b.callsign)
    if (cs !== 0) return cs
    return a.position - b.position
  })
}

/** ETA sort for SAAB INBOUND APP — earliest = first in sequence at bottom (toward CTR ARR); missing at top. */
function sortByEta(list: FlightStripData[]): FlightStripData[] {
  const nowMin = utcNowMinutes()
  return [...list].sort((a, b) => {
    const ka = hhmmSortKey(a.eta, nowMin)
    const kb = hhmmSortKey(b.eta, nowMin)
    const aMiss = !Number.isFinite(ka)
    const bMiss = !Number.isFinite(kb)
    // Missing ETA at top so they don't sit under the sequence
    if (aMiss !== bMiss) return aMiss ? -1 : 1
    // Later ETAs toward the top; earliest (first in sequence) at bottom
    const d = kb - ka
    if (d !== 0) return d
    const cs = a.callsign.localeCompare(b.callsign)
    if (cs !== 0) return cs
    return a.position - b.position
  })
}

/**
 * RTC ARR: sequence (non-assumed / pending inbound) above assumed.
 * Within each tier: closest ETA at bottom of tier; missing ETA at top of tier.
 */
function isRtcArrSequenceStrip(strip: FlightStripData): boolean {
  // Pending inbound handoff stays in the sequence even if briefly flagged assumed
  if (strip.transferPending === 'in') return true
  return !strip.isAssumed
}

function sortRtcArrByEtaAndAssume(list: FlightStripData[]): FlightStripData[] {
  const nowMin = utcNowMinutes()
  return [...list].sort((a, b) => {
    const aSeq = isRtcArrSequenceStrip(a)
    const bSeq = isRtcArrSequenceStrip(b)
    // Sequence tier above assumed
    if (aSeq !== bSeq) return aSeq ? -1 : 1

    const ka = hhmmSortKey(a.eta, nowMin)
    const kb = hhmmSortKey(b.eta, nowMin)
    const aMiss = !Number.isFinite(ka)
    const bMiss = !Number.isFinite(kb)
    if (aMiss !== bMiss) return aMiss ? -1 : 1
    // Later ETA toward top of tier; closest ETA at bottom of tier
    const d = kb - ka
    if (d !== 0) return d
    const cs = a.callsign.localeCompare(b.callsign)
    if (cs !== 0) return cs
    return a.position - b.position
  })
}

/**
 * Paper stick-bottom INBOUND — stack justified to bottom; earliest ETA at top of
 * that stack (later toward the bay floor); missing ETA at bottom of stack.
 */
function sortByEtaEarliestTop(list: FlightStripData[]): FlightStripData[] {
  const nowMin = utcNowMinutes()
  return [...list].sort((a, b) => {
    const ka = hhmmSortKey(a.eta, nowMin)
    const kb = hhmmSortKey(b.eta, nowMin)
    const aMiss = !Number.isFinite(ka)
    const bMiss = !Number.isFinite(kb)
    if (aMiss !== bMiss) return aMiss ? 1 : -1
    const d = ka - kb
    if (d !== 0) return d
    const cs = a.callsign.localeCompare(b.callsign)
    if (cs !== 0) return cs
    return a.position - b.position
  })
}

/**
 * Paper CLR read (col 4) while still above KLARERING.
 * Prefer local read without ES CLR/correct (those move under the header).
 */
function stripHasClrReadAbove(strip: FlightStripData): boolean {
  if (strip.clearance || strip.clearanceReadback) return false
  return !!strip.clearanceRead
}

/**
 * Paper pending above KLARERING:
 * CLR read at bottom (against header); within each group earliest EOBT at bottom; missing EOBT at top.
 */
function sortByEobtEarliestBottom(list: FlightStripData[]): FlightStripData[] {
  const nowMin = utcNowMinutes()
  return [...list].sort((a, b) => {
    const aClr = stripHasClrReadAbove(a)
    const bClr = stripHasClrReadAbove(b)
    if (aClr !== bClr) return aClr ? 1 : -1
    const ka = hhmmSortKey(a.eobt, nowMin)
    const kb = hhmmSortKey(b.eobt, nowMin)
    const aMiss = !Number.isFinite(ka)
    const bMiss = !Number.isFinite(kb)
    if (aMiss !== bMiss) return aMiss ? -1 : 1
    const d = kb - ka
    if (d !== 0) return d
    const cs = a.callsign.localeCompare(b.callsign)
    if (cs !== 0) return cs
    return a.position - b.position
  })
}

/**
 * ATD sort for CTR DEP — earliest ATD at top (upwards DEP RWY → CTR DEP flow).
 * No ATD → add-sequence at bottom (position order; new strips addFromTop:false → high position).
 * Equal ATD → keep add-sequence / bay appearance order (earlier appearance toward top).
 */
function sortByAtd(list: FlightStripData[]): FlightStripData[] {
  const nowMin = utcNowMinutes()
  return [...list].sort((a, b) => {
    const ka = hhmmSortKey(a.atd, nowMin)
    const kb = hhmmSortKey(b.atd, nowMin)
    const aMiss = !Number.isFinite(ka)
    const bMiss = !Number.isFinite(kb)
    if (aMiss && bMiss) return a.position - b.position
    // Missing ATD at bottom so new/unset sit under the ATD sequence
    if (aMiss !== bMiss) return aMiss ? 1 : -1
    // Earliest ATD at top (first departed toward top)
    const d = ka - kb
    if (d !== 0) return d
    // Same ATD: earlier bay appearance (lower position) toward top
    return a.position - b.position
  })
}

/** Gaps only when not in auto time/ETA/ATD/RWY-L/U-sort mode */
const showGaps = computed(
  () =>
    !stickBottomZone.value &&
    !etaSortEnabled.value &&
    !rtcArrSortEnabled.value &&
    !atdSortEnabled.value &&
    !runwayLuSortEnabled.value &&
    (!timeSortEnabled.value || preferManualOrder.value),
)

/** Same order topStrips shows. Used to predict where a drop will actually sit. */
function orderTopStrips(list: FlightStripData[]): FlightStripData[] {
  // Paper KLARERING (above header): EOBT (+ CLR read at bottom) until user
  // drags — then sticky positions; new prints insert by EOBT without re-sort.
  if (paperPendingKlarering.value) {
    if (preferManualOrder.value) {
      return list.sort((a, b) => a.position - b.position)
    }
    return sortByEobtEarliestBottom(list)
  }

  // INBOUND APP: always ETA (drag reorder does not stick)
  if (etaSortEnabled.value) {
    // Paper stick-bottom: earliest at top of bottom-justified stack
    return stickBottomZone.value ? sortByEtaEarliestTop(list) : sortByEta(list)
  }

  // RTC ARR: non-assumed / pending-in above assumed; closest ETA at bottom of each tier
  if (rtcArrSortEnabled.value) {
    return sortRtcArrByEtaAndAssume(list)
  }

  // CTR DEP: always ATD (earliest at top; no ATD → add sequence at bottom)
  if (atdSortEnabled.value) {
    return sortByAtd(list)
  }

  // RUNWAY: CFTO above LINEUP; sticky appearance within tier / for non-L/U
  if (runwayLuSortEnabled.value) {
    return sortRunwayLuOrder(list)
  }

  // TAXI / RTC TWY: ARR (taxi-in) above DEP (taxi-out); sticky within tier
  if (isTaxiSectionId(props.section.id)) {
    return sortTaxiMixedStack(list)
  }

  if (timeSortEnabled.value && !preferManualOrder.value) {
    return sortByDepTime(list, activeTimeSortField(), activeTimeSortDir())
  }

  return list.sort((a, b) => a.position - b.position)
}

const topStrips = computed(() => {
  void store.stripsVersion
  // Re-read mode when user toggles TOBT/MAN
  void sectionSortMode.value
  return orderTopStrips(collectTopStrips())
})

/**
 * Sections whose display sort ignores a raw drop index (ETA / ATD / runway tier / taxi tier).
 * Time-sort bays (TSAT, CD ALL) freeze to manual on drop, so the pointer index sticks.
 */
function displayReordersDrop(): boolean {
  return (
    etaSortEnabled.value ||
    atdSortEnabled.value ||
    rtcArrSortEnabled.value ||
    runwayLuSortEnabled.value ||
    isTaxiSectionId(props.section.id)
  )
}

/**
 * Paper pending → cleared always inserts at the top (moveStripToSection).
 * Returns that commit index, or null when the pointer index is used.
 */
function forcedInsertIndex(strip: FlightStripData | undefined): number | null {
  if (!strip) return null
  const sameTop =
    strip.bayId === props.bayId && strip.sectionId === props.section.id && !strip.bottom
  if (sameTop) return null
  if (
    store.isPaperLook &&
    isPendingDepSectionId(strip.sectionId) &&
    isClearedSectionId(props.section.id)
  ) {
    return 0
  }
  return null
}

/**
 * Where `dragged` will sit after moveStrip splices `insertAmongVisible` into
 * position order and this section's existing sort runs.
 * Return value is a v-for index in the current topStrips (length = end).
 */
function predictVisualLine(insertAmongVisible: number, dragged: FlightStripData): number {
  const others = store.getTopStrips(props.bayId, props.section.id).filter((s) => s.id !== dragged.id)
  const at = Math.max(0, Math.min(insertAmongVisible, others.length))
  const placed: FlightStripData[] = []
  let pos = 0
  for (let i = 0; i < others.length; i++) {
    if (i === at) placed.push({ ...dragged, position: pos++ })
    const other = others[i]
    if (other) placed.push({ ...other, position: pos++ })
  }
  if (at >= others.length) placed.push({ ...dragged, position: pos })

  const sorted = orderTopStrips(placed)
  const current = topStrips.value
  // No visual change — mark the drag source's own row (not a slot below it).
  if (sorted.length === current.length && sorted.every((s, i) => s.id === current[i]?.id)) {
    const self = current.findIndex((s) => s.id === dragged.id)
    return self < 0 ? current.length : self
  }
  const idx = sorted.findIndex((s) => s.id === dragged.id)
  if (idx < 0 || idx >= sorted.length - 1) return current.length
  const below = sorted[idx + 1]
  if (!below) return current.length
  const vis = current.findIndex((s) => s.id === below.id)
  return vis < 0 ? current.length : vis
}

/** Draw the placement line at the row the drop will actually occupy. */
function showInsertLine(insertAmongVisible: number) {
  const id = draggingStripId()
  const dragged = id ? store.strips.get(id) : undefined
  const forced = forcedInsertIndex(dragged)
  if (forced != null) {
    dropInsertIndex.value = forced
    return
  }
  if (dragged && displayReordersDrop()) {
    dropInsertIndex.value = predictVisualLine(insertAmongVisible, dragged)
    return
  }
  const container = topContainer.value
  const all = container ? flightStripsIn(container, true) : []
  dropInsertIndex.value = all.length
    ? visualIndexForInsert(all, insertAmongVisible)
    : insertAmongVisible
}

function toggleSortMode() {
  if (sectionSortMode.value === 'man') {
    // MAN → TOBT/TSAT: resume time-sort (re-sort OK)
    store.setSectionSortMode(props.bayId, props.section.id, 'time')
    return
  }
  // TOBT/TSAT → MAN: freeze current visual (time-sorted) order; do not reshuffle
  const orderedIds = topStrips.value.map((s) => s.id)
  store.enterManualSortMode(props.bayId, props.section.id, orderedIds)
}

/** Last preferred HHMM per strip — RTC dep sticky-manual clears when times change */
const lastSortTimes = ref<Map<string, string>>(new Map())

// RTC / non-toggle time-sort sections: drop sticky manual when TOBT/EOBT changes
watch(
  () => [store.stripsVersion, hasEssa.value, store.multiAirport] as const,
  () => {
    if (!timeSortEnabled.value) return
    // CD ALL / TSAT use explicit TOBT|MAN / TSAT|MAN — do not auto-clear MAN
    if (store.isModeToggleSectionId(props.section.id)) return
    const field = activeTimeSortField()
    const list = collectTopStrips()
    const nextTimes = new Map<string, string>()
    let timeChanged = false
    for (const strip of list) {
      const time = preferredDepTime(strip, field) || ''
      nextTimes.set(strip.id, time)
      if (lastSortTimes.value.has(strip.id) && lastSortTimes.value.get(strip.id) !== time) {
        timeChanged = true
      }
    }
    lastSortTimes.value = nextTimes
    if (timeChanged) {
      store.clearManualOrder(props.bayId, props.section.id)
    }
  },
)

const bottomStrips = computed(() => {
  void store.stripsVersion
  return store.getBottomStrips(props.bayId, props.section.id)
})
const hasPinnedZoneContent = computed(
  () =>
    bottomStrips.value.length > 0 ||
    showBreakoutAtBottom.value ||
    showMapAtBottom.value ||
    showDepAtBottom.value ||
    showTurnAtBottom.value ||
    showSid19lAtBottom.value ||
    showR16AtBottom.value,
)
const sectionGaps = computed(() => store.getGapsForSection(props.bayId, props.section.id))

/** Ordered ids for FLIP when sort/add shifts neighbors (matches auto-move timing). */
const topStripIds = computed(() => topStrips.value.map((s) => s.id))
const bottomStripIds = computed(() => bottomStrips.value.map((s) => s.id))
/**
 * Stick-bottom zones (and cleared under pending): skip FLIP on manual drag
 * (ghost strips), but allow it during auto-moves for neighbor shifts.
 */
const stripFlipEnabled = computed(() => {
  if (store.autoMovingStripIds.size > 0) return true
  if (stickBottomZone.value) return false
  if (store.isPaperLook && isClearedSectionId(props.section.id)) {
    const bay = store.layout.bays.find((b) => b.id === props.bayId)
    const idx = bay?.sections.findIndex((s) => s.id === props.section.id) ?? -1
    const above = idx > 0 ? bay!.sections[idx - 1] : undefined
    if (above?.hideHeader && isPendingDepSectionId(above.id)) return false
  }
  return true
})
useStripOrderFlip(topContainer, topStripIds, stripFlipEnabled)
useStripOrderFlip(bottomContainer, bottomStripIds, stripFlipEnabled)

const sectionRoot = ref<HTMLElement | null>(null)

/**
 * Lock this section's pixel height before an auto-move remounts strips.
 * Otherwise content enter/leave resizes the section and headers jump.
 * Heights stay locked after the fly (manual resize can still change them).
 */
function freezeSectionHeightForAutoMove() {
  if (props.isLastSection) return
  const el = sectionRoot.value
  if (!el) return
  const h = el.getBoundingClientRect().height
  if (h < 1) return
  store.setSectionHeight(props.bayId, props.section.id, h, false)
}

/** Stick-bottom zones: keep main strips visible against the header when overflowing. */
function pinStickBottomScroll() {
  if (!stickBottomZone.value) return
  const el = topContainer.value
  if (!el) return
  if (el.scrollHeight <= el.clientHeight + 1) {
    el.scrollTop = 0
    return
  }
  el.scrollTop = el.scrollHeight - el.clientHeight
}

let pendingScrollObserver: ResizeObserver | null = null

watch(
  [topStripIds, stickBottomZone],
  async () => {
    if (!stickBottomZone.value) return
    // Don't fight neighbor FLIP mid auto-move
    if (store.autoMovingStripIds.size > 0) return
    await nextTick()
    requestAnimationFrame(pinStickBottomScroll)
  },
  { flush: 'post' },
)

// Lock section heights before the strip remounts (beginAutoMove is sync-first).
// Do not freeze the stick-bottom spacer — neighbors must shift (FLIP) into the gap.
watch(
  () => store.autoMovingStripIds.size,
  (n, was) => {
    const prev = was ?? 0
    if (n > 0 && prev === 0) {
      freezeSectionHeightForAutoMove()
    }
    if (n === 0 && prev > 0) {
      scheduleAutoFitRecheck()
    }
  },
  { flush: 'sync' },
)

/** SAAB auto-fit: event-driven recheck (option A) + scroll-center first-in-sequence. */
const uiScalePercent = useUiScalePercent()
let autoFitTimer: ReturnType<typeof setTimeout> | null = null
let autoFitRunning = false
let autoFitQueued = false

function stripCanCompact(stripId: string): boolean {
  const strip = store.strips.get(stripId)
  if (!strip) return false
  const t = strip.stripType
  return t === 'departure' || t === 'arrival' || t === 'local' || t === 'vfr'
}

/** Ignore layout noise right after a fit pass (scrollbar show/hide, etc.). */
let autoFitSettleUntil = 0

/** @param force skip settle lock (strip list / header height — intentional). */
function scheduleAutoFitRecheck(force = false) {
  if (store.isPaperLook) return
  if (stickBottomZone.value) return
  if (store.autoMovingStripIds.size > 0) return
  // During an in-flight fit, queue a follow-up — do not drop resize/list updates
  // (dropping caused stale maximize priority and flicker after section drags).
  if (autoFitApplying.value || autoFitRunning) {
    autoFitQueued = true
    return
  }
  if (!force && Date.now() < autoFitSettleUntil) return
  if (autoFitTimer) clearTimeout(autoFitTimer)
  autoFitTimer = setTimeout(() => {
    autoFitTimer = null
    void runScheduledAutoFit()
  }, 80)
}

async function runScheduledAutoFit() {
  if (store.isPaperLook) return
  if (stickBottomZone.value) return
  if (store.autoMovingStripIds.size > 0) return
  if (autoFitApplying.value) {
    autoFitQueued = true
    return
  }
  if (autoFitRunning) {
    autoFitQueued = true
    return
  }
  const el = topContainer.value
  if (!el) return
  autoFitRunning = true
  try {
    do {
      autoFitQueued = false
      await runAutoFitStripSize({
        container: el,
        visualIds: topStripIds.value,
        // Size priority follows first-in-sequence, not insert addFromTop.
        // ESSA/SAAB INBOUND APP + TSAT: earliest (first) at visual bottom — keep
        // that strip maximised (preferTop:false). Other bays: first at visual top.
        preferTop: !(
          hasEssa.value &&
          (isInboundAppSection.value ||
            (useCdmSortLabels.value && isClearedSectionId(props.section.id)))
        ),
        canCompact: stripCanCompact,
        allowSizeFit:
          store.autoFitStripSizeMode === 'all' ||
          (store.autoFitStripSizeMode === 'standard' &&
            !isAutoFitExemptSection(props.section.id)),
        growBack:
          store.autoFitStripSizeMode !== 'off' && store.autoFitStripSizeGrowBack,
        // CD ALL / TSAT / PENDING DEP / CLEARED: keep bottom in view when scrolled
        scrollToBottom: isCdAllOrTsatSection(props.section.id),
      })
    } while (autoFitQueued && !autoFitApplying.value)
    // Scrollbar appearing/disappearing must not immediately re-run fit
    autoFitSettleUntil = Date.now() + 180
    if (el) {
      lastAutoFitClientH = el.clientHeight
      lastAutoFitClientW = el.clientWidth
    }
  } finally {
    autoFitRunning = false
  }
}

watch(
  [topStripIds, () => props.section.height, sectionGaps],
  () => {
    scheduleAutoFitRecheck(true)
  },
  { flush: 'post' },
)

watch(
  [
    () => store.autoFitStripSizeMode,
    () => store.autoFitStripSizeGrowBack,
    autoFitLayoutEpoch,
    uiScalePercent,
  ],
  () => {
    scheduleAutoFitRecheck(true)
  },
  { flush: 'post' },
)

watch(topStripIds, (ids, prev) => {
  if (!prev) return
  for (const id of prev) {
    if (!ids.includes(id)) clearAutoFitState(id)
  }
})

function onWindowResizeForAutoFit() {
  scheduleAutoFitRecheck()
}

/** Viewport size only (header drag / bay scale) — not content height (avoids fit loops). */
let autoFitViewportObserver: ResizeObserver | null = null
let lastAutoFitClientH = 0
let lastAutoFitClientW = 0

onMounted(() => {
  // Dropping in another section (e.g. above KLARERING) often skips this section's
  // dragleave — left a cyan insert/header indicator until reload.
  document.addEventListener('dragend', clearDragHighlights, true)
  document.addEventListener('drop', clearDragHighlights, true)
  window.addEventListener('resize', onWindowResizeForAutoFit)

  scheduleAutoFitRecheck()

  const el = topContainer.value
  if (el && typeof ResizeObserver !== 'undefined') {
    if (stickBottomZone.value) {
      pendingScrollObserver = new ResizeObserver(() => {
        if (stickBottomZone.value && store.autoMovingStripIds.size === 0) {
          pinStickBottomScroll()
        }
      })
      pendingScrollObserver.observe(el)
    } else if (!store.isPaperLook) {
      lastAutoFitClientH = el.clientHeight
      lastAutoFitClientW = el.clientWidth
      autoFitViewportObserver = new ResizeObserver(() => {
        const c = topContainer.value
        if (!c) return
        // Height matters for fit. Ignore width-only changes (scrollbar gutter)
        // which otherwise shrink↔grow forever on the knife-edge.
        const h = c.clientHeight
        const w = c.clientWidth
        const heightDelta = h - lastAutoFitClientH
        const heightChanged = Math.abs(heightDelta) >= 2
        const widthOnly =
          !heightChanged && Math.abs(w - lastAutoFitClientW) > 0
        lastAutoFitClientH = h
        lastAutoFitClientW = w
        if (widthOnly) return
        if (!heightChanged) return
        // Height growth must always recheck (grow-back). Settle lock would
        // otherwise swallow header-drag enlarges on flexing last sections.
        // scheduleAutoFitRecheck queues when a fit is already running.
        scheduleAutoFitRecheck(heightDelta > 0)
      })
      autoFitViewportObserver.observe(el)
    }
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('dragend', clearDragHighlights, true)
  document.removeEventListener('drop', clearDragHighlights, true)
  window.removeEventListener('resize', onWindowResizeForAutoFit)
  if (autoFitTimer) clearTimeout(autoFitTimer)
  pendingScrollObserver?.disconnect()
  pendingScrollObserver = null
  autoFitViewportObserver?.disconnect()
  autoFitViewportObserver = null
})

const {
  showHere: showTurnHere,
  atBottom: showTurnAtBottom,
  beforeTop: showTurnBeforeTopIndex,
  endTop: showTurnAtEndOfTop,
  beforeBottom: showTurnBeforeBottomIndex,
  endBottom: showTurnAtEndOfBottom,
} = createRwyBayTopHost(turnVisible, turnPlacement, turnDefaultSectionId, topStrips, bottomStrips)

const {
  showHere: showSid19lHere,
  atBottom: showSid19lAtBottom,
  beforeTop: showSid19lBeforeTopIndex,
  endTop: showSid19lAtEndOfTop,
  beforeBottom: showSid19lBeforeBottomIndex,
  endBottom: showSid19lAtEndOfBottom,
} = createRwyBayTopHost(sid19lVisible, sid19lPlacement, sid19lDefaultSectionId, topStrips, bottomStrips)

const {
  showHere: showR16Here,
  atBottom: showR16AtBottom,
  beforeTop: showR16BeforeTopIndex,
  endTop: showR16AtEndOfTop,
  beforeBottom: showR16BeforeBottomIndex,
  endBottom: showR16AtEndOfBottom,
} = createRwyBayTopHost(r16Visible, r16Placement, r16DefaultSectionId, topStrips, bottomStrips, {
  defaultBayId: r16DefaultBayId,
  requireRolesMode: false,
})

const sectionStyle = computed(() => {
  const noHeader = !!props.section.hideHeader
  // Last section always flexes to fill remaining space
  if (props.isLastSection) {
    return { flex: '1 1 auto', minHeight: noHeader ? '0px' : '80px' }
  }
  // Other sections: apply stored height, don't grow or shrink
  // Using flex: 0 0 auto prevents other sections from "bumping" during resize
  if (props.section.height) {
    return {
      height: `${props.section.height}px`,
      flex: '0 0 auto'  // don't grow, don't shrink
    }
  }
  // Headerless strip zones (e.g. pending above KLARERING) size to content
  if (noHeader) {
    return { flex: '1 1 auto', minHeight: '0px' }
  }
  return {}
})

// Resize handling
function findResizePair(eventTarget: EventTarget | null): {
  sectionAbove: Element
  sectionAboveId: string
  sectionEl: Element
  aboveHeight: number
  belowHeight: number
} | null {
  if (props.isFirstSection) return null
  const sectionEl = (eventTarget as HTMLElement | null)?.closest?.('.efs-section')
  if (!sectionEl) return null
  const bayEl = sectionEl.closest('.efs-bay')
  if (!bayEl) return null
  const allSections = Array.from(bayEl.querySelectorAll('.efs-section'))
  const currentIndex = allSections.indexOf(sectionEl)
  if (currentIndex <= 0) return null
  const sectionAbove = allSections[currentIndex - 1]
  const sectionAboveId = sectionAbove?.getAttribute('data-section-id')
  if (!sectionAbove || !sectionAboveId) return null
  return {
    sectionAbove,
    sectionAboveId,
    sectionEl,
    aboveHeight: sectionAbove.getBoundingClientRect().height,
    belowHeight: sectionEl.getBoundingClientRect().height,
  }
}

function onResizeStart(event: MouseEvent | TouchEvent) {
  const pair = findResizePair(event.currentTarget)
  if (!pair) return

  // Only fix height on the section above (the one we're resizing)
  // Don't touch other sections to avoid unintended layout shifts
  store.setSectionHeight(props.bayId, pair.sectionAboveId, pair.aboveHeight)

  // For the current section, only fix height if it's NOT the last section
  // Last section always flexes to fill remaining space
  if (!props.isLastSection) {
    store.setSectionHeight(props.bayId, props.section.id, pair.belowHeight)
  }

  // Start resize: section above grows/shrinks, current section does the inverse
  startResize(
    event,
    props.bayId,
    pair.sectionAboveId,
    pair.aboveHeight,
    props.section.id,
    pair.belowHeight,
    props.isLastSection,
  )
}

/** Double-click the header resize key → put the divider halfway between the pair. */
function onResizeReset(event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
  const pair = findResizePair(event.currentTarget)
  if (!pair) return

  const half = Math.max(80, (pair.aboveHeight + pair.belowHeight) / 2)
  store.setSectionHeight(props.bayId, pair.sectionAboveId, half)
  if (!props.isLastSection) {
    store.setSectionHeight(props.bayId, props.section.id, half)
  }
}

// Gap click handler - remove the gap
function onGapClick(index: number) {
  store.removeGapAtIndex(props.bayId, props.section.id, index)
}

// Approximate half-height of a flight strip (for estimating "strip top" from cursor Y)
const HALF_STRIP_HEIGHT = 22

// Compute position + gap info for a new strip drop in the top zone
function computeTopZoneCreateDrop(event: DragEvent): { position: number; gapIndex?: number; gapSize: number } {
  const container = topContainer.value
  if (!container) return { position: 0, gapSize: 0 }

  const allStripElements = Array.from(container.querySelectorAll('.flight-strip'))
  const draggedStripTop = event.clientY - HALF_STRIP_HEIGHT

  let position = allStripElements.length
  let droppedBelowLastStrip = false
  let distanceBelowLastStrip = 0
  let droppedIntoEmptySection = false
  let distanceFromTop = 0

  if (allStripElements.length > 0) {
    const lastStrip = allStripElements[allStripElements.length - 1]
    if (lastStrip) {
      const lastRect = lastStrip.getBoundingClientRect()
      if (draggedStripTop > lastRect.bottom) {
        droppedBelowLastStrip = true
        distanceBelowLastStrip = draggedStripTop - lastRect.bottom
      }
    }
  } else {
    const containerRect = container.getBoundingClientRect()
    distanceFromTop = draggedStripTop - containerRect.top
    if (distanceFromTop >= store.GAP_BUFFER) {
      droppedIntoEmptySection = true
    }
  }

  for (let i = 0; i < allStripElements.length; i++) {
    const element = allStripElements[i]
    if (!element) continue
    const rect = element.getBoundingClientRect()
    const midpoint = rect.top + rect.height / 2
    if (event.clientY < midpoint) {
      position = i
      droppedBelowLastStrip = false
      break
    }
  }

  let gapIndex: number | undefined
  let gapSize = 0

  if (droppedBelowLastStrip && distanceBelowLastStrip >= store.GAP_BUFFER) {
    gapIndex = position
    gapSize = distanceBelowLastStrip
  } else if (droppedIntoEmptySection) {
    gapIndex = 0
    gapSize = distanceFromTop
  }

  return { position, gapIndex, gapSize }
}

// Compute position for a new strip drop in the bottom strips zone
function computeBottomStripsDrop(event: DragEvent): number {
  const bottomContainer = (event.currentTarget as HTMLElement)
  const stripElements = Array.from(bottomContainer.querySelectorAll('.flight-strip'))
  let position = stripElements.length

  for (let i = 0; i < stripElements.length; i++) {
    const element = stripElements[i]
    if (!element) continue
    const rect = element.getBoundingClientRect()
    const midpoint = rect.top + rect.height / 2
    if (event.clientY < midpoint) {
      position = i
      break
    }
  }

  return position
}

// Apply a pending create (note or dialog) with position + gap
function applyCreate(
  type: SpecialStripType,
  callsign?: string,
  aircraftType?: string,
  airport?: string,
  position?: number,
  isBottom?: boolean,
  gapIndex?: number,
  gapSize?: number
) {
  store.createStrip(type, callsign, aircraftType, airport, props.bayId, props.section.id, position, isBottom)
  if (gapIndex !== undefined && gapSize && gapSize >= store.GAP_BUFFER) {
    store.setGapAtIndex(props.bayId, props.section.id, gapIndex, gapSize)
  }
}

// Handle create from StripCreationDialog
function onDialogCreate(data: { callsign: string; aircraftType?: string; airport?: string }) {
  applyCreate(
    createDialogType.value,
    data.callsign,
    data.aircraftType,
    data.airport,
    pendingCreatePosition.value,
    pendingCreateIsBottom.value,
    pendingCreateGapIndex.value,
    pendingCreateGapSize.value
  )
}

// Open the dialog with pending position/gap info
function openCreateDialog(type: SpecialStripType, position?: number, isBottom = false, gapIndex?: number, gapSize = 0) {
  createDialogType.value = type
  createDialogAirport.value = bayAirport.value
  pendingCreatePosition.value = position
  pendingCreateIsBottom.value = isBottom
  pendingCreateGapIndex.value = gapIndex
  pendingCreateGapSize.value = gapSize

  // Note: immediate unless multi-airport RTC. Vehicle always opens dialog (callsign).
  if (type === 'note' && !store.multiAirport) {
    applyCreate(type, undefined, undefined, bayAirport.value, position, isBottom, gapIndex, gapSize)
    return
  }

  createDialogOpen.value = true
}

/** Header-drop preview index (RTC: dep → bottom of TWY/RWY; arr → top). */
function headerDropInsertIndex(stripId?: string): number {
  const count = topStrips.value.length
  if (!store.multiAirport || !stripId) return 0
  const strip = store.strips.get(stripId)
  if (!strip) return 0
  const atTop = rtcInsertAtTop(props.section.id, strip.stripType, strip.groundstate)
  // Exclude the moving strip if already in this section
  const others = strip.bayId === props.bayId && strip.sectionId === props.section.id ? count - 1 : count
  return atTop ? 0 : Math.max(0, others)
}

// Header drop → top by default; RTC TWY/RWY use arr-top / dep-bottom
function onHeaderDragOver(event: DragEvent) {
  event.preventDefault()
  if (event.dataTransfer) {
    const isCreateDrag = event.dataTransfer.types.includes('application/efs-create')
    event.dataTransfer.dropEffect = isCreateDrag ? 'copy' : 'move'
  }
  claimHtml5DropHighlight()
  headerDropActive.value = true
  isBottomDragOver.value = false
  showInsertLine(headerDropInsertIndex(draggingStripId() ?? undefined))
}

function onHeaderDragEnter(event: DragEvent) {
  event.preventDefault()
  claimHtml5DropHighlight()
  headerDropActive.value = true
  isBottomDragOver.value = false
  showInsertLine(headerDropInsertIndex(draggingStripId() ?? undefined))
}

function onHeaderDragLeave(event: DragEvent) {
  const target = event.currentTarget as HTMLElement
  const related = event.relatedTarget as HTMLElement | null
  if (!related || !target.contains(related)) {
    headerDropActive.value = false
  }
}

function onHeaderDrop(event: DragEvent) {
  event.preventDefault()
  event.stopPropagation()
  headerDropActive.value = false
  clearDropPlacementLine()
  isBottomDragOver.value = false

  if (!event.dataTransfer) return

  const createType = event.dataTransfer.getData('application/efs-create')
  if (createType) {
    const t = createType as SpecialStripType
    const stripType =
      t === 'vfrDep' ? 'departure' : t === 'vfrArr' ? 'arrival' : t === 'cross' ? 'cross' : 'note'
    const pos =
      store.multiAirport && !rtcInsertAtTop(props.section.id, stripType)
        ? topStrips.value.length
        : 0
    openCreateDialog(t, pos, false)
    return
  }

  if (tryHandleInfoStripDrop(event, false)) return

  try {
    const data = JSON.parse(event.dataTransfer.getData('application/json'))
    if (data?.type === 'infoStrip') return
    if (!data?.stripId) return
    store.syncTimeSortSectionFromDom(props.bayId, props.section.id, topContainer.value)
    const pos = headerDropInsertIndex(data.stripId)
    store.moveStripToSection(data.stripId, props.bayId, props.section.id, pos)
  } catch (error) {
    console.error('Error handling header drop:', error)
  }
}

// Top strips drag handling
function onTopDragOver(event: DragEvent) {
  event.preventDefault()
  if (event.dataTransfer) {
    // Set appropriate dropEffect based on drag source
    const isCreateDrag = event.dataTransfer.types.includes('application/efs-create')
    event.dataTransfer.dropEffect = isCreateDrag ? 'copy' : 'move'
  }
  claimHtml5DropHighlight()
  headerDropActive.value = false
  isBottomDragOver.value = false
  updateDropPlacementLine(event)
}

function onTopDragEnter(event: DragEvent) {
  claimHtml5DropHighlight()
  headerDropActive.value = false
  isBottomDragOver.value = false
  updateDropPlacementLine(event)
}

function onTopDragLeave(event: DragEvent) {
  const target = event.currentTarget as HTMLElement
  const relatedTarget = event.relatedTarget as HTMLElement
  if (!target.contains(relatedTarget)) {
    clearDropPlacementLine()
  }
}

function onTopDrop(event: DragEvent) {
  event.preventDefault()
  clearDropPlacementLine()
  headerDropActive.value = false
  isBottomDragOver.value = false

  if (!event.dataTransfer) return

  // Handle create-strip drops from bottom bar
  const createType = event.dataTransfer.getData('application/efs-create')
  if (createType) {
    const type = createType as SpecialStripType
    const { position, gapIndex, gapSize } = computeTopZoneCreateDrop(event)
    openCreateDialog(type, position, false, gapIndex, gapSize)
    return
  }

  if (tryHandleInfoStripDrop(event, false)) return

  try {
    const data = JSON.parse(event.dataTransfer.getData('application/json'))
    if (data?.type === 'infoStrip') return
    const { stripId, bayId: sourceBayId, sectionId: sourceSectionId, isBottom: sourceIsBottom, originalTop, originalBottom, stripHeight, dragOffsetY } = data

    const container = topContainer.value
    if (!container) return

    // Only consider "same section" if strip is in top zone of same section
    // Strips from bottom zone don't leave a space in top zone, so treat as cross-section move
    const isSameSection = sourceBayId === props.bayId && sourceSectionId === props.section.id && !sourceIsBottom
    const allStripElements = Array.from(container.querySelectorAll('.flight-strip'))
    const allGapElements = Array.from(container.querySelectorAll('.strip-gap'))

    // Calculate where the strip's top would be based on cursor and drag offset
    const draggedStripTop = event.clientY - (dragOffsetY || 0)
    const draggedStripHeight = stripHeight || 50 // Use from drag data, fallback to 50

    // Find the dragged strip's current index
    let draggedIndex = -1
    for (let i = 0; i < allStripElements.length; i++) {
      const el = allStripElements[i]
      if (el && el.getAttribute('data-strip-id') === stripId) {
        draggedIndex = i
        break
      }
    }

    // Check if drop happened on a gap
    let droppedOnGap = false
    let gapIndex = -1
    let gapRect: DOMRect | null = null
    let dropOnTopHalf = false

    for (const gapEl of allGapElements) {
      const rect = gapEl.getBoundingClientRect()
      if (event.clientY >= rect.top && event.clientY <= rect.bottom) {
        droppedOnGap = true
        gapIndex = parseInt(gapEl.getAttribute('data-gap-index') || '-1')
        gapRect = rect
        dropOnTopHalf = event.clientY < rect.top + rect.height / 2
        break
      }
    }

    // Handle drop on gap
    if (droppedOnGap && gapIndex !== -1 && gapRect) {
      const currentGapSize = sectionGaps.value[gapIndex] || 0

      // Check if the dragged strip was adjacent to this gap
      // Gap at index N: strip at N-1 is above, strip at N is below
      const wasAboveGap = isSameSection && draggedIndex === gapIndex - 1
      const wasBelowGap = isSameSection && draggedIndex === gapIndex

      // Calculate new gap size
      let newGapSize: number
      if (wasBelowGap && originalTop !== undefined) {
        // Strip below gap dragged upward - reduce gap by the distance dragged up
        const draggedUpDistance = originalTop - draggedStripTop
        newGapSize = draggedUpDistance > 0 ? Math.max(0, currentGapSize - draggedUpDistance) : currentGapSize
      } else if (wasAboveGap) {
        // Strip above gap dropped on gap - keep gap unchanged
        newGapSize = currentGapSize
      } else {
        // Strip from elsewhere - reduce gap by strip height
        newGapSize = currentGapSize - draggedStripHeight
      }

      // Remove the gap before moving (so adjustGapsForMove doesn't affect it)
      store.removeGapAtIndex(props.bayId, props.section.id, gapIndex)

      // Determine insert position based on which half of the gap was hit
      // Gap at index N means it's before the strip at position N
      let insertPosition: number

      if (dropOnTopHalf) {
        // Strip goes above the gap (at position gapIndex, pushing others down)
        if (isSameSection && draggedIndex < gapIndex) {
          // Dragged strip was above the gap, after removal it shifts indices
          insertPosition = gapIndex - 1
        } else {
          insertPosition = gapIndex
        }
      } else {
        // Strip goes below the gap (at position gapIndex, but gap stays before it)
        if (isSameSection && draggedIndex < gapIndex) {
          insertPosition = gapIndex - 1
        } else {
          insertPosition = gapIndex
        }
      }

      store.syncTimeSortSectionFromDom(props.bayId, props.section.id, topContainer.value)
      store.moveStripToSection(stripId, props.bayId, props.section.id, insertPosition)

      // Re-add the gap at the correct position with the new size
      if (newGapSize >= store.GAP_BUFFER) {
        if (dropOnTopHalf) {
          // Gap goes after the inserted strip (before the strip that was originally below the gap)
          store.setGapAtIndex(props.bayId, props.section.id, insertPosition + 1, newGapSize)
        } else {
          // Gap stays before the inserted strip
          store.setGapAtIndex(props.bayId, props.section.id, insertPosition, newGapSize)
        }
      }

      return
    }

    // Calculate position, skipping the dragged strip for same-section moves
    const stripElements = isSameSection
      ? allStripElements.filter(el => el.getAttribute('data-strip-id') !== stripId)
      : allStripElements

    // Find drop position and check if dropping below last strip (or into empty section)
    let position = stripElements.length
    let droppedBelowLastStrip = false
    let distanceBelowLastStrip = 0
    let droppedIntoEmptySection = false
    let distanceFromTop = 0

    if (stripElements.length > 0) {
      const lastStrip = stripElements[stripElements.length - 1]
      if (lastStrip) {
        const lastRect = lastStrip.getBoundingClientRect()
        // Use the dragged strip's top position (not cursor) to calculate gap
        if (draggedStripTop > lastRect.bottom) {
          droppedBelowLastStrip = true
          distanceBelowLastStrip = draggedStripTop - lastRect.bottom
        }
      }
    } else {
      // Empty section - check distance from container top
      const containerRect = container.getBoundingClientRect()
      distanceFromTop = draggedStripTop - containerRect.top
      if (distanceFromTop >= store.GAP_BUFFER) {
        droppedIntoEmptySection = true
      }
    }

    // Same midpoint test as the placement line (index among strips excluding the drag source).
    const insertAt = insertIndexAtClientY(stripElements, event.clientY)
    if (insertAt < stripElements.length) {
      position = insertAt
      droppedBelowLastStrip = false
    }

    // Handle same-section gap adjustments
    if (isSameSection && draggedIndex !== -1) {
      const currentGap = store.getGapAtIndex(props.bayId, props.section.id, draggedIndex)

      // Check if position is effectively unchanged (dropped at same index)
      if (position === draggedIndex || (position === draggedIndex + 1 && draggedIndex === stripElements.length)) {
        // Same position - handle gap adjustment
        if (originalTop !== undefined && originalBottom !== undefined) {
          // Use strip top position for gap calculation
          const stripTopY = draggedStripTop

          // Get the position of the strip above (not the dragged strip's placeholder)
          // This is where the gap should be measured from
          const prevStripEl = draggedIndex > 0 ? allStripElements[draggedIndex - 1] : null
          const measureFromY = prevStripEl
            ? prevStripEl.getBoundingClientRect().bottom
            : container.getBoundingClientRect().top

          // Dragging down = increase gap
          // Check distance from strip above (not from self placeholder)
          if (stripTopY > measureFromY + store.GAP_BUFFER && draggedIndex == stripElements.length) {
            // Gap = distance from strip above + strip height (accounts for placeholder)
            const newGap = (stripTopY - measureFromY)// + draggedStripHeight
            store.setGapAtIndex(props.bayId, props.section.id, draggedIndex, newGap)
            return
          }

          // Dragging up (strip top above original top) = decrease gap
          if (stripTopY < originalTop && currentGap > 0) {
            const delta = originalTop - stripTopY
            store.setGapAtIndex(props.bayId, props.section.id, draggedIndex, Math.max(0, currentGap - delta))
            return
          }
        }

        // Dropped within original bounds - no change
        return
      }
    }

    store.syncTimeSortSectionFromDom(props.bayId, props.section.id, topContainer.value)
    store.moveStripToSection(stripId, props.bayId, props.section.id, position)

    // Create gap if dropped below last strip with enough distance
    if (droppedBelowLastStrip && distanceBelowLastStrip >= store.GAP_BUFFER) {
      // The strip is now at the last position, create gap before it
      // For same-section moves, add strip height to account for the space freed up
      // when the strip moves from its original position
      const gapSize = isSameSection
        ? distanceBelowLastStrip + draggedStripHeight
        : distanceBelowLastStrip
      store.setGapAtIndex(props.bayId, props.section.id, position, gapSize)
    }

    // Create gap if dropped into empty section below the buffer distance
    if (droppedIntoEmptySection) {
      // Strip is at position 0, create gap before it
      store.setGapAtIndex(props.bayId, props.section.id, 0, distanceFromTop)
    }
  } catch (error) {
    console.error('Error handling drop:', error)
  }
}

// Bottom drop zone handling
function onBottomDragOver(event: DragEvent) {
  event.preventDefault()
  if (event.dataTransfer) {
    const isCreateDrag = event.dataTransfer.types.includes('application/efs-create')
    event.dataTransfer.dropEffect = isCreateDrag ? 'copy' : 'move'
  }
  claimHtml5DropHighlight()
  isBottomDragOver.value = true
  clearDropPlacementLine()
}

function onBottomDragEnter() {
  claimHtml5DropHighlight()
  isBottomDragOver.value = true
  clearDropPlacementLine()
}

function onBottomDragLeave(event: DragEvent) {
  const target = event.currentTarget as HTMLElement
  const relatedTarget = event.relatedTarget as HTMLElement
  if (!target.contains(relatedTarget)) {
    isBottomDragOver.value = false
  }
}

function onBottomDrop(event: DragEvent) {
  event.preventDefault()
  isBottomDragOver.value = false

  if (!event.dataTransfer) return

  // Handle create-strip drops from bottom bar
  const createType = event.dataTransfer.getData('application/efs-create')
  if (createType) {
    const type = createType as SpecialStripType
    openCreateDialog(type, 0, true)
    return
  }

  if (tryHandleInfoStripDrop(event, true)) return

  try {
    const data = JSON.parse(event.dataTransfer.getData('application/json'))
    if (data?.type === 'infoStrip') return
    const { stripId } = data

    // Move to bottom strips at the beginning
    store.moveStripToBottom(stripId, props.bayId, props.section.id, 0)
  } catch (error) {
    console.error('Error handling bottom drop:', error)
  }
}

// Bottom strips container drop handling
function onBottomStripsDragOver(event: DragEvent) {
  event.preventDefault()
  if (event.dataTransfer) {
    const isCreateDrag = event.dataTransfer.types.includes('application/efs-create')
    event.dataTransfer.dropEffect = isCreateDrag ? 'copy' : 'move'
  }
  claimHtml5DropHighlight()
  isBottomDragOver.value = true
  clearDropPlacementLine()
}

function onBottomStripsDrop(event: DragEvent) {
  event.preventDefault()
  isBottomDragOver.value = false

  if (!event.dataTransfer) return

  // Handle create-strip drops from bottom bar
  const createType = event.dataTransfer.getData('application/efs-create')
  if (createType) {
    const type = createType as SpecialStripType
    const position = computeBottomStripsDrop(event)
    openCreateDialog(type, position, true)
    return
  }

  if (tryHandleInfoStripDrop(event, true)) return

  try {
    const data = JSON.parse(event.dataTransfer.getData('application/json'))
    if (data?.type === 'infoStrip') return
    const { stripId } = data

    // Find position within bottom strips (past last flight / over info → end)
    const position = computeBottomStripsDrop(event)

    store.moveStripToBottom(stripId, props.bayId, props.section.id, position)
  } catch (error) {
    console.error('Error handling bottom strips drop:', error)
  }
}

/** Drop after trailing bottom info strips (append to bottom list). */
function onBottomStripsDropAtEnd(event: DragEvent) {
  event.preventDefault()
  event.stopPropagation()
  isBottomDragOver.value = false
  if (!event.dataTransfer) return

  const createType = event.dataTransfer.getData('application/efs-create')
  if (createType) {
    openCreateDialog(createType as SpecialStripType, bottomStrips.value.length, true)
    return
  }
  if (tryHandleInfoStripDrop(event, true)) return
  try {
    const data = JSON.parse(event.dataTransfer.getData('application/json'))
    if (data?.type === 'infoStrip') return
    store.moveStripToBottom(data.stripId, props.bayId, props.section.id, bottomStrips.value.length)
  } catch (error) {
    console.error('Error handling bottom end drop:', error)
  }
}
</script>

<style scoped>
.efs-section {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 80px;
  border-bottom: 1px solid #2b2d31;
  border-right: 1px solid #2b2d31;
  border-left: 1px solid #2b2d31;
}

.efs-section--no-header {
  min-height: 0;
  border-bottom: none;
}

/* Paper stick-bottom zones (INBOUND / above KLARERING / PÅ BANAN / PÅ TAXI) — SAAB never gets this */
.efs-section--stick-bottom .top-strips-container {
  display: flex;
  flex-direction: column;
}

/* Grows when short → strips against the header below; collapses when overflowing */
.efs-section--stick-bottom .stick-bottom-spacer {
  flex: 1 1 auto;
  min-height: 0;
  pointer-events: none;
}

/*
 * Reverse pin tray: pinned strips + stick-to zone at TOP, main list at BOTTOM.
 * DOM order stays (main → tray → pinned) for shared handlers; flex order flips it.
 */
.section-content--stick-bottom .top-strips-container {
  order: 3;
}
.section-content--stick-bottom .bottom-drop-zone {
  order: 2;
}
.section-content--stick-bottom .bottom-strips-container {
  order: 1;
}

.efs-section:last-child {
  border-bottom: none;
}

.section-header {
  position: relative;
  background: #2c3138;
  padding: 0;
  border-bottom: 1px solid #4a5058;
  display: flex;
  align-items: center;
  justify-content: center;
  user-select: none;
  /* Floor with --efs-scale so large UI % stays readable on narrow bays */
  min-height: max(calc(18px * var(--bay-scale, 1)), calc(20px * var(--efs-scale, 1)));
}

/* RTC: warm grey section bars (less blue than default chrome) */
.section-header--rtc {
  background: #3a3836;
  border-bottom-color: #52504c;
}

.section-header.header-drop-active {
  box-shadow: inset 0 -3px 0 0 rgb(0, 150, 180);
}

.section-header.no-resize {
  cursor: default;
}

.section-header-left {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  display: flex;
  align-items: stretch;
  z-index: 1;
}

/* ESSA mode — SAAB EFS section header colours */
.section-header--essa-runway {
  background: #4e0910;
  border-bottom-color: #6a1420;
}
.section-header--essa-runway .section-title {
  color: #e8d0d0;
}
.section-header--essa-inbound {
  background: #97aba9;
  border-bottom-color: #7a908d;
}
.section-header--essa-inbound .section-title {
  color: #ebebeb; /* same as strip body */
}
.section-header--essa-other {
  background: #94979d;
  border-bottom-color: #787a81;
}
.section-header--essa-other .section-title {
  color: #000;
}

/* Paper FPS: same 400×50 SAAB body ratio as strips (via --bay-scale) */
.section-header--paper {
  background: #111;
  border-bottom-color: #111;
  /* Body 50×scale + TB type frames (2×2×scale) so outer height matches strips */
  height: calc(54px * var(--bay-scale, 1));
  min-height: calc(54px * var(--bay-scale, 1));
  max-height: calc(54px * var(--bay-scale, 1));
  padding: 0 calc(6px * var(--bay-scale, 1));
  box-sizing: border-box;
  cursor: ns-resize;
  gap: calc(6px * var(--bay-scale, 1));
}
.section-header--paper.no-resize {
  cursor: default;
}
.section-header--paper .section-title {
  color: #f0f0f0;
  font-size: calc(24px * var(--bay-scale, 1));
  letter-spacing: calc(1.2px * var(--bay-scale, 1));
  flex: 1 1 auto;
  min-width: 0;
}
.section-header--paper .section-title--paper-lg {
  font-size: calc(30px * var(--bay-scale, 1));
  letter-spacing: calc(1.4px * var(--bay-scale, 1));
}

/* Center title in header; RWY badge overlays on the right */
.section-header--paper .section-title--paper-center {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  flex: none;
  margin: 0;
  pointer-events: none;
}

.pg-hdr-rwy {
  /* Same frame weights as flight-strip colour border (--frame-side / --frame-tb) */
  --pg-rwy-frame-side: calc(8px * var(--bay-scale, 1));
  --pg-rwy-frame-tb: calc(var(--pg-rwy-frame-side) / 4);
  position: absolute;
  top: calc(2px * var(--bay-scale, 1));
  right: calc(2px * var(--bay-scale, 1));
  bottom: calc(2px * var(--bay-scale, 1));
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: calc(48px * var(--bay-scale, 1));
  margin: 0;
  padding: 0 calc(6px * var(--bay-scale, 1));
  box-sizing: border-box;
  background: #fff;
  color: #000;
  border-style: solid;
  border-color: #000;
  border-width: var(--pg-rwy-frame-tb) var(--pg-rwy-frame-side);
  border-radius: 0;
  appearance: none;
  -webkit-appearance: none;
  font-family: 'Segoe UI', Arial, sans-serif;
  font-size: calc(30px * var(--bay-scale, 1));
  font-weight: 700;
  letter-spacing: calc(1.4px * var(--bay-scale, 1));
  line-height: 1;
  text-transform: uppercase;
  cursor: pointer;
  user-select: none;
}
.pg-hdr-rwy:hover {
  background: #f5f5f5;
}

.pg-hdr-freq {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  line-height: 1.05;
  color: #2e6640;
  font-family: 'Segoe UI', Arial, sans-serif;
  font-size: calc(16px * var(--bay-scale, 1));
  font-weight: 700;
  letter-spacing: 0.03em;
  text-align: center;
  text-transform: uppercase;
  user-select: none;
}
.pg-hdr-freq-left {
  margin-right: auto;
}
.pg-hdr-freq-right {
  margin-left: auto;
}
.pg-hdr-freq-mhz {
  font-variant-numeric: tabular-nums;
}

/* SAAB/RTC/ESSA: title locked to header center; side controls overlay */
.section-header:not(.section-header--paper) .section-title {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  z-index: 0;
  max-width: calc(100% - 88px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  pointer-events: none;
}

.section-title {
  font-size: max(calc(14px * var(--bay-scale, 1)), calc(15px * var(--efs-scale, 1)));
  font-weight: 700;
  letter-spacing: calc(0.8px * var(--bay-scale, 1));
  line-height: 1;
  color: #a8afb6;
  text-transform: uppercase;
  text-align: center;
  font-family: 'Segoe UI', 'Arial', sans-serif;
}

.section-header-right {
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  display: flex;
  align-items: stretch;
  z-index: 1;
}

.section-hdr-rwy {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 max(calc(5px * var(--bay-scale, 1)), calc(6px * var(--efs-scale, 1)));
  margin-right: 1px;
  color: #e8e4dc;
  font-size: max(calc(11px * var(--bay-scale, 1)), calc(12px * var(--efs-scale, 1)));
  font-weight: 800;
  letter-spacing: 0.06em;
  line-height: 1;
  white-space: nowrap;
  user-select: none;
  pointer-events: none;
}

/* Same look as strip .action-button keys */
.section-hdr-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  width: max(calc(18px * var(--bay-scale, 1)), calc(20px * var(--efs-scale, 1)));
  height: 100%;
  margin: 0;
  padding: 0;
  border: none;
  border-radius: 0;
  background: #d8d8d8;
  color: #000;
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
  flex-shrink: 0;
}

.section-header-left .section-hdr-btn:not(:last-child) {
  border-right: 1px solid #666;
}

.section-hdr-btn:hover:not(:disabled):not(.is-inactive) {
  background: #e8e8e8;
}

.section-hdr-btn:disabled,
.section-hdr-btn.is-inactive {
  cursor: default;
  background: #d8d8d8;
  color: #9a9a9a;
}

.section-hdr-drag:not(:disabled) {
  cursor: ns-resize;
}

.section-hdr-drag-icon {
  display: block;
  width: 58%;
  height: 2px;
  background: currentColor;
  box-shadow: 0 4px 0 currentColor;
}

.section-hdr-search-icon {
  display: block;
  width: 70%;
  height: 70%;
}

.section-hdr-close-icon {
  display: block;
  width: 55%;
  height: 55%;
  overflow: visible;
}

.section-hdr-close-icon path {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: square;
  stroke-linejoin: miter;
}

/* Text key — same chrome as drag/search; wider for TOBT/TSAT/MAN label */
.section-sort-btn {
  width: auto;
  min-width: max(calc(28px * var(--bay-scale, 1)), calc(30px * var(--efs-scale, 1)));
  padding: 0 calc(3px * var(--bay-scale, 1));
  font-size: max(calc(9px * var(--bay-scale, 1)), calc(10px * var(--efs-scale, 1)));
  font-weight: 700;
  letter-spacing: 0.3px;
  text-transform: uppercase;
  font-family: 'Segoe UI', 'Arial', sans-serif;
  line-height: 1;
}

.section-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--efs-bay-bg, #3b3c41);
  transition: background 0.2s ease;
}

/* Horizontal insert marker while dragging between strips */
.drop-placement-line {
  height: 3px;
  margin: 1px 6px;
  border-radius: 1px;
  background: rgb(0, 150, 180);
  box-shadow: 0 0 0 1px rgba(0, 150, 180, 0.45);
  pointer-events: none;
  flex-shrink: 0;
}

/* Top strips container - scrollable (paper overrides overflow in EfsBay--paper) */
.top-strips-container {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 2px 0;
  min-height: 0;

  /* Firefox scrollbar styling */
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
}

/* Webkit (Chrome, Safari, Edge) scrollbar styling - overlay style */
.top-strips-container::-webkit-scrollbar {
  width: 6px;
  background: transparent;
}

.top-strips-container::-webkit-scrollbar-track {
  background: transparent;
}

.top-strips-container::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.15);
  border-radius: 3px;
}

.top-strips-container::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.3);
}

/* Bottom drop zone — stick-to tray (distinct from between-strip insert line) */
.bottom-drop-zone {
  height: 25px;
  flex-shrink: 0;
  position: relative;
  transition: background 0.15s ease, border-top 0.15s ease, border-bottom 0.15s ease,
    box-shadow 0.15s ease;
  border-top: 1px dashed transparent;
  background: transparent;
}

.bottom-drop-zone.has-bottom {
  border-top: 1px dashed #2a2e32;
}

.bottom-drop-zone.drop-active {
  border-top: 7px solid rgb(0, 150, 180);
  background: linear-gradient(
    to bottom,
    rgba(0, 150, 180, 0.45) 0%,
    rgba(0, 150, 180, 0.12) 55%,
    transparent 100%
  );
  box-shadow:
    0 -1px 0 0 rgba(0, 180, 200, 0.55),
    inset 0 10px 14px -8px rgba(0, 150, 180, 0.55);
}

/* End caps so the slot reads as a bay-wide “tray”, not a thin insert */
.bottom-drop-zone.drop-active::before,
.bottom-drop-zone.drop-active::after {
  content: '';
  position: absolute;
  top: -1px;
  width: 4px;
  height: 14px;
  background: rgb(0, 150, 180);
  border-radius: 1px;
  box-shadow: 0 0 6px rgba(0, 150, 180, 0.7);
  pointer-events: none;
}
.bottom-drop-zone.drop-active::before {
  left: 2px;
}
.bottom-drop-zone.drop-active::after {
  right: 2px;
}

/* Stick-bottom zones: tray at top — mirror border/gradient downward → upward */
.bottom-drop-zone--stick-top {
  border-top: none;
  border-bottom: 1px dashed transparent;
}
.bottom-drop-zone--stick-top.has-bottom {
  border-top: none;
  border-bottom: 1px dashed #2a2e32;
}
.bottom-drop-zone--stick-top.drop-active {
  border-top: none;
  border-bottom: 7px solid rgb(0, 150, 180);
  background: linear-gradient(
    to top,
    rgba(0, 150, 180, 0.45) 0%,
    rgba(0, 150, 180, 0.12) 55%,
    transparent 100%
  );
  box-shadow:
    0 1px 0 0 rgba(0, 180, 200, 0.55),
    inset 0 -10px 14px -8px rgba(0, 150, 180, 0.55);
}
.bottom-drop-zone--stick-top.drop-active::before,
.bottom-drop-zone--stick-top.drop-active::after {
  top: auto;
  bottom: -1px;
}

.bottom-info-drop-tail {
  min-height: 12px;
  flex-shrink: 0;
}

/* Bottom strips container - pinned (stick-to zone) */
.bottom-strips-container {
  flex-shrink: 0;
  padding: 2px 0;
  background: rgba(0, 100, 130, 0.1);
  border-top: 1px solid rgba(0, 150, 180, 0.3);
}

.bottom-strips-container--stick-top {
  border-top: none;
  border-bottom: 1px solid rgba(0, 150, 180, 0.3);
}

/* Strip gap - clickable area between strips */
.strip-gap {
  margin: 0 4px;
  background: rgba(100, 150, 180, 0.15);
  border: 1px rgba(100, 150, 180, 0.4);
  border-radius: 2px;
  cursor: pointer;
  transition: all 0.15s ease;
  min-height: 10px;
}

.strip-gap:hover {
  background: rgba(100, 150, 180, 0.25);
  border: 1px dashed rgba(100, 150, 180, 0.6);
}
</style>

<style>
/* Global styles for resize state */
body.section-resizing {
  cursor: ns-resize !important;
  user-select: none !important;
}

body.section-resizing * {
  cursor: ns-resize !important;
}
</style>

<template>
  <StripCreationDialog
    v-model="createDialogOpen"
    :strip-type="createDialogType"
    :initial-airport="createDialogAirport"
    @create="onDialogCreate"
  />
  <div
    class="efs-section"
    :data-section-id="section.id"
    :style="sectionStyle"
  >
    <div
      class="section-header"
      :class="[
        { 'no-resize': isFirstSection },
        essaHeaderClass,
      ]"
    >
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
      <span class="section-title">{{ section.title }}</span>
      <div class="section-header-right">
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
    </div>
    <div class="section-content">
      <!-- Top strips container (scrollable) -->
      <div
        ref="topContainer"
        class="top-strips-container"
        @dragover.prevent="onTopDragOver"
        @dragenter="onTopDragEnter"
        @dragleave="onTopDragLeave"
        @drop="onTopDrop"
      >
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

      <!-- Bottom drop zone -->
      <div
        class="bottom-drop-zone"
        :class="{ 'drop-active': isBottomDragOver, 'has-bottom': bottomStrips.length > 0 || showBreakoutAtBottom || showMapAtBottom || showDepAtBottom || showTurnAtBottom || showSid19lAtBottom || showR16AtBottom }"
        @dragover.prevent="onBottomDragOver"
        @dragenter="onBottomDragEnter"
        @dragleave="onBottomDragLeave"
        @drop="onBottomDrop"
      ></div>

      <!-- Bottom strips container (pinned) -->
      <div
        v-if="bottomStrips.length > 0 || showBreakoutAtBottom || showMapAtBottom || showDepAtBottom || showTurnAtBottom || showSid19lAtBottom || showR16AtBottom"
        ref="bottomContainer"
        class="bottom-strips-container"
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
import { ref, computed, watch, type ComputedRef, type Ref } from 'vue'
import type { FlightStrip as FlightStripData, Section } from '@/types/efs'
import { useEfsStore } from '@/store/efs'
import { useSectionResize } from '@/composables/useSectionResize'
import { useStripOrderFlip } from '@/composables/useStripOrderFlip'
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
import { isRunwayOrderSectionId, sortRunwayLuOrder } from '@vatefs/common'

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

/** Index among topStrips where a dragged strip would insert (line before that index; length = end). */
const dropInsertIndex = ref<number | null>(null)

function updateDropPlacementLine(event: DragEvent) {
  const container = topContainer.value
  if (!container) {
    dropInsertIndex.value = null
    return
  }
  const strips = Array.from(container.querySelectorAll('.flight-strip'))
  if (strips.length === 0) {
    // Only info strips (or empty): still show end-of-list insert line
    dropInsertIndex.value = 0
    return
  }
  for (let i = 0; i < strips.length; i++) {
    const el = strips[i]
    if (!el) continue
    const rect = el.getBoundingClientRect()
    const mid = rect.top + rect.height / 2
    if (event.clientY < mid) {
      dropInsertIndex.value = i
      return
    }
  }
  dropInsertIndex.value = strips.length
}

function clearDropPlacementLine() {
  dropInsertIndex.value = null
}
const isBottomDragOver = ref(false)
const topContainer = ref<HTMLElement | null>(null)
const bottomContainer = ref<HTMLElement | null>(null)

/** Touch/iPad drag: same insert line / bottom-slot as HTML5 dragover. */
const touchDropPlacement = useTouchDropPlacement()
let touchOwnedHighlight = false
watch(touchDropPlacement, (p) => {
  const mine = !!p && p.bayId === props.bayId && p.sectionId === props.section.id
  if (!mine) {
    if (touchOwnedHighlight) {
      dropInsertIndex.value = null
      isBottomDragOver.value = false
      touchOwnedHighlight = false
    }
    return
  }
  touchOwnedHighlight = true
  if (p!.isBottom) {
    dropInsertIndex.value = null
    isBottomDragOver.value = true
    return
  }
  isBottomDragOver.value = false
  dropInsertIndex.value = p!.insertIndex
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

const timeModeName = computed(() =>
  isClearedSectionId(props.section.id) ? 'TSAT' : 'TOBT',
)

/** Button label = active mode */
const sortModeLabel = computed(() =>
  sectionSortMode.value === 'man' ? 'MAN' : timeModeName.value,
)

const sortModeTitle = computed(() => {
  if (sectionSortMode.value === 'man') {
    return `Manual order - click for ${timeModeName.value}`
  }
  return isClearedSectionId(props.section.id)
    ? 'Sort by TSAT (else EOBT) - click for MAN'
    : 'Sort by TOBT (else EOBT) - click for MAN'
})

/**
 * Fixed sort field per section:
 * - pending_dep (CD ALL): TOBT → EOBT
 * - cleared (TSAT): TSAT → EOBT
 * - other time-sort sections: TOBT → EOBT
 */
function activeTimeSortField(): TimeSortField {
  if (isClearedSectionId(props.section.id)) return 'tsat'
  if (isPendingDepSectionId(props.section.id)) return 'etobt'
  return 'etobt'
}

function activeTimeSortDir(): TimeSortDir {
  return 'asc'
}

/**
 * Sticky manual order: MAN mode on CD ALL/TSAT, or drag-sticky on other time-sort
 * sections (RTC dep). INBOUND APP / CTR DEP always auto-sort (never sticky).
 * Other INBOUND (TWR/GND) use appearing order + sticky like taxi.
 */
const preferManualOrder = computed(() => {
  if (etaSortEnabled.value || atdSortEnabled.value) return false
  if (!timeSortEnabled.value) return false
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
 * - TSAT (cleared): TSAT → EOBT
 * - TOBT (pending_dep / RTC dep): TOBT → EOBT
 */
function preferredDepTime(strip: FlightStripData, field: TimeSortField): string | undefined {
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

/** ETA sort for INBOUND APP — earliest at bottom (bay fills from top); missing ETA at top. */
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
    !etaSortEnabled.value &&
    !atdSortEnabled.value &&
    !runwayLuSortEnabled.value &&
    (!timeSortEnabled.value || preferManualOrder.value),
)

const topStrips = computed(() => {
  void store.stripsVersion
  // Re-read mode when user toggles TOBT/MAN
  void sectionSortMode.value
  const list = collectTopStrips()

  // INBOUND APP: always ETA (drag reorder does not stick)
  if (etaSortEnabled.value) {
    return sortByEta(list)
  }

  // CTR DEP: always ATD (earliest at top; no ATD → add sequence at bottom)
  if (atdSortEnabled.value) {
    return sortByAtd(list)
  }

  // RUNWAY: CFTO above LINEUP; sticky appearance within tier / for non-L/U
  if (runwayLuSortEnabled.value) {
    return sortRunwayLuOrder(list)
  }

  if (timeSortEnabled.value && !preferManualOrder.value) {
    return sortByDepTime(list, activeTimeSortField(), activeTimeSortDir())
  }

  return list.sort((a, b) => a.position - b.position)
})

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
const sectionGaps = computed(() => store.getGapsForSection(props.bayId, props.section.id))

/** Ordered ids for FLIP when sort/add shifts neighbors (matches auto-move timing). */
const topStripIds = computed(() => topStrips.value.map((s) => s.id))
const bottomStripIds = computed(() => bottomStrips.value.map((s) => s.id))
useStripOrderFlip(topContainer, topStripIds)
useStripOrderFlip(bottomContainer, bottomStripIds)

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
  // Last section always flexes to fill remaining space
  if (props.isLastSection) {
    return { flex: '1 1 auto', minHeight: '80px' }
  }
  // Other sections: apply stored height, don't grow or shrink
  // Using flex: 0 0 auto prevents other sections from "bumping" during resize
  if (props.section.height) {
    return {
      height: `${props.section.height}px`,
      flex: '0 0 auto'  // don't grow, don't shrink
    }
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

  // Vehicle: always create in this section. Note: immediate unless multi-airport RTC.
  if (type === 'vehicle' || (type === 'note' && !store.multiAirport)) {
    applyCreate(type, undefined, undefined, bayAirport.value, position, isBottom, gapIndex, gapSize)
    return
  }

  createDialogOpen.value = true
}

// Top strips drag handling
function onTopDragOver(event: DragEvent) {
  event.preventDefault()
  if (event.dataTransfer) {
    // Set appropriate dropEffect based on drag source
    const isCreateDrag = event.dataTransfer.types.includes('application/efs-create')
    event.dataTransfer.dropEffect = isCreateDrag ? 'copy' : 'move'
  }
  isBottomDragOver.value = false
  updateDropPlacementLine(event)
}

function onTopDragEnter(event: DragEvent) {
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

    // Find position based on midpoints
    for (let i = 0; i < stripElements.length; i++) {
      const element = stripElements[i]
      if (!element) continue

      const rect = element.getBoundingClientRect()
      const midpoint = rect.top + rect.height / 2

      if (event.clientY < midpoint) {
        position = i
        droppedBelowLastStrip = false
        break
      }
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
  isBottomDragOver.value = true
  clearDropPlacementLine()
}

function onBottomDragEnter() {
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

.efs-section:last-child {
  border-bottom: none;
}

.section-header {
  position: relative;
  background: #2c3138;
  /* Clear left (drag+search[+sort]) and right (close) action buttons */
  padding: 0 max(calc(22px * var(--bay-scale, 1)), calc(24px * var(--efs-scale, 1)))
    0 max(calc(40px * var(--bay-scale, 1)), calc(44px * var(--efs-scale, 1)));
  border-bottom: 1px solid #4a5058;
  display: flex;
  align-items: center;
  justify-content: center;
  user-select: none;
  /* Floor with --efs-scale so large UI % stays readable on narrow bays */
  min-height: max(calc(18px * var(--bay-scale, 1)), calc(20px * var(--efs-scale, 1)));
}

.section-header:has(.section-sort-btn) {
  /* drag + search + TOBT|TSAT|MAN toggle */
  padding-left: max(calc(76px * var(--bay-scale, 1)), calc(82px * var(--efs-scale, 1)));
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

/* Top strips container - scrollable */
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

/* Bottom drop zone — append-to-bottom slot (distinct from between-strip insert line) */
.bottom-drop-zone {
  height: 25px;
  flex-shrink: 0;
  position: relative;
  transition: background 0.15s ease, border-top 0.15s ease, box-shadow 0.15s ease;
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

/* End caps so the bottom slot reads as a bay-wide “tray”, not a thin insert */
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

.bottom-info-drop-tail {
  min-height: 12px;
  flex-shrink: 0;
}

/* Bottom strips container - pinned */
.bottom-strips-container {
  flex-shrink: 0;
  padding: 2px 0;
  background: rgba(0, 100, 130, 0.1);
  border-top: 1px solid rgba(0, 150, 180, 0.3);
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

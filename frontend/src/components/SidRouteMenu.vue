<template>
  <v-menu
    :model-value="modelValue"
    :target="menuAnchor"
    location="bottom"
    :max-height="menuMaxPx"
    content-class="sid-route-overlay"
    :z-index="zIndex"
    :close-on-content-click="false"
    @update:model-value="onModelUpdate"
  >
    <div
      ref="menuEl"
      class="sid-route-menu"
      :class="{ 'sid-route-split': splitColumns && !fprView }"
      :style="menuBoxStyle"
      @click.stop
    >
      <!-- FPR / DCT submenu -->
      <template v-if="fprView">
        <button type="button" class="sid-route-top" title="Back" @click="fprView = false">
          <div class="sid-route-header">FPR / DCT</div>
          <div class="sid-route-callsign">{{ strip.callsign }}</div>
        </button>
        <div
          v-if="!fprPoint && !precedingWaypoints.length && !lopExtraSuggestPoints.length"
          class="sid-route-empty sid-route-scroll"
        >
          No FPL waypoints
        </div>
        <div v-else class="sid-route-list sid-route-scroll" :style="scrollBoxStyle">
          <button
            v-if="fprPoint"
            type="button"
            class="sid-route-item"
            :class="dctItemClass(fprPoint)"
            @click="onSelectDirect(fprPoint)"
          >FPR ({{ fprPoint }})</button>
          <button
            v-for="wp in precedingWaypoints"
            :key="wp"
            type="button"
            class="sid-route-item"
            :class="dctItemClass(wp)"
            @click="onSelectDirect(wp)"
          >{{ wp }}</button>
          <!-- Soft LOP DCT targets not already in the FPL waypoint list -->
          <button
            v-for="wp in lopExtraSuggestPoints"
            :key="'lop-' + wp"
            type="button"
            class="sid-route-item"
            :class="dctItemClass(wp)"
            @click="onSelectDirect(wp)"
          >{{ wp }}</button>
        </div>
        <div class="sid-route-manual" @click.stop>
          <input
            ref="manualInput"
            v-model="manualText"
            class="sid-route-manual-input"
            :class="{ invalid: manualText.length > 0 && !manualValid }"
            maxlength="5"
            placeholder="WAYPOINT"
            spellcheck="false"
            autocomplete="off"
            autocapitalize="characters"
            @input="onManualInput"
            @keydown.enter.prevent="submitManual"
            @keydown.escape.prevent="fprView = false"
          />
        </div>
        <button type="button" class="sid-route-clear" @click="onClearDirect">CLEAR</button>
      </template>

      <!-- Main DEP ROUTE menu -->
      <template v-else>
        <button type="button" class="sid-route-top" title="Close" @click="closeMenu">
          <div class="sid-route-header">DEP ROUTE</div>
          <div class="sid-route-callsign">{{ strip.callsign }}</div>
        </button>
        <div v-if="!strip.runway" class="sid-route-empty">No runway assigned</div>
        <div v-else-if="loading" class="sid-route-empty">Loading…</div>
        <div v-else-if="!hasAnySids" class="sid-route-empty">No SIDs for runway {{ strip.runway }}</div>
        <div
          v-else
          ref="bodyEl"
          class="sid-route-scroll"
          :style="scrollBoxStyle"
        >
          <div class="sid-route-col sid-route-col-main">
            <div v-if="normalSids.length" class="sid-route-list">
              <button
                v-for="sid in normalSids"
                :key="sid"
                type="button"
                class="sid-route-item"
                :class="{ selected: isSelected(sid), 'exit-match': isExitMatch(sid) }"
                @click="onSelect(sid)"
              >{{ sidLabel(sid) }}</button>
            </div>
            <template v-if="!splitColumns">
              <template v-if="slowSids.length">
                <div class="sid-route-section">SLOW</div>
                <div class="sid-route-list">
                  <button
                    v-for="sid in slowSids"
                    :key="'slow-' + sid"
                    type="button"
                    class="sid-route-item"
                    :class="{ selected: isSelected(sid), 'exit-match': isExitMatch(sid) }"
                    @click="onSelect(sid)"
                  >{{ sidLabel(sid) }}</button>
                </div>
              </template>
              <template v-if="milSids.length">
                <div class="sid-route-section">MIL</div>
                <div class="sid-route-list">
                  <button
                    v-for="sid in milSids"
                    :key="'mil-' + sid"
                    type="button"
                    class="sid-route-item"
                    :class="{ selected: isSelected(sid), 'exit-match': isExitMatch(sid) }"
                    @click="onSelect(sid)"
                  >{{ sidLabel(sid) }}</button>
                </div>
              </template>
              <template v-if="vfrSids.length">
                <div class="sid-route-section">VFR</div>
                <div class="sid-route-list">
                  <button
                    v-for="sid in vfrSids"
                    :key="'vfr-' + sid"
                    type="button"
                    class="sid-route-item"
                    :class="{ selected: isSelected(sid), 'exit-match': isExitMatch(sid) }"
                    @click="onSelect(sid)"
                  >{{ sidLabel(sid) }}</button>
                </div>
              </template>
            </template>
          </div>
          <div v-if="splitColumns" class="sid-route-col sid-route-col-side">
            <div class="sid-route-col-side-scroll">
              <template v-if="slowSids.length">
                <div class="sid-route-section">SLOW</div>
                <div class="sid-route-list">
                  <button
                    v-for="sid in slowSids"
                    :key="'slow2-' + sid"
                    type="button"
                    class="sid-route-item"
                    :class="{ selected: isSelected(sid), 'exit-match': isExitMatch(sid) }"
                    @click="onSelect(sid)"
                  >{{ sidLabel(sid) }}</button>
                </div>
              </template>
              <template v-if="milSids.length">
                <div class="sid-route-section">MIL</div>
                <div class="sid-route-list">
                  <button
                    v-for="sid in milSids"
                    :key="'mil2-' + sid"
                    type="button"
                    class="sid-route-item"
                    :class="{ selected: isSelected(sid), 'exit-match': isExitMatch(sid) }"
                    @click="onSelect(sid)"
                  >{{ sidLabel(sid) }}</button>
                </div>
              </template>
              <template v-if="vfrSids.length">
                <div class="sid-route-section">VFR</div>
                <div class="sid-route-list">
                  <button
                    v-for="sid in vfrSids"
                    :key="'vfr2-' + sid"
                    type="button"
                    class="sid-route-item"
                    :class="{ selected: isSelected(sid), 'exit-match': isExitMatch(sid) }"
                    @click="onSelect(sid)"
                  >{{ sidLabel(sid) }}</button>
                </div>
              </template>
            </div>
            <button
              type="button"
              class="sid-route-fpr"
              :class="{ 'lop-dct': !!lopPrimaryHighlight }"
              @click="openFprView"
            >FPR / DCT</button>
            <button
              v-if="fprPoint || lopPrimaryHighlight"
              type="button"
              class="sid-route-item sid-route-fpr-point"
              :class="dctItemClass(lopPrimaryHighlight || fprPoint || '')"
              @click="onSelectDirect(lopPrimaryHighlight || fprPoint || '')"
            >{{ lopPrimaryHighlight || fprPoint }}</button>
          </div>
        </div>
        <div class="sid-route-foot">
          <template v-if="!splitColumns && hasAnySids && strip.runway && !loading">
            <button
              type="button"
              class="sid-route-fpr"
              :class="{ 'lop-dct': !!lopPrimaryHighlight }"
              @click="openFprView"
            >FPR / DCT</button>
            <button
              v-if="fprPoint || lopPrimaryHighlight"
              type="button"
              class="sid-route-item sid-route-fpr-point"
              :class="dctItemClass(lopPrimaryHighlight || fprPoint || '')"
              @click="onSelectDirect(lopPrimaryHighlight || fprPoint || '')"
            >{{ lopPrimaryHighlight || fprPoint }}</button>
          </template>
          <button type="button" class="sid-route-clear" @click="onClear">CLEAR</button>
        </div>
      </template>
    </div>
  </v-menu>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { FlightStrip } from '@/types/efs'
import { useEfsStore } from '@/store/efs'
import {
  extractSignificantRouteFixes,
  extractTmaExitPoint,
  hasSlowRemark,
  isIfrSidEligible,
  isTrackSidName,
  isVectorSidName,
  parseRflToFeet,
  resolveLopDirectHighlights,
  withSlowRemark,
} from '@vatefs/common'

const props = withDefaults(
  defineProps<{
    modelValue: boolean
    strip: FlightStrip
    target: [number, number]
    /** Above zoom overlay (2400) when opened from zoomed strip */
    zIndex?: number
  }>(),
  { zIndex: 2600 },
)

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

/** Ignore outside-close briefly after open (touch ghost click). */
let ignoreCloseUntil = 0

const fprView = ref(false)
const manualInput = ref<HTMLInputElement | null>(null)
const manualText = ref('')
const menuEl = ref<HTMLElement | null>(null)
const bodyEl = ref<HTMLElement | null>(null)

/** Gap between the menu and the visible window edges. Matches Vuetify's overlay inset. */
const VIEW_MARGIN = 16
/** Header + footer reserved until the real chrome is measured. */
const CHROME_FALLBACK = 160

const menuMaxPx = ref(320)
const splitColumns = ref(false)
const pinScrollHeight = ref(false)
const measuredChrome = ref(CHROME_FALLBACK)
const oneColNatural = ref(0)
/** Viewport Y of the menu top. Above the click when the full menu would otherwise run off the bottom. */
const placedTop = ref<number | null>(null)

/**
 * Visible browser window, not the monitor.
 * visualViewport tracks a non-fullscreen window; innerHeight is the fallback.
 */
function visibleWindowHeight(): number {
  return window.visualViewport?.height ?? window.innerHeight
}

/** Full window minus the top and bottom margins. Not the space under the click. */
function syncMenuMax() {
  menuMaxPx.value = Math.max(0, Math.floor(visibleWindowHeight() - VIEW_MARGIN * 2))
}

/**
 * Keep the whole menu inside the window. Start at the click, then shift up
 * when click + height would pass the bottom. The top may sit above the click.
 */
function placeMenu(contentHeight: number) {
  const vh = visibleWindowHeight()
  const height = Math.min(Math.max(contentHeight, 1), menuMaxPx.value)
  let top = props.target[1]
  if (top + height > vh - VIEW_MARGIN) top = vh - VIEW_MARGIN - height
  if (top < VIEW_MARGIN) top = VIEW_MARGIN
  placedTop.value = Math.round(top)
}

const menuAnchor = computed((): [number, number] => [
  props.target[0],
  placedTop.value ?? props.target[1],
])

const menuBoxStyle = computed(() => ({
  maxHeight: `${menuMaxPx.value}px`,
}))

const scrollBoxStyle = computed(() => {
  const limit = `${Math.max(0, menuMaxPx.value - measuredChrome.value)}px`
  // Two columns need a definite height so a still-tall column can scroll
  // inside the window instead of growing the menu.
  if (splitColumns.value && !fprView.value && pinScrollHeight.value) {
    return { maxHeight: limit, height: limit }
  }
  return { maxHeight: limit }
})

function estimateItemPx(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--efs-scale')
  const scale = Number.parseFloat(raw)
  const s = Number.isFinite(scale) && scale > 0 ? scale : 1
  // min-height is content-box; padding and the divider sit outside it
  return Math.max(28, 28 * s) + Math.round(10 * s) + 1
}

/** One-column stack height from the SID counts, before the DOM is measured. */
function estimateOneColHeight(): number {
  const item = estimateItemPx()
  const section = Math.round(item * 0.85)
  let lists = normalSids.value.length * item
  if (slowSids.value.length) lists += section + slowSids.value.length * item
  if (milSids.value.length) lists += section + milSids.value.length * item
  if (vfrSids.value.length) lists += section + vfrSids.value.length * item
  const point = fprPoint.value || lopPrimaryHighlight.value ? item : 0
  return measuredChrome.value + lists + point
}

/**
 * Sum the rendered list/section heights. Works in either layout because each
 * list keeps its content height (the column scrolls, the list does not shrink).
 */
function measureStackedHeight(menu: HTMLElement): number {
  let lists = 0
  menu.querySelectorAll('.sid-route-list, .sid-route-section').forEach((el) => {
    lists += (el as HTMLElement).offsetHeight
  })
  const head = menu.querySelector('.sid-route-top') as HTMLElement | null
  const fpr = menu.querySelector('.sid-route-fpr') as HTMLElement | null
  const point = menu.querySelector('.sid-route-fpr-point') as HTMLElement | null
  const clear = menu.querySelector('.sid-route-clear') as HTMLElement | null
  return (
    (head?.offsetHeight ?? 0) +
    lists +
    (fpr?.offsetHeight ?? 0) +
    (point?.offsetHeight ?? 0) +
    (clear?.offsetHeight ?? 0)
  )
}

function measureChrome(menu: HTMLElement): number {
  const head = menu.querySelector('.sid-route-top') as HTMLElement | null
  const foot = menu.querySelector('.sid-route-foot') as HTMLElement | null
  const manual = menu.querySelector('.sid-route-manual') as HTMLElement | null
  const clear = menu.querySelector('.sid-route-clear') as HTMLElement | null
  const clearH = clear && !foot?.contains(clear) ? clear.offsetHeight : 0
  return (head?.offsetHeight ?? 0) + (foot?.offsetHeight ?? 0) + (manual?.offsetHeight ?? 0) + clearH
}

let refineToken = 0

function updateScrollPin(menu: HTMLElement) {
  if (!splitColumns.value || fprView.value) {
    pinScrollHeight.value = false
    return
  }
  const limit = Math.max(0, menuMaxPx.value - measuredChrome.value)
  let tallest = 0
  menu.querySelectorAll('.sid-route-col-main, .sid-route-col-side-scroll').forEach((el) => {
    tallest = Math.max(tallest, (el as HTMLElement).scrollHeight)
  })
  pinScrollHeight.value = tallest > limit + 1
}

async function refineLayout() {
  if (!props.modelValue) return
  const token = ++refineToken
  syncMenuMax()
  await nextTick()
  if (token !== refineToken || !props.modelValue) return
  const menu = menuEl.value
  if (!menu) return
  const chrome = measureChrome(menu)
  if (chrome > 0) measuredChrome.value = chrome
  if (!fprView.value && !loading.value && hasAnySids.value) {
    const natural = measureStackedHeight(menu)
    if (natural > 0) oneColNatural.value = natural
    const nextSplit = oneColNatural.value > menuMaxPx.value + 1
    if (nextSplit !== splitColumns.value) {
      splitColumns.value = nextSplit
      await nextTick()
      const menuAfter = menuEl.value
      if (token !== refineToken || !menuAfter) return
      const chromeAfter = measureChrome(menuAfter)
      if (chromeAfter > 0) measuredChrome.value = chromeAfter
    }
    const menuForScroll = menuEl.value
    if (!menuForScroll) return
    updateScrollPin(menuForScroll)
    await nextTick()
  } else if (!fprView.value) {
    splitColumns.value = false
    pinScrollHeight.value = false
  }
  const menuForPlace = menuEl.value
  if (token !== refineToken || !menuForPlace) return
  placeMenu(menuForPlace.offsetHeight || oneColNatural.value)
}

function onWindowChange() {
  if (!props.modelValue) return
  void refineLayout()
}

onMounted(() => {
  syncMenuMax()
  window.addEventListener('resize', onWindowChange)
  window.visualViewport?.addEventListener('resize', onWindowChange)
  window.visualViewport?.addEventListener('scroll', onWindowChange)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onWindowChange)
  window.visualViewport?.removeEventListener('resize', onWindowChange)
  window.visualViewport?.removeEventListener('scroll', onWindowChange)
})

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      ignoreCloseUntil = Date.now() + 450
      fprView.value = false
      manualText.value = ''
      splitColumns.value = false
      pinScrollHeight.value = false
      measuredChrome.value = CHROME_FALLBACK
      placedTop.value = props.target[1]
      syncMenuMax()
      void refineLayout()
    } else {
      fprView.value = false
      manualText.value = ''
      splitColumns.value = false
      pinScrollHeight.value = false
      placedTop.value = null
    }
  },
)

function onModelUpdate(open: boolean) {
  if (!open && Date.now() < ignoreCloseUntil) {
    nextTick(() => emit('update:modelValue', true))
    return
  }
  emit('update:modelValue', open)
}

function closeMenu() {
  ignoreCloseUntil = 0
  emit('update:modelValue', false)
}

const store = useEfsStore()
const allSids = ref<string[]>([])
/** SIDs leading to the strip's filled TMA exit (incl. alternatives like ROKNI↔ARS) */
const exitMatchKeys = ref<Set<string>>(new Set())
const loading = ref(false)

function normSidKey(s: string): string {
  return s.toUpperCase().replace(/\s+/g, '').replace(/[•*]/g, '·')
}

function isVfrSid(sid: string): boolean {
  return /^VFR/i.test(sid)
}

/** Military Standard Departure (ESE MIL03, MIL030, MIL14N, …) */
function isMilSid(sid: string): boolean {
  return /^MIL/i.test(sid)
}

/** Track/heading SIDs and HAPZI — SLOW departure routes (not radar-vector ·exit SIDs) */
function isSlowSid(sid: string): boolean {
  if (isVfrSid(sid) || isMilSid(sid)) return false
  if (isVectorSidName(sid)) return false
  if (isTrackSidName(sid)) return true
  return /^HAPZI/i.test(sid)
}

/** Technical SID name; only add spaces around · between designator and fix (e.g. ARS6E · KOGAV). */
function sidLabel(sid: string): string {
  const raw = sid.trim().toUpperCase().replace(/\s+/g, '')
  if (!raw) return sid
  const parts = raw.split(/[·•*.]/).filter(Boolean)
  if (parts.length >= 2) return parts.join(' · ')
  return raw
}

const normalSids = computed(() =>
  allSids.value.filter((s) => !isVfrSid(s) && !isMilSid(s) && !isSlowSid(s)),
)
const slowSids = computed(() => allSids.value.filter((s) => isSlowSid(s)))
const milSids = computed(() => allSids.value.filter((s) => isMilSid(s)))
const vfrSids = computed(() => allSids.value.filter((s) => isVfrSid(s)))
const hasAnySids = computed(
  () =>
    normalSids.value.length +
      slowSids.value.length +
      milSids.value.length +
      vfrSids.value.length >
    0,
)

/**
 * Significant FPL fixes for FPR/DCT: prefer EuroScope extracted (airway-expanded)
 * route when present, else filed route tokens.
 */
const routeFixes = computed(() =>
  extractSignificantRouteFixes(props.strip.extractedRoute || props.strip.route),
)
const fprPoint = computed(() => routeFixes.value[0] || undefined)
const precedingWaypoints = computed(() => routeFixes.value.slice(1))

/** LOP airport DCT rules (auto + soft suggest) — green highlight in FPR/DCT */
const lopDirectHighlights = computed(() =>
  resolveLopDirectHighlights({
    adep: props.strip.adep,
    ades: props.strip.ades,
    route: props.strip.extractedRoute || props.strip.route,
    rflFeet: parseRflToFeet(props.strip.rfl),
    runway: props.strip.runway,
    // Strip has no engine type — isSlow covers typical prop/turboprop deps
    isProp: !!props.strip.isSlow,
  }),
)

const lopHighlightMode = computed(() => {
  const map = new Map<string, 'auto' | 'suggest'>()
  for (const h of lopDirectHighlights.value) {
    map.set(h.point.toUpperCase(), h.mode)
  }
  return map
})

const lopPrimaryHighlight = computed(
  () => lopDirectHighlights.value[0]?.point.toUpperCase() || undefined,
)

/** Soft targets (e.g. ESDF NILUG) not already listed as FPL waypoints */
const lopExtraSuggestPoints = computed(() => {
  const listed = new Set(routeFixes.value.map((f) => f.toUpperCase()))
  return lopDirectHighlights.value
    .filter((h) => h.mode === 'suggest' && !listed.has(h.point.toUpperCase()))
    .map((h) => h.point.toUpperCase())
})

const manualValid = computed(() => parseManualWaypoint(manualText.value) != null)

function isSelected(sid: string): boolean {
  const current = props.strip.sid || ''
  if (!current) return false
  return normSidKey(sid) === normSidKey(current)
}

function isExitMatch(sid: string): boolean {
  return exitMatchKeys.value.has(normSidKey(sid))
}

function isDirectSelected(point: string): boolean {
  const cur = (props.strip.direct || '').trim().toUpperCase()
  return !!cur && cur === point.toUpperCase()
}

function dctItemClass(point: string): Record<string, boolean> {
  const u = point.toUpperCase()
  const mode = lopHighlightMode.value.get(u)
  return {
    selected: isDirectSelected(u),
    'lop-dct': !!mode,
    'lop-dct-auto': mode === 'auto',
    'lop-dct-suggest': mode === 'suggest',
  }
}

function openFprView() {
  fprView.value = true
  manualText.value = ''
  nextTick(() => manualInput.value?.focus())
}

function onManualInput() {
  manualText.value = manualText.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 5)
}

/** ICAO fix: 2–5 alphanumeric (typically 2–3 or 5 letters). */
function parseManualWaypoint(text: string): string | null {
  const t = text.trim().toUpperCase()
  if (!/^[A-Z0-9]{2,5}$/.test(t)) return null
  return t
}

async function fetchExitMatches(airport: string, runway: string) {
  // First FPL point after ADEP/rwy or SID/rwy (not the SID procedure name)
  const tmaExit =
    props.strip.tmaExit || extractTmaExitPoint(undefined, props.strip.route)
  if (!tmaExit) {
    exitMatchKeys.value = new Set()
    return
  }
  if (airport !== 'ESSA' && airport !== 'ESMS') {
    // Fallback: SID name / track ends with the FPL exit fix
    const exitU = tmaExit.toUpperCase()
    const keys = new Set<string>()
    for (const sid of allSids.value) {
      const key = normSidKey(sid)
      if (key.startsWith(exitU) && key.length > exitU.length && /\d/.test(key.slice(exitU.length))) {
        keys.add(key)
        continue
      }
      const parts = key.split('·')
      if (parts.length >= 2 && parts[parts.length - 1] === exitU) keys.add(key)
    }
    exitMatchKeys.value = keys
    return
  }
  try {
    const params = new URLSearchParams({ airport, runway, exit: tmaExit })
    if (airport === 'ESSA') {
      // Config optional — exit SIDs also come from all prefs for this DEP RWY
      if (store.essaRwyConfigIdResolved) {
        params.set('config', store.essaRwyConfigIdResolved)
      }
      params.set('slow', hasSlowRemark(props.strip.remarks) || props.strip.isSlow ? '1' : '0')
    }
    if (props.strip.route) params.set('route', props.strip.route)
    const res = await fetch(`/api/preferred-sid?${params}`)
    if (!res.ok) {
      exitMatchKeys.value = new Set()
      return
    }
    const data = (await res.json()) as { exitSids?: string[] }
    exitMatchKeys.value = new Set((data.exitSids ?? []).map(normSidKey))
  } catch {
    exitMatchKeys.value = new Set()
  }
}

async function fetchSids() {
  const airport = props.strip.adep
  const runway = props.strip.runway
  if (!airport || airport === '????' || !runway) {
    allSids.value = []
    exitMatchKeys.value = new Set()
    return
  }
  loading.value = true
  try {
    const res = await fetch(`/api/sids?airport=${encodeURIComponent(airport)}&runway=${encodeURIComponent(runway)}`)
    if (!res.ok) {
      allSids.value = []
      exitMatchKeys.value = new Set()
      return
    }
    const data = (await res.json()) as { name: string }[]
    allSids.value = data.map((s) => s.name)
    await fetchExitMatches(airport, runway)
  } catch {
    allSids.value = []
    exitMatchKeys.value = new Set()
  } finally {
    loading.value = false
  }
}

function close() {
  emit('update:modelValue', false)
}

function onSelect(sid: string) {
  // Real SID replaces AHD/vector mode and DCT
  if (props.strip.assignedHeading) {
    store.applyAssignedHeading(props.strip.id, '')
  }
  if (props.strip.direct) {
    store.sendAssignment(props.strip.id, 'assignDirect', '')
  }
  store.sendAssignment(props.strip.id, 'assignSid', sid)
  // Vector SIDs are normal RNAV (5000 ft) — never auto-set SLOW
  // V / Z: never auto-add SLOW flag from SID selection
  if (
    isIfrSidEligible(props.strip.flightRules) &&
    isSlowSid(sid) &&
    !isVectorSidName(sid) &&
    !hasSlowRemark(props.strip.remarks)
  ) {
    store.updateRemarks(props.strip.id, withSlowRemark(props.strip.remarks, true))
  }
  close()
}

function onClear() {
  // DCT in SID cell: clear DCT + restore preferred SID (same as FPR/DCT CLEAR).
  // Do not also send assignSid '' — that wipes the restored preferred SID.
  if (props.strip.direct) {
    store.applyAssignedDirect(props.strip.id, '')
    close()
    return
  }
  store.sendAssignment(props.strip.id, 'assignSid', '')
  close()
}

function onSelectDirect(point: string) {
  const fix = point.trim().toUpperCase()
  if (!fix) return
  store.applyAssignedDirect(props.strip.id, fix)
  close()
}

function submitManual() {
  const fix = parseManualWaypoint(manualText.value)
  if (!fix) return
  store.applyAssignedDirect(props.strip.id, fix)
  close()
}

function onClearDirect() {
  store.applyAssignedDirect(props.strip.id, '')
  close()
}

watch(
  () =>
    [
      props.target[1],
      loading.value,
      allSids.value.length,
      fprView.value,
      normalSids.value.length,
      slowSids.value.length,
      vfrSids.value.length,
      milSids.value.length,
    ] as const,
  () => {
    if (!props.modelValue) return
    syncMenuMax()
    if (!fprView.value && !loading.value && hasAnySids.value) {
      oneColNatural.value = estimateOneColHeight()
      splitColumns.value = oneColNatural.value > menuMaxPx.value + 1
      placeMenu(Math.min(oneColNatural.value, menuMaxPx.value))
    }
    void refineLayout()
  },
)

watch(
  () => props.modelValue,
  (open) => {
    if (open) void fetchSids()
  },
)
</script>

<style scoped>
/* Frame / non-clickable / CLEAR = action-key grey; SID choices = strip-white on black */
.sid-route-menu {
  --sid-strip-white: #ebebeb;
  --s: var(--efs-scale, 1);
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  min-width: calc(132px * var(--s));
  max-width: min(92vw, calc(360px * var(--s)));
  background: #d8d8d8;
  border: 1px solid #888;
  border-radius: 0;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
  color: #000;
  font-family: system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  overflow: hidden;
}

.sid-route-split {
  max-width: min(96vw, calc(560px * var(--s)));
}

.sid-route-top,
.sid-route-foot,
.sid-route-manual,
.sid-route-list,
.sid-route-section {
  flex-shrink: 0;
}

.sid-route-foot {
  display: flex;
  flex-direction: column;
}

/* SID lists scroll; header and FPR / CLEAR stay outside this box. */
.sid-route-scroll {
  min-height: 0;
  min-width: 0;
  box-sizing: border-box;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: #222 #c8c8c8;
}

.sid-route-scroll::-webkit-scrollbar,
.sid-route-col-main::-webkit-scrollbar,
.sid-route-col-side-scroll::-webkit-scrollbar {
  width: 10px;
}

.sid-route-scroll::-webkit-scrollbar-track,
.sid-route-col-main::-webkit-scrollbar-track,
.sid-route-col-side-scroll::-webkit-scrollbar-track {
  background: #c8c8c8;
}

.sid-route-scroll::-webkit-scrollbar-thumb,
.sid-route-col-main::-webkit-scrollbar-thumb,
.sid-route-col-side-scroll::-webkit-scrollbar-thumb {
  background: #222;
}

.sid-route-split .sid-route-scroll {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  align-items: stretch;
  overflow: hidden;
}

.sid-route-col-main {
  min-width: 0;
  min-height: 0;
}

.sid-route-split .sid-route-col-main {
  height: 100%;
  max-height: 100%;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: #222 #c8c8c8;
}

.sid-route-col-side {
  min-width: 0;
  min-height: 0;
  height: 100%;
  max-height: 100%;
  display: flex;
  flex-direction: column;
  border-left: 2px solid #555;
  overflow: hidden;
}

.sid-route-col-side-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: #222 #c8c8c8;
}

.sid-route-top {
  display: block;
  width: 100%;
  margin: 0;
  padding: 0;
  border: none;
  appearance: none;
  -webkit-appearance: none;
  background: #c0c0c0;
  cursor: pointer;
  font: inherit;
  text-align: center;
}

.sid-route-top:hover {
  background: #b0b0b0;
}

.sid-route-top:hover .sid-route-header,
.sid-route-top:hover .sid-route-callsign {
  background: transparent;
}

.sid-route-header {
  padding: calc(6px * var(--s)) calc(8px * var(--s)) calc(2px * var(--s));
  font-size: calc(9px * var(--s));
  font-weight: 800;
  letter-spacing: 0.12em;
  color: #000;
  text-transform: uppercase;
  text-align: center;
  background: #c0c0c0;
}

.sid-route-callsign {
  padding: 0 calc(8px * var(--s)) calc(6px * var(--s));
  font-size: calc(12px * var(--s));
  font-weight: 800;
  letter-spacing: 0.3px;
  color: #000;
  text-align: center;
  text-transform: uppercase;
  background: #c0c0c0;
  border-bottom: 2px solid #555;
}

.sid-route-section {
  padding: calc(5px * var(--s)) calc(8px * var(--s)) calc(4px * var(--s));
  font-size: calc(9px * var(--s));
  font-weight: 800;
  letter-spacing: 0.12em;
  color: #000;
  text-transform: uppercase;
  text-align: center;
  border-top: 2px solid #555;
  border-bottom: 2px solid #555;
  background: #c0c0c0;
}

.sid-route-empty {
  padding: calc(8px * var(--s));
  font-size: calc(10px * var(--s));
  font-weight: 600;
  color: #000;
  text-align: center;
  background: #d8d8d8;
}

.sid-route-list {
  display: flex;
  flex-direction: column;
  background: #d8d8d8;
}

.sid-route-list-cols {
  display: grid;
  grid-template-columns: 1fr 1fr;
}

/* Clickable SIDs — action-key default; hover/selected = dark on strip-white */
.sid-route-item {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  margin: 0;
  padding: calc(5px * var(--s)) calc(8px * var(--s));
  border: none;
  border-radius: 0;
  border-bottom: 1px solid #888;
  appearance: none;
  -webkit-appearance: none;
  background: #d8d8d8;
  color: #000;
  font-size: calc(10px * var(--s));
  font-weight: 700;
  letter-spacing: 0.3px;
  text-transform: uppercase;
  text-align: center;
  cursor: pointer;
  line-height: 1.1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-height: max(28px, calc(28px * var(--s)));
}

.sid-route-list-cols .sid-route-item:nth-child(odd) {
  border-right: 1px solid #888;
}

.sid-route-list:not(.sid-route-list-cols) .sid-route-item:last-child,
.sid-route-list-cols .sid-route-item:nth-last-child(-n + 2) {
  border-bottom: none;
}

/* SIDs leading to filled TMA exit (incl. alternatives e.g. ROKNI when ARS) */
.sid-route-item.exit-match {
  background: #b8d4a8;
  color: #000;
  box-shadow: inset 0 0 0 1px #7a9a6a;
}

/* LOP DCT: soft = green; auto = stronger green */
.sid-route-item.lop-dct-suggest,
.sid-route-item.lop-dct:not(.lop-dct-auto) {
  background: #8fd19a;
  color: #000;
  box-shadow: inset 0 0 0 1px #3d8f4a;
}

.sid-route-item.lop-dct-auto {
  background: #5cb86a;
  color: #000;
  box-shadow: inset 0 0 0 1px #2a6e35;
  font-weight: 800;
}

.sid-route-fpr.lop-dct {
  background: #8fd19a;
  color: #000;
  box-shadow: inset 0 0 0 1px #3d8f4a;
}

.sid-route-item.selected {
  background: var(--sid-strip-white);
  color: #1a3a6e;
  box-shadow: inset 0 0 0 2px #1a3a6e;
}

.sid-route-item.lop-dct.selected,
.sid-route-item.lop-dct-auto.selected,
.sid-route-item.lop-dct-suggest.selected {
  background: #c8f0ce;
  color: #0a3d14;
  box-shadow: inset 0 0 0 2px #2a6e35;
}

.sid-route-item.exit-match.selected {
  background: #b8d4a8;
  color: #1a3a6e;
  box-shadow: inset 0 0 0 2px #1a3a6e;
}

.sid-route-item:hover {
  background: #1a3a6e;
  color: var(--sid-strip-white);
  box-shadow: inset 0 0 0 2px #000;
  position: relative;
  z-index: 1;
}

.sid-route-manual {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: calc(6px * var(--s)) calc(8px * var(--s));
  border-top: 2px solid #555;
  background: #c0c0c0;
}

.sid-route-manual-input {
  width: 100%;
  margin: 0;
  padding: calc(6px * var(--s)) calc(8px * var(--s));
  border: 2px solid #555;
  border-radius: 0;
  background: #fff;
  color: #000;
  font-size: calc(12px * var(--s));
  font-weight: 800;
  letter-spacing: 0.12em;
  text-align: center;
  text-transform: uppercase;
  outline: none;
  font-family: inherit;
}

.sid-route-manual-input:focus {
  border-color: #1a3a6e;
}

.sid-route-manual-input.invalid {
  border-color: #a33;
  background: #fff5f5;
}

.sid-route-fpr {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  margin: 0;
  padding: calc(8px * var(--s)) calc(8px * var(--s));
  border: none;
  border-top: 3px solid #333;
  border-radius: 0;
  appearance: none;
  -webkit-appearance: none;
  background: #b8b8b8;
  color: #000;
  font-size: calc(11px * var(--s));
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  cursor: pointer;
  line-height: 1.1;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.35);
  min-height: max(30px, calc(30px * var(--s)));
}

.sid-route-fpr:hover {
  background: #1a3a6e;
  color: var(--sid-strip-white);
  box-shadow: inset 0 0 0 2px #000;
}

/* First FPL point — quick DCT under FPR / DCT */
.sid-route-fpr-point {
  border-top: 1px solid #666;
  border-bottom: none;
  background: #c8c8c8;
  font-size: calc(11px * var(--s));
  font-weight: 800;
  letter-spacing: 0.1em;
  min-height: max(30px, calc(30px * var(--s)));
}

.sid-route-fpr-point:hover {
  background: #1a3a6e;
  color: var(--sid-strip-white);
  box-shadow: inset 0 0 0 2px #000;
}

.sid-route-clear {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  margin: 0;
  padding: calc(10px * var(--s)) calc(8px * var(--s));
  border: none;
  border-top: 3px solid #333;
  border-radius: 0;
  appearance: none;
  -webkit-appearance: none;
  background: #a8a8a8;
  color: #000;
  font-size: calc(12px * var(--s));
  font-weight: 800;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  cursor: pointer;
  line-height: 1.1;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.35);
  min-height: max(32px, calc(32px * var(--s)));
}

/* CLEAR under FPR / first-point — thinner separator */
.sid-route-fpr + .sid-route-clear,
.sid-route-fpr-point + .sid-route-clear {
  border-top: 1px solid #666;
}

.sid-route-clear:hover {
  background: #1a3a6e;
  color: var(--sid-strip-white);
  box-shadow: inset 0 0 0 2px #000;
}
</style>

<style>
/* Vuetify sizes the overlay, but its content overflows visibly past max-height.
   Clip here so the menu box cannot paint below the window. */
.v-overlay__content.sid-route-overlay {
  overflow: hidden !important;
  display: flex;
  flex-direction: column;
}
</style>

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
      class="sid-route-menu stand-menu"
      :class="{
        'stand-menu-multi': !isCompact && columns.length > 1,
        'stand-menu-compact': isCompact,
      }"
      :style="menuBoxStyle"
      @click.stop
    >
      <button type="button" class="sid-route-top" title="Close" @click="closeMenu">
        <div class="sid-route-header">STAND</div>
        <div class="sid-route-callsign">
          <span>{{ strip.callsign }}</span>
          <span
            v-if="strip.aircraftType?.trim()"
            class="stand-menu-atyp"
          >{{ strip.aircraftType.trim() }}</span>
        </div>
      </button>

      <div v-if="loading" class="sid-route-empty">Loading…</div>
      <div v-else-if="isCompact ? !compactRows.length : !columns.length" class="sid-route-empty">No stand data</div>

      <!-- Compact: single scrollable list, stand name + colour highlight only -->
      <div
        v-else-if="isCompact"
        ref="bodyEl"
        class="stand-menu-compact-body"
        :style="columnsBoxStyle"
      >
        <div class="sid-route-list stand-menu-compact-list">
          <template v-for="row in compactRows" :key="row.key">
            <div
              v-if="row.kind === 'section'"
              class="sid-route-section stand-menu-compact-sec"
            >{{ row.label }}</div>
            <button
              v-else
              type="button"
              class="sid-route-item stand-menu-item stand-menu-key"
              :class="standItemClass(row.stand)"
              :disabled="!row.stand.selectable"
              :title="standTitle(row.stand)"
              @click="onSelect(row.stand)"
            >
              <span class="stand-key-icon" aria-hidden="true">
                <v-icon
                  v-if="occupiedStatusIcon(row.stand)"
                  class="stand-occ-icon"
                  :icon="occupiedStatusIcon(row.stand)!"
                  size="15"
                />
              </span>
              <span class="stand-key-name">{{ row.stand.name }}</span>
              <span class="stand-key-right">
                <template v-if="row.stand.assignedCount && row.stand.assignedCount > 0">
                  <span class="stand-key-cs">{{ row.stand.assignedCount }} assigned</span>
                  <span class="stand-key-time"></span>
                </template>
                <template v-else-if="row.stand.occupied">
                  <span class="stand-key-cs">{{ row.stand.occupied.label }}</span>
                  <span class="stand-key-time">
                    <v-icon
                      v-if="showBlockedByIcon(row.stand)"
                      class="stand-key-block-icon"
                      icon="mdi-cancel"
                      size="11"
                    />
                    <span v-if="standKeySubText(row.stand)">{{ standKeySubText(row.stand) }}</span>
                  </span>
                </template>
              </span>
            </button>
          </template>
        </div>
      </div>

      <!-- Full: multi-column apron map -->
      <div
        v-else
        ref="bodyEl"
        class="stand-menu-columns"
        :style="columnsBoxStyle"
      >
        <!-- T5 spans Pier A+B and Pier F (+ Remote F); same header chrome as T4/… -->
        <div v-if="t5Columns.length" class="stand-menu-col-group">
          <div class="sid-route-section stand-menu-col-title stand-menu-group-title">T5</div>
          <div class="stand-menu-col-group-body">
            <div
              v-for="col in t5Columns"
              :key="col.key"
              class="stand-menu-col"
            >
              <div class="stand-menu-col-scroll">
                <template v-for="sec in col.sections" :key="col.key + '-' + sec.title">
                  <div
                    v-if="sec.subtitle"
                    class="sid-route-section stand-menu-sub"
                  >{{ sec.subtitle }}</div>
                  <div class="sid-route-list">
                    <button
                      v-for="stand in sec.stands"
                      :key="stand.name"
                      type="button"
                      class="sid-route-item stand-menu-item stand-menu-key"
                      :class="standItemClass(stand)"
                      :disabled="!stand.selectable"
                      :title="standTitle(stand)"
                      @click="onSelect(stand)"
                    >
                      <span class="stand-key-icon" aria-hidden="true">
                        <v-icon
                          v-if="occupiedStatusIcon(stand)"
                          class="stand-occ-icon"
                          :icon="occupiedStatusIcon(stand)!"
                          size="15"
                        />
                      </span>
                      <span class="stand-key-name">{{ stand.name }}</span>
                      <span class="stand-key-right">
                        <template v-if="stand.assignedCount && stand.assignedCount > 0">
                          <span class="stand-key-cs">{{ stand.assignedCount }} assigned</span>
                          <span class="stand-key-time"></span>
                        </template>
                        <template v-else-if="stand.occupied">
                          <span class="stand-key-cs">{{ stand.occupied.label }}</span>
                          <span class="stand-key-time">
                            <v-icon
                              v-if="showBlockedByIcon(stand)"
                              class="stand-key-block-icon"
                              icon="mdi-cancel"
                              size="11"
                            />
                            <span v-if="standKeySubText(stand)">{{ standKeySubText(stand) }}</span>
                          </span>
                        </template>
                      </span>
                    </button>
                  </div>
                </template>
              </div>
            </div>
          </div>
        </div>

        <div
          v-for="col in otherColumns"
          :key="col.key"
          class="stand-menu-col"
        >
          <div class="sid-route-section stand-menu-col-title">{{ col.title }}</div>
          <div class="stand-menu-col-scroll">
            <template v-for="sec in col.sections" :key="col.key + '-' + sec.title">
              <div
                v-if="sec.subtitle"
                class="sid-route-section stand-menu-sub"
              >{{ sec.subtitle }}</div>
              <div class="sid-route-list">
                <button
                  v-for="stand in sec.stands"
                  :key="stand.name"
                  type="button"
                  class="sid-route-item stand-menu-item stand-menu-key"
                  :class="standItemClass(stand)"
                  :disabled="!stand.selectable"
                  :title="standTitle(stand)"
                  @click="onSelect(stand)"
                >
                  <span class="stand-key-icon" aria-hidden="true">
                    <v-icon
                      v-if="occupiedStatusIcon(stand)"
                      class="stand-occ-icon"
                      :icon="occupiedStatusIcon(stand)!"
                      size="15"
                    />
                  </span>
                  <span class="stand-key-name">{{ stand.name }}</span>
                  <span class="stand-key-right">
                    <template v-if="stand.assignedCount && stand.assignedCount > 0">
                      <span class="stand-key-cs">{{ stand.assignedCount }} assigned</span>
                      <span class="stand-key-time"></span>
                    </template>
                    <template v-else-if="stand.occupied">
                      <span class="stand-key-cs">{{ stand.occupied.label }}</span>
                      <span class="stand-key-time">
                        <v-icon
                          v-if="showBlockedByIcon(stand)"
                          class="stand-key-block-icon"
                          icon="mdi-cancel"
                          size="11"
                        />
                        <span v-if="standKeySubText(stand)">{{ standKeySubText(stand) }}</span>
                      </span>
                    </template>
                  </span>
                </button>
              </div>
            </template>
          </div>
        </div>
      </div>

      <div class="sid-route-foot">
        <button
          type="button"
          class="sid-route-fpr"
          :disabled="!currentStand"
          @click="onPublish"
        >Publish</button>
        <button type="button" class="sid-route-clear" @click="onClear">Clear</button>
      </div>
    </div>
  </v-menu>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { FlightStrip, StandMenuApron, StandMenuStand } from '@vatefs/common'
import { useEfsStore } from '@/store/efs'

const props = withDefaults(
  defineProps<{
    modelValue: boolean
    strip: FlightStrip
    target: [number, number]
    zIndex?: number
  }>(),
  { zIndex: 2600 },
)

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const store = useEfsStore()

interface StandColumnSection {
  title: string
  /** Shown under the column title when the column merges several aprons (e.g. PIER A) */
  subtitle?: string
  stands: StandMenuStand[]
}

interface StandColumn {
  key: string
  title: string
  sections: StandColumnSection[]
}

const menuEl = ref<HTMLElement | null>(null)
const bodyEl = ref<HTMLElement | null>(null)
const loading = ref(false)
const aprons = ref<StandMenuApron[]>([])
const currentStand = ref<string | undefined>()

const isCompact = computed(() => store.standMenuLayout === 'compact')

const VIEW_MARGIN = 16
const CHROME_FALLBACK = 120
/** Full apron columns need room for icon | stand | C/S (same key layout as compact). */
const COL_MIN_PX = 180
const COMPACT_COL_PX = 220
const menuMaxPx = ref(320)
const menuMaxWidthPx = ref(480)
const measuredChrome = ref(CHROME_FALLBACK)
const contentHeightPx = ref(0)
const placedTop = ref<number | null>(null)
const placedLeft = ref<number | null>(null)

let ignoreCloseUntil = 0
let refineToken = 0

/**
 * Column groups (file order within each column):
 *   T5(A+B | F+Remote) | T4 | T3+T2 | D/E | G+H | J+K+L+P | M+R | S
 * T5 uses a spanning header; other columns use the first apron as the title.
 */
const COLUMN_ORDER = ['T5AB', 'T5F', 'T4', 'T32', 'DE', 'GH', 'JKLP', 'MR', 'S'] as const

function columnKeyForApron(
  title: string,
): { key: string; colTitle: string; subtitle?: string; /** Pier labels under shared T5 header. */ keepSub?: boolean } {
  const t = title.trim().toUpperCase()
  if (t === 'T5 PIER A') return { key: 'T5AB', colTitle: 'T5', subtitle: 'Pier A', keepSub: true }
  if (t === 'T5 PIER B') return { key: 'T5AB', colTitle: 'T5', subtitle: 'Pier B', keepSub: true }
  if (t === 'T5 PIER F') return { key: 'T5F', colTitle: 'T5', subtitle: 'Pier F', keepSub: true }
  if (t === 'APRON F' || t === 'F') return { key: 'T5F', colTitle: 'T5', subtitle: 'Remote F', keepSub: true }
  if (t === 'T4') return { key: 'T4', colTitle: 'T4' }
  if (t === 'T3') return { key: 'T32', colTitle: 'T3', subtitle: 'T3' }
  if (t === 'T2') return { key: 'T32', colTitle: 'T3', subtitle: 'T2' }
  if (t === 'APRON D/E' || t === 'D/E') return { key: 'DE', colTitle: 'D/E' }
  if (['G', 'H'].includes(t) || /^APRON\s+[GH]$/.test(t)) {
    const letter = t.replace(/^APRON\s+/, '')
    return { key: 'GH', colTitle: 'G', subtitle: letter }
  }
  if (['J', 'K', 'L', 'P'].includes(t) || /^APRON\s+[JKLP]$/.test(t)) {
    const letter = t.replace(/^APRON\s+/, '')
    return { key: 'JKLP', colTitle: 'J', subtitle: letter }
  }
  if (['M', 'R'].includes(t) || /^APRON\s+[MR]$/.test(t)) {
    const letter = t.replace(/^APRON\s+/, '')
    return { key: 'MR', colTitle: 'M', subtitle: letter }
  }
  if (t === 'S' || t === 'APRON S') return { key: 'S', colTitle: 'S' }
  return { key: t, colTitle: t }
}

const columns = computed((): StandColumn[] => {
  const map = new Map<string, StandColumn>()
  for (const apron of aprons.value) {
    if (!apron.stands.length) continue
    const { key, colTitle, subtitle, keepSub } = columnKeyForApron(apron.title)
    let col = map.get(key)
    if (!col) {
      col = { key, title: colTitle, sections: [] }
      map.set(key, col)
    }
    // T5: always show pier/remote labels under the spanning header.
    // Other columns: first apron is the title; later aprons get mid-list labels.
    col.sections.push({
      title: apron.title,
      subtitle: keepSub || col.sections.length > 0 ? subtitle : undefined,
      stands: apron.stands,
    })
  }
  const ordered: StandColumn[] = []
  for (const key of COLUMN_ORDER) {
    const col = map.get(key)
    if (col) ordered.push(col)
    map.delete(key)
  }
  for (const col of map.values()) ordered.push(col)
  return ordered
})

type CompactRow =
  | { kind: 'section'; key: string; label: string }
  | { kind: 'stand'; key: string; stand: StandMenuStand }

/** Flatten aprons into one scrollable list with light section labels. */
const compactRows = computed((): CompactRow[] => {
  const rows: CompactRow[] = []
  for (const apron of aprons.value) {
    if (!apron.stands.length) continue
    const { subtitle, colTitle, keepSub } = columnKeyForApron(apron.title)
    const label = keepSub && subtitle ? subtitle : colTitle
    rows.push({ kind: 'section', key: `sec-${apron.title}`, label })
    for (const stand of apron.stands) {
      rows.push({ kind: 'stand', key: stand.name, stand })
    }
  }
  return rows
})

const t5Columns = computed(() => columns.value.filter((c) => c.key === 'T5AB' || c.key === 'T5F'))
const otherColumns = computed(() => columns.value.filter((c) => c.key !== 'T5AB' && c.key !== 'T5F'))

const menuAnchor = computed((): [number, number] => [
  placedLeft.value ?? props.target[0],
  placedTop.value ?? props.target[1],
])

const menuBoxStyle = computed(() => {
  if (isCompact.value) {
    const w = Math.min(menuMaxWidthPx.value, COMPACT_COL_PX)
    // Fixed width so 1fr columns resolve (shrink-to-fit was collapsing C/S)
    return {
      maxHeight: `${menuMaxPx.value}px`,
      width: `${w}px`,
      maxWidth: `${w}px`,
      minWidth: `${w}px`,
    }
  }
  return {
    maxHeight: `${menuMaxPx.value}px`,
    maxWidth: `${menuMaxWidthPx.value}px`,
  }
})

const columnsBoxStyle = computed(() => {
  const h = Math.max(0, menuMaxPx.value - measuredChrome.value)
  return {
    maxHeight: `${h}px`,
    height: contentHeightPx.value > 0 ? `${Math.min(contentHeightPx.value, h)}px` : undefined,
  }
})

function standItemClass(stand: StandMenuStand) {
  const occ = stand.occupied
  const occKind = occ?.kind
  const notAllowed = stand.fit === 'notAllowed'
  // Blocked: red if related stand occupied, amber if only planned
  const blockedAsOccupied = occKind === 'blocked' && occ?.blockFrom !== 'assigned'
  const blockedAsPlanned = occKind === 'blocked' && occ?.blockFrom === 'assigned'
  const planned = occKind === 'assigned' || blockedAsPlanned
  // Fill = availability (amber/red/grey/default). Green left edge = preferred (exit-match).
  return {
    selected: !!currentStand.value && currentStand.value.toUpperCase() === stand.name.toUpperCase(),
    'exit-match': stand.fit === 'preferred' && !notAllowed,
    'stand-occupied': !notAllowed && (occKind === 'occupied' || blockedAsOccupied),
    'stand-planned': !notAllowed && planned,
    'stand-planned-air': !notAllowed && planned && !!occ?.airborne,
    'stand-not-allowed': notAllowed,
  }
}

/** True when Planned/Blocked comes from an aircraft still airborne (softer yellow). */
function isAirbornePlanned(stand: StandMenuStand): boolean {
  const occ = stand.occupied
  if (!occ?.airborne) return false
  if (occ.kind === 'assigned') return true
  return occ.kind === 'blocked' && occ.blockFrom === 'assigned'
}

/** occupied = on stand; assigned = planned; blocked = GRP BLOCKS/LIMITS neighbour */
function occupiedKindLabel(stand: StandMenuStand): string {
  if (!stand.occupied) return ''
  // Neighbour blocked by a planned aircraft → same wording as that plan (Inbound / Planned)
  if (stand.occupied.kind === 'assigned' || stand.occupied.blockFrom === 'assigned') {
    return stand.occupied.airborne ? 'Inbound' : 'Planned'
  }
  if (stand.occupied.kind === 'blocked') return 'Blocked'
  return 'Occupied'
}

/** Status MDI — plan/inbound/block; occupied dep = takeoff, arr = parking. */
function occupiedStatusIcon(stand: StandMenuStand): string | undefined {
  const occ = stand.occupied
  if (!occ) return undefined
  if (occ.kind === 'assigned' || occ.blockFrom === 'assigned') {
    return occ.airborne ? 'mdi-airplane-landing' : 'mdi-map-marker-outline'
  }
  if (occ.kind === 'blocked') return 'mdi-cancel'
  if (occ.kind === 'occupied') {
    return occ.departure ? 'mdi-airplane-takeoff' : 'mdi-parking'
  }
  return undefined
}

/** Format HHmm → HH:MM when possible. */
function formatHhMm(raw: string | undefined): string {
  if (!raw) return ''
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 4) return `${digits.slice(0, 2)}:${digits.slice(2)}`
  return raw
}

/**
 * Prefer TS → TB → EB. Only for departures Occupied on stand
 * (not blocked — those show the related stand name).
 */
function depTimeText(stand: StandMenuStand): string {
  const occ = stand.occupied
  if (!occ || occ.kind !== 'occupied') return ''
  if (occ.tsat) return `TS ${formatHhMm(occ.tsat)}`
  if (occ.tobt) return `TB ${formatHhMm(occ.tobt)}`
  if (occ.eobt) return `EB ${formatHhMm(occ.eobt)}`
  return ''
}

/** Bottom-right key line: related stand when blocked, else dep time. */
function standKeySubText(stand: StandMenuStand): string {
  const occ = stand.occupied
  if (!occ) return ''
  if (occ.kind === 'blocked') return occ.relatedStand ?? ''
  return depTimeText(stand)
}

/** Soft block (inbound/planned neighbour) — show cancel next to related stand. */
function showBlockedByIcon(stand: StandMenuStand): boolean {
  const occ = stand.occupied
  return occ?.kind === 'blocked' && occ.blockFrom === 'assigned'
}

function occupiedText(stand: StandMenuStand): string {
  if (!stand.occupied) return ''
  const rel = stand.occupied.relatedStand ? ` ${stand.occupied.relatedStand}` : ''
  const time = depTimeText(stand)
  return `${occupiedKindLabel(stand)}${rel} ${stand.occupied.label}${time ? ` ${time}` : ''}`.trim()
}

function standTitle(stand: StandMenuStand): string {
  const bits: string[] = [stand.name]
  if (stand.fit === 'preferred') bits.push('preferred')
  else if (stand.fit === 'notAllowed') bits.push(stand.reason ? `not allowed: ${stand.reason}` : 'not allowed')
  if (stand.assignedCount && stand.assignedCount > 0) bits.push(`${stand.assignedCount} assigned`)
  else if (stand.occupied) bits.push(occupiedText(stand))
  return bits.join(' · ')
}

function visibleWindowHeight(): number {
  return window.visualViewport?.height ?? window.innerHeight
}

function visibleWindowWidth(): number {
  return window.visualViewport?.width ?? window.innerWidth
}

function syncMenuMax() {
  menuMaxPx.value = Math.max(0, Math.floor(visibleWindowHeight() - VIEW_MARGIN * 2))
  menuMaxWidthPx.value = Math.max(0, Math.floor(visibleWindowWidth() - VIEW_MARGIN * 2))
}

function placeMenu(contentHeight: number, contentWidth: number) {
  const vh = visibleWindowHeight()
  const vw = visibleWindowWidth()
  const height = Math.min(Math.max(contentHeight, 1), menuMaxPx.value)
  const width = Math.min(Math.max(contentWidth, 1), menuMaxWidthPx.value)
  let top = props.target[1]
  if (top + height > vh - VIEW_MARGIN) top = vh - VIEW_MARGIN - height
  if (top < VIEW_MARGIN) top = VIEW_MARGIN
  let left = props.target[0]
  if (left + width > vw - VIEW_MARGIN) left = vw - VIEW_MARGIN - width
  if (left < VIEW_MARGIN) left = VIEW_MARGIN
  placedTop.value = Math.round(top)
  placedLeft.value = Math.round(left)
}

function estimateItemPx(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--efs-scale')
  const scale = Number.parseFloat(raw)
  const s = Number.isFinite(scale) && scale > 0 ? scale : 1
  return Math.max(28, 28 * s) + Math.round(10 * s) + 1
}

function estimateContent(): { height: number; width: number } {
  const item = estimateItemPx()
  const section = Math.round(item * 0.85)
  if (isCompact.value) {
    const compactItem = Math.max(22, Math.round(item * 0.72))
    let h = 0
    for (const row of compactRows.value) {
      h += row.kind === 'section' ? section : compactItem
    }
    return {
      height: measuredChrome.value + h,
      width: Math.min(menuMaxWidthPx.value, COMPACT_COL_PX),
    }
  }
  let tallest = 0
  for (const col of columns.value) {
    let h = section // column title
    for (const sec of col.sections) {
      if (sec.subtitle) h += section
      h += sec.stands.length * item
    }
    tallest = Math.max(tallest, h)
  }
  const n = Math.max(1, columns.value.length)
  const width = Math.min(menuMaxWidthPx.value, n * COL_MIN_PX + 8)
  return { height: measuredChrome.value + tallest, width }
}

function measureChrome(menu: HTMLElement): number {
  const head = menu.querySelector('.sid-route-top') as HTMLElement | null
  const foot = menu.querySelector('.sid-route-foot') as HTMLElement | null
  return (head?.offsetHeight ?? 0) + (foot?.offsetHeight ?? 0)
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

  let tallest = 0
  if (isCompact.value) {
    const body = menu.querySelector('.stand-menu-compact-body') as HTMLElement | null
    const list = menu.querySelector('.stand-menu-compact-list') as HTMLElement | null
    tallest = list?.scrollHeight ?? body?.scrollHeight ?? 0
  } else {
    const groupTitle = menu.querySelector('.stand-menu-group-title') as HTMLElement | null
    const groupTitleH = groupTitle?.offsetHeight ?? 0
    menu.querySelectorAll('.stand-menu-col').forEach((el) => {
      const title = el.querySelector('.stand-menu-col-title') as HTMLElement | null
      const scroll = el.querySelector('.stand-menu-col-scroll') as HTMLElement | null
      const inGroup = !!el.closest('.stand-menu-col-group')
      tallest = Math.max(
        tallest,
        (inGroup ? groupTitleH : 0) +
          (title?.offsetHeight ?? 0) +
          (scroll?.scrollHeight ?? 0),
      )
    })
  }
  const limit = Math.max(0, menuMaxPx.value - measuredChrome.value)
  contentHeightPx.value = Math.min(tallest || limit, limit)

  const width = isCompact.value
    ? Math.min(menuMaxWidthPx.value, Math.max(menu.offsetWidth, COMPACT_COL_PX))
    : Math.min(
        menuMaxWidthPx.value,
        Math.max(menu.offsetWidth, columns.value.length * COL_MIN_PX),
      )
  placeMenu(measuredChrome.value + contentHeightPx.value, width)
}

async function fetchMenu() {
  loading.value = true
  aprons.value = []
  currentStand.value = props.strip.stand
  try {
    const res = await store.requestStandMenu(props.strip.id)
    if (res) {
      aprons.value = res.aprons
      currentStand.value = res.currentStand ?? props.strip.stand
    }
  } finally {
    loading.value = false
  }
  syncMenuMax()
  const est = estimateContent()
  contentHeightPx.value = Math.max(0, est.height - measuredChrome.value)
  placeMenu(est.height, est.width)
  void refineLayout()
}

function closeMenu() {
  emit('update:modelValue', false)
}

function onModelUpdate(open: boolean) {
  if (!open && Date.now() < ignoreCloseUntil) {
    emit('update:modelValue', true)
    return
  }
  emit('update:modelValue', open)
}

function onSelect(stand: StandMenuStand) {
  if (!stand.selectable) return
  store.sendGrpStand(props.strip.id, 'assign', stand.name)
  currentStand.value = stand.name
  closeMenu()
}

function onPublish() {
  if (!currentStand.value) return
  store.sendGrpStand(props.strip.id, 'publish', currentStand.value)
  closeMenu()
}

function onClear() {
  store.sendGrpStand(props.strip.id, 'clear')
  currentStand.value = undefined
  closeMenu()
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      ignoreCloseUntil = Date.now() + 300
      placedTop.value = null
      placedLeft.value = null
      contentHeightPx.value = 0
      void fetchMenu()
    }
  },
)

watch(
  () => props.strip.stand,
  (s) => {
    if (props.modelValue) currentStand.value = s
  },
)

onBeforeUnmount(() => {
  refineToken++
})
</script>

<style scoped>
/* Shared stand key: icon | centred name | C/S + time (full + compact) */
.stand-menu-key {
  display: grid;
  grid-template-columns: minmax(0, 1fr) max-content minmax(0, 1fr);
  align-items: center;
  column-gap: calc(4px * var(--s, 1));
  padding-top: calc(3px * var(--s, 1));
  padding-bottom: calc(3px * var(--s, 1));
  font-size: calc(11px * var(--s, 1));
  line-height: 1.15;
  text-align: left;
  overflow: hidden;
}

.stand-key-icon {
  display: inline-flex;
  align-items: center;
  justify-content: flex-start;
  width: 100%;
  min-width: 0;
  height: calc(16px * var(--s, 1));
}

.stand-key-icon .stand-occ-icon {
  margin-right: 0;
}

.stand-key-name {
  font-weight: 800;
  white-space: nowrap;
  text-align: center;
  padding: 0 2px;
}

.stand-key-right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  justify-content: center;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  text-align: right;
}

.stand-key-cs,
.stand-key-time {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stand-key-cs {
  display: block;
  font-size: calc(9px * var(--s, 1));
  font-weight: 600;
  letter-spacing: 0.02em;
}

.stand-key-time {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 2px;
  font-size: calc(8px * var(--s, 1));
  font-weight: 700;
  letter-spacing: 0.02em;
  opacity: 0.9;
  min-height: 1em;
}

.stand-key-block-icon {
  flex-shrink: 0;
  opacity: 0.9;
}

.stand-occ-icon {
  opacity: 0.9;
}

/* Amber scale: inbound (light) → planned (darker). Red: occupied / hard block. */
.sid-route-item.stand-planned.stand-planned-air {
  background: #e4e0d4;
  color: #4a463c;
  box-shadow: inset 0 0 0 1px #c0b8a8;
}

.sid-route-item.stand-planned {
  background: #ddd2c0;
  color: #4a4438;
  box-shadow: inset 0 0 0 1px #b8a898;
}

.sid-route-item.stand-occupied,
.sid-route-item.stand-blocked {
  background: #e8c0c0;
  color: #3a1010;
  box-shadow: inset 0 0 0 1px #b07070;
}

/* Preferred = green left edge only (fill stays availability colour) */
.sid-route-item.exit-match {
  box-shadow: inset 8px 0 0 #5a9a4a;
}

.sid-route-item.exit-match.stand-planned.stand-planned-air {
  box-shadow: inset 8px 0 0 #5a9a4a, inset 0 0 0 1px #c0b8a8;
}

.sid-route-item.exit-match.stand-planned {
  box-shadow: inset 8px 0 0 #5a9a4a, inset 0 0 0 1px #b8a898;
}

.sid-route-item.exit-match.stand-occupied,
.sid-route-item.exit-match.stand-blocked {
  box-shadow: inset 8px 0 0 #5a9a4a, inset 0 0 0 1px #b07070;
}

.sid-route-item.stand-not-allowed {
  background: #c8c8c8;
  color: #888;
  opacity: 0.55;
  box-shadow: none;
}

.sid-route-item.stand-not-allowed:hover:not(:disabled) {
  background: #1a3a6e;
  color: #ebebeb;
  opacity: 1;
  box-shadow: inset 0 0 0 2px #000;
}

.sid-route-item:disabled {
  background: #c8c8c8;
  color: #888;
  cursor: default;
  opacity: 0.55;
  box-shadow: none;
}

.sid-route-item:disabled:hover {
  background: #c8c8c8;
  color: #888;
  box-shadow: none;
}

.sid-route-item.stand-occupied:not(:disabled):hover,
.sid-route-item.stand-blocked:not(:disabled):hover,
.sid-route-item.stand-planned:not(:disabled):hover,
.sid-route-item.stand-planned.stand-planned-air:not(:disabled):hover {
  background: #1a3a6e;
  color: #ebebeb;
  opacity: 1;
  box-shadow: inset 0 0 0 2px #000;
}

.sid-route-fpr:disabled {
  opacity: 0.45;
  cursor: default;
}

.sid-route-fpr:disabled:hover {
  background: #b8b8b8;
  color: #000;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.35);
}
</style>

<style>
/* Stand menu frame + multi-column apron layout */
.sid-route-overlay .sid-route-menu.stand-menu {
  --sid-strip-white: #ebebeb;
  --s: var(--efs-scale, 1);
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  min-width: calc(132px * var(--s));
  max-width: min(96vw, 1200px);
  background: #d8d8d8;
  border: 1px solid #888;
  border-radius: 0;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
  color: #000;
  font-family: system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  overflow: hidden;
}

.sid-route-overlay .stand-menu-multi {
  min-width: min(96vw, calc(224px * var(--s, 1)));
}

.sid-route-overlay .sid-route-top,
.sid-route-overlay .sid-route-foot,
.sid-route-overlay .sid-route-list,
.sid-route-overlay .sid-route-section {
  flex-shrink: 0;
}

.sid-route-overlay .sid-route-foot {
  display: flex;
  flex-direction: column;
}

.sid-route-overlay .stand-menu-columns {
  display: flex;
  flex-direction: row;
  align-items: stretch;
  min-height: 0;
  min-width: 0;
  box-sizing: border-box;
  overflow-x: auto;
  overflow-y: hidden;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: #222 #c8c8c8;
  background: #d8d8d8;
}

.sid-route-overlay .stand-menu-col-group {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  border-right: 2px solid #555;
  overflow: hidden;
}

.sid-route-overlay .stand-menu-col-group-body {
  flex: 1 1 auto;
  display: flex;
  flex-direction: row;
  align-items: stretch;
  min-height: 0;
  overflow: hidden;
}

.sid-route-overlay .stand-menu-col-group .stand-menu-col {
  border-right: 1px solid #888;
}

.sid-route-overlay .stand-menu-col-group .stand-menu-col:last-child {
  border-right: none;
}

.sid-route-overlay .stand-menu-col {
  flex: 1 0 auto;
  min-width: calc(112px * var(--s, 1));
  max-width: calc(160px * var(--s, 1));
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-right: 2px solid #555;
  overflow: hidden;
}

.sid-route-overlay .stand-menu-columns > .stand-menu-col:last-child,
.sid-route-overlay .stand-menu-columns > .stand-menu-col-group:last-child {
  border-right: none;
}

.sid-route-overlay .stand-menu-col-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: #222 #c8c8c8;
}

.sid-route-overlay .stand-menu-col-title {
  position: sticky;
  top: 0;
  z-index: 1;
  flex-shrink: 0;
}

/* Same chrome as top column headers (no darker / smaller mid-list style) */
.sid-route-overlay .stand-menu-sub {
  background: #c0c0c0;
}

.sid-route-overlay .stand-menu-compact {
  min-width: 0;
  box-sizing: border-box;
}

.sid-route-overlay .stand-menu-compact-body {
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: #222 #c8c8c8;
  background: #d8d8d8;
}

.sid-route-overlay .stand-menu-compact-list {
  width: 100%;
  min-width: 0;
}

.sid-route-overlay .stand-menu-compact-sec {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: calc(3px * var(--s, 1)) calc(6px * var(--s, 1));
  font-size: calc(8px * var(--s, 1));
}

.sid-route-overlay .sid-route-item.stand-menu-key {
  display: grid;
  grid-template-columns: minmax(0, 1fr) max-content minmax(0, 1fr);
  align-items: center;
  column-gap: calc(4px * var(--s, 1));
  padding: calc(3px * var(--s, 1)) calc(6px * var(--s, 1));
  font-size: calc(11px * var(--s, 1));
  line-height: 1.15;
  white-space: nowrap;
  text-align: left;
  overflow: hidden;
  text-overflow: clip;
  width: 100%;
  box-sizing: border-box;
}

.sid-route-overlay .stand-key-icon {
  display: inline-flex;
  align-items: center;
  justify-content: flex-start;
  width: 100%;
  min-width: 0;
  height: calc(16px * var(--s, 1));
}

.sid-route-overlay .stand-key-icon .stand-occ-icon {
  margin-right: 0;
}

.sid-route-overlay .stand-key-name {
  font-weight: 800;
  white-space: nowrap;
  text-align: center;
  padding: 0 2px;
}

.sid-route-overlay .stand-key-right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  justify-content: center;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  text-align: right;
}

.sid-route-overlay .stand-key-cs,
.sid-route-overlay .stand-key-time {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sid-route-overlay .stand-key-cs {
  font-size: calc(9px * var(--s, 1));
  font-weight: 600;
  letter-spacing: 0.02em;
}

.sid-route-overlay .stand-key-time {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 2px;
  font-size: calc(8px * var(--s, 1));
  font-weight: 700;
  letter-spacing: 0.02em;
  opacity: 0.9;
  min-height: 1em;
}

.sid-route-overlay .stand-key-block-icon {
  flex-shrink: 0;
  opacity: 0.9;
}

.sid-route-overlay .sid-route-top {
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

.sid-route-overlay .sid-route-header {
  padding: calc(6px * var(--s, 1)) calc(8px * var(--s, 1)) calc(2px * var(--s, 1));
  font-size: calc(9px * var(--s, 1));
  font-weight: 800;
  letter-spacing: 0.12em;
  color: #000;
  text-transform: uppercase;
  text-align: center;
  background: #c0c0c0;
}

.sid-route-overlay .sid-route-callsign {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: calc(8px * var(--s, 1));
  padding: 0 calc(8px * var(--s, 1)) calc(6px * var(--s, 1));
  font-size: calc(12px * var(--s, 1));
  font-weight: 800;
  letter-spacing: 0.3px;
  color: #000;
  text-align: center;
  text-transform: uppercase;
  background: #c0c0c0;
  border-bottom: 2px solid #555;
}

.sid-route-overlay .stand-menu-atyp {
  font-size: calc(10px * var(--s, 1));
  font-weight: 700;
  letter-spacing: 0.06em;
  color: #222;
}

.sid-route-overlay .sid-route-section {
  padding: calc(5px * var(--s, 1)) calc(8px * var(--s, 1)) calc(4px * var(--s, 1));
  font-size: calc(9px * var(--s, 1));
  font-weight: 800;
  letter-spacing: 0.12em;
  color: #000;
  text-transform: uppercase;
  text-align: center;
  border-top: 2px solid #555;
  border-bottom: 2px solid #555;
  background: #c0c0c0;
}

/* After .sid-route-section so these win over its border-top */
.sid-route-overlay .stand-menu-col > .stand-menu-col-title,
.sid-route-overlay .stand-menu-group-title {
  border-top: none;
}

/* Flush under spanning T5 — no double rule on Pier A / Pier F */
.sid-route-overlay .stand-menu-col-group .stand-menu-col-scroll > .stand-menu-sub:first-child {
  border-top: none;
}

.sid-route-overlay .sid-route-empty {
  padding: calc(8px * var(--s, 1));
  font-size: calc(10px * var(--s, 1));
  font-weight: 600;
  color: #000;
  text-align: center;
  background: #d8d8d8;
}

.sid-route-overlay .sid-route-list {
  display: flex;
  flex-direction: column;
  background: #d8d8d8;
}

.sid-route-overlay .sid-route-item {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  margin: 0;
  padding: calc(5px * var(--s, 1)) calc(8px * var(--s, 1));
  border: none;
  border-radius: 0;
  border-bottom: 1px solid #888;
  appearance: none;
  -webkit-appearance: none;
  background: #d8d8d8;
  color: #000;
  font-size: calc(10px * var(--s, 1));
  font-weight: 700;
  letter-spacing: 0.3px;
  text-transform: uppercase;
  text-align: center;
  cursor: pointer;
  line-height: 1.1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-height: max(28px, calc(28px * var(--s, 1)));
}

/* Fill = availability; preferred = green left edge only */
.sid-route-overlay .sid-route-item.exit-match {
  box-shadow: inset 8px 0 0 #5a9a4a;
}

.sid-route-overlay .sid-route-item.stand-planned.stand-planned-air {
  background: #e4e0d4;
  color: #4a463c;
  box-shadow: inset 0 0 0 1px #c0b8a8;
}

.sid-route-overlay .sid-route-item.stand-planned {
  background: #ddd2c0;
  color: #4a4438;
  box-shadow: inset 0 0 0 1px #b8a898;
}

.sid-route-overlay .sid-route-item.stand-occupied,
.sid-route-overlay .sid-route-item.stand-blocked {
  background: #e8c0c0;
  color: #3a1010;
  box-shadow: inset 0 0 0 1px #b07070;
}

.sid-route-overlay .sid-route-item.exit-match.stand-planned.stand-planned-air {
  box-shadow: inset 8px 0 0 #5a9a4a, inset 0 0 0 1px #c0b8a8;
}

.sid-route-overlay .sid-route-item.exit-match.stand-planned {
  box-shadow: inset 8px 0 0 #5a9a4a, inset 0 0 0 1px #b8a898;
}

.sid-route-overlay .sid-route-item.exit-match.stand-occupied,
.sid-route-overlay .sid-route-item.exit-match.stand-blocked {
  box-shadow: inset 8px 0 0 #5a9a4a, inset 0 0 0 1px #b07070;
}

.sid-route-overlay .sid-route-item.stand-not-allowed {
  background: #c8c8c8;
  color: #888;
  opacity: 0.55;
  box-shadow: none;
}

.sid-route-overlay .sid-route-item.stand-not-allowed:hover:not(:disabled) {
  background: #1a3a6e;
  color: #ebebeb;
  opacity: 1;
  box-shadow: inset 0 0 0 2px #000;
}

.sid-route-overlay .sid-route-item:disabled {
  background: #c8c8c8;
  color: #888;
  cursor: default;
  opacity: 0.55;
  box-shadow: none;
}

.sid-route-overlay .sid-route-item.selected {
  background: var(--sid-strip-white, #ebebeb);
  color: #1a3a6e;
  box-shadow: inset 0 0 0 2px #1a3a6e;
}

.sid-route-overlay .sid-route-item.exit-match.selected {
  box-shadow: inset 8px 0 0 #5a9a4a, inset 0 0 0 2px #1a3a6e;
}

.sid-route-overlay .sid-route-item:hover:not(:disabled),
.sid-route-overlay .sid-route-item.stand-planned.stand-planned-air:hover:not(:disabled) {
  background: #1a3a6e;
  color: #ebebeb;
  opacity: 1;
  box-shadow: inset 0 0 0 2px #000;
  position: relative;
  z-index: 1;
}

.sid-route-overlay .sid-route-fpr {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  margin: 0;
  padding: calc(8px * var(--s, 1)) calc(8px * var(--s, 1));
  border: none;
  border-top: 3px solid #333;
  border-radius: 0;
  appearance: none;
  -webkit-appearance: none;
  background: #b8b8b8;
  color: #000;
  font-size: calc(11px * var(--s, 1));
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  cursor: pointer;
  line-height: 1.1;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.35);
  min-height: max(30px, calc(30px * var(--s, 1)));
}

.sid-route-overlay .sid-route-fpr:hover:not(:disabled) {
  background: #1a3a6e;
  color: #ebebeb;
  box-shadow: inset 0 0 0 2px #000;
}

.sid-route-overlay .sid-route-clear {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  margin: 0;
  padding: calc(10px * var(--s, 1)) calc(8px * var(--s, 1));
  border: none;
  border-top: 3px solid #333;
  border-radius: 0;
  appearance: none;
  -webkit-appearance: none;
  background: #a8a8a8;
  color: #000;
  font-size: calc(12px * var(--s, 1));
  font-weight: 800;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  cursor: pointer;
  line-height: 1.1;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.35);
  min-height: max(32px, calc(32px * var(--s, 1)));
}

.sid-route-overlay .sid-route-clear:hover {
  background: #1a3a6e;
  color: #ebebeb;
  box-shadow: inset 0 0 0 2px #000;
}

.sid-route-overlay .sid-route-fpr + .sid-route-clear {
  border-top: 1px solid #666;
}
</style>

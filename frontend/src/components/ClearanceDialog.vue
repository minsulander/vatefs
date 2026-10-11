<template>
  <v-dialog v-model="dialogOpen" max-width="320" content-class="clnc-dialog-wrapper">
    <div class="efs-popup-menu efs-popup-menu--wide clnc-dialog" @click.stop>
      <div class="efs-popup-header">Clearance</div>
      <div class="efs-popup-subheader clnc-subheader">
        <span class="clnc-callsign">{{ strip.callsign }}</span>
        <span class="clnc-header-meta">
          <span v-if="strip.isSlow || hasSlowRemark(strip.remarks)" class="efs-popup-chip active clnc-slow-tag">SLOW</span>
          <span>{{ strip.flightRules }} {{ strip.aircraftType }}/{{ strip.wakeTurbulence }}</span>
          <span v-if="strip.stand">{{ strip.stand }}</span>
        </span>
      </div>

      <button
        v-if="departureName && store.myAirports.length > 1"
        type="button"
        class="efs-popup-item efs-popup-item--stack clnc-airport"
        disabled
      >
        <span class="efs-popup-item-title">{{ strip.adep }}</span>
        <span class="efs-popup-item-sub">{{ departureName }}</span>
      </button>
      <button
        v-if="destinationName"
        type="button"
        class="efs-popup-item efs-popup-item--stack clnc-airport"
        @click="showRoute = !showRoute"
      >
        <span class="efs-popup-item-title">{{ strip.ades }}</span>
        <span class="efs-popup-item-sub">{{ destinationName }}</span>
      </button>
      <div
        v-if="showRoute && strip.route"
        class="efs-popup-meta clnc-route"
        @mousedown.stop
        @click.stop
      >{{ strip.route }}</div>

      <div class="efs-popup-list clnc-fields">
        <button type="button" class="efs-popup-item clnc-field-row" @click="onRwyClick">
          <span class="clnc-field-label">RWY</span>
          <span class="clnc-field-value">{{ strip.runway || '---' }}</span>
        </button>
        <button type="button" class="efs-popup-item clnc-field-row" @click="onSidClick">
          <span class="clnc-field-label">SID</span>
          <span class="clnc-field-value">{{ clearanceSidName || '---' }}</span>
        </button>
        <button
          v-if="showAhdgRow"
          type="button"
          class="efs-popup-item clnc-field-row"
          @click="onAhdClick"
        >
          <span class="clnc-field-label">AHDG</span>
          <span class="clnc-field-value">{{ strip.direct || (strip.assignedHeading ? 'H' + strip.assignedHeading : '---') }}</span>
        </button>
        <button
          type="button"
          class="efs-popup-item clnc-field-row"
          @click="onCflClick"
        >
          <span class="clnc-field-label">CFL</span>
          <span class="clnc-field-value">{{ strip.clearedAltitude || '---' }}</span>
        </button>
        <button
          type="button"
          class="efs-popup-item clnc-field-row"
          :class="{ 'is-disabled': !strip.canResetSquawk }"
          :title="assrTitle"
          @click="onAssrClick"
        >
          <span class="clnc-field-label">ASSR</span>
          <span class="clnc-field-value">{{ strip.squawk || '----' }}</span>
        </button>
        <div v-if="showCdmTimes && strip.tsat" class="efs-popup-item clnc-field-row is-disabled">
          <span class="clnc-field-label">TSAT</span>
          <span class="clnc-field-value">{{ strip.tsat }}</span>
        </div>
        <div v-if="showCdmTimes && strip.ctot" class="efs-popup-item clnc-field-row is-disabled">
          <span class="clnc-field-label">CTOT</span>
          <span class="clnc-field-value">{{ strip.ctot }}</span>
        </div>
      </div>

      <!-- Active REQUEST / SENT flow (pilot-initiated) -->
      <template v-if="strip.dclStatus === 'REQUEST' || strip.dclStatus === 'SENT'">
        <div class="efs-popup-section">
          DCL
          <span class="clnc-dcl-status" :class="dclStatusClass">{{ strip.dclStatus }}</span>
        </div>
        <div v-if="strip.dclMessage" class="efs-popup-meta clnc-dcl-message">{{ strip.dclMessage }}</div>
        <div v-if="strip.dclClearance" class="efs-popup-meta clnc-dcl-preview">{{ strip.dclClearance }}</div>
        <div v-if="strip.dclStatus === 'REQUEST'" class="efs-popup-search">
          <span class="clnc-field-label">RMK</span>
          <input v-model="remarks" class="efs-popup-search-input" placeholder="Remarks…" />
        </div>
      </template>
      <!-- Controller-initiated DCL when pilot is on Hoppie -->
      <template v-else-if="showProactiveDcl">
        <div class="efs-popup-section">
          DCL
          <span v-if="strip.dclStatus" class="clnc-dcl-status" :class="dclStatusClass">{{ strip.dclStatus }}</span>
          <span class="clnc-dcl-status dcl-status-online">ONLINE</span>
        </div>
        <div v-if="proactivePreview || strip.dclClearance" class="efs-popup-meta clnc-dcl-preview">{{ proactivePreview || strip.dclClearance }}</div>
        <div class="efs-popup-search">
          <span class="clnc-field-label">RMK</span>
          <input v-model="remarks" class="efs-popup-search-input" placeholder="Remarks…" />
        </div>
      </template>
      <template v-else-if="strip.dclStatus">
        <div class="efs-popup-section">
          DCL
          <span class="clnc-dcl-status" :class="dclStatusClass">{{ strip.dclStatus }}</span>
        </div>
        <div v-if="strip.dclMessage" class="efs-popup-meta clnc-dcl-message">{{ strip.dclMessage }}</div>
        <div v-if="strip.dclClearance" class="efs-popup-meta clnc-dcl-preview">{{ strip.dclClearance }}</div>
      </template>

      <!-- Same menus as strip data boxes (above dialog) -->
      <RwyMenu v-model="rwyMenuOpen" :strip="strip" :target="menuTarget" :z-index="menuZ" />
      <SidRouteMenu v-model="sidMenuOpen" :strip="strip" :target="menuTarget" :z-index="menuZ" />
      <AhdMenu v-model="ahdMenuOpen" :strip="strip" :target="menuTarget" :z-index="menuZ" />
      <CflMenu v-model="cflMenuOpen" :strip="strip" :target="menuTarget" :z-index="menuZ" />

      <div v-if="strip.dclStatus === 'REQUEST'" class="clnc-actions">
        <button type="button" class="efs-popup-footer clnc-action" @click="onCancel">Cancel</button>
        <button type="button" class="efs-popup-footer clnc-action clnc-action-reject" @click="onReject">Reject</button>
        <button type="button" class="efs-popup-footer clnc-action" :disabled="!canSendDcl" @click="onSend">Send</button>
      </div>
      <div v-else-if="strip.dclStatus === 'SENT'" class="clnc-actions clnc-actions-2">
        <button type="button" class="efs-popup-footer clnc-action" @click="onCancel">Cancel</button>
        <button type="button" class="efs-popup-footer clnc-action clnc-action-reject" @click="onReject">Reject</button>
      </div>
      <div v-else-if="showProactiveDcl" class="clnc-actions">
        <button type="button" class="efs-popup-footer clnc-action" @click="onCancel">Cancel</button>
        <button type="button" class="efs-popup-footer clnc-action" :disabled="okDisabled" @click="onOk">OK</button>
        <button
          type="button"
          class="efs-popup-footer clnc-action clnc-action-dcl"
          :disabled="!canSendDcl"
          title="Send data-link clearance (no prior pilot request)"
          @click="onProactiveDcl"
        >DCL</button>
      </div>
      <div v-else class="clnc-actions clnc-actions-2">
        <button type="button" class="efs-popup-footer clnc-action" @click="onCancel">Cancel</button>
        <button type="button" class="efs-popup-footer clnc-action" :disabled="okDisabled" @click="onOk">OK</button>
      </div>
    </div>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { FlightStrip } from '@/types/efs'
import { useEfsStore } from '@/store/efs'
import {
  formatTrackSidDisplay,
  hasForcedSidInRoute,
  hasSlowRemark,
  isIfrSidEligible,
  isTrackSidName,
  sidsMatch,
  withSlowRemark,
} from '@vatefs/common'
import SidRouteMenu from './SidRouteMenu.vue'
import RwyMenu from './RwyMenu.vue'
import CflMenu from './CflMenu.vue'
import AhdMenu from './AhdMenu.vue'

const props = defineProps<{
  strip: FlightStrip
  modelValue: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const store = useEfsStore()

const dialogOpen = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v)
})

const okDisabled = computed(() => !props.strip.canEditClearance)

// DCL state
const remarks = ref('')
/** Pilot is online on Hoppie — enables proactive DCL when no REQUEST/SENT flow. */
const hoppieOnline = ref(false)
const proactivePreview = ref<string | null>(null)
let hoppieCheckSeq = 0

const canSendDcl = computed(() => {
  const s = props.strip
  // SID must be assigned and look like a standard SID (no special chars like · or spaces)
  const sidValid = !!s.sid && /^[A-Z0-9]+$/.test(s.sid)
  const cflValid = !!s.clearedAltitude
  const squawkValid = !!s.squawk && s.squawk !== '----'
  return sidValid && cflValid && squawkValid
})

/** Show proactive DCL only when Hoppie connected, pilot online, and no active request/send. */
const showProactiveDcl = computed(() => {
  if (store.dclStatus !== 'connected') return false
  if (!hoppieOnline.value) return false
  const s = props.strip.dclStatus
  return !s || s === 'INVALID' || s === 'UNABLE' || s === 'REJECTED' || s === 'DONE'
})

const dclStatusClass = computed(() => {
  switch (props.strip.dclStatus) {
    case 'REQUEST': return 'dcl-status-request'
    case 'SENT': return 'dcl-status-sent'
    case 'DONE': return 'dcl-status-done'
    case 'INVALID':
    case 'UNABLE':
    case 'REJECTED': return 'dcl-status-error'
    default: return ''
  }
})

async function checkHoppieOnline() {
  const seq = ++hoppieCheckSeq
  hoppieOnline.value = false
  proactivePreview.value = null
  if (store.dclStatus !== 'connected') return
  const status = props.strip.dclStatus
  if (status === 'REQUEST' || status === 'SENT') return
  try {
    const res = await fetch(`/api/hoppie/online/${encodeURIComponent(props.strip.callsign)}`)
    if (!res.ok || seq !== hoppieCheckSeq) return
    const data = (await res.json()) as { online?: boolean; clearancePreview?: string }
    if (seq !== hoppieCheckSeq) return
    hoppieOnline.value = !!data.online
    proactivePreview.value = data.clearancePreview ?? null
  } catch {
    if (seq === hoppieCheckSeq) {
      hoppieOnline.value = false
      proactivePreview.value = null
    }
  }
}

/** TOBT/TSAT/CTOT only for IFR (I/Y) departures */
const showCdmTimes = computed(() =>
  props.strip.stripType === 'departure' &&
  (props.strip.flightRules === 'I' || props.strip.flightRules === 'Y')
)

// Airport name lookups
const destinationName = ref<string | null>(null)
const departureName = ref<string | null>(null)
const showRoute = ref(false)

async function fetchAirportName(icao: string): Promise<string | null> {
  if (!icao || icao === '????') return null
  try {
    const res = await fetch(`/api/airport-name?icao=${icao}`)
    if (res.ok) {
      const data = await res.json()
      return data.name ?? null
    }
  } catch {
    // ignore
  }
  return null
}

async function fetchDestinationName() {
  destinationName.value = await fetchAirportName(props.strip.ades)
}

async function fetchDepartureName() {
  if (store.myAirports.length > 1) {
    departureName.value = await fetchAirportName(props.strip.adep)
  } else {
    departureName.value = null
  }
}

/** Above v-dialog (default ~2400) — same menus as strip boxes */
const menuZ = 2700
const menuTarget = ref<[number, number]>([0, 0])
const rwyMenuOpen = ref(false)
const sidMenuOpen = ref(false)
const ahdMenuOpen = ref(false)
const cflMenuOpen = ref(false)

const availableSids = ref<{ name: string }[]>([])
/** Preferred SID sort group from /api/preferred-sid (letter-group or SLOW tracks) */
const preferredSidSortGroup = ref<string[]>([])
const preferredSidMatched = ref<string | null>(null)

/** Normalize for matching list ↔ assigned (· / • / * / spaces). */
function normSidKey(s: string): string {
  return s.toUpperCase().replace(/\s+/g, '').replace(/[•*]/g, '·')
}

/**
 * SID row: same preferred preview as the strip when FPL has no forced SID,
 * shown as exact ESE technical name (not PETEV 3G / 120veBABAP display form).
 * With AHD set: show ve{TMA exit} (preferred/SID cleared).
 */
const clearanceSidName = computed(() => {
  // Vector mode — same as strip (ignore GetSid until SID/rwy forced)
  if (props.strip.assignedHeading && !hasForcedSidInRoute(props.strip.route)) {
    return store.displaySidForStrip(props.strip) || ''
  }
  let raw = props.strip.sid || ''
  if (
    !props.strip.assignedHeading &&
    !props.strip.clearance &&
    (props.strip.adep === 'ESSA' || props.strip.adep === 'ESMS' || props.strip.adep === 'ESGG') &&
    isIfrSidEligible(props.strip.flightRules) &&
    (props.strip.stripType === 'departure' || props.strip.stripType === 'local')
  ) {
    const preferred =
      preferredSidMatched.value || store.getEssaPreferredSid(props.strip.id)
    if (preferred) {
      const forced = hasForcedSidInRoute(props.strip.route)
      if (!forced || !raw) raw = preferred
    }
  }
  if (!raw) return ''
  const exact = availableSids.value.find((s) => s.name === raw)
  if (exact) return exact.name
  const key = normSidKey(raw)
  const fuzzy = availableSids.value.find((s) => normSidKey(s.name) === key)
  if (fuzzy) return fuzzy.name
  return raw
})

/** SLOW remarks flag drives preferred SID / CFL (not isSlow ATYP alone). */
function isSlowForClr(): boolean {
  return hasSlowRemark(props.strip.remarks)
}

function sidIsTrack(sid: string | undefined | null): boolean {
  return isTrackSidName(sid) || !!formatTrackSidDisplay(sid)
}

/** Hide AHDG when a slow/track SID is set or expected, unless a heading is already assigned. */
const showAhdgRow = computed(() => {
  if (props.strip.direct || props.strip.assignedHeading) return true
  if (isSlowForClr()) return false
  if (sidIsTrack(clearanceSidName.value) || sidIsTrack(props.strip.sid)) return false
  if (sidIsTrack(preferredSidMatched.value)) return false
  if (preferredSidSortGroup.value.some((n) => sidIsTrack(n))) return false
  return true
})

function isPreferredSidIfrDep(): boolean {
  const adep = props.strip.adep
  return (
    (adep === 'ESSA' || adep === 'ESMS' || adep === 'ESGG') &&
    isIfrSidEligible(props.strip.flightRules) &&
    (props.strip.stripType === 'departure' || props.strip.stripType === 'local')
  )
}

// Fetch SIDs for SID row label matching (menus fetch their own lists)
async function fetchSids() {
  const airport = props.strip.adep
  const runway = props.strip.runway
  if (!airport || airport === '????' || !runway) {
    availableSids.value = []
    return
  }
  try {
    const res = await fetch(`/api/sids?airport=${airport}&runway=${runway}`)
    if (res.ok) {
      const data = await res.json()
      availableSids.value = data
    }
  } catch {
    availableSids.value = []
  }
}

/**
 * Preferred SID: ESSA (config + SLOW), ESMS (K/L or G/H), or ESGG (LOP §2.3).
 * Reassigns when uncleared so runway/config changes update the letter group.
 * Returns the SID that should be used for auto-CFL (newly assigned or matched preferred).
 */
async function applyPreferredSid(): Promise<string | undefined> {
  preferredSidSortGroup.value = []
  preferredSidMatched.value = null

  if (!isPreferredSidIfrDep()) return undefined

  const airport = props.strip.adep
  const runway = props.strip.runway
  if (!airport || !runway) return undefined

  if (airport === 'ESSA' && !store.essaRwyConfigIdResolved) return undefined

  // Already cleared — keep assigned SID
  const mayReassign =
    !props.strip.clearance && !!props.strip.canEditClearance

  try {
    const params = new URLSearchParams({ airport, runway })
    if (airport === 'ESSA') {
      params.set('config', store.essaRwyConfigIdResolved!)
      params.set('slow', isSlowForClr() ? '1' : '0')
    }
    if (airport === 'ESGG' && props.strip.callsign) {
      params.set('callsign', props.strip.callsign)
    }
    if (props.strip.route) params.set('route', props.strip.route)

    const res = await fetch(`/api/preferred-sid?${params}`)
    if (!res.ok) return undefined
    const data = await res.json() as { sid: string | null; sortGroup?: string[] }
    preferredSidSortGroup.value = data.sortGroup ?? []
    preferredSidMatched.value = data.sid

    if (mayReassign && data.sid) {
      // Vector departure — keep ve{exit}; never force preferred SID into FPL
      if (props.strip.assignedHeading) {
        preferredSidMatched.value = null
        return undefined
      }
      const forced = hasForcedSidInRoute(props.strip.route)
      const stickyEs =
        !!props.strip.sid &&
        (forced || sidIsTrack(props.strip.sid) || /^VFR/i.test(props.strip.sid))
      if (stickyEs) {
        // Forced FPL / track / VFR — keep ES selection for display and CFL
        preferredSidMatched.value = props.strip.sid!
        return props.strip.sid
      }
      preferredSidMatched.value = data.sid
      // ES GetSid already matches preferred (ESE prio) — do not force into FPL
      if (sidsMatch(props.strip.sid, data.sid)) {
        return data.sid
      }
      // Wrong / missing ES SID — force preferred SID into the flight plan
      store.sendAssignment(props.strip.id, 'assignSid', data.sid)
      if (
        isIfrSidEligible(props.strip.flightRules) &&
        sidIsTrack(data.sid) &&
        !hasSlowRemark(props.strip.remarks)
      ) {
        store.updateRemarks(props.strip.id, withSlowRemark(props.strip.remarks, true))
      }
      return data.sid
    }
    return data.sid ?? undefined
  } catch {
    return undefined
  }
}

/** True when strip already has a controller-set CFL (not blank / not just RFL echo). */
function hasAssignedCfl(): boolean {
  const cfl = props.strip.clearedAltitude
  if (!cfl) return false
  // Uncleared: CFL equal to RFL is often ES "no temporary" display echo — treat as unset
  if (!props.strip.clearance && props.strip.rfl && cfl === props.strip.rfl) return false
  return true
}

/** Swedish TMA initial climb when COPX lookup misses (SLOW → 3000, ESMS → 4000, else 5000). */
function defaultInitialClimbFt(airport: string): number | undefined {
  const apt = airport.toUpperCase()
  if (apt !== 'ESSA' && apt !== 'ESGG' && apt !== 'ESMS') return undefined
  if (isSlowForClr()) return 3000
  if (apt === 'ESMS') return 4000
  return 5000
}

/**
 * Fetch the SID altitude and assign CFL if not already set.
 * Prefer preferred/display SID — strip.sid may still be a route fix while the
 * preview SID is what the controller sees (and what we just assigned).
 */
async function applyDefaultCfl(sidOverride?: string) {
  const airport = props.strip.adep
  // Use raw ESE SID (not display form — e.g. 120veTOVRI / PETEV 3G break /api/sidalt)
  const sid = sidOverride || preferredSidMatched.value || props.strip.sid
  if (!airport || airport === '????' || !sid || hasAssignedCfl()) return
  try {
    const params = new URLSearchParams({ airport, sid })
    if (isSlowForClr()) params.set('slow', '1')
    const res = await fetch(`/api/sidalt?${params}`)
    if (res.ok) {
      const data = await res.json() as { altitude: number | null }
      // Backend already applies Swedish TMA fallback; keep a client-side fallback too
      const altitude = data.altitude ?? defaultInitialClimbFt(airport)
      if (altitude) {
        store.sendAssignment(props.strip.id, 'assignCfl', String(altitude))
      }
    } else {
      const fallback = defaultInitialClimbFt(airport)
      if (fallback) {
        store.sendAssignment(props.strip.id, 'assignCfl', String(fallback))
      }
    }
  } catch {
    // ignore
  }
}

// Ask TopSky for a code if empty (EFS does not generate squawks)
function applyDefaultSquawk() {
  if (!props.strip.squawk && props.strip.canResetSquawk) {
    requestTopskySquawk()
  }
}

function closeFieldMenus() {
  rwyMenuOpen.value = false
  sidMenuOpen.value = false
  ahdMenuOpen.value = false
  cflMenuOpen.value = false
}

function menuCoordsFromEvent(event: MouseEvent): [number, number] {
  let x = event.clientX
  let y = event.clientY
  if ((x === 0 && y === 0) || !Number.isFinite(x) || !Number.isFinite(y)) {
    const el = (event.currentTarget || event.target) as HTMLElement | null
    if (el?.getBoundingClientRect) {
      const r = el.getBoundingClientRect()
      x = r.left + r.width / 2
      y = r.bottom
    }
  }
  return [x, y]
}

function openFieldMenu(
  event: MouseEvent,
  which: 'rwy' | 'sid' | 'ahd' | 'cfl',
) {
  menuTarget.value = menuCoordsFromEvent(event)
  const already =
    (which === 'rwy' && rwyMenuOpen.value) ||
    (which === 'sid' && sidMenuOpen.value) ||
    (which === 'ahd' && ahdMenuOpen.value) ||
    (which === 'cfl' && cflMenuOpen.value)
  closeFieldMenus()
  if (already) return
  if (which === 'rwy') rwyMenuOpen.value = true
  else if (which === 'sid') sidMenuOpen.value = true
  else if (which === 'ahd') ahdMenuOpen.value = true
  else cflMenuOpen.value = true
}

function onRwyClick(event: MouseEvent) {
  openFieldMenu(event, 'rwy')
}
function onSidClick(event: MouseEvent) {
  openFieldMenu(event, 'sid')
}
function onAhdClick(event: MouseEvent) {
  openFieldMenu(event, 'ahd')
}
function onCflClick(event: MouseEvent) {
  openFieldMenu(event, 'cfl')
}

async function runClearancePrep() {
  preferredSidSortGroup.value = []
  preferredSidMatched.value = null
  fetchDestinationName()
  fetchDepartureName()
  await fetchSids()
  const preferredSid = await applyPreferredSid()
  await applyDefaultCfl(preferredSid)
  applyDefaultSquawk()
}

// When dialog opens, fetch data — keep existing strip remarks (do not wipe)
watch(dialogOpen, async (open) => {
  if (open) {
    remarks.value = props.strip.remarks || ''
    preferredSidSortGroup.value = []
    preferredSidMatched.value = null
    void checkHoppieOnline()
    await runClearancePrep()
  } else {
    closeFieldMenus()
    destinationName.value = null
    departureName.value = null
    showRoute.value = false
    preferredSidSortGroup.value = []
    preferredSidMatched.value = null
    hoppieOnline.value = false
    proactivePreview.value = null
  }
})

// Keep SID label list in sync when runway changes via RwyMenu
watch(
  () => props.strip.runway,
  () => {
    if (dialogOpen.value) void fetchSids()
  },
)

function onOk() {
  if (!props.strip.clearance) {
    store.sendStripAction(props.strip.id, 'toggleClearanceFlag')
  }
  dialogOpen.value = false
}

function onCancel() {
  if (props.strip.clearance) {
    store.sendStripAction(props.strip.id, 'toggleClearanceFlag')
  }
  dialogOpen.value = false
}

function onReject() {
  store.dclReject(props.strip.id)
  dialogOpen.value = false
}

function onSend() {
  store.dclSend(props.strip.id, remarks.value)
  dialogOpen.value = false
}

function onProactiveDcl() {
  store.dclSend(props.strip.id, remarks.value, true)
  dialogOpen.value = false
}

const assrTitle = computed(() => {
  if (!props.strip.canResetSquawk) {
    return props.strip.squawk ? `ASSR ${props.strip.squawk}` : 'ASSR'
  }
  return props.strip.squawk
    ? `ASSR ${props.strip.squawk} - click for new code`
    : 'Click for new code'
})

/** Prevent double TopSky AllocateSSR (e.g. CLR auto + rapid clicks) */
let lastAssrResetAt = 0
function requestTopskySquawk() {
  if (!props.strip.canResetSquawk) return
  const now = Date.now()
  if (now - lastAssrResetAt < 1500) return
  lastAssrResetAt = now
  // Triggers TopSky SSR allocation via plugin — EFS does not invent codes
  store.sendStripAction(props.strip.id, 'resetSquawk')
}

function onAssrClick() {
  requestTopskySquawk()
}
</script>

<style>
/* CLNC Dialog — unscoped (v-dialog teleports); chrome from efs-popup-menu.css */
.clnc-dialog-wrapper {
  box-shadow: none !important;
  background: transparent !important;
}

.clnc-dialog {
  --s: var(--efs-scale, 1);
  position: relative;
  width: 100%;
  max-width: min(92vw, calc(320px * var(--s)));
}

.clnc-subheader {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: calc(4px * var(--s));
}

.clnc-callsign {
  font-size: calc(13px * var(--s));
  font-weight: 800;
  letter-spacing: 0.3px;
  text-transform: uppercase;
}

.clnc-header-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: calc(6px * var(--s));
  font-size: calc(10px * var(--s));
  font-weight: 700;
  letter-spacing: 0.2px;
  text-transform: uppercase;
  color: #333;
}

.clnc-slow-tag {
  min-width: 0;
  padding: calc(1px * var(--s)) calc(5px * var(--s));
  background: #f0c040;
  color: #000;
  box-shadow: inset 0 0 0 1px #a08020;
}

.clnc-airport {
  border-bottom: 1px solid #888;
}

.clnc-airport .efs-popup-item-title,
.clnc-airport .efs-popup-item-sub {
  text-align: center;
}

.clnc-action-ok {
  background: #1a3a6e !important;
  color: #fff !important;
}

.clnc-route {
  word-break: break-all;
  line-height: 1.35;
  text-transform: uppercase;
  border-bottom: 1px solid #888;
  user-select: text;
  -webkit-user-select: text;
  cursor: text;
}

.clnc-fields {
  max-height: none;
}

.clnc-field-row {
  justify-content: space-between;
  gap: calc(10px * var(--s));
  text-align: left;
}

.clnc-field-label {
  flex: 0 0 auto;
  min-width: calc(48px * var(--s));
  font-size: calc(10px * var(--s));
  font-weight: 800;
  letter-spacing: 0.12em;
  color: #333;
}

.clnc-field-value {
  flex: 1 1 auto;
  min-width: 0;
  font-size: calc(12px * var(--s));
  font-weight: 800;
  letter-spacing: 0.3px;
  text-align: right;
  text-transform: uppercase;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.clnc-field-row:hover:not(:disabled):not(.is-disabled) .clnc-field-label {
  color: var(--efs-popup-strip-white, #ebebeb);
}

.efs-popup-section .clnc-dcl-status {
  display: inline-block;
  margin-left: calc(8px * var(--s));
  padding: calc(1px * var(--s)) calc(6px * var(--s));
  font-size: calc(9px * var(--s));
  font-weight: 800;
  letter-spacing: 0.06em;
  vertical-align: middle;
  border: 1px solid #666;
}

.dcl-status-request {
  background: #f0c040;
  color: #000;
  border-color: #a08020;
}

.dcl-status-sent {
  background: #b8d4a8;
  color: #1a3a1a;
  border-color: #7a9a6a;
}

.dcl-status-done {
  background: var(--efs-popup-strip-white, #ebebeb);
  color: #1a3a6e;
  border-color: #1a3a6e;
}

.dcl-status-error {
  background: #e8b4b4;
  color: #6a1010;
  border-color: #a05050;
}

.dcl-status-online {
  background: #b8d4a8;
  color: #1a3a1a;
  border-color: #7a9a6a;
}

.clnc-action-dcl:hover:not(:disabled) {
  background: #c8e0b8;
}

.clnc-dcl-message {
  word-break: break-all;
  opacity: 0.85;
}

.clnc-dcl-preview {
  font-weight: 700;
  line-height: 1.35;
  text-align: left;
  text-transform: none;
  letter-spacing: 0;
  white-space: pre-wrap;
  background: var(--efs-popup-strip-white, #ebebeb);
  border-bottom: 1px solid #888;
}

.clnc-actions {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  border-top: 3px solid #333;
  background: #a8a8a8;
}

.clnc-actions-2 {
  grid-template-columns: 1fr 1fr;
}

.clnc-action {
  border-top: none;
  border-right: 1px solid #777;
  box-shadow: none;
  min-height: max(32px, calc(32px * var(--s)));
}

.clnc-action:last-child {
  border-right: none;
}

.clnc-action:disabled {
  opacity: 0.45;
  cursor: not-allowed;
  background: #a8a8a8;
  color: #444;
  box-shadow: none;
}

.clnc-action:disabled:hover {
  background: #a8a8a8;
  color: #444;
  box-shadow: none;
}

.clnc-action-reject:hover:not(:disabled) {
  background: #6a1010;
  color: #fff;
}
</style>

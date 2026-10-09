<template>
  <v-dialog v-model="dialogOpen" max-width="280" content-class="clnc-dialog-wrapper">
    <div class="clnc-dialog">
      <div class="clnc-header">
        <span>{{ strip.callsign }}</span>
        <span class="clnc-header-right">
          <span v-if="strip.isSlow || hasSlowRemark(strip.remarks)" class="clnc-slow-tag">SLOW</span>
          <span class="clnc-header-info">{{ strip.flightRules }} {{ strip.aircraftType }}/{{ strip.wakeTurbulence }}</span>
          <span v-if="strip.stand" class="clnc-header-info">{{ strip.stand }}</span>
        </span>
      </div>
      <div v-if="departureName && store.myAirports.length > 1" class="clnc-destination">
        <span class="clnc-dest-icao">{{ strip.adep }}</span>
        <span class="clnc-dest-name">{{ departureName }}</span>
      </div>
      <div v-if="destinationName" class="clnc-destination clnc-clickable" @click="showRoute = !showRoute">
        <span class="clnc-dest-icao">{{ strip.ades }}</span>
        <span class="clnc-dest-name">{{ destinationName }}</span>
      </div>
      <div v-if="showRoute && strip.route" class="clnc-route">{{ strip.route }}</div>
      <div class="clnc-fields">
        <div class="clnc-row"><span class="clnc-label">RWY</span><span class="clnc-value clnc-clickable" @click="openDropdown('rwy')">{{ strip.runway || '---' }}</span></div>
        <div class="clnc-row"><span class="clnc-label">SID</span><span class="clnc-value clnc-clickable" @click="openDropdown('sid')">{{ clearanceSidName || '---' }}</span></div>
        <div
          v-if="showAhdgRow"
          class="clnc-row"
        >
          <span class="clnc-label">AHDG</span>
          <span class="clnc-value clnc-clickable" @click="openDropdown('hdg')">{{ strip.direct || (strip.assignedHeading ? 'H' + strip.assignedHeading : '---') }}</span>
        </div>
        <div class="clnc-row">
          <span class="clnc-label">CFL</span>
          <span
            ref="cflValueEl"
            class="clnc-value clnc-clickable"
            @click="onCflClick"
          >{{ strip.clearedAltitude || '---' }}</span>
        </div>
        <div class="clnc-row">
          <span class="clnc-label">ASSR</span>
          <span
            class="clnc-value"
            :class="{ 'clnc-clickable': strip.canResetSquawk }"
            :title="assrTitle"
            @click="onAssrClick"
            @dblclick="onAssrDblClick"
          >{{ strip.squawk || '----' }}</span>
        </div>
        <div v-if="showCdmTimes && strip.tsat" class="clnc-row">
          <span class="clnc-label">TSAT</span>
          <span class="clnc-value">{{ strip.tsat }}</span>
        </div>
        <div v-if="showCdmTimes && strip.ctot" class="clnc-row">
          <span class="clnc-label">CTOT</span>
          <span class="clnc-value">{{ strip.ctot }}</span>
        </div>
      </div>

      <!-- DCL section (shown when there's a DCL request) -->
      <div v-if="strip.dclStatus" class="clnc-dcl-section">
        <div class="clnc-dcl-header">
          <span class="clnc-dcl-label">DCL</span>
          <span class="clnc-dcl-status" :class="dclStatusClass">{{ strip.dclStatus }}</span>
        </div>
        <div v-if="strip.dclMessage" class="clnc-dcl-message">{{ strip.dclMessage }}</div>
        <div v-if="strip.dclClearance" class="clnc-dcl-preview">{{ strip.dclClearance }}</div>
        <div v-if="strip.dclStatus === 'REQUEST'" class="clnc-remarks-row">
          <span class="clnc-label">RMK</span>
          <input v-model="remarks" class="clnc-remarks-input" placeholder="Remarks..." />
        </div>
      </div>

      <!-- Dropdown overlay (RWY / SID / AHDG) -->
      <div v-if="activeDropdown" class="clnc-dropdown-overlay" @click="activeDropdown = null">
        <div class="clnc-dropdown" :style="dropdownStyle" @click.stop>
          <div ref="dropdownScrollRef" class="clnc-dropdown-scroll">
            <div v-for="option in dropdownOptions" :key="option.value"
              class="clnc-dropdown-item"
              :class="{ 'clnc-dropdown-selected': option.selected }"
              @click="selectOption(option.value)">
              {{ option.label }}
            </div>
            <div v-if="dropdownOptions.length === 0" class="clnc-dropdown-empty">
              {{ activeDropdown === 'sid' ? 'No SIDs for this runway' : 'No options' }}
            </div>
          </div>
        </div>
      </div>

      <CflMenu
        v-model="cflMenuOpen"
        :strip="strip"
        :target="cflMenuTarget"
        :z-index="2700"
      />

      <div class="clnc-actions" v-if="strip.dclStatus === 'REQUEST'">
        <button class="clnc-btn clnc-btn-cancel" @click="onCancel">Cancel</button>
        <button class="clnc-btn clnc-btn-reject" @click="onReject">Reject</button>
        <button class="clnc-btn clnc-btn-send" :disabled="!canSendDcl" @click="onSend">Send</button>
      </div>
      <div class="clnc-actions" v-else-if="strip.dclStatus === 'SENT'">
        <button class="clnc-btn clnc-btn-cancel" @click="onCancel">Cancel</button>
        <button class="clnc-btn clnc-btn-reject" @click="onReject">Reject</button>
      </div>
      <div class="clnc-actions" v-else>
        <button class="clnc-btn clnc-btn-cancel" @click="onCancel">Cancel</button>
        <button class="clnc-btn clnc-btn-ok" :disabled="okDisabled" @click="onOk">OK</button>
      </div>
    </div>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import type { FlightStrip } from '@/types/efs'
import { useEfsStore } from '@/store/efs'
import {
  formatSidForDisplay,
  formatTrackSidDisplay,
  hasForcedSidInRoute,
  hasSlowRemark,
  isIfrSidEligible,
  isTrackSidName,
  withSlowRemark,
} from '@vatefs/common'
import CflMenu from './CflMenu.vue'

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

const canSendDcl = computed(() => {
  const s = props.strip
  // SID must be assigned and look like a standard SID (no special chars like · or spaces)
  const sidValid = !!s.sid && /^[A-Z0-9]+$/.test(s.sid)
  const cflValid = !!s.clearedAltitude
  const squawkValid = !!s.squawk && s.squawk !== '----'
  return sidValid && cflValid && squawkValid
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

// Dropdown scroll ref
const dropdownScrollRef = ref<HTMLElement | null>(null)
const cflValueEl = ref<HTMLElement | null>(null)
const cflMenuOpen = ref(false)
const cflMenuTarget = ref<[number, number]>([0, 0])

// Dropdown state
const activeDropdown = ref<'rwy' | 'sid' | 'hdg' | null>(null)
const availableRunways = ref<string[]>([])
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
 */
const clearanceSidName = computed(() => {
  let raw = props.strip.sid || ''
  if (
    !props.strip.clearance &&
    (props.strip.adep === 'ESSA' || props.strip.adep === 'ESMS') &&
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

function isSlowForClr(): boolean {
  return !!props.strip.isSlow || hasSlowRemark(props.strip.remarks)
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
    (adep === 'ESSA' || adep === 'ESMS') &&
    isIfrSidEligible(props.strip.flightRules) &&
    (props.strip.stripType === 'departure' || props.strip.stripType === 'local')
  )
}

// Fetch runways for the departure airport
async function fetchRunways() {
  const airport = props.strip.adep
  if (!airport || airport === '????') return
  try {
    const res = await fetch(`/api/runways?airport=${airport}`)
    if (res.ok) {
      const data = await res.json()
      availableRunways.value = data
    }
  } catch {
    availableRunways.value = []
  }
}

// Fetch SIDs for the current runway
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
 * Preferred SID: ESSA (config + SLOW) or ESMS (K/L, or G/H when EKCH RWY 30 active in ES).
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
    if (props.strip.route) params.set('route', props.strip.route)

    const res = await fetch(`/api/preferred-sid?${params}`)
    if (!res.ok) return undefined
    const data = await res.json() as { sid: string | null; sortGroup?: string[] }
    preferredSidSortGroup.value = data.sortGroup ?? []
    preferredSidMatched.value = data.sid

    if (mayReassign && data.sid) {
      const forced = hasForcedSidInRoute(props.strip.route)
      const stickyEs =
        !!props.strip.sid &&
        (forced || sidIsTrack(props.strip.sid) || /^VFR/i.test(props.strip.sid))
      if (stickyEs) {
        // Forced FPL / track / VFR — keep ES selection for display and CFL
        preferredSidMatched.value = props.strip.sid!
        return props.strip.sid
      }
      // Always enter preferred SID on CLR open (even when GetSid already matches)
      preferredSidMatched.value = data.sid
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

// When dialog opens, fetch data and reset remarks
watch(dialogOpen, async (open) => {
  if (open) {
    remarks.value = ''
    preferredSidSortGroup.value = []
    preferredSidMatched.value = null
    fetchRunways()
    fetchDestinationName()
    fetchDepartureName()
    await fetchSids()
    const preferredSid = await applyPreferredSid()
    await applyDefaultCfl(preferredSid)
    applyDefaultSquawk()
  } else {
    activeDropdown.value = null
    cflMenuOpen.value = false
    destinationName.value = null
    departureName.value = null
    showRoute.value = false
    preferredSidSortGroup.value = []
    preferredSidMatched.value = null
  }
})

// Auto-scroll dropdown to selected item when dropdown opens
watch(activeDropdown, (val) => {
  if (val) {
    nextTick(() => {
      const container = dropdownScrollRef.value
      if (!container) return
      const selected = container.querySelector('.clnc-dropdown-selected') as HTMLElement | null
      if (selected) {
        selected.scrollIntoView({ block: 'center' })
      }
    })
  }
})

// Generate heading options: 005, 010, ..., 360
const headingOptions = (() => {
  const opts: { label: string; value: string }[] = []
  for (let h = 5; h <= 360; h += 5) {
    const padded = String(h).padStart(3, '0')
    opts.push({ label: padded, value: padded })
  }
  return opts
})()

const dropdownOptions = computed(() => {
  switch (activeDropdown.value) {
    case 'rwy':
      return availableRunways.value.map(rwy => ({
        label: rwy,
        value: rwy,
        selected: rwy === props.strip.runway
      }))
    case 'sid': {
      const isVfr = props.strip.flightRules === 'V'
      let sids = isVfr
        ? availableSids.value.filter(sid => sid.name.startsWith('VFR'))
        : [...availableSids.value]
      if (!isVfr && preferredSidSortGroup.value.length > 0) {
        const groupSet = new Set(preferredSidSortGroup.value)
        const matched = preferredSidMatched.value
        sids.sort((a, b) => {
          const aIn = groupSet.has(a.name)
          const bIn = groupSet.has(b.name)
          if (aIn && !bIn) return -1
          if (!aIn && bIn) return 1
          if (aIn && bIn && matched) {
            if (a.name === matched && b.name !== matched) return -1
            if (b.name === matched && a.name !== matched) return 1
          }
          return 0
        })
      }
      const currentKey = normSidKey(clearanceSidName.value || props.strip.sid || '')
      const tmaExit = props.strip.tmaExit
      return sids.map(sid => ({
        label: formatSidForDisplay(sid.name, tmaExit) || sid.name,
        value: sid.name,
        selected: !!currentKey && normSidKey(sid.name) === currentKey
      }))
    }
    case 'hdg': {
      const current = props.strip.assignedHeading
      return headingOptions.map(opt => ({
        ...opt,
        selected: opt.value === current
      }))
    }
    default:
      return []
  }
})

const dropdownStyle = computed(() => {
  // Position dropdown in the dialog area
  return {}
})

async function openDropdown(field: 'rwy' | 'sid' | 'hdg') {
  if (activeDropdown.value === field) {
    activeDropdown.value = null
    return
  }
  cflMenuOpen.value = false
  // Always refresh RWY/SID lists when opening (runway may have just appeared from route)
  if (field === 'rwy') {
    await fetchRunways()
  } else if (field === 'sid') {
    await fetchSids()
  }
  activeDropdown.value = field
}

function onCflClick(event: MouseEvent) {
  activeDropdown.value = null
  if (cflMenuOpen.value) {
    cflMenuOpen.value = false
    return
  }
  const el = cflValueEl.value
  if (el) {
    const r = el.getBoundingClientRect()
    cflMenuTarget.value = [r.left + r.width / 2, r.top + r.height / 2]
  } else {
    cflMenuTarget.value = [event.clientX, event.clientY]
  }
  cflMenuOpen.value = true
}

function selectOption(value: string) {
  const field = activeDropdown.value
  activeDropdown.value = null

  if (!field) return

  switch (field) {
    case 'rwy':
      store.sendAssignment(props.strip.id, 'assignDepartureRunway', value)
      // Changing runway clears the SID
      store.sendAssignment(props.strip.id, 'assignSid', '')
      // Refresh SID list for the new runway
      setTimeout(() => fetchSids(), 100)
      break
    case 'sid':
      preferredSidMatched.value = value
      store.sendAssignment(props.strip.id, 'assignSid', value)
      // Track / SLOW SID → set SLOW remarks flag (I/Y only — never V/Z)
      if (
        isIfrSidEligible(props.strip.flightRules) &&
        sidIsTrack(value) &&
        !hasSlowRemark(props.strip.remarks)
      ) {
        store.updateRemarks(props.strip.id, withSlowRemark(props.strip.remarks, true))
      }
      break
    case 'hdg':
      store.sendAssignment(props.strip.id, 'assignHeading', value)
      break
  }
}

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

const assrTitle = computed(() => {
  if (!props.strip.canResetSquawk) {
    return props.strip.squawk ? `ASSR ${props.strip.squawk}` : 'ASSR'
  }
  if (!props.strip.squawk) return 'Click for new code'
  return 'Double-click for new code'
})

/** Prevent double TopSky AllocateSSR (e.g. CLR auto + click, or empty dblclick) */
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
  if (!props.strip.squawk) requestTopskySquawk()
}

function onAssrDblClick() {
  if (props.strip.squawk) requestTopskySquawk()
}
</script>

<style>
/* CLNC Dialog - unscoped because v-dialog teleports content outside component */
.clnc-dialog-wrapper {
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5) !important;
}

.clnc-dialog {
  --s: var(--efs-scale, 1);
  background: #2a2a2e;
  border: 2px solid #555;
  padding: 0;
  position: relative;
}

.clnc-header {
  background: #3b7dd8;
  color: #fff;
  font-size: calc(15px * var(--s));
  font-weight: bold;
  padding: calc(6px * var(--s)) calc(12px * var(--s));
  letter-spacing: calc(0.5px * var(--s));
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.clnc-header-right {
  display: flex;
  align-items: center;
  gap: calc(6px * var(--s));
}

.clnc-header-info {
  font-size: calc(10px * var(--s));
  font-weight: normal;
  opacity: 0.8;
}

.clnc-slow-tag {
  font-size: calc(9px * var(--s));
  font-weight: bold;
  padding: calc(1px * var(--s)) calc(6px * var(--s));
  border-radius: calc(2px * var(--s));
  background: #f57c00;
  color: #fff;
  letter-spacing: calc(0.5px * var(--s));
}

.clnc-destination {
  text-align: center;
  padding: calc(6px * var(--s)) calc(12px * var(--s)) calc(2px * var(--s));
  border-bottom: 1px solid #444;
}

.clnc-dest-icao {
  font-size: calc(13px * var(--s));
  font-weight: bold;
  color: #e0e0e0;
  display: block;
}

.clnc-dest-name {
  font-size: calc(10px * var(--s));
  color: #999;
  display: block;
  margin-top: calc(1px * var(--s));
}

.clnc-route {
  color: #ccc;
  font-size: calc(10px * var(--s));
  word-break: break-all;
  line-height: 1.4;
  padding: calc(4px * var(--s)) calc(12px * var(--s)) calc(6px * var(--s));
  border-bottom: 1px solid #444;
}

.clnc-fields {
  padding: calc(8px * var(--s)) calc(12px * var(--s));
}

.clnc-row {
  display: flex;
  justify-content: space-between;
  padding: calc(4px * var(--s)) 0;
  border-bottom: 1px solid #444;
}

.clnc-row:last-child {
  border-bottom: none;
}

.clnc-label {
  color: #aaa;
  font-size: calc(11px * var(--s));
  font-weight: 600;
  min-width: calc(48px * var(--s));
}

.clnc-value {
  color: #e0e0e0;
  font-size: calc(13px * var(--s));
  font-weight: bold;
  text-align: right;
}

.clnc-clickable {
  cursor: pointer;
  text-decoration: underline;
  text-decoration-style: dotted;
  text-underline-offset: 2px;
}

.clnc-clickable:hover {
  color: #64b5f6;
}

.clnc-actions {
  display: flex;
  border-top: calc(1px * var(--s)) solid #555;
}

.clnc-btn {
  flex: 1;
  padding: calc(8px * var(--s)) 0;
  border: none;
  font-size: calc(12px * var(--s));
  font-weight: bold;
  cursor: pointer;
  letter-spacing: calc(0.5px * var(--s));
  min-height: max(32px, calc(32px * var(--s)));
}

.clnc-btn-cancel {
  background: #555;
  color: #ccc;
  border-right: calc(1px * var(--s)) solid #666;
}

.clnc-btn-cancel:hover {
  background: #666;
}

.clnc-btn-ok {
  background: #2e7d32;
  color: #fff;
}

.clnc-btn-ok:hover:not(:disabled) {
  background: #388e3c;
}

.clnc-btn-ok:disabled {
  background: #3a3a3a;
  color: #666;
  cursor: not-allowed;
}

/* DCL section */
.clnc-dcl-section {
  padding: calc(8px * var(--s)) calc(12px * var(--s));
  border-top: calc(1px * var(--s)) solid #555;
  background: #1e1e22;
}

.clnc-dcl-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: calc(6px * var(--s));
}

.clnc-dcl-label {
  color: #aaa;
  font-size: calc(11px * var(--s));
  font-weight: 600;
}

.clnc-dcl-status {
  font-size: calc(10px * var(--s));
  font-weight: bold;
  padding: calc(1px * var(--s)) calc(6px * var(--s));
  border-radius: calc(2px * var(--s));
}

.dcl-status-request {
  background: #f9a825;
  color: #000;
}

.dcl-status-sent {
  background: #2e7d32;
  color: #fff;
}

.dcl-status-done {
  background: #1565c0;
  color: #fff;
}

.dcl-status-error {
  background: #c62828;
  color: #fff;
}

.clnc-dcl-message {
  color: #999;
  font-size: calc(9px * var(--s));
  margin-bottom: calc(6px * var(--s));
  word-break: break-all;
}

.clnc-dcl-preview {
  color: #e0e0e0;
  font-size: calc(11px * var(--s));
  font-weight: 500;
  line-height: 1.4;
  margin-bottom: calc(6px * var(--s));
  padding: calc(4px * var(--s)) calc(6px * var(--s));
  background: #2a2a2e;
  border: 1px solid #444;
  border-radius: calc(2px * var(--s));
}

.clnc-remarks-row {
  display: flex;
  align-items: center;
  gap: calc(8px * var(--s));
  margin-top: calc(4px * var(--s));
}

.clnc-remarks-input {
  flex: 1;
  background: #333;
  border: 1px solid #555;
  color: #e0e0e0;
  font-size: calc(11px * var(--s));
  padding: calc(3px * var(--s)) calc(6px * var(--s));
  border-radius: calc(2px * var(--s));
  outline: none;
}

.clnc-remarks-input:focus {
  border-color: #3b7dd8;
}

.clnc-remarks-input::placeholder {
  color: #666;
}

/* Reject and Send buttons */
.clnc-btn-reject {
  background: #c62828;
  color: #fff;
  border-right: calc(1px * var(--s)) solid #666;
}

.clnc-btn-reject:hover {
  background: #e53935;
}

.clnc-btn-send {
  background: #1565c0;
  color: #fff;
}

.clnc-btn-send:hover:not(:disabled) {
  background: #1976d2;
}

.clnc-btn-send:disabled {
  background: #3a3a3a;
  color: #666;
  cursor: not-allowed;
}

/* Dropdown overlay and items */
.clnc-dropdown-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 10;
}

.clnc-dropdown {
  position: absolute;
  top: calc(30px * var(--s));
  left: calc(12px * var(--s));
  right: calc(12px * var(--s));
  background: #1e1e22;
  border: 1px solid #666;
  border-radius: calc(2px * var(--s));
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.6);
}

.clnc-dropdown-scroll {
  max-height: calc(200px * var(--s));
  overflow-y: auto;
}

.clnc-dropdown-item {
  padding: calc(5px * var(--s)) calc(10px * var(--s));
  color: #ddd;
  font-size: calc(12px * var(--s));
  font-weight: 600;
  cursor: pointer;
  border-bottom: 1px solid #333;
}

.clnc-dropdown-item:last-child {
  border-bottom: none;
}

.clnc-dropdown-empty {
  padding: calc(10px * var(--s));
  color: #888;
  font-size: calc(11px * var(--s));
  text-align: center;
}

.clnc-dropdown-item:hover {
  background: #3b7dd8;
  color: #fff;
}

.clnc-dropdown-selected {
  background: #2a4a6e;
  color: #8cbcf0;
}

.clnc-dropdown-scroll::-webkit-scrollbar {
  width: calc(6px * var(--s));
}

.clnc-dropdown-scroll::-webkit-scrollbar-track {
  background: #1e1e22;
}

.clnc-dropdown-scroll::-webkit-scrollbar-thumb {
  background: #555;
  border-radius: calc(3px * var(--s));
}
</style>

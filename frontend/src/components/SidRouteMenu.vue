<template>
  <v-menu
    :model-value="modelValue"
    :target="target"
    location="bottom"
    :z-index="zIndex"
    :close-on-content-click="false"
    @update:model-value="onModelUpdate"
  >
    <div class="sid-route-menu" @click.stop>
      <button type="button" class="sid-route-top" title="Close" @click="closeMenu">
        <div class="sid-route-header">DEP ROUTE</div>
        <div class="sid-route-callsign">{{ strip.callsign }}</div>
      </button>
      <div v-if="!strip.runway" class="sid-route-empty">No runway assigned</div>
      <div v-else-if="loading" class="sid-route-empty">Loading…</div>
      <div v-else-if="!hasAnySids" class="sid-route-empty">No SIDs for runway {{ strip.runway }}</div>
      <template v-else>
        <div
          v-if="normalSids.length"
          class="sid-route-list"
          :class="{ 'sid-route-list-cols': normalSids.length > 10 }"
        >
          <button
            v-for="sid in normalSids"
            :key="sid"
            type="button"
            class="sid-route-item"
            :class="{ selected: isSelected(sid), 'exit-match': isExitMatch(sid) }"
            @click="onSelect(sid)"
          >{{ sidLabel(sid) }}</button>
        </div>
        <template v-if="slowSids.length">
          <div class="sid-route-section">SLOW</div>
          <div
            class="sid-route-list"
            :class="{ 'sid-route-list-cols': slowSids.length > 8 }"
          >
            <button
              v-for="sid in slowSids"
              :key="sid"
              type="button"
              class="sid-route-item"
              :class="{ selected: isSelected(sid), 'exit-match': isExitMatch(sid) }"
              @click="onSelect(sid)"
            >{{ sidLabel(sid) }}</button>
          </div>
        </template>
        <template v-if="vfrSids.length">
          <div class="sid-route-section">VFR</div>
          <div
            class="sid-route-list"
            :class="{ 'sid-route-list-cols': vfrSids.length > 8 }"
          >
            <button
              v-for="sid in vfrSids"
              :key="sid"
              type="button"
              class="sid-route-item"
              :class="{ selected: isSelected(sid), 'exit-match': isExitMatch(sid) }"
              @click="onSelect(sid)"
            >{{ sidLabel(sid) }}</button>
          </div>
        </template>
      </template>
      <button type="button" class="sid-route-clear" @click="onClear">CLEAR</button>
    </div>
  </v-menu>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { FlightStrip } from '@/types/efs'
import { useEfsStore } from '@/store/efs'
import {
  extractTmaExitPoint,
  hasSlowRemark,
  isIfrSidEligible,
  isTrackSidName,
  isVectorSidName,
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

watch(
  () => props.modelValue,
  (open) => {
    if (open) ignoreCloseUntil = Date.now() + 450
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

/** Track/heading SIDs and HAPZI — SLOW departure routes (not radar-vector ·exit SIDs) */
function isSlowSid(sid: string): boolean {
  if (isVfrSid(sid)) return false
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
  allSids.value.filter((s) => !isVfrSid(s) && !isSlowSid(s)),
)
const slowSids = computed(() => allSids.value.filter((s) => isSlowSid(s)))
const vfrSids = computed(() => allSids.value.filter((s) => isVfrSid(s)))
const hasAnySids = computed(
  () => normalSids.value.length + slowSids.value.length + vfrSids.value.length > 0,
)

function isSelected(sid: string): boolean {
  const current = props.strip.sid || ''
  if (!current) return false
  return normSidKey(sid) === normSidKey(current)
}

function isExitMatch(sid: string): boolean {
  return exitMatchKeys.value.has(normSidKey(sid))
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
  store.sendAssignment(props.strip.id, 'assignSid', '')
  close()
}

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

.sid-route-item.selected {
  background: var(--sid-strip-white);
  color: #1a3a6e;
  box-shadow: inset 0 0 0 2px #1a3a6e;
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

.sid-route-clear:hover {
  background: #1a3a6e;
  color: var(--sid-strip-white);
  box-shadow: inset 0 0 0 2px #000;
}
</style>

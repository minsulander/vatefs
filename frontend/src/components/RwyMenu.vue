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
        <div class="sid-route-header">{{ title }}</div>
        <div class="sid-route-callsign">{{ strip.callsign }}</div>
      </button>
      <div v-if="loading" class="sid-route-empty">Loading…</div>
      <div v-else-if="!airport" class="sid-route-empty">No airport</div>
      <div v-else-if="runways.length === 0" class="sid-route-empty">No runways for {{ airport }}</div>
      <div
        v-else
        class="sid-route-list"
        :class="{ 'sid-route-list-cols': runways.length > 8 }"
      >
        <button
          v-for="rwy in runways"
          :key="rwy"
          type="button"
          class="sid-route-item"
          :class="{ selected: isSelected(rwy) }"
          @click="onSelect(rwy)"
        >{{ rwy }}</button>
      </div>
      <button type="button" class="sid-route-clear" @click="onClear">CLEAR</button>
    </div>
  </v-menu>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { FlightStrip } from '@/types/efs'
import { useEfsStore } from '@/store/efs'

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
const runways = ref<string[]>([])
const loading = ref(false)

const isArrival = computed(() => props.strip.stripType === 'arrival')
const title = computed(() => (isArrival.value ? 'ARR RWY' : 'DEP RWY'))
const airport = computed(() => {
  const icao = isArrival.value ? props.strip.ades : props.strip.adep
  if (!icao || icao === '????') return ''
  return icao
})
const assignType = computed(() =>
  isArrival.value ? ('assignArrivalRunway' as const) : ('assignDepartureRunway' as const),
)

function isSelected(rwy: string): boolean {
  return (props.strip.runway || '').toUpperCase() === rwy.toUpperCase()
}

/** ESSA physical order: west pair, east pair, south pair, then heli 07/25 */
const ESSA_RWY_ORDER = ['01L', '19R', '01R', '19L', '08', '26', '07', '25']
const ESSA_HELI_RWYS = new Set(['07', '25'])

/** Common ICAO helicopter type designators (VATSIM / ESSA traffic). */
const HELI_ATYP = new Set([
  'A109', 'A119', 'A139', 'A169', 'A189',
  'AS35', 'AS50', 'AS55', 'AS65', 'AS3B',
  'AW139', 'AW169', 'AW189',
  'B06', 'B47', 'B206', 'B212', 'B407', 'B412', 'B429', 'B430',
  'BK17', 'BO105',
  'EC20', 'EC25', 'EC30', 'EC35', 'EC45', 'EC55', 'EC75',
  'H60', 'H64', 'H47', 'H135', 'H145', 'H160', 'H175', 'H215', 'H225',
  'KA32', 'MD50', 'MD52', 'MD60', 'MI8', 'MI17', 'MI24', 'NH90',
  'R22', 'R44', 'R66', 'S61', 'S76', 'S92',
  'HELI', 'H/C',
])

function isUnknownAtyp(atyp: string | undefined): boolean {
  const u = (atyp || '').trim().toUpperCase()
  return !u || u === 'UNKN' || u === '????' || u === 'ZZZZ' || u === 'XXXX'
}

function isHelicopterAtyp(atyp: string | undefined): boolean {
  const u = (atyp || '').trim().toUpperCase()
  if (!u) return false
  return HELI_ATYP.has(u)
}

function showEssaHeliRwys(): boolean {
  const atyp = props.strip.aircraftType
  if (isHelicopterAtyp(atyp) || isUnknownAtyp(atyp)) return true
  // Keep 07/25 visible if already assigned (so CLEAR / re-select stays possible)
  const current = (props.strip.runway || '').toUpperCase()
  return ESSA_HELI_RWYS.has(current)
}

function sortRunways(apt: string, list: string[]): string[] {
  if (apt.toUpperCase() === 'ESSA') {
    const allowHeli = showEssaHeliRwys()
    const filtered = allowHeli
      ? list
      : list.filter((r) => !ESSA_HELI_RWYS.has(r.toUpperCase()))
    const rank = new Map(ESSA_RWY_ORDER.map((r, i) => [r, i]))
    return [...filtered].sort((a, b) => {
      const ra = rank.get(a.toUpperCase())
      const rb = rank.get(b.toUpperCase())
      if (ra !== undefined && rb !== undefined) return ra - rb
      if (ra !== undefined) return -1
      if (rb !== undefined) return 1
      return a.localeCompare(b, undefined, { numeric: true })
    })
  }
  return [...list].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
}

async function fetchRunways() {
  const apt = airport.value
  if (!apt) {
    runways.value = []
    return
  }
  loading.value = true
  try {
    const res = await fetch(`/api/runways?airport=${encodeURIComponent(apt)}`)
    if (!res.ok) {
      runways.value = []
      return
    }
    const data = (await res.json()) as string[]
    runways.value = sortRunways(apt, data)
  } catch {
    runways.value = []
  } finally {
    loading.value = false
  }
}

function close() {
  emit('update:modelValue', false)
}

function onSelect(rwy: string) {
  store.sendAssignment(props.strip.id, assignType.value, rwy)
  close()
}

function onClear() {
  store.sendAssignment(props.strip.id, assignType.value, '')
  close()
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) void fetchRunways()
  },
)
</script>

<style scoped>
.sid-route-menu {
  --sid-strip-white: #ebebeb;
  --s: var(--efs-scale, 1);
  min-width: calc(120px * var(--s));
  max-width: min(92vw, calc(280px * var(--s)));
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

.sid-route-item.selected {
  background: var(--sid-strip-white);
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

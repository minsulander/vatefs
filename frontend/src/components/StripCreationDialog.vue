<template>
  <v-dialog :model-value="modelValue" @update:model-value="emit('update:modelValue', $event)" max-width="340" content-class="strip-create-dialog-wrapper">
    <div class="strip-create-dialog">
      <div class="dialog-header">
        <div class="dialog-header-indicator" :class="headerIndicatorClass"></div>
        <span class="dialog-header-title">{{ dialogTitle }}</span>
      </div>

      <div class="dialog-body">
        <!-- Callsign (notes excluded; vehicles: no FPL match) -->
        <div v-if="!isNote" class="dialog-field">
          <label class="dialog-label">Callsign</label>
          <input
            ref="callsignInput"
            v-model="callsign"
            class="dialog-input"
            :class="{ 'input-error': !isVehicle && callsign.length > 0 && callsign.length < 2 }"
            :placeholder="isVehicle ? '' : 'e.g. SEKFH'"
            maxlength="10"
            @input="onCallsignInput"
            @keydown.enter="onOk"
            @keydown.escape="onCancel"
          />
          <div v-if="!isVehicle" class="match-indicator" :class="matchClass">
            <span v-if="isSearching">Searching...</span>
            <span v-else-if="callsign.length < 2"></span>
            <span v-else-if="matchFound">Flight found</span>
            <span v-else>No matching flight</span>
          </div>
        </div>

        <!-- Aircraft type (VFR DEP/ARR only) -->
        <div v-if="stripType === 'vfrDep' || stripType === 'vfrArr'" class="dialog-field">
          <label class="dialog-label">Aircraft type</label>
          <input
            v-model="aircraftType"
            class="dialog-input"
            placeholder="e.g. C172"
            maxlength="10"
            @input="aircraftType = aircraftType.toUpperCase()"
            @keydown.enter="onOk"
            @keydown.escape="onCancel"
          />
        </div>

        <!-- Airport selector — same sort/look as RTC bay airport picker (ICAO only) -->
        <div v-if="showAirportSelector" class="dialog-field">
          <label class="dialog-label">{{ airportLabel }}</label>
          <div class="airport-pick efs-popup-menu">
            <div class="efs-popup-list airport-pick-list">
              <button
                v-for="opt in airportOptions"
                :key="opt.icao"
                type="button"
                class="efs-popup-item efs-popup-item--start airport-pick-item"
                :class="{
                  selected: opt.icao === selectedAirport,
                  'efs-popup-muted': !opt.isActive,
                  'airport-pick-item--accent': !!opt.accent,
                }"
                :style="opt.accent ? { background: opt.accent, color: '#000' } : undefined"
                @click="selectedAirport = opt.icao"
                @keydown.enter.prevent="onOk"
              >
                <span class="item-icao">{{ opt.icao }}</span>
                <span v-if="store.multiAirport && (opt.arr || opt.dep)" class="item-right">
                  <span class="item-traffic">
                    <span v-if="opt.arr" class="traffic-arr">↓{{ opt.arr }}</span>
                    <span v-if="opt.dep" class="traffic-dep">↑{{ opt.dep }}</span>
                  </span>
                </span>
              </button>
              <div v-if="airportOptions.length === 0" class="efs-popup-meta">
                {{ store.multiAirport ? 'Assign an airport to a column first' : 'No airports' }}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="dialog-actions">
        <button class="dialog-btn dialog-cancel" @click="onCancel">Cancel</button>
        <button class="dialog-btn dialog-ok" :disabled="!isValid" @click="onOk">OK</button>
      </div>
    </div>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { useEfsStore } from '@/store/efs'
import { buildRtcAirportList } from '@/composables/rtcAirportList'

type SpecialStripType = 'vfrDep' | 'vfrArr' | 'cross' | 'note' | 'vehicle'

const props = defineProps<{
  modelValue: boolean
  stripType: SpecialStripType
  /** Prefill airport (e.g. from drop target column) */
  initialAirport?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'create': [data: { callsign: string; aircraftType?: string; airport?: string }]
}>()

const store = useEfsStore()

const callsignInput = ref<HTMLInputElement | null>(null)
const callsign = ref('')
const aircraftType = ref('')
const selectedAirport = ref('')
const matchFound = ref(false)
const isSearching = ref(false)

let searchDebounce: ReturnType<typeof setTimeout> | undefined

const isNote = computed(() => props.stripType === 'note')
const isVehicle = computed(() => props.stripType === 'vehicle')

/**
 * Airports for manual strip creation.
 * RTC: only airports currently assigned to a visible column (column order).
 * Single-airport: myAirports.
 */
const airportOptions = computed(() => {
  if (!store.multiAirport) {
    return store.myAirports.map((icao) => ({
      icao,
      arr: 0,
      dep: 0,
      total: 0,
      isActive: true,
      inColumn: true,
      hasEsFlag: false,
      accent: null as string | null,
      priority: 0,
      taken: false,
    }))
  }
  return buildRtcAirportList().filter((o) => o.inColumn)
})

const showAirportSelector = computed(() => {
  // Exactly one column/airport → auto-select, skip picker
  if (airportOptions.value.length === 1) return false
  // RTC with none assigned: show empty hint; 2+ : pick
  if (store.multiAirport) return true
  return airportOptions.value.length > 1
})

const airportLabel = computed(() => {
  switch (props.stripType) {
    case 'vfrDep': return 'Origin'
    case 'vfrArr': return 'Destination'
    default: return 'Airport'
  }
})

const dialogTitle = computed(() => {
  switch (props.stripType) {
    case 'vfrDep': return 'NEW VFR DEPARTURE'
    case 'vfrArr': return 'NEW VFR ARRIVAL'
    case 'cross': return 'NEW CROSSING TRAFFIC'
    case 'note': return 'NEW NOTE'
    case 'vehicle': return 'NEW VEHICLE'
    default: return 'NEW STRIP'
  }
})

const headerIndicatorClass = computed(() => {
  switch (props.stripType) {
    case 'vfrDep': return 'indicator-dep'
    case 'vfrArr': return 'indicator-arr'
    case 'cross': return 'indicator-cross'
    case 'vehicle': return store.multiAirport ? 'indicator-vehicle-rtc' : 'indicator-vehicle'
    default: return 'indicator-note'
  }
})

const matchClass = computed(() => {
  if (callsign.value.length < 2) return ''
  if (isSearching.value) return 'match-searching'
  return matchFound.value ? 'match-found' : 'match-notfound'
})

const isValid = computed(() => {
  // RTC: must pick a column airport
  if (store.multiAirport) {
    if (!selectedAirport.value) return false
    if (!airportOptions.value.some((o) => o.icao === selectedAirport.value)) return false
  }
  if (isNote.value) {
    return !showAirportSelector.value || !!selectedAirport.value
  }
  // Vehicle callsign is optional; other types need ≥2 chars
  if (!isVehicle.value && callsign.value.length < 2) return false
  if (showAirportSelector.value && !selectedAirport.value) return false
  return true
})

// Reset state when dialog opens
watch(() => props.modelValue, (open) => {
  if (open) {
    callsign.value = ''
    aircraftType.value = ''
    const selectable = airportOptions.value.map((o) => o.icao)
    const prefer =
      props.initialAirport && selectable.includes(props.initialAirport)
        ? props.initialAirport
        : selectable[0] ?? ''
    selectedAirport.value = prefer
    matchFound.value = false
    isSearching.value = false
    nextTick(() => {
      if (!isNote.value) callsignInput.value?.focus()
    })
  }
})

function onCallsignInput() {
  const cs = callsign.value.toUpperCase().trim()
  callsign.value = cs

  // Vehicles are local-only — never match against VATSIM FPLs
  if (isVehicle.value) {
    matchFound.value = false
    isSearching.value = false
    return
  }

  if (cs.length < 2) {
    matchFound.value = false
    isSearching.value = false
    return
  }

  if (searchDebounce) clearTimeout(searchDebounce)
  isSearching.value = true
  searchDebounce = setTimeout(async () => {
    try {
      const resp = await fetch(`/api/flight/${encodeURIComponent(cs)}`)
      if (resp.ok) {
        const flight = await resp.json()
        matchFound.value = true
        if (flight.aircraftType && !aircraftType.value) {
          aircraftType.value = flight.aircraftType.toUpperCase()
        }
      } else {
        matchFound.value = false
      }
    } catch {
      matchFound.value = false
    }
    isSearching.value = false
  }, 300)
}

function onOk() {
  if (!isValid.value) return

  emit('create', {
    callsign: isNote.value ? '' : callsign.value,
    aircraftType: isVehicle.value ? undefined : (aircraftType.value || undefined),
    airport: selectedAirport.value || undefined
  })
  emit('update:modelValue', false)
}

function onCancel() {
  emit('update:modelValue', false)
}
</script>

<style>
/* Dialog wrapper - unscoped because v-dialog teleports */
.strip-create-dialog-wrapper {
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5) !important;
}

.strip-create-dialog {
  --s: var(--efs-scale, 1);
  background: #2a2a2e;
  border: 2px solid #555;
}

.dialog-header {
  display: flex;
  align-items: center;
  padding: calc(10px * var(--s)) calc(14px * var(--s));
  border-bottom: 1px solid #444;
  gap: calc(10px * var(--s));
}

.dialog-header-indicator {
  width: calc(8px * var(--s));
  height: calc(22px * var(--s));
  flex-shrink: 0;
}

.indicator-dep { background: #3a72d4; }
.indicator-arr { background: #daa520; }
.indicator-cross { background: #881fe0; }
.indicator-note { background: #888; }
.indicator-vehicle { background: #4a4a4a; }
.indicator-vehicle-rtc { background: #c62828; }

.dialog-header-title {
  font-size: calc(12px * var(--s));
  font-weight: 700;
  color: #ddd;
  letter-spacing: calc(1px * var(--s));
}

.dialog-body {
  padding: calc(12px * var(--s)) calc(14px * var(--s));
  display: flex;
  flex-direction: column;
  gap: calc(10px * var(--s));
}

.dialog-field {
  display: flex;
  flex-direction: column;
  gap: calc(3px * var(--s));
}

.dialog-label {
  font-size: calc(10px * var(--s));
  font-weight: 600;
  color: #999;
  text-transform: uppercase;
  letter-spacing: calc(0.5px * var(--s));
}

.dialog-input {
  background: #1a1a1e;
  border: 1px solid #555;
  color: #eee;
  padding: calc(6px * var(--s)) calc(8px * var(--s));
  font-size: calc(14px * var(--s));
  font-weight: 600;
  letter-spacing: calc(0.5px * var(--s));
  outline: none;
  font-family: 'Segoe UI', 'Arial', sans-serif;
}

.dialog-input:focus {
  border-color: #0088aa;
}

.dialog-input.input-error {
  border-color: #c62828;
}

.match-indicator {
  font-size: calc(10px * var(--s));
  height: calc(14px * var(--s));
  line-height: calc(14px * var(--s));
}

.match-searching {
  color: #888;
}

.match-found {
  color: #4caf50;
}

.match-notfound {
  color: #ff9800;
}

.dialog-actions {
  display: flex;
  border-top: calc(1px * var(--s)) solid #555;
}

.dialog-btn {
  flex: 1;
  padding: calc(10px * var(--s)) 0;
  border: none;
  font-size: calc(12px * var(--s));
  font-weight: bold;
  cursor: pointer;
  letter-spacing: calc(0.5px * var(--s));
  min-height: max(32px, calc(32px * var(--s)));
}

.dialog-cancel {
  background: #555;
  color: #ccc;
  border-right: calc(1px * var(--s)) solid #666;
}

.dialog-cancel:hover {
  background: #666;
}

.dialog-ok {
  background: #0077aa;
  color: #fff;
}

.dialog-ok:hover:not(:disabled) {
  background: #0099cc;
}

.dialog-ok:disabled {
  background: #444;
  color: #777;
  cursor: default;
}

/* RTC-style airport list (ICAO only; column accent; muted if inactive) */
.airport-pick {
  width: 100%;
  max-width: none;
  border: 1px solid #555;
  box-shadow: none;
}

.airport-pick-list {
  max-height: calc(220px * var(--s));
}

.airport-pick-item .item-icao {
  font-weight: 800;
  letter-spacing: 0.05em;
}

.airport-pick-item.selected:not(.airport-pick-item--accent) {
  outline: 2px solid #1a3a6e;
  outline-offset: -2px;
}

.airport-pick-item.selected.airport-pick-item--accent {
  box-shadow: inset 0 0 0 2px #000;
}
</style>

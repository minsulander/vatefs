<template>
  <v-dialog :model-value="modelValue" @update:model-value="emit('update:modelValue', $event)" max-width="340" content-class="strip-create-dialog-wrapper">
    <div class="strip-create-dialog">
      <div class="dialog-header">
        <div class="dialog-header-indicator" :class="headerIndicatorClass"></div>
        <span class="dialog-header-title">{{ dialogTitle }}</span>
      </div>

      <div class="dialog-body">
        <!-- Callsign input -->
        <div class="dialog-field">
          <label class="dialog-label">Callsign</label>
          <input
            ref="callsignInput"
            v-model="callsign"
            class="dialog-input"
            :class="{ 'input-error': callsign.length > 0 && callsign.length < 2 }"
            placeholder="e.g. SEKFH"
            maxlength="10"
            @input="onCallsignInput"
            @keydown.enter="onOk"
            @keydown.escape="onCancel"
          />
          <div class="match-indicator" :class="matchClass">
            <span v-if="isSearching">Searching...</span>
            <span v-else-if="callsign.length < 2"></span>
            <span v-else-if="matchFound">Flight found</span>
            <span v-else>No matching flight</span>
          </div>
        </div>

        <!-- Aircraft type (VFR DEP/ARR only) -->
        <div v-if="stripType !== 'cross'" class="dialog-field">
          <label class="dialog-label">Aircraft type</label>
          <input
            v-model="aircraftType"
            class="dialog-input"
            placeholder="e.g. C172"
            maxlength="10"
            @keydown.enter="onOk"
            @keydown.escape="onCancel"
          />
        </div>

        <!-- Airport selector (VFR DEP/ARR when multiple airports) -->
        <div v-if="stripType !== 'cross' && airports.length > 1" class="dialog-field">
          <label class="dialog-label">{{ stripType === 'vfrDep' ? 'Origin' : 'Destination' }}</label>
          <select v-model="selectedAirport" class="dialog-input dialog-select">
            <option v-for="ap in airports" :key="ap" :value="ap">{{ ap }}</option>
          </select>
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

type SpecialStripType = 'vfrDep' | 'vfrArr' | 'cross' | 'note'

const props = defineProps<{
  modelValue: boolean
  stripType: SpecialStripType
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

const airports = computed(() => store.myAirports)

const dialogTitle = computed(() => {
  switch (props.stripType) {
    case 'vfrDep': return 'NEW VFR DEPARTURE'
    case 'vfrArr': return 'NEW VFR ARRIVAL'
    case 'cross': return 'NEW CROSSING TRAFFIC'
    default: return 'NEW STRIP'
  }
})

const headerIndicatorClass = computed(() => {
  switch (props.stripType) {
    case 'vfrDep': return 'indicator-dep'
    case 'vfrArr': return 'indicator-arr'
    case 'cross': return 'indicator-cross'
    default: return 'indicator-note'
  }
})

const matchClass = computed(() => {
  if (callsign.value.length < 2) return ''
  if (isSearching.value) return 'match-searching'
  return matchFound.value ? 'match-found' : 'match-notfound'
})

const isValid = computed(() => {
  return callsign.value.length >= 2
})

// Reset state when dialog opens
watch(() => props.modelValue, (open) => {
  if (open) {
    callsign.value = ''
    aircraftType.value = ''
    selectedAirport.value = airports.value[0] ?? ''
    matchFound.value = false
    isSearching.value = false
    nextTick(() => {
      callsignInput.value?.focus()
    })
  }
})

function onCallsignInput() {
  const cs = callsign.value.toUpperCase().trim()
  callsign.value = cs

  if (cs.length < 2) {
    matchFound.value = false
    isSearching.value = false
    return
  }

  // Debounce the flight lookup
  if (searchDebounce) clearTimeout(searchDebounce)
  isSearching.value = true
  searchDebounce = setTimeout(async () => {
    try {
      const resp = await fetch(`/api/flight/${encodeURIComponent(cs)}`)
      if (resp.ok) {
        const flight = await resp.json()
        matchFound.value = true
        // Pre-fill aircraft type if available and not already entered
        if (flight.aircraftType && !aircraftType.value) {
          aircraftType.value = flight.aircraftType
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
    callsign: callsign.value,
    aircraftType: aircraftType.value || undefined,
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
  background: #2a2a2e;
  border: 2px solid #555;
}

.dialog-header {
  display: flex;
  align-items: center;
  padding: 10px 14px;
  border-bottom: 1px solid #444;
  gap: 10px;
}

.dialog-header-indicator {
  width: 8px;
  height: 22px;
  flex-shrink: 0;
}

.indicator-dep { background: #3b7dd8; }
.indicator-arr { background: #daa520; }
.indicator-cross { background: #9b59b6; }
.indicator-note { background: #888; }

.dialog-header-title {
  font-size: 12px;
  font-weight: 700;
  color: #ddd;
  letter-spacing: 1px;
}

.dialog-body {
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.dialog-field {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.dialog-label {
  font-size: 10px;
  font-weight: 600;
  color: #999;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.dialog-input {
  background: #1a1a1e;
  border: 1px solid #555;
  color: #eee;
  padding: 6px 8px;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.5px;
  outline: none;
  font-family: 'Segoe UI', 'Arial', sans-serif;
}

.dialog-input:focus {
  border-color: #0088aa;
}

.dialog-input.input-error {
  border-color: #c62828;
}

.dialog-select {
  appearance: auto;
  cursor: pointer;
}

.match-indicator {
  font-size: 10px;
  height: 14px;
  line-height: 14px;
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
  border-top: 1px solid #555;
}

.dialog-btn {
  flex: 1;
  padding: 10px 0;
  border: none;
  font-size: 12px;
  font-weight: bold;
  cursor: pointer;
  letter-spacing: 0.5px;
}

.dialog-cancel {
  background: #555;
  color: #ccc;
  border-right: 1px solid #666;
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
</style>

<template>
  <v-dialog v-model="dialogOpen" max-width="280" content-class="clnc-dialog-wrapper">
    <div class="clnc-dialog">
      <div class="clnc-header">{{ strip.callsign }}</div>
      <div class="clnc-fields">
        <div class="clnc-row"><span class="clnc-label">RWY</span><span class="clnc-value clnc-clickable" @click="openDropdown('rwy')">{{ strip.runway || '---' }}</span></div>
        <div class="clnc-row"><span class="clnc-label">SID</span><span class="clnc-value clnc-clickable" @click="openDropdown('sid')">{{ strip.sid || '---' }}</span></div>
        <div class="clnc-row"><span class="clnc-label">AHDG</span><span class="clnc-value clnc-clickable" @click="openDropdown('hdg')">{{ strip.direct || (strip.assignedHeading ? 'H' + strip.assignedHeading : '---') }}</span></div>
        <div class="clnc-row"><span class="clnc-label">CFL</span><span class="clnc-value clnc-clickable" @click="openDropdown('cfl')">{{ strip.clearedAltitude || '---' }}</span></div>
        <div class="clnc-row"><span class="clnc-label">ASSR</span><span class="clnc-value clnc-clickable" @click="onResetSquawk">{{ strip.squawk || '----' }}</span></div>
      </div>

      <!-- Dropdown overlay -->
      <div v-if="activeDropdown" class="clnc-dropdown-overlay" @click="activeDropdown = null">
        <div class="clnc-dropdown" :style="dropdownStyle" @click.stop>
          <div class="clnc-dropdown-scroll">
            <div v-for="option in dropdownOptions" :key="option.value"
              class="clnc-dropdown-item"
              :class="{ 'clnc-dropdown-selected': option.selected }"
              @click="selectOption(option.value)">
              {{ option.label }}
            </div>
          </div>
        </div>
      </div>

      <div class="clnc-actions">
        <button class="clnc-btn clnc-btn-cancel" @click="onCancel">Cancel</button>
        <button class="clnc-btn clnc-btn-ok" :disabled="okDisabled" @click="onOk">OK</button>
      </div>
    </div>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { FlightStrip } from '@/types/efs'
import { useEfsStore } from '@/store/efs'

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

// Dropdown state
const activeDropdown = ref<'rwy' | 'sid' | 'hdg' | 'cfl' | null>(null)
const availableRunways = ref<string[]>([])
const availableSids = ref<{ name: string }[]>([])

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

// Fetch the SID altitude and assign CFL if not already set
async function applyDefaultCfl() {
  const airport = props.strip.adep
  const sid = props.strip.sid
  if (!airport || !sid || props.strip.clearedAltitude) return
  try {
    const res = await fetch(`/api/sidalt?airport=${airport}&sid=${sid}`)
    if (res.ok) {
      const data = await res.json()
      if (data.altitude) {
        store.sendAssignment(props.strip.id, 'assignCfl', String(data.altitude))
      }
    }
  } catch {
    // ignore
  }
}

// When dialog opens, fetch data
watch(dialogOpen, (open) => {
  if (open) {
    fetchRunways()
    fetchSids()
    applyDefaultCfl()
  } else {
    activeDropdown.value = null
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

// Generate CFL options: A05-A50 (500ft intervals), then 060-510 (1000ft FL intervals)
const cflOptions = (() => {
  const opts: { label: string; value: string }[] = []
  // Altitudes: 500ft to 5000ft (transition altitude) in 500ft steps
  for (let alt = 500; alt <= 5000; alt += 500) {
    const label = 'A' + String(alt / 100).padStart(2, '0')
    opts.push({ label, value: String(alt) })
  }
  // Flight levels: 6000ft to 51000ft in 1000ft steps
  for (let alt = 6000; alt <= 51000; alt += 1000) {
    const fl = String(alt / 100).padStart(3, '0')
    opts.push({ label: fl, value: String(alt) })
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
    case 'sid':
      return availableSids.value.map(sid => ({
        label: sid.name,
        value: sid.name,
        selected: sid.name === props.strip.sid
      }))
    case 'hdg': {
      const current = props.strip.assignedHeading
      return headingOptions.map(opt => ({
        ...opt,
        selected: opt.value === current
      }))
    }
    case 'cfl': {
      const current = props.strip.clearedAltitude
      return cflOptions.map(opt => ({
        ...opt,
        selected: opt.label === current
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

async function openDropdown(field: 'rwy' | 'sid' | 'hdg' | 'cfl') {
  if (activeDropdown.value === field) {
    activeDropdown.value = null
    return
  }
  // Fetch fresh data when opening RWY/SID dropdowns
  if (field === 'rwy' && availableRunways.value.length === 0) {
    await fetchRunways()
  } else if (field === 'sid' && availableSids.value.length === 0) {
    await fetchSids()
  }
  activeDropdown.value = field
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
      store.sendAssignment(props.strip.id, 'assignSid', value)
      break
    case 'hdg':
      store.sendAssignment(props.strip.id, 'assignHeading', value)
      break
    case 'cfl':
      store.sendAssignment(props.strip.id, 'assignCfl', value)
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

function onResetSquawk() {
  store.sendStripAction(props.strip.id, 'resetSquawk')
}
</script>

<style>
/* CLNC Dialog - unscoped because v-dialog teleports content outside component */
.clnc-dialog-wrapper {
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5) !important;
}

.clnc-dialog {
  background: #2a2a2e;
  border: 2px solid #555;
  font-family: 'Consolas', 'Monaco', 'Lucida Console', monospace;
  padding: 0;
  position: relative;
}

.clnc-header {
  background: #3b7dd8;
  color: #fff;
  font-size: 15px;
  font-weight: bold;
  padding: 6px 12px;
  letter-spacing: 0.5px;
}

.clnc-fields {
  padding: 8px 12px;
}

.clnc-row {
  display: flex;
  justify-content: space-between;
  padding: 4px 0;
  border-bottom: 1px solid #444;
}

.clnc-row:last-child {
  border-bottom: none;
}

.clnc-label {
  color: #aaa;
  font-size: 11px;
  font-weight: 600;
  min-width: 48px;
}

.clnc-value {
  color: #e0e0e0;
  font-size: 13px;
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
  border-top: 1px solid #555;
}

.clnc-btn {
  flex: 1;
  padding: 8px 0;
  border: none;
  font-family: 'Consolas', 'Monaco', 'Lucida Console', monospace;
  font-size: 12px;
  font-weight: bold;
  cursor: pointer;
  letter-spacing: 0.5px;
}

.clnc-btn-cancel {
  background: #555;
  color: #ccc;
  border-right: 1px solid #666;
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
  top: 30px;
  left: 12px;
  right: 12px;
  background: #1e1e22;
  border: 1px solid #666;
  border-radius: 2px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.6);
}

.clnc-dropdown-scroll {
  max-height: 200px;
  overflow-y: auto;
}

.clnc-dropdown-item {
  padding: 5px 10px;
  color: #ddd;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  border-bottom: 1px solid #333;
}

.clnc-dropdown-item:last-child {
  border-bottom: none;
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
  width: 6px;
}

.clnc-dropdown-scroll::-webkit-scrollbar-track {
  background: #1e1e22;
}

.clnc-dropdown-scroll::-webkit-scrollbar-thumb {
  background: #555;
  border-radius: 3px;
}
</style>

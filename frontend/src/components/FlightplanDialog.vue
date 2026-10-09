<template>
  <v-dialog v-model="dialogOpen" max-width="400" content-class="fpl-dialog-wrapper">
    <div class="fpl-dialog">
      <div class="fpl-header">
        <span class="fpl-callsign">{{ strip.callsign }}</span>
        <span class="fpl-type-badge">{{ strip.aircraftType }}/{{ strip.wakeTurbulence }}</span>
        <span class="fpl-rules-badge">{{ flightRulesLabel }}</span>
      </div>

      <div v-if="loading" class="fpl-loading">Loading...</div>
      <div v-else-if="flight" class="fpl-body">
        <!-- Aerodromes row -->
        <div class="fpl-section-header">Route</div>
        <div class="fpl-grid">
          <div class="fpl-field">
            <span class="fpl-label">ADEP</span>
            <span class="fpl-val">{{ flight.origin || '----' }}</span>
          </div>
          <div class="fpl-field">
            <span class="fpl-label">ADES</span>
            <span class="fpl-val">{{ flight.destination || '----' }}</span>
          </div>
          <div class="fpl-field">
            <span class="fpl-label">ALTN</span>
            <span class="fpl-val">{{ flight.alternate || '----' }}</span>
          </div>
          <div class="fpl-field">
            <span class="fpl-label">RFL</span>
            <span class="fpl-val">{{ formatFL(flight.rfl) }}</span>
          </div>
        </div>

        <!-- SID/STAR/RWY row -->
        <div class="fpl-grid">
          <div class="fpl-field">
            <span class="fpl-label">DEP RWY</span>
            <span class="fpl-val">{{ flight.depRwy || '---' }}</span>
          </div>
          <div class="fpl-field">
            <span class="fpl-label">SID</span>
            <span class="fpl-val">{{ flight.sid || '---' }}</span>
          </div>
          <div class="fpl-field">
            <span class="fpl-label">ARR RWY</span>
            <span class="fpl-val">{{ flight.arrRwy || '---' }}</span>
          </div>
          <div class="fpl-field">
            <span class="fpl-label">STAR</span>
            <span class="fpl-val">{{ flight.star || '---' }}</span>
          </div>
        </div>

        <!-- Route -->
        <div class="fpl-route-row">
          <span class="fpl-label">RTE</span>
          <span class="fpl-route-val">{{ flight.route || '---' }}</span>
        </div>

        <!-- Assignments -->
        <div class="fpl-section-header">Assigned Data</div>
        <div class="fpl-grid">
          <div class="fpl-field">
            <span class="fpl-label">SSR</span>
            <span class="fpl-val">{{ flight.squawk || '----' }}</span>
          </div>
          <div class="fpl-field">
            <span class="fpl-label">CFL</span>
            <span class="fpl-val">{{ formatFL(flight.cfl) }}</span>
          </div>
          <div class="fpl-field">
            <span class="fpl-label">HDG</span>
            <span class="fpl-val">{{ flight.ahdg ? String(flight.ahdg).padStart(3, '0') : '---' }}</span>
          </div>
          <div class="fpl-field">
            <span class="fpl-label">SPD</span>
            <span class="fpl-val">{{ flight.asp ? String(flight.asp) : '---' }}</span>
          </div>
        </div>

        <!-- Status -->
        <div class="fpl-section-header">Status</div>
        <div class="fpl-grid">
          <div class="fpl-field">
            <span class="fpl-label">CTLR</span>
            <span class="fpl-val fpl-val-small">{{ flight.controller || '---' }}</span>
          </div>
          <div class="fpl-field">
            <span class="fpl-label">GS</span>
            <span class="fpl-val">{{ flight.groundstate || '---' }}</span>
          </div>
          <div class="fpl-field">
            <span class="fpl-label">STAND</span>
            <span class="fpl-val">{{ flight.stand || '---' }}</span>
          </div>
          <div class="fpl-field">
            <span class="fpl-label">EOBT</span>
            <span class="fpl-val">{{ flight.eobt || '----' }}</span>
          </div>
        </div>

        <div class="fpl-grid">
          <div class="fpl-field">
            <span class="fpl-label">ALT</span>
            <span class="fpl-val">{{ flight.currentAltitude != null ? Math.round(flight.currentAltitude) + 'ft' : '---' }}</span>
          </div>
          <div class="fpl-field">
            <span class="fpl-label">GND SPD</span>
            <span class="fpl-val">{{ flight.groundSpeed != null ? flight.groundSpeed + 'kt' : '---' }}</span>
          </div>
          <div class="fpl-field">
            <span class="fpl-label">CLR</span>
            <span class="fpl-val">{{ flight.clearance ? 'YES' : 'NO' }}</span>
          </div>
          <div class="fpl-field">
            <span class="fpl-label">NEXT</span>
            <span class="fpl-val fpl-val-small">{{ flight.nextController || '---' }}</span>
          </div>
        </div>

        <!-- CDM / vIFF times — only fields that are present -->
        <template v-if="hasCdmTimes">
          <div class="fpl-section-header">CDM</div>
          <div class="fpl-grid">
            <div v-if="flight.tobt" class="fpl-field">
              <span class="fpl-label">TOBT<span v-if="flight.tobtSetBy" class="fpl-setby"> ({{ flight.tobtSetBy }})</span></span>
              <span class="fpl-val">{{ flight.tobt }}</span>
            </div>
            <div v-if="flight.tsat" class="fpl-field">
              <span class="fpl-label">TSAT</span>
              <span class="fpl-val">{{ flight.tsat }}</span>
            </div>
            <div v-if="flight.ctot" class="fpl-field" :title="flight.ctotReason || undefined">
              <span class="fpl-label">CTOT</span>
              <span class="fpl-val">{{ flight.ctot }}</span>
            </div>
            <div v-if="flight.asrt" class="fpl-field">
              <span class="fpl-label">ASRT</span>
              <span class="fpl-val">{{ flight.asrt }}</span>
            </div>
            <div v-if="flight.tsac" class="fpl-field">
              <span class="fpl-label">TSAC</span>
              <span class="fpl-val">{{ flight.tsac }}</span>
            </div>
            <div v-if="flight.ctoc" class="fpl-field">
              <span class="fpl-label">CTOC</span>
              <span class="fpl-val">{{ flight.ctoc }}</span>
            </div>
            <div v-if="flight.cdmSts" class="fpl-field">
              <span class="fpl-label">STS</span>
              <span class="fpl-val">{{ flight.cdmSts }}</span>
            </div>
          </div>
          <div v-if="flight.ctot && flight.ctotReason" class="fpl-route-row">
            <span class="fpl-label">CTOT REASON</span>
            <span class="fpl-route-val">{{ flight.ctotReason }}</span>
          </div>
        </template>
      </div>

      <div class="fpl-actions">
        <button class="fpl-btn" @click="dialogOpen = false">Close</button>
      </div>
    </div>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { FlightStrip } from '@/types/efs'

const props = defineProps<{
  strip: FlightStrip
  modelValue: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const dialogOpen = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v)
})

const loading = ref(false)
const flight = ref<any>(null)

const flightRulesLabel = computed(() => {
  switch (props.strip.flightRules) {
    case 'I': return 'IFR'
    case 'V': return 'VFR'
    case 'Y': return 'Y'
    case 'Z': return 'Z'
    default: return props.strip.flightRules
  }
})

/** Show CDM block when any vIFF/CDM time or status is present */
const hasCdmTimes = computed(() => {
  const f = flight.value
  if (!f) return false
  return !!(f.tobt || f.tsat || f.ctot || f.asrt || f.tsac || f.ctoc || f.cdmSts)
})

function formatFL(feet: number | undefined | null): string {
  if (feet == null || feet === 0) return '---'
  if (feet === 1) return 'ILS'
  if (feet === 2) return 'VIS'
  if (feet < 10000) return 'A' + String(Math.round(feet / 100)).padStart(2, '0')
  return String(Math.round(feet / 100)).padStart(3, '0')
}

async function fetchFlight() {
  loading.value = true
  flight.value = null
  try {
    const res = await fetch(`/api/flight/${encodeURIComponent(props.strip.callsign)}`)
    if (res.ok) {
      flight.value = await res.json()
    }
  } catch {
    // ignore
  } finally {
    loading.value = false
  }
}

watch(dialogOpen, (open) => {
  if (open) {
    fetchFlight()
  }
})
</script>

<style>
/* FPL Dialog - unscoped because v-dialog teleports content */
.fpl-dialog-wrapper {
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5) !important;
}

.fpl-dialog {
  --s: var(--efs-scale, 1);
  background: #2a2a2e;
  border: 2px solid #555;
  padding: 0;
}

.fpl-header {
  background: #3b7dd8;
  color: #fff;
  padding: calc(6px * var(--s)) calc(12px * var(--s));
  display: flex;
  align-items: center;
  gap: calc(10px * var(--s));
}

.fpl-callsign {
  font-size: calc(15px * var(--s));
  font-weight: bold;
  letter-spacing: calc(0.5px * var(--s));
}

.fpl-type-badge,
.fpl-rules-badge {
  font-size: calc(10px * var(--s));
  background: rgba(255, 255, 255, 0.2);
  padding: calc(1px * var(--s)) calc(6px * var(--s));
  border-radius: calc(2px * var(--s));
}

.fpl-loading {
  padding: calc(20px * var(--s));
  text-align: center;
  color: #888;
  font-size: calc(12px * var(--s));
}

.fpl-body {
  padding: calc(8px * var(--s)) calc(12px * var(--s));
}

.fpl-section-header {
  color: #7aa5d6;
  font-size: calc(9px * var(--s));
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: calc(1px * var(--s));
  padding: calc(6px * var(--s)) 0 calc(2px * var(--s));
  border-bottom: 1px solid #3a3a3e;
  margin-bottom: calc(4px * var(--s));
}

.fpl-section-header:first-child {
  padding-top: 0;
}

.fpl-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr 1fr;
  gap: calc(2px * var(--s)) calc(8px * var(--s));
  margin-bottom: calc(2px * var(--s));
}

.fpl-field {
  display: flex;
  flex-direction: column;
  padding: calc(2px * var(--s)) 0;
}

.fpl-label {
  color: #777;
  font-size: calc(8px * var(--s));
  font-weight: 600;
  letter-spacing: calc(0.5px * var(--s));
}

.fpl-val {
  color: #e0e0e0;
  font-size: calc(13px * var(--s));
  font-weight: bold;
}

.fpl-val-small {
  font-size: calc(10px * var(--s));
}

.fpl-setby {
  font-weight: 500;
  letter-spacing: 0;
  text-transform: none;
}

.fpl-route-row {
  display: flex;
  flex-direction: column;
  padding: calc(2px * var(--s)) 0 calc(4px * var(--s));
}

.fpl-route-val {
  color: #ccc;
  font-size: calc(10px * var(--s));
  word-break: break-all;
  line-height: 1.4;
  margin-top: calc(1px * var(--s));
}

.fpl-actions {
  border-top: calc(1px * var(--s)) solid #555;
}

.fpl-btn {
  width: 100%;
  padding: calc(8px * var(--s)) 0;
  border: none;
  background: #555;
  color: #ccc;
  font-size: calc(12px * var(--s));
  font-weight: bold;
  cursor: pointer;
  letter-spacing: calc(0.5px * var(--s));
  min-height: max(32px, calc(32px * var(--s)));
}

.fpl-btn:hover {
  background: #666;
}
</style>

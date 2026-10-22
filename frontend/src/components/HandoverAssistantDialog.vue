<template>
  <v-dialog
    :model-value="modelValue"
    max-width="520"
    scrim
    content-class="handover-assistant-dialog-wrap"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="efs-popup-menu efs-popup-menu--wide handover-assistant-dialog" @click.stop>
      <div class="efs-popup-header">Handover Assistant</div>
      <p class="handover-assistant-hint">
        Transfer {{ assumedCount }} assumed strip{{ assumedCount === 1 ? '' : 's' }} to:
      </p>
      <div v-if="sortedControllers.length === 0" class="handover-assistant-empty">
        No other ES* controllers online
      </div>
      <div v-else class="efs-popup-list handover-assistant-list">
        <button
          v-for="ctrl in sortedControllers"
          :key="ctrl.callsign"
          type="button"
          class="efs-popup-item efs-popup-item--stack"
          :class="{ 'is-preferred': ctrl.preferred }"
          :disabled="submitting"
          @click="onSelect(ctrl.callsign)"
        >
          <span class="efs-popup-item-title">
            <template v-if="ctrl.positionId">{{ ctrl.positionId }} · </template>{{ ctrl.callsign }}
          </span>
          <span class="efs-popup-item-sub transfer-freq">
            {{ ctrl.frequency }}
            <span v-if="ctrl.preferred" class="handover-preferred-tag">primary</span>
          </span>
        </button>
      </div>

      <button
        type="button"
        class="handover-how-toggle"
        :aria-expanded="showHow"
        @click="showHow = !showHow"
      >
        <span class="handover-how-arrow" :class="{ 'is-open': showHow }" aria-hidden="true" />
        How it works
      </button>
      <div v-if="showHow" class="handover-how">
        <div class="handover-how-col">
          <div class="handover-how-role">Relieved</div>
          <ul class="handover-how-list">
            <li>Unprime keeps your strips visible</li>
            <li>Auto-opens on unprime after ≥5 min primed (or open from the main menu)</li>
            <li>Pick an ES* target to transfer strips you assume</li>
            <li>Partial failures are toasted</li>
          </ul>
        </div>
        <div class="handover-how-col">
          <div class="handover-how-role">Relieving</div>
          <ul class="handover-how-list">
            <li>Settings → Handover Assistant: auto-assume (on by default)</li>
            <li>HA-marked transfers (EFSHO) are auto-ASSUMEd when they target you</li>
          </ul>
        </div>
      </div>

      <div class="handover-assistant-actions">
        <button
          type="button"
          class="efs-popup-footer"
          :disabled="submitting"
          @click="emit('update:modelValue', false)"
        >Cancel</button>
      </div>
    </div>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useEfsStore } from '@/store/efs'

const props = defineProps<{
  modelValue: boolean
  /** Primed primary frequency (MHz) before unprime — prefer matching targets */
  preferredFrequency?: number
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const store = useEfsStore()
const submitting = ref(false)
const showHow = ref(false)

const assumedCount = computed(() => {
  let n = 0
  for (const s of store.strips.values()) {
    if (s.isAssumed && s.stripType !== 'note' && s.stripType !== 'vehicle') n++
  }
  return n
})

function freqClose(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.005
}

function parseCtrlFreq(freq: string): number | undefined {
  const n = parseFloat(freq)
  return Number.isFinite(n) ? n : undefined
}

/** Handover Assistant targets: Swedish login callsigns only (ES*) */
function isEsLoginCallsign(callsign: string): boolean {
  return callsign.trim().toUpperCase().startsWith('ES')
}

const sortedControllers = computed(() => {
  const pref = props.preferredFrequency
  const list = store.controllers
    .filter((c) => isEsLoginCallsign(c.callsign))
    .map((c) => {
      const f = parseCtrlFreq(c.frequency)
      const preferred = pref != null && f != null && freqClose(f, pref)
      return { ...c, preferred, _freq: f ?? 999 }
    })
  list.sort((a, b) => {
    if (a.preferred !== b.preferred) return a.preferred ? -1 : 1
    return a.callsign.localeCompare(b.callsign)
  })
  return list
})

watch(
  () => props.modelValue,
  (open) => {
    if (open) submitting.value = false
  },
)

function onSelect(targetCallsign: string) {
  if (submitting.value) return
  if (assumedCount.value === 0) {
    store.showNotify('Handover Assistant: no assumed strips to transfer', 'info')
    emit('update:modelValue', false)
    return
  }
  submitting.value = true
  store.handoverAssistantTransfer(targetCallsign)
  emit('update:modelValue', false)
}
</script>

<style scoped>
.handover-assistant-dialog {
  padding-bottom: 4px;
}
.handover-assistant-hint {
  margin: 0 12px 8px;
  font-size: 12px;
  font-weight: 600;
  color: #333;
}
.handover-assistant-empty {
  margin: 8px 12px 16px;
  font-size: 13px;
  font-weight: 600;
  color: #555;
}
.handover-assistant-list {
  max-height: min(50vh, 360px);
  overflow-y: auto;
}
.handover-assistant-actions {
  display: flex;
  justify-content: flex-end;
  border-top: 1px solid #888;
  margin-top: 4px;
}
.efs-popup-item.is-preferred .efs-popup-item-title {
  color: #b45309;
}
.handover-preferred-tag {
  margin-left: 6px;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #b45309;
  font-weight: 700;
}

.handover-how-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  margin: 0;
  padding: 8px 12px;
  border: none;
  border-top: 1px solid #888;
  appearance: none;
  background: #c8c8c8;
  color: #000;
  font: inherit;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  cursor: pointer;
  text-align: left;
}
.handover-how-toggle:hover {
  background: #bcbcbc;
}
.handover-how-arrow {
  display: inline-block;
  width: 0;
  height: 0;
  border-left: 4px solid transparent;
  border-right: 4px solid transparent;
  border-top: 5px solid #333;
  transition: transform 0.12s ease;
}
.handover-how-arrow.is-open {
  transform: rotate(180deg);
}
.handover-how {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px 14px;
  padding: 8px 12px 12px;
  background: #d0d0d0;
  border-top: 1px solid #888;
}
.handover-how-role {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #000;
  margin-bottom: 4px;
}
.handover-how-list {
  margin: 0;
  padding-left: 1.1em;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.35;
  color: #222;
}
.handover-how-list li + li {
  margin-top: 3px;
}

@media (max-width: 420px) {
  .handover-how {
    grid-template-columns: 1fr;
  }
}
</style>

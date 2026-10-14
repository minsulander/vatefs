<template>
  <v-dialog
    v-model="dialogOpen"
    max-width="280"
    content-class="coord-proposal-dialog-wrapper"
    @click:outside="onClose"
  >
    <div class="efs-popup-menu efs-popup-menu--wide coord-proposal-dialog" @click.stop>
      <div class="efs-popup-header">COORD PROPOSAL</div>
      <div class="efs-popup-subheader coord-proposal-subheader">
        <span class="coord-proposal-callsign">{{ strip.callsign }}</span>
      </div>

      <div class="efs-popup-list coord-proposal-fields">
        <div class="efs-popup-item clnc-field-row is-disabled">
          <span class="clnc-field-label">{{ levelLabel }}</span>
          <span class="clnc-field-value">{{ xflDisplay || '—' }}</span>
        </div>
        <div class="efs-popup-item clnc-field-row is-disabled">
          <span class="clnc-field-label">POINT</span>
          <span class="clnc-field-value">{{ pointDisplay || '—' }}</span>
        </div>
      </div>

      <div class="clnc-actions clnc-actions-2">
        <button type="button" class="efs-popup-footer clnc-action" @click="onReject">REJECT</button>
        <button type="button" class="efs-popup-footer clnc-action" @click="onAccept">ACCEPT</button>
      </div>
    </div>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { FlightStrip } from '@vatefs/common'
import { useEfsStore } from '@/store/efs'

const props = defineProps<{
  modelValue: boolean
  strip: FlightStrip
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const store = useEfsStore()

const dialogOpen = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})

function formatXflToken(feet: number | undefined): string {
  if (feet == null || feet <= 0) return ''
  return 'FL' + String(Math.round(feet / 100)).padStart(3, '0')
}

/** ARR proposals use PEL; DEP/local keep XFL. */
const levelLabel = computed(() =>
  props.strip.stripType === 'arrival' ? 'PEL' : 'XFL',
)

const xflDisplay = computed(() => formatXflToken(props.strip.exitCoordAltitude))

const pointDisplay = computed(() => (props.strip.exitCoordPoint || '').trim().toUpperCase())

function onAccept() {
  store.acceptCoordination(props.strip.id)
  dialogOpen.value = false
}

function onReject() {
  store.refuseCoordination(props.strip.id)
  dialogOpen.value = false
}

function onClose() {
  dialogOpen.value = false
}
</script>

<style>
/* Teleported dialog — match DepCoordDialog / ClearanceDialog chrome */
.coord-proposal-dialog-wrapper {
  box-shadow: none !important;
  background: transparent !important;
}

.coord-proposal-dialog {
  --s: var(--efs-scale, 1);
  position: relative;
  width: 100%;
  max-width: min(92vw, calc(280px * var(--s)));
}

.coord-proposal-subheader {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: calc(4px * var(--s));
}

.coord-proposal-callsign {
  font-size: calc(13px * var(--s));
  font-weight: 800;
  letter-spacing: 0.3px;
  text-transform: uppercase;
}

.coord-proposal-fields {
  max-height: none;
}

.coord-proposal-dialog .clnc-field-row {
  justify-content: space-between;
  gap: calc(10px * var(--s));
  text-align: left;
}

.coord-proposal-dialog .clnc-field-label {
  flex: 0 0 auto;
  min-width: calc(48px * var(--s));
  font-size: calc(10px * var(--s));
  font-weight: 800;
  letter-spacing: 0.12em;
  color: #333;
  text-align: left;
}

.coord-proposal-dialog .clnc-field-value {
  flex: 1 1 auto;
  min-width: 0;
  font-size: calc(12px * var(--s));
  font-weight: 800;
  letter-spacing: 0.3px;
  text-align: right;
  text-transform: uppercase;
}

.coord-proposal-dialog .clnc-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  border-top: 3px solid #333;
}

.coord-proposal-dialog .clnc-actions-2 {
  grid-template-columns: 1fr 1fr;
}

.coord-proposal-dialog .clnc-action {
  min-height: max(32px, calc(32px * var(--s)));
}
</style>

<template>
  <v-dialog
    v-model="dialogOpen"
    max-width="260"
    content-class="atd-dialog-wrapper"
    @click:outside="onCancel"
  >
    <div class="efs-popup-menu efs-popup-menu--wide atd-dialog" @click.stop>
      <div class="efs-popup-header">ATD</div>
      <div class="efs-popup-subheader atd-subheader">
        <span class="atd-callsign">{{ strip.callsign }}</span>
      </div>

      <div class="efs-popup-list atd-fields">
        <div class="efs-popup-item clnc-field-row atd-field">
          <span class="clnc-field-label">ATD</span>
          <input
            ref="atdInputEl"
            v-model="atdEdit"
            class="atd-input"
            :class="{ invalid: atdEdit.length > 0 && !atdValid }"
            type="text"
            inputmode="numeric"
            maxlength="5"
            placeholder="HHMM"
            spellcheck="false"
            autocomplete="off"
            title="Actual time of departure (UTC)"
            @input="onAtdInput"
            @keydown.enter.prevent="onOk"
            @keydown.escape.prevent="onCancel"
          />
        </div>
      </div>

      <div class="clnc-actions clnc-actions-2">
        <button type="button" class="efs-popup-footer clnc-action" @click="onCancel">Cancel</button>
        <button
          type="button"
          class="efs-popup-footer clnc-action"
          :disabled="!atdValid"
          @click="onOk"
        >OK</button>
      </div>
    </div>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { FlightStrip } from '@vatefs/common'
import { useEfsStore } from '@/store/efs'

const props = defineProps<{
  modelValue: boolean
  strip: FlightStrip
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  /** Fired after ATD is accepted — parent applies DEP (CTO). */
  confirm: [atd: string]
}>()

const store = useEfsStore()

const dialogOpen = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})

const atdInputEl = ref<HTMLInputElement | null>(null)
const atdEdit = ref('')
const atdValid = computed(() => parseAtdHhmm(atdEdit.value) != null)

function utcNowHhmm(): string {
  const d = new Date()
  return `${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}`
}

function formatHhmmColon(hhmm: string): string {
  const digits = hhmm.replace(/\D/g, '').slice(0, 4)
  if (digits.length !== 4) return digits
  return `${digits.slice(0, 2)}:${digits.slice(2)}`
}

/** Accept `1430` or `14:30` → canonical HHMM, or null. */
function parseAtdHhmm(text: string): string | null {
  const digits = text.replace(/\D/g, '')
  if (digits.length !== 4) return null
  const h = Number(digits.slice(0, 2))
  const m = Number(digits.slice(2))
  if (!Number.isFinite(h) || !Number.isFinite(m) || h > 23 || m > 59) return null
  return digits
}

function onAtdInput() {
  const digits = atdEdit.value.replace(/\D/g, '').slice(0, 4)
  atdEdit.value = formatHhmmColon(digits)
}

function seedText() {
  const raw = props.strip.atd || utcNowHhmm()
  const digits = raw.replace(/\D/g, '').slice(0, 4)
  atdEdit.value = formatHhmmColon(digits.length === 4 ? digits : utcNowHhmm())
}

function focusInput() {
  nextTick(() => {
    requestAnimationFrame(() => {
      const el = atdInputEl.value
      if (!el) return
      el.focus()
      el.select()
    })
  })
}

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    seedText()
    focusInput()
  },
)

function onOk() {
  const atd = parseAtdHhmm(atdEdit.value)
  if (!atd) return
  store.setAtd(props.strip.id, atd)
  emit('confirm', atd)
  dialogOpen.value = false
}

function onCancel() {
  dialogOpen.value = false
}
</script>

<style>
/* Teleported dialog — match DepCoordDialog / ClearanceDialog chrome */
.atd-dialog-wrapper {
  box-shadow: none !important;
  background: transparent !important;
}

.atd-dialog {
  --s: var(--efs-scale, 1);
  position: relative;
  width: 100%;
  max-width: min(92vw, calc(260px * var(--s)));
}

.atd-subheader {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: calc(4px * var(--s));
}

.atd-callsign {
  font-size: calc(13px * var(--s));
  font-weight: 800;
  letter-spacing: 0.3px;
  text-transform: uppercase;
}

.atd-fields {
  max-height: none;
}

.atd-field {
  cursor: default;
}

.atd-input {
  width: 5em;
  margin: 0;
  padding: calc(2px * var(--s)) calc(4px * var(--s));
  border: 1px solid #888;
  border-radius: 0;
  background: #ebebeb;
  color: #000;
  font: inherit;
  font-weight: 700;
  text-align: center;
  text-transform: uppercase;
  outline: none;
}

.atd-input:focus {
  border-color: #555;
  background: #fff;
}

.atd-input.invalid {
  border-color: #c44;
  color: #a00;
}

.atd-dialog .clnc-field-row {
  justify-content: space-between;
  gap: calc(10px * var(--s));
  text-align: left;
}

.atd-dialog .clnc-field-label {
  flex: 0 0 auto;
  min-width: calc(48px * var(--s));
  font-size: calc(10px * var(--s));
  font-weight: 800;
  letter-spacing: 0.12em;
  color: #333;
  text-align: left;
}

.atd-dialog .clnc-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  border-top: 3px solid #333;
}

.atd-dialog .clnc-actions-2 {
  grid-template-columns: 1fr 1fr;
}

.atd-dialog .clnc-action {
  min-height: max(32px, calc(32px * var(--s)));
}

.atd-dialog .clnc-action:disabled {
  opacity: 0.4;
  cursor: default;
}
</style>

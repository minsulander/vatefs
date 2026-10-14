<template>
  <v-dialog
    v-model="dialogOpen"
    max-width="260"
    content-class="tsac-dialog-wrapper"
    @click:outside="onCancel"
  >
    <div class="efs-popup-menu efs-popup-menu--wide tsac-dialog" @click.stop>
      <div class="efs-popup-header">TSAC</div>
      <div class="efs-popup-subheader tsac-subheader">
        <span class="tsac-callsign">{{ strip.callsign }}</span>
        <span v-if="tsatHint" class="tsac-hint">TSAT {{ tsatHint }}</span>
      </div>

      <div class="efs-popup-list tsac-fields">
        <div class="efs-popup-item clnc-field-row tsac-field">
          <span class="clnc-field-label">TSAC</span>
          <input
            ref="tsacInputEl"
            v-model="tsacEdit"
            class="tsac-input"
            :class="{ invalid: tsacEdit.length > 0 && !tsacValid }"
            type="text"
            inputmode="numeric"
            maxlength="5"
            placeholder="HHMM"
            spellcheck="false"
            autocomplete="off"
            title="TSAT communicated to pilot (UTC)"
            @input="onTsacInput"
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
          :disabled="!tsacValid"
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
  /** Prefill (usually current TSAC or live TSAT) */
  initial?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const store = useEfsStore()

const dialogOpen = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})

const tsacInputEl = ref<HTMLInputElement | null>(null)
const tsacEdit = ref('')
const tsacValid = computed(() => parseHhmm(tsacEdit.value) != null)

const tsatHint = computed(() => {
  const raw = (props.strip.tsat || '').replace(/\D/g, '').slice(0, 4)
  return raw.length === 4 ? raw : ''
})

function formatHhmmColon(hhmm: string): string {
  const digits = hhmm.replace(/\D/g, '').slice(0, 4)
  if (digits.length !== 4) return digits
  return `${digits.slice(0, 2)}:${digits.slice(2)}`
}

/** Accept `1430` or `14:30` → canonical HHMM, or null. */
function parseHhmm(text: string): string | null {
  const digits = text.replace(/\D/g, '')
  if (digits.length !== 4) return null
  const h = Number(digits.slice(0, 2))
  const m = Number(digits.slice(2))
  if (!Number.isFinite(h) || !Number.isFinite(m) || h > 23 || m > 59) return null
  return digits
}

function onTsacInput() {
  const digits = tsacEdit.value.replace(/\D/g, '').slice(0, 4)
  tsacEdit.value = formatHhmmColon(digits)
}

function seedText() {
  const raw = (props.initial || props.strip.tsac || props.strip.tsat || '').replace(/\D/g, '').slice(0, 4)
  tsacEdit.value = formatHhmmColon(raw.length === 4 ? raw : '')
}

function focusInput() {
  nextTick(() => {
    requestAnimationFrame(() => {
      const el = tsacInputEl.value
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
  const tsac = parseHhmm(tsacEdit.value)
  if (!tsac) return
  store.setTsac(props.strip.id, tsac)
  dialogOpen.value = false
}

function onCancel() {
  dialogOpen.value = false
}
</script>

<style>
/* Teleported dialog — match AtdDialog / ClearanceDialog chrome */
.tsac-dialog-wrapper {
  box-shadow: none !important;
  background: transparent !important;
}

.tsac-dialog {
  --s: var(--efs-scale, 1);
  position: relative;
  width: 100%;
  max-width: min(92vw, calc(260px * var(--s)));
}

.tsac-subheader {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: calc(4px * var(--s));
}

.tsac-callsign {
  font-size: calc(13px * var(--s));
  font-weight: 800;
  letter-spacing: 0.3px;
  text-transform: uppercase;
}

.tsac-hint {
  font-size: calc(10px * var(--s));
  font-weight: 700;
  letter-spacing: 0.08em;
  color: #555;
}

.tsac-fields {
  max-height: none;
}

.tsac-field {
  cursor: default;
}

.tsac-input {
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

.tsac-input:focus {
  border-color: #555;
  background: #fff;
}

.tsac-input.invalid {
  border-color: #c44;
  color: #a00;
}

.tsac-dialog .clnc-field-row {
  justify-content: space-between;
  gap: calc(10px * var(--s));
  text-align: left;
}

.tsac-dialog .clnc-field-label {
  flex: 0 0 auto;
  min-width: calc(48px * var(--s));
  font-size: calc(10px * var(--s));
  font-weight: 800;
  letter-spacing: 0.12em;
  color: #333;
  text-align: left;
}

.tsac-dialog .clnc-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  border-top: 3px solid #333;
}

.tsac-dialog .clnc-actions-2 {
  grid-template-columns: 1fr 1fr;
}

.tsac-dialog .clnc-action {
  min-height: max(32px, calc(32px * var(--s)));
}

.tsac-dialog .clnc-action:disabled {
  opacity: 0.4;
  cursor: default;
}
</style>

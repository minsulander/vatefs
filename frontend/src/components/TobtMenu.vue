<template>
  <v-menu
    :model-value="modelValue"
    :target="target"
    location="center"
    origin="center center"
    :z-index="zIndex"
    :close-on-content-click="false"
    @update:model-value="onModelUpdate"
  >
    <div class="tobt-menu" @click.stop>
      <button type="button" class="tobt-menu-top" title="Close" @click="closeMenu">
        <div class="tobt-menu-header">{{ kindLabel }}</div>
        <div class="tobt-menu-callsign">{{ strip.callsign }}</div>
      </button>
      <div class="tobt-menu-manual" @click.stop>
        <input
          ref="manualInput"
          v-model="manualText"
          class="tobt-menu-manual-input"
          :class="{ invalid: manualText.length > 0 && !manualValid }"
          type="text"
          inputmode="numeric"
          maxlength="5"
          placeholder="HHMM / HH:MM"
          spellcheck="false"
          autocomplete="off"
          @input="onManualInput"
          @keydown.enter.prevent="onReady"
          @keydown.escape.prevent="closeMenu"
        />
      </div>
      <div class="tobt-menu-actions">
        <button
          type="button"
          class="tobt-menu-item"
          :disabled="!manualValid"
          @click="onSetOnly"
        >{{ setLabel }}</button>
        <button
          type="button"
          class="tobt-menu-item tobt-menu-ready"
          @click="onReady"
        >{{ readyLabel }}</button>
        <button
          v-if="kind === 'tobt'"
          type="button"
          class="tobt-menu-item"
          :class="{
            'tobt-menu-pm-sent': strip.cdmInformed,
            'tobt-menu-pm-blink': store.isPmBlinking('cdmPm', strip.callsign),
          }"
          :title="cdmPmTitle"
          @click="onSendCdmPm"
        >{{ cdmPmLabel }}</button>
      </div>
    </div>
  </v-menu>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { FlightStrip } from '@/types/efs'
import { useEfsStore } from '@/store/efs'
import { focusPopupInput } from '@/composables/focusPopupInput'

export type TobtMenuKind = 'tobt' | 'eobt'

const props = withDefaults(
  defineProps<{
    modelValue: boolean
    strip: FlightStrip
    target: [number, number]
    /** TOBT (CDM) or EOBT (SAAB EFS-wide) */
    kind?: TobtMenuKind
    zIndex?: number
  }>(),
  { kind: 'tobt', zIndex: 2600 },
)

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const store = useEfsStore()
const manualInput = ref<HTMLInputElement | null>(null)
const manualText = ref('')
const manualValid = computed(() => parseTobtHhmm(manualText.value) != null)
let ignoreCloseUntil = 0

const kindLabel = computed(() => (props.kind === 'eobt' ? 'EOBT' : 'TOBT'))
const setLabel = computed(() => (props.kind === 'eobt' ? 'Set EOBT' : 'Set TOBT'))
const readyLabel = computed(() => (props.kind === 'eobt' ? 'Ready EOBT' : 'Ready TOBT'))
const cdmPmLabel = computed(() =>
  props.strip.cdmInformed ? 'Resend CDM PM ✓' : 'Send CDM PM',
)
const cdmPmTitle = computed(() =>
  props.strip.cdmInformed
    ? 'vIFF CDM PM already sent — click to resend (needs ES window focus)'
    : 'EuroScope .msg CDM flow PM (needs ES window focus)',
)

function utcNowHhmm(): string {
  const d = new Date()
  return `${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}`
}

/** Display HHMM as HH:MM (colon only when we have a full time). */
function formatHhmmColon(hhmm: string): string {
  const digits = hhmm.replace(/\D/g, '').slice(0, 4)
  if (digits.length !== 4) return digits
  return `${digits.slice(0, 2)}:${digits.slice(2)}`
}

/**
 * Accept `1430` or `14:30` (and loose digit/colon mixtures with exactly 4 digits).
 * Returns canonical HHMM or null if incomplete/invalid.
 */
function parseTobtHhmm(text: string): string | null {
  const digits = text.replace(/\D/g, '')
  if (digits.length !== 4) return null
  const h = Number(digits.slice(0, 2))
  const m = Number(digits.slice(2))
  if (!Number.isFinite(h) || !Number.isFinite(m) || h > 23 || m > 59) return null
  return digits
}

function seedText() {
  const raw =
    props.kind === 'eobt'
      ? props.strip.eobt || utcNowHhmm()
      : props.strip.tobt || props.strip.eobt || utcNowHhmm()
  const digits = raw.replace(/\D/g, '').slice(0, 4)
  manualText.value = formatHhmmColon(digits.length === 4 ? digits : utcNowHhmm())
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      ignoreCloseUntil = Date.now() + 450
      seedText()
      focusPopupInput(() => manualInput.value)
    }
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

/** Digits freely; optional single colon — never force `:` while typing. */
function onManualInput() {
  const raw = manualText.value
  const hasColon = raw.includes(':')
  if (!hasColon) {
    manualText.value = raw.replace(/\D/g, '').slice(0, 4)
    return
  }
  const [pre = '', ...rest] = raw.split(':')
  const hh = pre.replace(/\D/g, '').slice(0, 2)
  const mm = rest.join('').replace(/\D/g, '').slice(0, 2)
  // Keep a trailing colon while the user is still typing minutes
  if (mm.length === 0 && (raw.endsWith(':') || rest.length > 0)) {
    manualText.value = `${hh}:`
    return
  }
  manualText.value = `${hh}:${mm}`
}

function onSetOnly() {
  const value = parseTobtHhmm(manualText.value)
  if (!value) return
  closeMenu()
  if (props.kind === 'eobt') {
    if (value !== (props.strip.eobt || '')) {
      store.viffUpdateEobt(props.strip.id, value)
    }
    return
  }
  if (value !== (props.strip.tobt || props.strip.eobt || '')) {
    store.viffUpdateTobt(props.strip.id, value)
  }
}

/** Ready TOBT = now then REA (server). Ready EOBT = EOBT now (UTC HHMM). */
function onReady() {
  closeMenu()
  if (props.kind === 'eobt') {
    store.viffUpdateEobt(props.strip.id, utcNowHhmm())
    return
  }
  store.viffReadyTobt(props.strip.id)
}

/** Brittle: plugin types `.msg CS <CDMconfig PrivateMessage>` + DPI INFORMED/1 */
function onSendCdmPm() {
  closeMenu()
  if (store.isPmOnCooldown('cdmPm', props.strip.callsign)) return
  store.sendStripAction(props.strip.id, 'CDM_PM')
}
</script>

<style scoped>
.tobt-menu {
  --s: var(--efs-scale, 1);
  width: calc(120px * var(--s));
  min-width: calc(120px * var(--s));
  max-width: min(92vw, calc(140px * var(--s)));
  background: #d8d8d8;
  border: 1px solid #888;
  border-radius: 0;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
  color: #000;
  font-family: system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  overflow: hidden;
}

.tobt-menu-top {
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

.tobt-menu-top:hover {
  background: #b0b0b0;
}

.tobt-menu-header {
  padding: calc(6px * var(--s)) calc(8px * var(--s)) calc(2px * var(--s));
  font-size: calc(9px * var(--s));
  font-weight: 800;
  letter-spacing: 0.12em;
  color: #000;
  text-transform: uppercase;
  text-align: center;
  background: #c0c0c0;
}

.tobt-menu-callsign {
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

.tobt-menu-manual {
  padding: calc(6px * var(--s)) calc(8px * var(--s));
  background: #c8c8c8;
}

.tobt-menu-manual-input {
  display: block;
  width: 100%;
  box-sizing: border-box;
  margin: 0;
  padding: calc(5px * var(--s)) calc(6px * var(--s));
  border: 1px solid #666;
  border-radius: 0;
  background: #fff;
  color: #000;
  font-size: calc(13px * var(--s));
  font-weight: 700;
  letter-spacing: 0.5px;
  text-align: center;
  text-transform: uppercase;
  font-family: inherit;
  outline: none;
}

.tobt-menu-manual-input:focus {
  border-color: #1a3a6e;
  box-shadow: inset 0 0 0 1px #1a3a6e;
}

.tobt-menu-manual-input.invalid {
  border-color: #a30;
  color: #800;
}

.tobt-menu-manual-input::placeholder {
  color: #888;
  font-weight: 600;
  text-transform: none;
  letter-spacing: 0;
  font-size: calc(10px * var(--s));
}

.tobt-menu-actions {
  display: flex;
  flex-direction: column;
  background: #d8d8d8;
  border-top: 3px solid #333;
}

.tobt-menu-item {
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
  font-size: calc(11px * var(--s));
  font-weight: 700;
  letter-spacing: 0.3px;
  text-transform: uppercase;
  text-align: center;
  cursor: pointer;
  line-height: 1.1;
  white-space: nowrap;
  min-height: max(28px, calc(28px * var(--s)));
}

.tobt-menu-item:last-child {
  border-bottom: none;
}

.tobt-menu-item:hover:not(:disabled) {
  background: #1a3a6e;
  color: #fff;
}

.tobt-menu-item:disabled {
  opacity: 0.45;
  cursor: default;
}

.tobt-menu-ready:not(:disabled) {
  background: #c8e6c8;
}

.tobt-menu-ready:hover:not(:disabled) {
  background: #1a6e3a;
  color: #fff;
}

.tobt-menu-pm-sent:not(:disabled) {
  background: #c8e6c8;
  color: #0a2a0a;
}

.tobt-menu-pm-sent:hover:not(:disabled) {
  background: #1a6e3a;
  color: #fff;
}

/* CDM PM success: orange flash on the label only */
.tobt-menu-pm-blink:not(:disabled) {
  background: inherit !important;
  animation: tobt-pm-text-flash 0.4s ease-in-out 5;
  color: #e67e00 !important;
}

@keyframes tobt-pm-text-flash {
  0%,
  100% {
    color: #e67e00;
    opacity: 1;
  }
  50% {
    color: #ffb347;
    opacity: 0.85;
  }
}
</style>

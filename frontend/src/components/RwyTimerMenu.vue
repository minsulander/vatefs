<template>
  <v-menu
    :model-value="modelValue"
    :target="target"
    location="bottom"
    origin="top center"
    :z-index="zIndex"
    :close-on-content-click="false"
    @update:model-value="onModelUpdate"
  >
    <div class="efs-popup-menu rwy-timer-menu" @click.stop>
      <div class="efs-popup-header">Countdown</div>
      <div class="rwy-timer-menu-body">
        <div class="rwy-timer-menu-presets">
          <button
            type="button"
            class="rwy-timer-menu-preset"
            tabindex="-1"
            title="Start 2:00 countdown"
            @click="onPreset(2)"
          >
            2
          </button>
          <button
            type="button"
            class="rwy-timer-menu-preset"
            tabindex="-1"
            title="Start 3:00 countdown"
            @click="onPreset(3)"
          >
            3
          </button>
          <button
            type="button"
            class="rwy-timer-menu-preset"
            tabindex="-1"
            title="Start 4:00 countdown"
            @click="onPreset(4)"
          >
            4
          </button>
        </div>
        <input
          ref="inputEl"
          v-model="text"
          class="rwy-timer-menu-input"
          :class="{ invalid: text.length > 0 && !valid }"
          type="text"
          inputmode="decimal"
          maxlength="6"
          placeholder="2 / 2.5 / 00:20"
          title="Minutes (2), decimal (2.5 / 2,5), or MM:SS. Seconds: 0020 or 00:20"
          spellcheck="false"
          autocomplete="off"
          @input="onInput"
          @keydown.enter.prevent="onStart"
          @keydown.escape.prevent="close"
        />
        <button
          type="button"
          class="rwy-timer-menu-start"
          tabindex="-1"
          :disabled="!valid"
          @click="onStart"
        >
          Start timer
        </button>
      </div>
    </div>
  </v-menu>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { focusPopupInput } from '@/composables/focusPopupInput'
import { parseRunwayTimerMmSs } from '@/composables/runwaySectionTimers'

const props = withDefaults(
  defineProps<{
    modelValue: boolean
    target: [number, number]
    /** Prefill (e.g. current elapsed as MM:SS) */
    initialText?: string
    zIndex?: number
  }>(),
  { initialText: '00:00', zIndex: 2700 },
)

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  start: [ms: number]
}>()

const inputEl = ref<HTMLInputElement | null>(null)
const text = ref('00:00')
const valid = computed(() => parseRunwayTimerMmSs(text.value) != null)
let ignoreCloseUntil = 0
const focusTimers: number[] = []

function clearFocusTimers() {
  while (focusTimers.length) {
    window.clearTimeout(focusTimers.pop())
  }
}

/** Focus MM:SS after v-menu teleports; delayed retries beat the opening click stealing focus. */
function focusTimeInput() {
  clearFocusTimers()
  focusPopupInput(() => inputEl.value, { attempts: 24 })
  // Opening click/mouseup often returns focus to the runway timer button — re-grab after.
  for (const ms of [50, 120, 220]) {
    focusTimers.push(
      window.setTimeout(() => {
        const el = inputEl.value
        if (!el || !props.modelValue) return
        el.focus({ preventScroll: true })
        el.select()
      }, ms),
    )
  }
}

watch(
  () => props.modelValue,
  (open) => {
    if (!open) {
      clearFocusTimers()
      return
    }
    ignoreCloseUntil = Date.now() + 450
    text.value = props.initialText || '00:00'
    focusTimeInput()
  },
)

function onModelUpdate(v: boolean) {
  if (!v && Date.now() < ignoreCloseUntil) {
    nextTick(() => emit('update:modelValue', true))
    return
  }
  emit('update:modelValue', v)
}

function close() {
  ignoreCloseUntil = 0
  emit('update:modelValue', false)
}

function onInput() {
  // Digits, colon, decimal comma/dot (2.5 / 2,5 minutes)
  text.value = text.value.replace(/[^\d:.,]/g, '').slice(0, 6)
}

function startMs(ms: number) {
  emit('start', ms)
  emit('update:modelValue', false)
}

function onPreset(minutes: number) {
  startMs(minutes * 60 * 1000)
}

function onStart() {
  const ms = parseRunwayTimerMmSs(text.value)
  if (ms == null) return
  startMs(ms)
}
</script>

<style scoped>
.rwy-timer-menu {
  min-width: calc(140px * var(--efs-scale, 1));
}

.rwy-timer-menu-body {
  display: flex;
  flex-direction: column;
  gap: calc(6px * var(--efs-scale, 1));
  padding: calc(8px * var(--efs-scale, 1));
  background: #d8d8d8;
}

.rwy-timer-menu-presets {
  display: flex;
  gap: calc(4px * var(--efs-scale, 1));
}

.rwy-timer-menu-preset {
  flex: 1;
  margin: 0;
  padding: calc(3px * var(--efs-scale, 1)) calc(4px * var(--efs-scale, 1));
  border: 1px solid #555;
  border-radius: 0;
  background: #c8c8c8;
  color: #000;
  font-family: 'Segoe UI', 'Arial', sans-serif;
  font-size: calc(11px * var(--efs-scale, 1));
  font-weight: 700;
  letter-spacing: 0.02em;
  line-height: 1.2;
  cursor: pointer;
  appearance: none;
}

.rwy-timer-menu-preset:hover {
  background: #e0e0e0;
}

.rwy-timer-menu-input {
  box-sizing: border-box;
  width: 100%;
  margin: 0;
  padding: calc(4px * var(--efs-scale, 1)) calc(6px * var(--efs-scale, 1));
  border: 1px solid #666;
  border-radius: 0;
  background: #ebebeb;
  color: #000;
  font-family: 'Segoe UI', 'Arial', sans-serif;
  font-size: calc(14px * var(--efs-scale, 1));
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.04em;
  text-align: center;
}

.rwy-timer-menu-input.invalid {
  border-color: #a44;
  background: #f5e0e0;
}

.rwy-timer-menu-start {
  margin: 0;
  padding: calc(5px * var(--efs-scale, 1)) calc(6px * var(--efs-scale, 1));
  border: 1px solid #555;
  border-radius: 0;
  background: #c8c8c8;
  color: #000;
  font-family: 'Segoe UI', 'Arial', sans-serif;
  font-size: calc(11px * var(--efs-scale, 1));
  font-weight: 700;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  cursor: pointer;
  appearance: none;
}

.rwy-timer-menu-start:hover:not(:disabled) {
  background: #e0e0e0;
}

.rwy-timer-menu-start:disabled {
  color: #9a9a9a;
  cursor: default;
}
</style>

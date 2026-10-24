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
    <div class="ahd-menu" @click.stop>
      <button type="button" class="ahd-menu-top" title="Close" @click="closeMenu">
        <div class="ahd-menu-header">AHD</div>
        <div class="ahd-menu-callsign">{{ strip.callsign }}</div>
      </button>
      <div ref="listEl" class="ahd-menu-list" @scroll.passive="onListScroll">
        <button
          v-for="(opt, i) in headingOptions"
          :key="`${i}-${opt}`"
          type="button"
          class="ahd-menu-item"
          :class="{ selected: opt === currentHeading }"
          :data-ahd="opt"
          :data-copy="Math.floor(i / headingCycle.length)"
          @click="onSelect(opt)"
        >{{ opt }}</button>
      </div>
      <button
        type="button"
        class="ahd-menu-item ahd-menu-llz"
        :class="{ selected: currentHeading === 'LLZ' }"
        @click="onSelect('LLZ')"
      >LLZ</button>
      <div class="ahd-menu-manual" @click.stop>
        <input
          ref="manualInput"
          v-model="manualText"
          class="ahd-menu-manual-input"
          :class="{ invalid: manualText.length > 0 && !manualValid }"
          maxlength="3"
          placeholder=""
          spellcheck="false"
          autocomplete="off"
          inputmode="numeric"
          @input="onManualInput"
          @keydown.enter.prevent="submitManual"
          @keydown.escape.prevent="closeMenu"
        />
      </div>
      <button type="button" class="ahd-menu-clear" @click="onClear">CLEAR</button>
    </div>
  </v-menu>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { FlightStrip } from '@/types/efs'
import { useEfsStore } from '@/store/efs'

const props = withDefaults(
  defineProps<{
    modelValue: boolean
    strip: FlightStrip
    target: [number, number]
    zIndex?: number
  }>(),
  { zIndex: 2600 },
)

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const store = useEfsStore()
const listEl = ref<HTMLElement | null>(null)
const manualInput = ref<HTMLInputElement | null>(null)
const manualText = ref('')
let ignoreCloseUntil = 0
/** Guard while adjusting scrollTop for wrap (avoid re-entry). */
let wrappingScroll = false

/** 005…360 step 5 — one full circle */
const headingCycle = (() => {
  const opts: string[] = []
  for (let h = 5; h <= 360; h += 5) {
    opts.push(String(h).padStart(3, '0'))
  }
  return opts
})()

/** Triple list so scroll wraps through a full 360° both up and down */
const HEADING_COPIES = 3
const headingOptions = Array.from({ length: HEADING_COPIES }, () => headingCycle).flat()

const currentHeading = computed(() => (props.strip.assignedHeading || '').trim())

/** 1–360; "20" / "020" / "5" all valid (padded on submit). */
const manualValid = computed(() => parseManualHeading(manualText.value) != null)

function focusManualInput() {
  nextTick(() => {
    requestAnimationFrame(() => {
      const el = manualInput.value
      if (!el) return
      el.focus()
      el.select()
    })
  })
}

watch(
  () => props.modelValue,
  async (open) => {
    if (open) {
      ignoreCloseUntil = Date.now() + 450
      manualText.value = ''
      nextTick(() => {
        scrollToSelected()
        focusManualInput()
      })
    } else {
      manualText.value = ''
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

function cycleScrollHeight(container: HTMLElement): number {
  return container.scrollHeight / HEADING_COPIES
}

/** Keep scroll in the middle copy so the list wraps endlessly both ways. */
function onListScroll() {
  const container = listEl.value
  if (!container || wrappingScroll) return
  const h = cycleScrollHeight(container)
  if (h <= 0) return
  if (container.scrollTop < h * 0.5) {
    wrappingScroll = true
    container.scrollTop += h
    wrappingScroll = false
  } else if (container.scrollTop >= h * 1.5) {
    wrappingScroll = true
    container.scrollTop -= h
    wrappingScroll = false
  }
}

function scrollToSelected() {
  const container = listEl.value
  if (!container) return
  // Prefer middle copy so wrap room exists above and below
  const hdg = currentHeading.value || '180'
  const mid =
    (container.querySelector(`[data-copy="1"][data-ahd="${hdg}"]`) as HTMLElement | null) ||
    (container.querySelector('[data-copy="1"][data-ahd="180"]') as HTMLElement | null)
  mid?.scrollIntoView({ block: 'center' })
  // Re-center into middle band after layout
  nextTick(() => onListScroll())
}

function onManualInput() {
  manualText.value = manualText.value.replace(/\D/g, '').slice(0, 3)
}

/** Parse 1–3 digit entry → padded heading (20 → 020). */
function parseManualHeading(text: string): string | null {
  const digits = text.replace(/\D/g, '')
  if (!digits) return null
  const n = parseInt(digits, 10)
  if (!Number.isFinite(n) || n < 1 || n > 360) return null
  return String(n).padStart(3, '0')
}

function onSelect(value: string) {
  store.applyAssignedHeading(props.strip.id, value)
  closeMenu()
}

function submitManual() {
  const padded = parseManualHeading(manualText.value)
  if (!padded) return
  store.applyAssignedHeading(props.strip.id, padded)
  closeMenu()
}

function onClear() {
  store.applyAssignedHeading(props.strip.id, '')
  closeMenu()
}
</script>

<style scoped>
.ahd-menu {
  --ahd-strip-white: #ebebeb;
  --s: var(--efs-scale, 1);
  width: calc(88px * var(--s));
  min-width: calc(88px * var(--s));
  max-width: min(92vw, calc(100px * var(--s)));
  background: #d8d8d8;
  border: 1px solid #888;
  border-radius: 0;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
  color: #000;
  font-family: system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  overflow: hidden;
}

.ahd-menu-top {
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

.ahd-menu-top:hover {
  background: #b0b0b0;
}

.ahd-menu-header {
  padding: calc(6px * var(--s)) calc(8px * var(--s)) calc(2px * var(--s));
  font-size: calc(9px * var(--s));
  font-weight: 800;
  letter-spacing: 0.12em;
  color: #000;
  text-transform: uppercase;
  text-align: center;
  background: #c0c0c0;
}

.ahd-menu-callsign {
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

.ahd-menu-llz {
  border-top: 2px solid #555;
  border-bottom: 2px solid #555;
}

.ahd-menu-list {
  display: flex;
  flex-direction: column;
  background: #d8d8d8;
  max-height: min(40vh, calc(280px * var(--s)));
  overflow-y: auto;
  overscroll-behavior: contain;
}

.ahd-menu-item {
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
  font-size: calc(12px * var(--s));
  font-weight: 700;
  letter-spacing: 0.3px;
  font-variant-numeric: tabular-nums;
  text-transform: uppercase;
  text-align: center;
  cursor: pointer;
  line-height: 1.1;
  white-space: nowrap;
  min-height: max(28px, calc(28px * var(--s)));
}

.ahd-menu-list .ahd-menu-item:last-child {
  border-bottom: none;
}

.ahd-menu-item.selected {
  background: var(--ahd-strip-white);
  color: #1a3a6e;
  box-shadow: inset 0 0 0 2px #1a3a6e;
}

.ahd-menu-item:hover {
  background: #1a3a6e;
  color: var(--ahd-strip-white);
  box-shadow: inset 0 0 0 2px #000;
  position: relative;
  z-index: 1;
}

.ahd-menu-manual {
  padding: calc(6px * var(--s)) calc(8px * var(--s));
  background: #c8c8c8;
  border-top: 3px solid #333;
}

.ahd-menu-manual-input {
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
  font-variant-numeric: tabular-nums;
  font-family: inherit;
  outline: none;
}

.ahd-menu-manual-input:focus {
  border-color: #1a3a6e;
  box-shadow: inset 0 0 0 1px #1a3a6e;
}

.ahd-menu-manual-input.invalid {
  border-color: #a30;
  color: #800;
}

.ahd-menu-clear {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  margin: 0;
  padding: calc(10px * var(--s)) calc(8px * var(--s));
  border: none;
  border-top: 3px solid #333;
  border-radius: 0;
  appearance: none;
  -webkit-appearance: none;
  background: #a8a8a8;
  color: #000;
  font-size: calc(12px * var(--s));
  font-weight: 800;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  cursor: pointer;
  line-height: 1.1;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.35);
  min-height: max(32px, calc(32px * var(--s)));
}

.ahd-menu-clear:hover {
  background: #1a3a6e;
  color: var(--ahd-strip-white);
  box-shadow: inset 0 0 0 2px #000;
}
</style>

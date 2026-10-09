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
    <div class="cfl-menu" @click.stop>
      <button type="button" class="cfl-menu-top" title="Close" @click="closeMenu">
        <div class="cfl-menu-header">CFL</div>
        <div class="cfl-menu-callsign">{{ strip.callsign }}</div>
      </button>
      <div ref="listEl" class="cfl-menu-list">
        <button
          v-for="opt in cflOptions"
          :key="opt.value"
          type="button"
          class="cfl-menu-item"
          :class="{ selected: isLevelSelected(opt) }"
          :data-cfl="opt.value"
          @click="onSelectLevel(opt.value)"
        >{{ opt.label }}</button>
      </div>

      <div class="cfl-menu-app">
        <button
          type="button"
          class="cfl-menu-item cfl-menu-app-item"
          :class="{ selected: isAppSelected('CA') }"
          @click="onSelectApp('CA')"
        >CA</button>
        <button
          type="button"
          class="cfl-menu-item cfl-menu-app-item"
          :class="{ selected: isAppSelected('VA') }"
          @click="onSelectApp('VA')"
        >VA</button>
        <button
          type="button"
          class="cfl-menu-item cfl-menu-app-item"
          :class="{ selected: isAppSelected('OS') }"
          @click="onSelectApp('OS')"
        >OS</button>
        <button
          v-for="app in customAppClrTypes"
          :key="app"
          type="button"
          class="cfl-menu-item cfl-menu-app-item"
          :class="{ selected: isAppSelected(app) }"
          @click="onSelectApp(app)"
        >{{ app }}</button>
      </div>

      <div class="cfl-menu-manual" @click.stop>
        <input
          ref="manualInput"
          v-model="manualText"
          class="cfl-menu-manual-input"
          :class="{ invalid: manualText.length > 0 && !manualValid }"
          maxlength="5"
          placeholder=""
          spellcheck="false"
          autocomplete="off"
          @input="onManualInput"
          @keydown.enter.prevent="submitManual"
          @keydown.escape.prevent="closeMenu"
        />
      </div>
    </div>
  </v-menu>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { isApproachClearanceLabel, parseAltitudeToFeet, parseManualCfl } from '@vatefs/common'
import type { FlightStrip } from '@/types/efs'
import { useEfsStore } from '@/store/efs'

export interface CflOption {
  label: string
  value: string
}

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
const appClrTypes = ref<string[]>([])
let ignoreCloseUntil = 0

/** Extra APPCLR types from TopSky (OS / CA / VA are fixed keys above). */
const customAppClrTypes = computed(() =>
  appClrTypes.value.filter((t) => t !== 'OS' && t !== 'CA' && t !== 'VA'),
)

const manualValid = computed(() => parseManualCfl(manualText.value) != null)

/** A05–A50 (500 ft), then 060–510 (1000 ft), high → low like TopSky. */
const cflOptions: CflOption[] = (() => {
  const opts: CflOption[] = []
  for (let alt = 51000; alt >= 6000; alt -= 1000) {
    const fl = Math.round(alt / 100)
    opts.push({ label: String(fl).padStart(3, '0'), value: String(alt) })
  }
  for (let alt = 5000; alt >= 500; alt -= 500) {
    const hundreds = Math.round(alt / 100)
    opts.push({ label: `A${String(hundreds).padStart(2, '0')}`, value: String(alt) })
  }
  return opts
})()

const currentLabel = computed(() => (props.strip.clearedAltitude || '').trim().toUpperCase())

watch(
  () => props.modelValue,
  async (open) => {
    if (open) {
      ignoreCloseUntil = Date.now() + 450
      manualText.value = ''
      await fetchAppClr()
      nextTick(() => {
        scrollToSelected()
        manualInput.value?.focus()
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

function onManualInput() {
  let s = manualText.value.toUpperCase().replace(/[^A0-9.]/g, '')
  if (s.includes('A')) {
    // A-form: A + up to 3 digits (no decimal)
    const rest = s.replace(/A/g, '').replace(/\./g, '')
    manualText.value = ('A' + rest).slice(0, 4)
    return
  }
  const dot = s.indexOf('.')
  if (dot >= 0) {
    // Strip form: up to 2 digits, dot, 1 decimal (e.g. 1.2)
    const whole = s.slice(0, dot).replace(/\./g, '').slice(0, 2)
    const frac = s.slice(dot + 1).replace(/\./g, '').slice(0, 1)
    manualText.value = frac.length > 0 || s.endsWith('.') ? `${whole}.${frac}` : whole
    return
  }
  manualText.value = s.slice(0, 3)
}

function submitManual() {
  const feet = parseManualCfl(manualText.value)
  if (feet == null) return
  store.sendAssignment(props.strip.id, 'assignCfl', String(feet))
  closeMenu()
}

async function fetchAppClr() {
  const airport = (props.strip.ades || '').trim().toUpperCase()
  if (!airport || airport === '????' || airport === 'ZZZZ') {
    appClrTypes.value = []
    return
  }
  const runway = (props.strip.runway || '').trim().toUpperCase()
  try {
    const params = new URLSearchParams({ airport })
    if (runway) params.set('runway', runway)
    const res = await fetch(`/api/appclr?${params}`)
    if (!res.ok) {
      appClrTypes.value = []
      return
    }
    const data = (await res.json()) as { types?: string[] }
    // CA/VA/OS are fixed keys above — only extra APPCLR types here
    appClrTypes.value = (data.types ?? []).filter((t) => t !== 'CA' && t !== 'VA' && t !== 'OS')
  } catch {
    appClrTypes.value = []
  }
}

function currentFeet(): number | undefined {
  return parseAltitudeToFeet(props.strip.clearedAltitude)
}

function isLevelSelected(opt: CflOption): boolean {
  if (isApproachClearanceLabel(currentLabel.value)) return false
  const cur = currentFeet()
  if (cur == null) return false
  return cur === parseInt(opt.value, 10)
}

function isAppSelected(app: string): boolean {
  const label = currentLabel.value
  if (!label) return false
  if (app === 'CA') return label === 'CA'
  if (app === 'VA') return label === 'VA'
  return label === app.toUpperCase()
}

function scrollToSelected() {
  const container = listEl.value
  if (!container) return
  const selected = container.querySelector('.cfl-menu-item.selected') as HTMLElement | null
  if (selected) {
    selected.scrollIntoView({ block: 'center' })
    return
  }
  const mid = container.querySelector('[data-cfl="5000"]') as HTMLElement | null
  mid?.scrollIntoView({ block: 'center' })
}

function onSelectLevel(value: string) {
  store.sendAssignment(props.strip.id, 'assignCfl', value)
  closeMenu()
}

function onSelectApp(app: string) {
  store.sendAssignment(props.strip.id, 'assignAppClr', app)
  closeMenu()
}
</script>

<style scoped>
.cfl-menu {
  --cfl-strip-white: #ebebeb;
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

.cfl-menu-top {
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

.cfl-menu-top:hover {
  background: #b0b0b0;
}

.cfl-menu-header {
  padding: calc(6px * var(--s)) calc(8px * var(--s)) calc(2px * var(--s));
  font-size: calc(9px * var(--s));
  font-weight: 800;
  letter-spacing: 0.12em;
  color: #000;
  text-transform: uppercase;
  text-align: center;
  background: #c0c0c0;
}

.cfl-menu-callsign {
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

.cfl-menu-manual {
  padding: calc(6px * var(--s)) calc(8px * var(--s));
  background: #c8c8c8;
  border-top: 3px solid #333;
}

.cfl-menu-manual-input {
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

.cfl-menu-manual-input:focus {
  border-color: #1a3a6e;
  box-shadow: inset 0 0 0 1px #1a3a6e;
}

.cfl-menu-manual-input.invalid {
  border-color: #a30;
  color: #800;
}

.cfl-menu-manual-input::placeholder {
  color: #888;
  font-weight: 600;
  text-transform: none;
  letter-spacing: 0;
  font-size: calc(10px * var(--s));
}

.cfl-menu-list {
  display: flex;
  flex-direction: column;
  background: #d8d8d8;
  max-height: min(40vh, calc(280px * var(--s)));
  overflow-y: auto;
  overscroll-behavior: contain;
}

.cfl-menu-app {
  display: flex;
  flex-direction: column;
  background: #d8d8d8;
  border-top: 3px solid #333;
}

.cfl-menu-item {
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
  text-transform: uppercase;
  text-align: center;
  cursor: pointer;
  line-height: 1.1;
  white-space: nowrap;
  min-height: max(28px, calc(28px * var(--s)));
}

.cfl-menu-list .cfl-menu-item:last-child,
.cfl-menu-app .cfl-menu-item:last-child {
  border-bottom: none;
}

.cfl-menu-item.selected {
  background: var(--cfl-strip-white);
  color: #1a3a6e;
  box-shadow: inset 0 0 0 2px #1a3a6e;
}

.cfl-menu-item:hover {
  background: #1a3a6e;
  color: var(--cfl-strip-white);
  box-shadow: inset 0 0 0 2px #000;
  position: relative;
  z-index: 1;
}

</style>

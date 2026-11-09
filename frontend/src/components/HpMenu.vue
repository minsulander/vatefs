<template>
  <v-menu
    :model-value="modelValue"
    :target="target"
    location="bottom"
    :offset="4"
    :z-index="zIndex"
    :close-on-content-click="false"
    @update:model-value="onModelUpdate"
  >
    <div class="hp-menu" @click.stop @mousedown.prevent>
      <button
        v-for="hp in intersections"
        :key="hp"
        type="button"
        class="hp-menu-item"
        :class="{ selected: isSelected(hp) }"
        @click="onSelect(hp)"
      >{{ hp }}</button>
      <button
        type="button"
        class="hp-menu-clear"
        :class="{ 'hp-menu-clear-only': intersections.length === 0 }"
        @click="onClear"
      >CLEAR</button>
    </div>
  </v-menu>
</template>

<script setup lang="ts">
import { computed, nextTick, watch } from 'vue'
import type { FlightStrip } from '@/types/efs'
import { useEfsStore } from '@/store/efs'
import { essaHpPreferencesForStrip } from '@/data/essa-hp-intersections'

const props = withDefaults(
  defineProps<{
    modelValue: boolean
    strip: FlightStrip
    /** Prefer the HP cell element so location=bottom sits under the field, not over it. */
    target?: HTMLElement | [number, number]
    zIndex?: number
  }>(),
  { zIndex: 2600 },
)

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  select: [hp: string]
  clear: []
}>()

const store = useEfsStore()
/** Ignore the opening click so v-menu does not instantly dismiss. */
let ignoreCloseUntil = 0

const intersections = computed(() => [
  ...essaHpPreferencesForStrip(props.strip, store.controllers, {
    gndSplit: store.essaGndSplit,
  }),
])
const currentHp = computed(() => (props.strip.hp || '').trim().toUpperCase())

function isSelected(hp: string): boolean {
  return currentHp.value === hp.toUpperCase()
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) ignoreCloseUntil = Date.now() + 120
  },
)

function onModelUpdate(open: boolean) {
  if (!open && Date.now() < ignoreCloseUntil) {
    nextTick(() => emit('update:modelValue', true))
    return
  }
  emit('update:modelValue', open)
}

function onSelect(hp: string) {
  emit('select', hp.toUpperCase())
  ignoreCloseUntil = 0
  emit('update:modelValue', false)
}

function onClear() {
  emit('clear')
  ignoreCloseUntil = 0
  emit('update:modelValue', false)
}
</script>

<style scoped>
.hp-menu {
  --hp-strip-white: #ebebeb;
  --s: var(--efs-scale, 1);
  display: flex;
  flex-direction: column;
  min-width: calc(52px * var(--s));
  background: #d8d8d8;
  border: 1px solid #888;
  border-radius: 0;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
  color: #000;
  font-family: system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  overflow: hidden;
  max-height: min(40vh, calc(280px * var(--s)));
  overflow-y: auto;
  overscroll-behavior: contain;
}

.hp-menu-item {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  margin: 0;
  padding: calc(5px * var(--s)) calc(10px * var(--s));
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

.hp-menu-item:hover {
  background: #1a3a6e;
  color: var(--hp-strip-white);
  box-shadow: inset 0 0 0 2px #000;
  position: relative;
  z-index: 1;
}

.hp-menu-item.selected {
  background: var(--hp-strip-white);
  color: #1a3a6e;
  box-shadow: inset 0 0 0 2px #1a3a6e;
}

.hp-menu-clear {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  margin: 0;
  padding: calc(8px * var(--s)) calc(10px * var(--s));
  border: none;
  border-top: 2px solid #555;
  border-radius: 0;
  appearance: none;
  -webkit-appearance: none;
  background: #a8a8a8;
  color: #000;
  font-size: calc(11px * var(--s));
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  text-align: center;
  cursor: pointer;
  line-height: 1.1;
  white-space: nowrap;
  min-height: max(28px, calc(28px * var(--s)));
}

.hp-menu-clear-only {
  border-top: none;
}

.hp-menu-clear:hover {
  background: #1a3a6e;
  color: var(--hp-strip-white);
  box-shadow: inset 0 0 0 2px #000;
}
</style>

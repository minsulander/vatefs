<template>
  <v-dialog
    :model-value="modelValue"
    max-width="420"
    scrim
    content-class="workspace-search-dialog-wrap"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <div class="efs-popup-menu efs-popup-menu--wide workspace-search-dialog" @click.stop>
      <div class="efs-popup-header">Search</div>
      <div class="efs-popup-search">
        <input
          ref="inputEl"
          v-model="query"
          class="efs-popup-search-input"
          type="text"
          placeholder="Callsign…"
          maxlength="12"
          autocomplete="off"
          spellcheck="false"
          @keydown.esc.stop="$emit('update:modelValue', false)"
        />
      </div>
      <div class="efs-popup-list">
        <div v-if="!trimmed" class="efs-popup-item is-disabled">Type a callsign</div>
        <template v-else>
          <div class="efs-popup-section">In EFS</div>
          <button
            v-for="s in efsHits"
            :key="s.id"
            type="button"
            class="efs-popup-item efs-popup-item--stack"
            @click="onSelectEfs(s)"
          >
            <span class="efs-popup-item-title">{{ s.callsign }}</span>
            <span class="efs-popup-item-sub">{{ s.sectionId }} · {{ s.aircraftType }}</span>
          </button>
          <div v-if="!efsHits.length" class="efs-popup-item is-disabled">No strips</div>

          <div class="efs-popup-section">Trash</div>
          <button
            v-for="s in trashHits"
            :key="s.stripId"
            type="button"
            class="efs-popup-item efs-popup-item--stack"
            @click="onRestore(s.stripId)"
          >
            <span class="efs-popup-item-title">{{ s.callsign }}</span>
            <span class="efs-popup-item-sub">Restore from trash</span>
          </button>
          <div v-if="!trashHits.length" class="efs-popup-item is-disabled">No matches</div>

          <div class="efs-popup-section">VATSIM / network</div>
          <div v-if="flightLookupLoading" class="efs-popup-item is-disabled">Looking up…</div>
          <button
            v-else-if="flightLookup"
            type="button"
            class="efs-popup-item efs-popup-item--stack"
            @click="onFlightLookup"
          >
            <span class="efs-popup-item-title">{{ flightLookup.callsign }}</span>
            <span class="efs-popup-item-sub">
              {{ flightLookup.aircraftType || '?' }}
              {{ flightLookup.adep || '' }}→{{ flightLookup.ades || '' }}
            </span>
          </button>
          <div v-else class="efs-popup-item is-disabled">No flight plan found</div>
        </template>
      </div>
      <div class="essa-roles-actions">
        <button
          type="button"
          class="efs-popup-footer essa-roles-action"
          @click="$emit('update:modelValue', false)"
        >Close</button>
      </div>
    </div>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useEfsStore } from '@/store/efs'
import type { DeletedStripInfo, FlightStrip } from '@vatefs/common'

defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [boolean] }>()

const store = useEfsStore()
const query = ref('')
const inputEl = ref<HTMLInputElement | null>(null)
const flightLookup = ref<{
  callsign: string
  aircraftType?: string
  adep?: string
  ades?: string
} | null>(null)
const flightLookupLoading = ref(false)
let lookupTimer: ReturnType<typeof setTimeout> | null = null

const trimmed = computed(() => query.value.trim().toUpperCase())

const efsHits = computed(() => {
  const q = trimmed.value
  if (!q) return [] as FlightStrip[]
  void store.stripsVersion
  return [...store.strips.values()].filter((s) => s.callsign.toUpperCase().includes(q)).slice(0, 20)
})

const trashHits = computed(() => {
  const q = trimmed.value
  if (!q) return [] as DeletedStripInfo[]
  return store.deletedStrips.filter((s) => (s.callsign || '').toUpperCase().includes(q)).slice(0, 20)
})

watch(
  () => trimmed.value,
  (q) => {
    flightLookup.value = null
    if (lookupTimer) clearTimeout(lookupTimer)
    if (q.length < 2) return
    lookupTimer = setTimeout(() => void lookupFlight(q), 300)
  },
)

watch(
  () => store /* model open via parent */,
  () => {},
)

async function lookupFlight(callsign: string) {
  flightLookupLoading.value = true
  try {
    const res = await fetch(`/api/flight/${encodeURIComponent(callsign)}`)
    if (!res.ok) {
      flightLookup.value = null
      return
    }
    const data = await res.json()
    flightLookup.value = {
      callsign: data.callsign || callsign,
      aircraftType: data.aircraftType,
      adep: data.adep || data.origin,
      ades: data.ades || data.destination,
    }
  } catch {
    flightLookup.value = null
  } finally {
    flightLookupLoading.value = false
  }
}

function onSelectEfs(_strip: FlightStrip) {
  emit('update:modelValue', false)
}

function onRestore(stripId: string) {
  store.restoreStrip(stripId)
  emit('update:modelValue', false)
}

function onFlightLookup() {
  emit('update:modelValue', false)
}

defineExpose({
  focus: async () => {
    await nextTick()
    inputEl.value?.focus()
  },
})
</script>

<style scoped>
.workspace-search-dialog {
  max-height: min(70vh, 520px);
  overflow: auto;
}
</style>

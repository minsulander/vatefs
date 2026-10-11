<template>
  <v-dialog
    :model-value="modelValue"
    @update:model-value="emit('update:modelValue', $event)"
    max-width="460"
    content-class="print-dialog-wrapper"
  >
    <div class="print-dialog">
      <div class="print-header">
        <v-icon size="20" class="print-header-icon">mdi-printer</v-icon>
        <span class="print-title">{{ isManual ? 'Printer queue' : 'Print strip' }}</span>
        <button class="print-close" type="button" title="Close" @click="emit('update:modelValue', false)">×</button>
      </div>

      <div class="print-body">
        <!-- Manual mode: pending queue first -->
        <div v-if="isManual" class="print-section print-section-queue">
          <div class="print-section-title">
            Waiting to print
            <span v-if="store.pendingPrintFlights.length" class="print-count">
              {{ store.pendingPrintFlights.length }}
            </span>
          </div>

          <div class="print-search">
            <input
              ref="queueFilterInput"
              v-model="query"
              class="print-search-input"
              type="search"
              placeholder="Filter queue…"
              maxlength="12"
              @keydown.escape="emit('update:modelValue', false)"
            />
          </div>

          <div class="print-list">
            <div v-if="filtered.length === 0" class="print-empty">
              {{ store.pendingPrintFlights.length === 0 ? 'No flights waiting to print' : 'No matches' }}
            </div>
            <button
              v-for="item in filtered"
              :key="item.callsign"
              type="button"
              class="print-row"
              @click="onPrintFlight(item.callsign)"
            >
              <div class="print-row-main">
                <span class="print-callsign">{{ item.callsign }}</span>
                <span class="print-meta">{{ rowMeta(item) }}</span>
              </div>
              <span class="print-action">Print</span>
            </button>
          </div>
        </div>

        <div class="print-section" :class="{ 'print-section-queue': isManual }">
          <div class="print-section-title">Flight strip by callsign</div>
          <div class="print-callsign-row">
            <input
              ref="callsignInput"
              v-model="callsign"
              class="print-search-input print-callsign-input"
              type="text"
              placeholder="Callsign"
              maxlength="10"
              @input="onCallsignInput"
              @keydown.enter="onPrintCallsign"
              @keydown.escape="emit('update:modelValue', false)"
            />
            <button
              type="button"
              class="print-action print-callsign-btn"
              :disabled="!canPrintCallsign"
              @click="onPrintCallsign"
            >
              Print
            </button>
          </div>
          <div class="print-match" :class="matchClass">
            <span v-if="isSearching">Looking up…</span>
            <span v-else-if="callsign.trim().length < 2"></span>
            <span v-else-if="match">
              {{ match.source === 'local' ? 'Local' : 'VATSIM' }}:
              {{ match.origin }}→{{ match.destination }}
              <template v-if="match.aircraftType"> · {{ match.aircraftType }}</template>
            </span>
            <span v-else>No FPL found</span>
          </div>
        </div>

        <div class="print-section">
          <div class="print-section-title">Blank strip</div>
          <!-- Top row: red/black+grid, ARR+grid, DEP+grid -->
          <div class="print-templates print-templates-row">
            <button
              v-for="tpl in framedEmptyTemplates"
              :key="tpl.kind"
              type="button"
              class="print-template print-template-compact"
              :class="`tpl-${tpl.kind}`"
              @click="onPrintTemplate(tpl.kind)"
            >
              <span class="print-template-preview" :class="`pv-frame pv-${tpl.kind}`">
                <span
                  class="pv-grid"
                  :class="{
                    'pv-grid-arr': tpl.kind === 'empty_arr',
                    'pv-grid-dep': tpl.kind === 'empty_dep',
                    'pv-grid-frame': tpl.kind === 'empty_frame',
                  }"
                >
                  <span class="pv-g pv-g-cs" />
                  <span class="pv-g pv-g-time" />
                  <span class="pv-g pv-g-mid" />
                  <span class="pv-g pv-g-clr" />
                  <span class="pv-g pv-g-rte" />
                  <span class="pv-g pv-g-ctot" />
                </span>
              </span>
              <span class="print-template-label">{{ tpl.label }}</span>
            </button>
          </div>
          <!-- Below: completely blank red/black (no internal grid) -->
          <button
            type="button"
            class="print-template print-template-plain-empty tpl-empty"
            @click="onPrintTemplate('empty')"
          >
            <span class="print-template-preview pv-frame pv-empty" />
            <span class="print-template-label">Empty</span>
          </button>

          <div class="print-section-title print-section-title-spaced">Info strips</div>
          <div class="print-templates">
            <button
              v-for="tpl in infoTemplates"
              :key="tpl.kind"
              type="button"
              class="print-template"
              :class="`tpl-${tpl.kind}`"
              @click="onPrintTemplate(tpl.kind)"
            >
              <span class="print-template-preview" :class="`pv-frame pv-${tpl.kind}`">
                <span v-if="tpl.kind === 'hinder'" class="pv-fill">HINDER</span>
                <span v-else-if="tpl.kind === 'bogsering'" class="pv-panel">Bogsering</span>
                <span v-else-if="tpl.kind === 'snorojning'" class="pv-panel pv-panel-2">
                  <b>Snöröjning</b>
                  <span>Pågår -&gt;</span>
                </span>
                <span v-else-if="tpl.kind === 'prel_rojning'" class="pv-panel pv-panel-2">
                  <b>Prel nästa</b>
                  <span>röjning -&gt;</span>
                </span>
              </span>
              <span class="print-template-label">{{ tpl.label }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import type { PaperInfoKind, PendingPrintFlightInfo } from '@vatefs/common'
import { useEfsStore } from '@/store/efs'

type PrintMatch = {
  source: 'local' | 'vatsim'
  callsign: string
  origin: string
  destination: string
  aircraftType?: string
  eobt?: string
  ctot?: string
  squawk?: string
}

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

const store = useEfsStore()
const isManual = computed(() => store.stripPrintMode === 'manual')
const query = ref('')
const callsign = ref('')
const callsignInput = ref<HTMLInputElement | null>(null)
const queueFilterInput = ref<HTMLInputElement | null>(null)
const match = ref<PrintMatch | null>(null)
const isSearching = ref(false)
let searchDebounce: ReturnType<typeof setTimeout> | undefined

/** Top row — blanks with FPS box/grid borders */
const framedEmptyTemplates: Array<{ kind: PaperInfoKind; label: string }> = [
  { kind: 'empty_frame', label: 'Blank' },
  { kind: 'empty_arr', label: 'Blank ARR' },
  { kind: 'empty_dep', label: 'Blank DEP' },
]

const infoTemplates: Array<{ kind: PaperInfoKind; label: string }> = [
  { kind: 'hinder', label: 'HINDER' },
  { kind: 'bogsering', label: 'Bogsering' },
  { kind: 'snorojning', label: 'Snöröjning Pågår' },
  { kind: 'prel_rojning', label: 'Prel nästa röjning' },
]

const canPrintCallsign = computed(() => callsign.value.trim().length >= 2 && !!match.value)

const matchClass = computed(() => {
  if (isSearching.value) return 'is-searching'
  if (callsign.value.trim().length < 2) return ''
  return match.value ? 'is-found' : 'is-missing'
})

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      query.value = ''
      callsign.value = ''
      match.value = null
      isSearching.value = false
      if (isManual.value) store.listPendingPrint()
      nextTick(() => {
        if (isManual.value && store.pendingPrintFlights.length > 0) {
          queueFilterInput.value?.focus()
        } else {
          callsignInput.value?.focus()
        }
      })
    }
  }
)

const filtered = computed(() => {
  const q = query.value.trim().toUpperCase()
  const list = store.pendingPrintFlights
  if (!q) return list
  return list.filter((s) => {
    const hay = `${s.callsign} ${s.adep} ${s.ades} ${s.aircraftType}`.toUpperCase()
    return hay.includes(q)
  })
})

function rowMeta(item: PendingPrintFlightInfo): string {
  const route = [item.adep, item.ades].filter(Boolean).join('→')
  const type = item.aircraftType || ''
  const times = [item.eobt ? `EOBT ${item.eobt}` : '', item.ctot ? `CTOT ${item.ctot}` : '']
    .filter(Boolean)
    .join(' · ')
  return [item.stripType.toUpperCase(), type, route, times].filter(Boolean).join(' · ')
}

function onCallsignInput() {
  const cs = callsign.value.toUpperCase().trim()
  callsign.value = cs
  match.value = null
  if (cs.length < 2) {
    isSearching.value = false
    return
  }
  if (searchDebounce) clearTimeout(searchDebounce)
  isSearching.value = true
  searchDebounce = setTimeout(async () => {
    try {
      const resp = await fetch(`/api/print-flight/${encodeURIComponent(cs)}`)
      if (resp.ok) {
        match.value = (await resp.json()) as PrintMatch
      } else {
        match.value = null
      }
    } catch {
      match.value = null
    }
    isSearching.value = false
  }, 300)
}

function onPrintCallsign() {
  if (!canPrintCallsign.value) return
  store.printStrip(callsign.value.trim().toUpperCase())
  emit('update:modelValue', false)
}

function onPrintFlight(cs: string) {
  store.printStrip(cs)
}

function onPrintTemplate(kind: PaperInfoKind) {
  store.printPaperInfoStrip(kind)
  emit('update:modelValue', false)
}
</script>

<style>
.print-dialog-wrapper {
  box-shadow: none !important;
}

.print-dialog {
  background: #2b2d31;
  color: #e8e8e8;
  border: 1px solid #4a4d55;
  border-radius: 6px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  max-height: min(86vh, 720px);
  font-family: system-ui, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
}

.print-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}

.print-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid #3a3d45;
  background: #232528;
}

.print-header-icon {
  color: #c9a227;
}

.print-title {
  flex: 1;
  font-weight: 600;
  font-size: 0.95rem;
}

.print-close {
  border: none;
  background: transparent;
  color: #aaa;
  font-size: 1.35rem;
  line-height: 1;
  cursor: pointer;
  padding: 0 4px;
}

.print-close:hover {
  color: #fff;
}

.print-section {
  padding: 10px 12px 12px;
}

.print-section-queue {
  border-bottom: 1px solid #3a3d45;
  background: #26282c;
}

.print-section-queue + .print-section {
  border-top: none;
}

.print-section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #9a9a9a;
  margin-bottom: 8px;
}

.print-count {
  background: #c9a227;
  color: #1e2022;
  border-radius: 8px;
  padding: 0 6px;
  font-size: 0.7rem;
  line-height: 1.4;
}

.print-callsign-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.print-callsign-input {
  flex: 1;
  text-transform: uppercase;
}

.print-callsign-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.print-match {
  min-height: 1.2em;
  margin-top: 6px;
  font-size: 0.78rem;
  color: #888;
}

.print-match.is-found {
  color: #8bc34a;
}

.print-match.is-missing {
  color: #e57373;
}

.print-templates {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.print-templates-row {
  flex-direction: row;
  flex-wrap: wrap;
  gap: 6px;
}

.print-section-title-spaced {
  margin-top: 14px;
}

.print-template {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  text-align: left;
  border: 1px solid #3a3d45;
  background: #232528;
  color: inherit;
  border-radius: 4px;
  padding: 6px 8px;
  cursor: pointer;
}

.print-template-compact {
  flex: 1 1 0;
  min-width: 0;
  flex-direction: column;
  align-items: stretch;
  gap: 5px;
  width: auto;
  padding: 6px;
}

.print-template:hover {
  border-color: #c9a227;
  background: #2f3238;
}

/* Mini FPS holders: red side rails + black top/bottom (same idea as bay strips) */
.print-template-preview.pv-frame {
  flex: 0 0 150px;
  height: 30px;
  box-sizing: border-box;
  overflow: hidden;
  display: flex;
  align-items: stretch;
  font-size: 9px;
  line-height: 1.1;
  font-family: Arial, Helvetica, sans-serif;
  border-style: solid;
  border-width: 2px 5px;
  border-color: transparent;
  background-color: #f7f4ee;
  background-image:
    linear-gradient(#c62828, #c62828),
    linear-gradient(#c62828, #c62828),
    linear-gradient(#111, #111),
    linear-gradient(#111, #111);
  background-size:
    5px 100%,
    5px 100%,
    calc(100% - 10px) 2px,
    calc(100% - 10px) 2px;
  background-position:
    left top,
    right top,
    top left 5px,
    bottom left 5px;
  background-repeat: no-repeat;
  background-origin: border-box;
  background-clip: border-box;
}

/* Completely blank red/black — cream only, no internal grid */
.print-template-preview.pv-empty {
  background-color: #f7f4ee;
}

.print-template-plain-empty {
  margin-top: 6px;
  justify-content: center;
}

.print-template-plain-empty .print-template-preview {
  flex: 0 0 180px;
}

.print-template-plain-empty .print-template-label {
  flex: 0 0 auto;
}

/* Red/black + grid: keep rails, cream cells inside */
.print-template-preview.pv-empty_frame {
  background-color: #fff;
  padding: 0;
  overflow: hidden;
}

/* Blank ARR/DEP: yellow / blue type frame + mini box layout */
.print-template-preview.pv-empty_arr,
.print-template-preview.pv-empty_dep {
  border-style: solid;
  border-width: 2px 5px;
  border-color: #daa520;
  background-color: #fff;
  background-image: none;
  padding: 0;
  overflow: hidden;
}

.print-template-preview.pv-empty_dep {
  border-color: #3a72d4;
}

/*
 * Framed blank previews: render grid at strip-like proportions and crop
 * (overflow hidden) so cells aren't stretched to the tiny button width.
 */
.print-template-preview .pv-grid {
  flex: 0 0 auto;
  width: 280px;
  height: 100%;
  display: grid;
  grid-template-columns: 72px 36px 70px 28px 28px 48px 36px;
  grid-template-rows: 1fr 1fr;
  gap: 0;
  background: #ccc;
}

.print-template-preview .pv-g {
  background: #f7f4ee;
  box-shadow: inset 0 0 0 0.5px #999;
  min-height: 0;
}

.print-template-preview .pv-g-cs {
  grid-row: 1 / 3;
  grid-column: 1;
}

.print-template-preview .pv-g-time {
  grid-column: 2;
  grid-row: 1;
}

.print-template-preview .pv-g-mid {
  grid-column: 3;
  grid-row: 1 / 3;
}

.print-template-preview .pv-g-clr {
  grid-column: 4 / 6;
  grid-row: 1 / 3;
}

.print-template-preview .pv-g-rte {
  grid-column: 6;
  grid-row: 1 / 3;
}

.print-template-preview .pv-g-ctot {
  grid-column: 7;
  grid-row: 1 / 3;
}

.print-template-compact .print-template-preview {
  flex: 0 0 auto;
  width: 100%;
  height: 34px;
}

.print-template-compact .print-template-label {
  text-align: center;
  font-size: 0.78rem;
}

.print-template-preview.pv-hinder {
  background-color: #d32f2f;
}

.print-template-preview .pv-fill {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-weight: 800;
  letter-spacing: 0.06em;
  font-size: 11px;
}

.print-template-preview .pv-panel {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 46%;
  max-width: 46%;
  padding: 0 4px;
  color: #fff;
  font-weight: 700;
  font-size: 10px;
  background: #d32f2f;
  box-sizing: border-box;
}

.print-template-preview .pv-panel-2 {
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  font-size: 8px;
  line-height: 1.15;
  padding: 1px 4px;
}

.print-template-preview.pv-prel_rojning .pv-panel {
  background: #2e5a3c;
}

.print-template-label {
  font-size: 0.85rem;
  font-weight: 600;
}

.print-search {
  margin-bottom: 8px;
}

.print-search-input {
  width: 100%;
  box-sizing: border-box;
  background: #1e2022;
  border: 1px solid #4a4d55;
  border-radius: 4px;
  color: #eee;
  padding: 6px 10px;
  font-size: 0.9rem;
}

.print-search-input:focus {
  outline: none;
  border-color: #c9a227;
}

.print-list {
  max-height: min(36vh, 280px);
  overflow-y: auto;
  border: 1px solid #3a3d45;
  border-radius: 4px;
  background: #1e2022;
}

.print-empty {
  padding: 20px 16px;
  text-align: center;
  color: #888;
  font-size: 0.85rem;
}

.print-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  text-align: left;
  border: none;
  border-bottom: 1px solid #33363c;
  background: transparent;
  color: inherit;
  padding: 10px 12px;
  cursor: pointer;
}

.print-row:last-child {
  border-bottom: none;
}

.print-row:hover {
  background: #35383f;
}

.print-row-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.print-callsign {
  font-weight: 700;
  letter-spacing: 0.02em;
}

.print-meta {
  font-size: 0.75rem;
  color: #9a9a9a;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.print-action {
  flex-shrink: 0;
  font-size: 0.75rem;
  font-weight: 600;
  color: #1e2022;
  background: #c9a227;
  border: none;
  border-radius: 3px;
  padding: 6px 10px;
  cursor: pointer;
}
</style>

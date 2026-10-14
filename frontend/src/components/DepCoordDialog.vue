<template>
  <v-dialog
    v-model="dialogOpen"
    max-width="280"
    content-class="dep-coord-dialog-wrapper"
    @click:outside="onCancel"
  >
    <div class="efs-popup-menu efs-popup-menu--wide dep-coord-dialog" @click.stop>
      <div class="efs-popup-header">Departure Coordination</div>
      <div class="efs-popup-subheader dep-coord-subheader">
        <span class="dep-coord-callsign">{{ strip.callsign }}</span>
        <span class="dep-coord-meta">
          <span>{{ strip.runway || '—' }}</span>
          <span>{{ strip.ades || '—' }}</span>
          <span v-if="routePreview">{{ routePreview }}</span>
        </span>
      </div>

      <div v-if="esmsAutoCoordHint" class="dep-coord-hint">{{ esmsAutoCoordHint }}</div>

      <div class="efs-popup-list dep-coord-fields">
        <div
          class="efs-popup-item clnc-field-row dep-coord-field"
          :class="{ 'is-disabled': esmsAutoCoordEligible }"
        >
          <span class="clnc-field-label">XFL</span>
          <input
            v-model="xflEdit"
            class="dep-coord-input"
            :class="{ 'dep-coord-input--locked': esmsAutoCoordEligible }"
            maxlength="5"
            spellcheck="false"
            :disabled="esmsAutoCoordEligible"
            :readonly="esmsAutoCoordEligible"
            :title="
              esmsAutoCoordEligible
                ? 'ESMS auto-coord: XFL fixed at 1000 (pink) — ACC returns 4000'
                : 'Exit coordination level (not ES clearance)'
            "
            @keydown.enter.prevent="onOk"
          />
        </div>
        <div class="efs-popup-item clnc-field-row is-disabled">
          <span class="clnc-field-label">ASSR</span>
          <span class="clnc-field-value">{{ assrDisplay || '----' }}</span>
        </div>
        <div class="efs-popup-item clnc-field-row is-disabled dep-coord-dim">
          <span class="clnc-field-label">ATOW</span>
          <span class="clnc-field-value">---</span>
        </div>
        <div class="efs-popup-item clnc-field-row is-disabled">
          <span class="clnc-field-label">EOBT</span>
          <span class="clnc-field-value">{{ strip.eobt || '----' }}</span>
        </div>
      </div>

      <div class="clnc-actions clnc-actions-2">
        <button type="button" class="efs-popup-footer clnc-action" @click="onCancel">Cancel</button>
        <button type="button" class="efs-popup-footer clnc-action" @click="onOk">OK</button>
      </div>
    </div>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { FlightStrip } from '@vatefs/common'
import {
  ESMS_AUTO_COORD_INIT_XFL_FT,
  extractSignificantRouteFixes,
  isEsmsAutoCoordSid,
  isIfrSidEligible,
  parseAltitudeToFeet,
  parseRflToFeet,
  resolveLopAutoDirect,
  resolveLopDirectHighlights,
} from '@vatefs/common'
import { useEfsStore } from '@/store/efs'

const props = defineProps<{
  modelValue: boolean
  strip: FlightStrip
  /** True when ASSUME was sent immediately before opening (XFL may arrive later). */
  assumedBeforeOpen?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const store = useEfsStore()

const dialogOpen = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})

const xflEdit = ref('')
/** After force-assume open: re-sync local XFL once when strip.xfl arrives/changes. */
const pendingAssumeXflSync = ref(false)

const assrDisplay = computed(() => store.displayAssrForStrip(props.strip) || '')

/**
 * ESMS special DEP handshake: eligible SID → default pink XFL 1000
 * (ACC counters 4000; Accept sets DepC). Ineligible SIDs keep normal XFL seed.
 */
const esmsAutoCoordEligible = computed(() => {
  const s = props.strip
  if (!isIfrSidEligible(s.flightRules)) return false
  if (s.stripType !== 'departure' && s.stripType !== 'local') return false
  const sid = (s.sid || '').trim() || undefined
  return isEsmsAutoCoordSid(s.adep, sid, s.runway)
})

const esmsAutoCoordHint = computed(() =>
  esmsAutoCoordEligible.value
    ? 'ESMS: send 1000 → ACC returns 4000'
    : '',
)

/** Beginning of route — first 1–2 significant fixes (TopSky DEP COORD style). */
const routePreview = computed(() => {
  const fixes = extractSignificantRouteFixes(props.strip.route)
  if (fixes.length === 0) {
    const sid = store.displaySidForStrip(props.strip)
    return sid || ''
  }
  return fixes.slice(0, 2).join(' ')
})

function formatXflToken(feet: number | undefined): string {
  if (feet == null || feet <= 0) return ''
  return String(Math.round(feet / 100)).padStart(3, '0')
}

function seedXflFromStrip() {
  if (esmsAutoCoordEligible.value) {
    // Handshake token — do not seed published 4000 / live ES XFL
    xflEdit.value = formatXflToken(ESMS_AUTO_COORD_INIT_XFL_FT)
    return
  }
  xflEdit.value = formatXflToken(store.xflFeetForStrip(props.strip))
}

watch(
  () => props.modelValue,
  (open) => {
    if (!open) {
      pendingAssumeXflSync.value = false
      return
    }
    seedXflFromStrip()
    // ESMS auto-coord locks the seed at 1000 — do not re-sync from strip.xfl
    pendingAssumeXflSync.value = !!props.assumedBeforeOpen && !esmsAutoCoordEligible.value
  },
)

/**
 * While open: fill empty local XFL when strip gains a value; after force-assume,
 * re-sync once when strip.xfl changes (even if a fallback was already shown).
 * Skipped for ESMS auto-coord (keep 1000 handshake token).
 */
watch(
  () => [props.modelValue, props.strip.xfl, store.xflFeetForStrip(props.strip)] as const,
  ([open, stripXfl, feet], prev) => {
    if (!open) return
    if (esmsAutoCoordEligible.value) return
    const token = formatXflToken(feet)
    if (!token) return

    if (!xflEdit.value.trim()) {
      xflEdit.value = token
      if (pendingAssumeXflSync.value && stripXfl) {
        pendingAssumeXflSync.value = false
      }
      return
    }

    if (!pendingAssumeXflSync.value) return
    const prevXfl = prev?.[1]
    if (stripXfl && stripXfl !== prevXfl) {
      xflEdit.value = token
      pendingAssumeXflSync.value = false
    }
  },
)

function parseXflEditToFeet(raw: string): number | undefined {
  const t = raw.trim().toUpperCase().replace(/\s+/g, '')
  if (!t) return undefined
  const fromCommon = parseAltitudeToFeet(t)
  if (fromCommon != null) return fromCommon
  if (/^\d{2,3}$/.test(t)) return parseInt(t, 10) * 100
  return undefined
}

/** LOP DCT fix (e.g. MIKNA) for fallback if ES refuses empty-point XFL-only. */
function lopFallbackPoint(): string | undefined {
  const s = props.strip
  const input = {
    adep: s.adep || '',
    ades: s.ades,
    route: s.route,
    rflFeet: parseRflToFeet(s.rfl),
    runway: s.runway,
  }
  const auto = resolveLopAutoDirect(input)
  if (auto?.point) return auto.point.toUpperCase()
  const hi = resolveLopDirectHighlights(input)[0]
  return hi?.point?.toUpperCase()
}

function onOk() {
  // ESMS eligible auto-coord: always send handshake 1000 (input is locked)
  const altitudeFeet = esmsAutoCoordEligible.value
    ? ESMS_AUTO_COORD_INIT_XFL_FT
    : (parseXflEditToFeet(xflEdit.value) ?? store.xflFeetForStrip(props.strip))
  if (altitudeFeet == null || altitudeFeet <= 0) {
    return
  }
  store.initiateXflCoordination(props.strip.id, {
    altitudeFeet,
    point: lopFallbackPoint(),
  })
  dialogOpen.value = false
}

function onCancel() {
  dialogOpen.value = false
}
</script>

<style>
/* Teleported dialog — match ClearanceDialog chrome */
.dep-coord-dialog-wrapper {
  box-shadow: none !important;
  background: transparent !important;
}

.dep-coord-dialog {
  --s: var(--efs-scale, 1);
  position: relative;
  width: 100%;
  max-width: min(92vw, calc(280px * var(--s)));
}

.dep-coord-subheader {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: calc(4px * var(--s));
}

.dep-coord-callsign {
  font-size: calc(13px * var(--s));
  font-weight: 800;
  letter-spacing: 0.3px;
  text-transform: uppercase;
}

.dep-coord-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: calc(6px * var(--s));
  font-size: calc(10px * var(--s));
  font-weight: 700;
  letter-spacing: 0.2px;
  text-transform: uppercase;
  color: #333;
}

.dep-coord-hint {
  padding: calc(4px * var(--s)) calc(10px * var(--s));
  font-size: calc(9px * var(--s));
  font-weight: 700;
  letter-spacing: 0.04em;
  text-align: center;
  color: #a11;
  border-bottom: 1px solid #ccc;
}

.dep-coord-fields {
  max-height: none;
}

.dep-coord-field {
  cursor: default;
}

.dep-coord-input {
  width: 4.5em;
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

.dep-coord-input:focus {
  border-color: #555;
  background: #fff;
}

.dep-coord-input--locked,
.dep-coord-input:disabled {
  border-color: #aaa;
  background: #d8d8d8;
  color: #555;
  cursor: default;
  opacity: 1;
}

.dep-coord-input--locked:focus,
.dep-coord-input:disabled:focus {
  border-color: #aaa;
  background: #d8d8d8;
}

.dep-coord-dim {
  opacity: 0.45;
}

.dep-coord-dialog .clnc-field-row {
  justify-content: space-between;
  gap: calc(10px * var(--s));
  text-align: left;
}

.dep-coord-dialog .clnc-field-label {
  flex: 0 0 auto;
  min-width: calc(48px * var(--s));
  font-size: calc(10px * var(--s));
  font-weight: 800;
  letter-spacing: 0.12em;
  color: #333;
  text-align: left;
}

.dep-coord-dialog .clnc-field-value {
  flex: 1 1 auto;
  min-width: 0;
  font-size: calc(12px * var(--s));
  font-weight: 800;
  letter-spacing: 0.3px;
  text-align: right;
  text-transform: uppercase;
}

.dep-coord-dialog .clnc-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  border-top: 3px solid #333;
}

.dep-coord-dialog .clnc-actions-2 {
  grid-template-columns: 1fr 1fr;
}

.dep-coord-dialog .clnc-action {
  min-height: max(32px, calc(32px * var(--s)));
}
</style>

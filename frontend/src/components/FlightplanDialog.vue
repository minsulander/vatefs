<template>
  <v-dialog
    v-model="dialogOpen"
    max-width="780"
    content-class="fpl-dialog-wrapper"
  >
    <div class="efs-popup-menu efs-popup-menu--wide fpl-dialog" @click.stop>
      <div class="efs-popup-header">Flight Plan</div>

      <div v-if="loading" class="efs-popup-meta fpl-loading">Loading…</div>
      <div v-else class="fpl-body">
        <!-- Row 1: identity -->
        <div class="fpl-row">
          <div class="fpl-field fpl-grow-cs">
            <span class="fpl-lbl">C/S</span>
            <span class="fpl-box">{{ cs }}</span>
          </div>
          <div class="fpl-field fpl-grow-xs">
            <span class="fpl-lbl">FRUL</span>
            <input
              v-model="draft.frul"
              class="fpl-box fpl-input"
              maxlength="1"
              @input="onFrulInput"
            />
          </div>
          <div class="fpl-field fpl-grow-xs">
            <span class="fpl-lbl">FTYP</span>
            <span class="fpl-box">{{ ftyp }}</span>
          </div>
          <div class="fpl-field fpl-grow-xs">
            <span class="fpl-lbl">NRAC</span>
            <input
              v-model="draft.nrac"
              class="fpl-box fpl-input"
              maxlength="2"
              title="Number of aircraft"
              @input="onNracInput"
            />
          </div>
          <div class="fpl-field fpl-grow-atyp">
            <span class="fpl-lbl">ATYP/W</span>
            <div class="fpl-pair">
              <input
                v-model="draft.atyp"
                class="fpl-box fpl-input"
                maxlength="4"
                @input="upperDraft('atyp')"
              />
              <span class="fpl-slash">/</span>
              <input
                v-model="draft.wtc"
                class="fpl-box fpl-input fpl-box--wtc"
                maxlength="1"
                @input="onWtcInput"
              />
            </div>
          </div>
        </div>

        <!-- Row 2: equipment — always EQUIP/SUR; FAA letter shows dimmed (ICAO) hint -->
        <div class="fpl-row">
          <div class="fpl-field fpl-grow-full">
            <span class="fpl-lbl">EQUIP</span>
            <div class="fpl-pair fpl-pair--equip">
              <div
                class="fpl-box fpl-equip-left"
                :class="{ 'fpl-equip-left--faa': !!faaIcaoHint }"
                title="FAA letter or ICAO field 10a — type more than one letter for ICAO"
                @mousedown.prevent="focusEquipLeft"
                @click="focusEquipLeft"
              >
                <input
                  ref="equipLeftInput"
                  v-model="draft.equipLeft"
                  class="fpl-equip-left-input"
                  maxlength="40"
                  :style="faaIcaoHint ? { width: `${Math.max(1, draft.equipLeft.length || 1)}ch` } : undefined"
                  @mousedown.stop
                  @input="onEquipLeftInput"
                />
                <span v-if="faaIcaoHint" class="fpl-equip-faa-icao">({{ faaIcaoHint }})</span>
              </div>
              <span class="fpl-slash">/</span>
              <input
                v-model="draft.equipRight"
                class="fpl-box fpl-input fpl-box--equip-r"
                maxlength="5"
                :disabled="draft.faaMode"
                :title="draft.faaMode ? 'Derived from FAA letter' : 'ICAO field 10b / transponder'"
                @input="onEquipRightInput"
              />
            </div>
          </div>
        </div>

        <!-- Row 3: airports / times — compact ICAO/times; EQCST takes remaining width -->
        <div class="fpl-row">
          <div class="fpl-field fpl-grow-sm">
            <span class="fpl-lbl">ADEP</span>
            <input
              v-model="draft.adep"
              class="fpl-box fpl-input"
              maxlength="4"
              @input="upperDraft('adep')"
            />
          </div>
          <div class="fpl-field fpl-grow-sm">
            <span class="fpl-lbl">ADES</span>
            <input
              v-model="draft.ades"
              class="fpl-box fpl-input"
              maxlength="4"
              @input="upperDraft('ades')"
            />
          </div>
          <div class="fpl-field fpl-grow-sm">
            <span class="fpl-lbl">EOBD</span>
            <input
              v-model="draft.eobd"
              class="fpl-box fpl-input"
              maxlength="6"
              @input="onDigitsDraft('eobd', 6)"
            />
          </div>
          <div class="fpl-field fpl-grow-sm">
            <span class="fpl-lbl">EOBT</span>
            <input
              v-model="draft.eobt"
              class="fpl-box fpl-input"
              maxlength="4"
              @input="onDigitsDraft('eobt', 4)"
            />
          </div>
          <div class="fpl-field fpl-grow-sm">
            <span class="fpl-lbl">CTOT</span>
            <span class="fpl-box" :title="ctotReason || undefined">{{ ctot }}</span>
          </div>
          <div class="fpl-field fpl-grow-eqcst">
            <span class="fpl-lbl">EQCST</span>
            <span class="fpl-box fpl-box--eqcst" :title="eqcst || undefined">{{ eqcst }}</span>
          </div>
        </div>

        <!-- Row 4: performance -->
        <div class="fpl-row">
          <div class="fpl-field fpl-grow-sm">
            <span class="fpl-lbl">TAS</span>
            <input
              v-model="draft.tas"
              class="fpl-box fpl-input"
              maxlength="4"
              @input="onDigitsDraft('tas', 4)"
            />
          </div>
          <div class="fpl-field fpl-grow-sm">
            <span class="fpl-lbl">RFL</span>
            <input
              v-model="draft.rfl"
              class="fpl-box fpl-input"
              maxlength="5"
              @input="upperDraft('rfl')"
            />
          </div>
          <div class="fpl-field fpl-grow-sm">
            <span class="fpl-lbl">EET</span>
            <input
              v-model="draft.eet"
              class="fpl-box fpl-input"
              maxlength="4"
              @input="onDigitsDraft('eet', 4)"
            />
          </div>
          <div class="fpl-field fpl-grow-xs">
            <span class="fpl-lbl">ATO</span>
            <span class="fpl-box">{{ ato }}</span>
          </div>
          <div class="fpl-field fpl-grow-altn">
            <span class="fpl-lbl">ALTN</span>
            <div class="fpl-pair">
              <input
                v-model="draft.altn1"
                class="fpl-box fpl-input"
                maxlength="4"
                @input="upperDraft('altn1')"
              />
              <span class="fpl-slash">/</span>
              <input
                v-model="draft.altn2"
                class="fpl-box fpl-input"
                maxlength="4"
                @input="upperDraft('altn2')"
              />
            </div>
          </div>
          <div class="fpl-field fpl-grow-sm">
            <span class="fpl-lbl">ETD</span>
            <span class="fpl-box">{{ etd }}</span>
          </div>
          <div class="fpl-field fpl-grow-sm">
            <span class="fpl-lbl">ETB</span>
            <span class="fpl-box">{{ etb }}</span>
          </div>
        </div>

        <!-- RTE — only field that scrolls when very long -->
        <div class="fpl-row fpl-row--area fpl-rte">
          <span class="fpl-lbl fpl-lbl--side">RTE</span>
          <textarea
            v-model="draft.route"
            class="fpl-box fpl-box--area fpl-input fpl-textarea"
            rows="3"
            @input="upperDraft('route')"
          />
        </div>

        <!-- TopSky-style: triangle toggles Other / FMF / SUP -->
        <button
          type="button"
          class="fpl-toggle"
          :title="showExtended ? 'Hide Other / FMF / SUP' : 'Show Other / FMF / SUP'"
          @click="showExtended = !showExtended"
        >
          <span class="fpl-toggle-arrow" :class="{ 'fpl-toggle-arrow--open': showExtended }" aria-hidden="true" />
          <span class="fpl-toggle-label">Other / FMF / SUP</span>
        </button>

        <template v-if="showExtended">
          <div class="fpl-row fpl-row--area">
            <span class="fpl-lbl fpl-lbl--side">Other</span>
            <textarea
              v-model="draft.other"
              class="fpl-box fpl-box--area fpl-box--area-lg fpl-input fpl-textarea"
              rows="3"
              @input="upperDraft('other')"
            />
          </div>
          <div class="fpl-row fpl-row--inline">
            <span class="fpl-lbl fpl-lbl--side">FMF</span>
            <span class="fpl-box">{{ fmf }}</span>
          </div>
          <div class="fpl-row fpl-row--inline">
            <span class="fpl-lbl fpl-lbl--side">SUP</span>
            <span class="fpl-box">{{ draft.supl }}</span>
          </div>
        </template>

        <!-- Assigned / state -->
        <div class="fpl-row">
          <div class="fpl-field">
            <span class="fpl-lbl">PSSR</span>
            <span class="fpl-box">{{ pssr }}</span>
          </div>
          <div class="fpl-field">
            <span class="fpl-lbl">ASSR</span>
            <input
              v-model="draft.assr"
              class="fpl-box fpl-input"
              maxlength="5"
              @input="onAssrInput"
            />
          </div>
          <div class="fpl-field">
            <span class="fpl-lbl">PEL/CFL</span>
            <span class="fpl-box">{{ draft.pelCfl }}</span>
          </div>
          <div class="fpl-field fpl-grow-state">
            <span class="fpl-lbl">System State</span>
            <span class="fpl-box">{{ systemState }}</span>
          </div>
          <div class="fpl-field fpl-grow-xs">
            <span class="fpl-lbl">LFUNC</span>
            <span class="fpl-box">{{ lfunc }}</span>
          </div>
        </div>

        <div class="fpl-row">
          <div class="fpl-field">
            <span class="fpl-lbl">ETN</span>
            <span class="fpl-box">{{ etn }}</span>
          </div>
          <div class="fpl-field">
            <span class="fpl-lbl">COPN</span>
            <span class="fpl-box">{{ copn }}</span>
          </div>
          <div class="fpl-field">
            <span class="fpl-lbl">ETX</span>
            <span class="fpl-box">{{ etx }}</span>
          </div>
          <div class="fpl-field">
            <span class="fpl-lbl">COPX</span>
            <span class="fpl-box">{{ copx }}</span>
          </div>
          <div class="fpl-field fpl-grow-xs">
            <span class="fpl-lbl">Type</span>
            <span class="fpl-box">{{ fplType }}</span>
          </div>
          <div class="fpl-field fpl-grow-ifpl">
            <span class="fpl-lbl">IFPLID</span>
            <span class="fpl-box">{{ ifplid }}</span>
          </div>
        </div>

        <div v-if="ctotReason" class="fpl-note">{{ ctotReason }}</div>

        <!-- Debug / live status — collapsed by default -->
        <button
          type="button"
          class="fpl-toggle"
          :title="showDebug ? 'Hide status' : 'Show status'"
          @click="showDebug = !showDebug"
        >
          <span class="fpl-toggle-arrow" :class="{ 'fpl-toggle-arrow--open': showDebug }" aria-hidden="true" />
          <span class="fpl-toggle-label">Status</span>
        </button>

        <template v-if="showDebug">
          <div class="fpl-row">
            <div class="fpl-field fpl-grow-state">
              <span class="fpl-lbl">CTLR</span>
              <span class="fpl-box fpl-box--debug">{{ dbgController }}</span>
            </div>
            <div class="fpl-field">
              <span class="fpl-lbl">GS</span>
              <span class="fpl-box fpl-box--debug">{{ dbgGs }}</span>
            </div>
            <div class="fpl-field">
              <span class="fpl-lbl">STAND</span>
              <span class="fpl-box fpl-box--debug">{{ dbgStand }}</span>
            </div>
            <div class="fpl-field">
              <span class="fpl-lbl">CLR</span>
              <span class="fpl-box fpl-box--debug">{{ dbgClr }}</span>
            </div>
            <div class="fpl-field fpl-grow-state">
              <span class="fpl-lbl">NEXT</span>
              <span class="fpl-box fpl-box--debug">{{ dbgNext }}</span>
            </div>
          </div>
          <div class="fpl-row">
            <div class="fpl-field">
              <span class="fpl-lbl">ALT</span>
              <span class="fpl-box fpl-box--debug">{{ dbgAlt }}</span>
            </div>
            <div class="fpl-field">
              <span class="fpl-lbl">GND SPD</span>
              <span class="fpl-box fpl-box--debug">{{ dbgGndSpd }}</span>
            </div>
            <div class="fpl-field">
              <span class="fpl-lbl">HDG</span>
              <span class="fpl-box fpl-box--debug">{{ dbgHdg }}</span>
            </div>
            <div class="fpl-field">
              <span class="fpl-lbl">SPD</span>
              <span class="fpl-box fpl-box--debug">{{ dbgSpd }}</span>
            </div>
            <div class="fpl-field">
              <span class="fpl-lbl">AIRB</span>
              <span class="fpl-box fpl-box--debug">{{ dbgAirborne }}</span>
            </div>
          </div>
          <div class="fpl-row">
            <div class="fpl-field">
              <span class="fpl-lbl">DEP RWY</span>
              <span class="fpl-box fpl-box--debug">{{ dbgDepRwy }}</span>
            </div>
            <div class="fpl-field">
              <span class="fpl-lbl">SID</span>
              <span class="fpl-box fpl-box--debug">{{ dbgSid }}</span>
            </div>
            <div class="fpl-field">
              <span class="fpl-lbl">ARR RWY</span>
              <span class="fpl-box fpl-box--debug">{{ dbgArrRwy }}</span>
            </div>
            <div class="fpl-field">
              <span class="fpl-lbl">STAR</span>
              <span class="fpl-box fpl-box--debug">{{ dbgStar }}</span>
            </div>
            <div class="fpl-field">
              <span class="fpl-lbl">CTL</span>
              <span class="fpl-box fpl-box--debug">{{ dbgCtl }}</span>
            </div>
          </div>
          <div v-if="hasCdmTimes" class="fpl-row">
            <div v-if="dbgTobt" class="fpl-field">
              <span class="fpl-lbl">TOBT</span>
              <span class="fpl-box fpl-box--debug">{{ dbgTobt }}</span>
            </div>
            <div v-if="dbgTsat" class="fpl-field">
              <span class="fpl-lbl">TSAT</span>
              <span class="fpl-box fpl-box--debug">{{ dbgTsat }}</span>
            </div>
            <div v-if="dbgAsrt" class="fpl-field">
              <span class="fpl-lbl">ASRT</span>
              <span class="fpl-box fpl-box--debug">{{ dbgAsrt }}</span>
            </div>
            <div v-if="dbgCdmSts" class="fpl-field">
              <span class="fpl-lbl">CDM STS</span>
              <span class="fpl-box fpl-box--debug">{{ dbgCdmSts }}</span>
            </div>
            <div v-if="dbgDcl" class="fpl-field">
              <span class="fpl-lbl">DCL</span>
              <span class="fpl-box fpl-box--debug">{{ dbgDcl }}</span>
            </div>
          </div>
          <div class="fpl-row">
            <div class="fpl-field fpl-grow-full">
              <span class="fpl-lbl">SECTION</span>
              <span class="fpl-box fpl-box--debug">{{ dbgSection }}</span>
            </div>
          </div>
        </template>
      </div>

      <div class="fpl-actions">
        <button type="button" class="efs-popup-footer fpl-action" @click="onCancel">Cancel</button>
        <button
          type="button"
          class="efs-popup-footer fpl-action fpl-action--apply"
          :disabled="!isDirty"
          @click="onApply"
        >
          Apply
        </button>
        <button type="button" class="efs-popup-footer fpl-action" @click="dialogOpen = false">Close</button>
      </div>
    </div>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, reactive } from 'vue'
import {
  DEFAULT_TRANSITION_ALTITUDE_FT,
  formatEfsLevel,
  faaToIcaoEquip,
  isFaaEquipLetter,
} from '@vatefs/common'
import type { FlightStrip } from '@/types/efs'
import { useEfsStore } from '@/store/efs'

const props = defineProps<{
  strip: FlightStrip
  modelValue: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const store = useEfsStore()

const dialogOpen = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v)
})

const loading = ref(false)
const flight = ref<Record<string, any> | null>(null)
/** TopSkyAirspace TA for this strip's airport — same source as CFL menu */
const transitionAltitudeFt = ref(DEFAULT_TRANSITION_ALTITUDE_FT)
/** Other / FMF / SUP (TopSky extended mode) */
const showExtended = ref(true)
/** Debug status rows */
const showDebug = ref(false)

interface FplDraft {
  frul: string
  nrac: string
  atyp: string
  wtc: string
  equipLeft: string
  equipRight: string
  adep: string
  ades: string
  eobd: string
  eobt: string
  tas: string
  rfl: string
  eet: string
  altn1: string
  altn2: string
  route: string
  other: string
  supl: string
  assr: string
  pelCfl: string
  /** When true, EQUIP left is FAA single letter */
  faaMode: boolean
}

function emptyDraft(): FplDraft {
  return {
    frul: '',
    nrac: '1',
    atyp: '',
    wtc: '',
    equipLeft: '',
    equipRight: '',
    adep: '',
    ades: '',
    eobd: '',
    eobt: '',
    tas: '',
    rfl: '',
    eet: '',
    altn1: '',
    altn2: '',
    route: '',
    other: '',
    supl: '',
    assr: '',
    pelCfl: '',
    faaMode: false,
  }
}

/** Leading NUMBER/ from EuroScope AircraftInfo (ICAO field 9), else 1. */
function parseNracFromAircraftInfo(info: string): string {
  const m = String(info || '').trim().match(/^(\d{1,2})\//)
  const n = m?.[1]
  return n ? String(parseInt(n, 10)) : '1'
}

const draft = reactive<FplDraft>(emptyDraft())
const baseline = ref<FplDraft>(emptyDraft())

function pick(...vals: unknown[]): string {
  for (const v of vals) {
    if (v == null || v === '') continue
    const s = String(v).trim()
    if (s) return s
  }
  return ''
}

/** EFS-wide A/F levels (A050 / F090) — same TA as CFL menu (TopSkyAirspace). */
function formatFL(feet: number | string | undefined | null): string {
  if (feet == null || feet === '' || feet === 0) return ''
  return formatEfsLevel(feet, transitionAltitudeFt.value)
}

function formatEet(minutes: number | undefined | null): string {
  if (minutes == null || !(minutes > 0)) return ''
  const m = Math.round(minutes)
  return String(Math.floor(m / 60)).padStart(2, '0') + String(m % 60).padStart(2, '0')
}

function formatAssr(code: string): string {
  if (!code) return ''
  return code.startsWith('A') || code.startsWith('a') ? code.toUpperCase() : `A${code}`
}

/** TopSky EQCST: W/EQ Y/EQ U/NO … from field 10a letters. */
function deriveEqcst(equipment: string): string {
  if (!equipment) return ''
  const eq = equipment.toUpperCase()
  return (['W', 'Y', 'U', 'R', 'P', 'S'] as const)
    .map((c) => `${c}/${eq.includes(c) ? 'EQ' : 'NO'}`)
    .join(' ')
}

function parseAltn2(remarks: string, altn1: string): string {
  if (!remarks) return ''
  const m = remarks.match(/\b(?:RALT|ALTN)\/([A-Z0-9]{3,4})\b/i)
  if (!m?.[1]) return ''
  const icao = m[1].toUpperCase()
  if (altn1 && icao === altn1.toUpperCase()) return ''
  return icao
}

/** SUP: E/HHmm endurance + P/nnn + C/pilot (ICAO item 19 / ES-style). */
function formatSupl(endurance: string, pilotName: string, remarks: string): string {
  const parts: string[] = []
  if (endurance) parts.push(`E/${endurance}`)
  else {
    const em = remarks.match(/\bE\/(\d{4})\b/i)
    if (em) parts.push(`E/${em[1]}`)
  }
  const pm = remarks.match(/\bP\/(\d{1,3})\b/i)
  if (pm?.[1]) parts.push(`P/${pm[1].padStart(3, '0')}`)
  const pic =
    pilotName.trim() ||
    remarks.match(/\bC\/([^\n/]+?)(?=\s+[A-Z]\/|$)/i)?.[1]?.trim() ||
    ''
  if (pic) parts.push(`C/${pic}`)
  return parts.join(' ')
}

/** Surveillance letter from FAA→ICAO map (e.g. G → H). */
function faaSurFromLetter(letter: string): string {
  const icao = faaToIcaoEquip(letter) || ''
  const parts = icao.split('/')
  return (parts[1] || '').toUpperCase()
}

function snapshotFromFlight(): FplDraft {
  const f = flight.value
  const s = props.strip
  const altn1 = pick(f?.alternate)
  const remarks = pick(f?.fplRemarks)
  const faaLetter = pick(f?.faaEquipment)
  const faaMode = !!(faaLetter || f?.equipmentDisplay)
  let equipLeft = ''
  let equipRight = ''
  if (faaMode) {
    equipLeft = (faaLetter || pick(f?.equipmentDisplay).charAt(0) || '').slice(0, 1).toUpperCase()
    // Always show SUR window — fill from FAA conversion (or stored ICAO sur)
    equipRight = pick(f?.surveillance) || faaSurFromLetter(equipLeft)
  } else {
    equipLeft = pick(f?.equipment)
    equipRight = pick(f?.surveillance)
  }
  const cfl =
    formatFL(f?.cfl ?? null) ||
    formatFL(s.clearedAltitude) ||
    pick(s.clearedAltitude)
  const xfl =
    formatFL(f?.xfl ?? null) ||
    formatFL(s.xfl) ||
    pick(s.xfl)
  return {
    frul: pick(f?.flightRules, s.flightRules).slice(0, 1).toUpperCase(),
    nrac: parseNracFromAircraftInfo(pick(f?.aircraftInfo)) || '1',
    atyp: pick(f?.aircraftType, s.aircraftType).toUpperCase(),
    wtc: pick(f?.wakeTurbulence, s.wakeTurbulence).slice(0, 1).toUpperCase(),
    equipLeft,
    equipRight,
    adep: pick(f?.origin, s.adep).toUpperCase(),
    ades: pick(f?.destination, s.ades).toUpperCase(),
    eobd: pick(f?.eobd),
    eobt: pick(f?.eobt, s.eobt),
    tas: pick(f?.tas, s.tas).replace(/\D/g, '').slice(0, 4),
    rfl: formatFL(f?.rfl ?? null) || pick(s.rfl),
    eet: pick(f?.filedEet) || formatEet(f?.ete ?? null),
    altn1: altn1.toUpperCase(),
    altn2: parseAltn2(remarks, altn1).toUpperCase(),
    route: pick(f?.route, s.route).toUpperCase(),
    other: remarks.toUpperCase(),
    supl: formatSupl(pick(f?.endurance), pick(f?.pilotName), remarks).toUpperCase(),
    assr: formatAssr(pick(f?.squawk, s.squawk)),
    pelCfl: cfl || xfl,
    faaMode,
  }
}

function applySnapshot(src: FplDraft) {
  Object.assign(draft, { ...src })
}

function draftEquals(a: FplDraft, b: FplDraft): boolean {
  const keys = Object.keys(a) as (keyof FplDraft)[]
  return keys.every((k) => String(a[k] ?? '') === String(b[k] ?? ''))
}

const isDirty = computed(() => !draftEquals(draft, baseline.value))
/** Dimmed ICAO conversion after FAA letter, e.g. SDFGRY/H — only while faaMode */
const faaIcaoHint = computed(() =>
  draft.faaMode && isFaaEquipLetter(draft.equipLeft) ? faaToIcaoEquip(draft.equipLeft) || '' : ''
)

/**
 * FAA when left is a single mapped letter (SUR is derived, not editable).
 * Typing a second left character switches to ICAO — clear autofilled FAA SUR.
 */
function syncEquipMode() {
  const left = draft.equipLeft
  const wasFaa = draft.faaMode
  if (left.length === 1 && isFaaEquipLetter(left)) {
    draft.faaMode = true
    const expectedSur = faaSurFromLetter(left)
    if (expectedSur) draft.equipRight = expectedSur
    return
  }
  draft.faaMode = false
  // Leaving FAA → drop SUR that was derived from the FAA letter
  if (wasFaa) draft.equipRight = ''
}

const f = computed(() => flight.value)
const s = computed(() => props.strip)

const cs = computed(() => pick(f.value?.callsign, s.value.callsign))
const ftyp = computed(() => '') // TopSky FTYP — not in EuroScope plugin API
const ctot = computed(() => pick(f.value?.ctot, s.value.ctot))
const ctotReason = computed(() => pick(f.value?.ctotReason, s.value.ctotReason))
const eqcst = computed(() => {
  if (draft.faaMode && isFaaEquipLetter(draft.equipLeft)) {
    const icao = faaToIcaoEquip(draft.equipLeft) || ''
    const left = icao.split('/')[0] || ''
    return deriveEqcst(left)
  }
  return deriveEqcst(draft.equipLeft)
})
const ato = computed(() => '') // ATOW — not available (TopSky)
const etd = computed(() => pick(draft.eobt, f.value?.ttot, f.value?.ctot))
const etb = computed(() => {
  if (draft.eet || f.value?.filedEet) return formatEet(f.value?.ete ?? null)
  return ''
})
const fmf = computed(() => '') // Flight Message — not in ES feed
const pssr = computed(() => formatAssr(pick(f.value?.previousSquawk)))
const systemState = computed(() => {
  const ctl = pick(f.value?.controller, s.value.ownerCallsign)
  if (!ctl) return 'FREE'
  if (s.value.isAssumed || ctl === store.myCallsign) return 'ASSUMED'
  if (s.value.transferPending === 'in') return 'HANDOFF IN'
  if (s.value.transferPending === 'out') return 'HANDOFF OUT'
  return 'TRACKED'
})
/** LFUNC = tracking controller SI (not login callsign) */
const lfunc = computed(() => pick(f.value?.controllerId, s.value.ownerSi))
const etn = computed(() => '')
const copn = computed(() => '')
const etx = computed(() => '')
const copx = computed(() => '')
/**
 * TopSky "Type" APL/FPL — EuroScope SDK has no APL/FPL flag (GetPlanType is I/V only).
 * Heuristic: both ADEP+ADES → FPL, else APL when a callsign exists.
 */
const fplType = computed(() => {
  if (draft.adep && draft.ades) return 'FPL'
  if (cs.value) return 'APL'
  return ''
})
const ifplid = computed(() => '') // TopSky: not available

// —— Debug status rows ——
const dbgController = computed(() =>
  pick(f.value?.controller, s.value.ownerCallsign) || '---'
)
const dbgGs = computed(() =>
  pick(f.value?.groundstate, s.value.groundstate) || '---'
)
const dbgStand = computed(() => pick(f.value?.stand, s.value.stand) || '---')
const dbgClr = computed(() => {
  const clr = f.value?.clearance ?? s.value.clearance
  if (clr == null) return '---'
  return clr ? 'YES' : 'NO'
})
const dbgNext = computed(() =>
  pick(
    f.value?.handoffTargetController,
    f.value?.nextController,
    s.value.transferCallsign,
    s.value.nextSiCallsign
  ) || '---'
)
const dbgAlt = computed(() => {
  const a = f.value?.currentAltitude
  return a != null ? `${Math.round(a)}ft` : '---'
})
const dbgGndSpd = computed(() => {
  const g = f.value?.groundSpeed
  return g != null ? `${g}kt` : '---'
})
const dbgHdg = computed(() => {
  const h = f.value?.ahdg
  if (h == null || h === 0) return pick(s.value.assignedHeading) || '---'
  return String(h).padStart(3, '0')
})
const dbgSpd = computed(() => {
  if (f.value?.asp) return String(f.value.asp)
  if (f.value?.mach) return `M${f.value.mach}`
  return pick(s.value.assignedSpeed) || '---'
})
const dbgAirborne = computed(() => {
  const a = f.value?.airborne ?? s.value.airborne
  if (a == null) return '---'
  return a ? 'YES' : 'NO'
})
const dbgDepRwy = computed(() => pick(f.value?.depRwy, s.value.runway) || '---')
const dbgSid = computed(() => pick(f.value?.sid, s.value.sid) || '---')
const dbgArrRwy = computed(() => pick(f.value?.arrRwy) || '---')
const dbgStar = computed(() => pick(f.value?.star, s.value.star) || '---')
const dbgCtl = computed(() => {
  const c = f.value?.clearedToLand ?? s.value.clearedToLand
  if (c == null) return '---'
  return c ? 'YES' : 'NO'
})
const hasCdmTimes = computed(() => {
  const fl = f.value
  if (!fl) return !!(s.value.tobt || s.value.tsat || s.value.ctot || s.value.asrt || s.value.cdmSts || s.value.dclStatus)
  return !!(fl.tobt || fl.tsat || fl.ctot || fl.asrt || fl.tsac || fl.ctoc || fl.cdmSts || fl.dclStatus)
})
const dbgTobt = computed(() => {
  const t = pick(f.value?.tobt, s.value.tobt)
  if (!t) return ''
  const by = pick(f.value?.tobtSetBy, s.value.tobtSetBy)
  return by ? `${t}(${by})` : t
})
const dbgTsat = computed(() => pick(f.value?.tsat, s.value.tsat))
const dbgAsrt = computed(() => pick(f.value?.asrt, s.value.asrt))
const dbgCdmSts = computed(() => pick(f.value?.cdmSts, s.value.cdmSts))
const dbgDcl = computed(() => pick(f.value?.dclStatus, s.value.dclStatus))
const dbgSection = computed(() => {
  const bay = s.value.bayId || '?'
  const sec = s.value.sectionId || '?'
  const rule = pick(f.value?.lastSectionRule)
  const parts = [`${bay}/${sec}`]
  if (rule) parts.push(`rule=${rule}`)
  if (s.value.isAssumed) parts.push('mine')
  else if (s.value.ownedByOther) parts.push('other')
  if (s.value.transferPending) parts.push(`xfer-${s.value.transferPending}`)
  return parts.join('  ')
})

function upperDraft(key: keyof FplDraft) {
  const v = draft[key]
  if (typeof v === 'string') (draft as any)[key] = v.toUpperCase()
}

function onFrulInput() {
  draft.frul = draft.frul.toUpperCase().replace(/[^IVYZ]/g, '').slice(0, 1)
}

function onNracInput() {
  let n = draft.nrac.replace(/\D/g, '').slice(0, 2)
  if (n === '0') n = '1'
  draft.nrac = n
}

function onWtcInput() {
  draft.wtc = draft.wtc.toUpperCase().replace(/[^LHMJ]/g, '').slice(0, 1)
}

const equipLeftInput = ref<HTMLInputElement | null>(null)

function focusEquipLeft() {
  const el = equipLeftInput.value
  if (!el) return
  el.focus()
  // Place caret at end so typing continues the code
  const len = el.value.length
  try {
    el.setSelectionRange(len, len)
  } catch {
    /* ignore */
  }
}

function onEquipLeftInput() {
  // Always allow multi-char ICAO equip — FAA is only when a single mapped letter remains
  draft.equipLeft = draft.equipLeft.toUpperCase().replace(/[^A-Z0-9]/g, '')
  syncEquipMode()
}

function onEquipRightInput() {
  draft.equipRight = draft.equipRight.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5)
  syncEquipMode()
}

function onDigitsDraft(key: 'eobd' | 'eobt' | 'tas' | 'eet', max: number) {
  draft[key] = draft[key].replace(/\D/g, '').slice(0, max)
}

function onAssrInput() {
  let v = draft.assr.toUpperCase().replace(/[^A0-7]/g, '')
  if (v.startsWith('A')) v = 'A' + v.slice(1).replace(/[^0-7]/g, '').slice(0, 4)
  else v = v.replace(/[^0-7]/g, '').slice(0, 4)
  draft.assr = v
}

function taAirport(): string {
  const type = props.strip.stripType
  const dest = pick(draft.ades, f.value?.destination, props.strip.ades).toUpperCase()
  const orig = pick(draft.adep, f.value?.origin, props.strip.adep).toUpperCase()
  if (type === 'arrival' || type === 'local') return dest
  return orig || dest
}

async function fetchTransitionAltitude() {
  const airport = taAirport()
  if (!airport || airport === '????' || airport === 'ZZZZ') {
    transitionAltitudeFt.value = DEFAULT_TRANSITION_ALTITUDE_FT
    return
  }
  try {
    const res = await fetch(`/api/transition-altitude?airport=${encodeURIComponent(airport)}`)
    if (!res.ok) {
      transitionAltitudeFt.value = DEFAULT_TRANSITION_ALTITUDE_FT
      return
    }
    const data = (await res.json()) as { feet?: number }
    transitionAltitudeFt.value =
      typeof data.feet === 'number' && data.feet > 0 ? data.feet : DEFAULT_TRANSITION_ALTITUDE_FT
  } catch {
    transitionAltitudeFt.value = DEFAULT_TRANSITION_ALTITUDE_FT
  }
}

function loadDraftFromFlight() {
  const snap = snapshotFromFlight()
  baseline.value = { ...snap }
  applySnapshot(snap)
}

async function fetchFlight() {
  loading.value = true
  try {
    const res = await fetch(`/api/flight/${encodeURIComponent(props.strip.callsign)}`)
    flight.value = res.ok ? await res.json() : null
    await fetchTransitionAltitude()
    loadDraftFromFlight()
  } catch {
    flight.value = null
    loadDraftFromFlight()
  } finally {
    loading.value = false
  }
}

function onCancel() {
  applySnapshot(baseline.value)
  dialogOpen.value = false
}

function onApply() {
  if (!isDirty.value) return
  const b = baseline.value
  const d = draft
  const fields: Parameters<typeof store.amendFlightPlan>[1] = {}

  if (d.frul !== b.frul) fields.flightRules = d.frul
  if (d.atyp !== b.atyp) fields.aircraftType = d.atyp
  if (d.wtc !== b.wtc) fields.wakeTurbulence = d.wtc
  if (d.adep !== b.adep) fields.origin = d.adep
  if (d.ades !== b.ades) fields.destination = d.ades
  if (d.eobd !== b.eobd) fields.eobd = d.eobd
  if (d.eobt !== b.eobt) fields.eobt = d.eobt
  if (d.tas !== b.tas) fields.tas = d.tas
  if (d.rfl !== b.rfl) fields.rfl = d.rfl
  if (d.eet !== b.eet) fields.eet = d.eet
  if (d.altn1 !== b.altn1) fields.alternate = d.altn1
  if (d.altn2 !== b.altn2) fields.alternate2 = d.altn2
  if (d.route !== b.route) fields.route = d.route
  if (d.other !== b.other) fields.fplRemarks = d.other
  if (d.assr !== b.assr) fields.squawk = d.assr.replace(/^A/i, '')
  // SUP + PEL/CFL are display-only (not pushed)

  const equipChanged =
    d.equipLeft !== b.equipLeft ||
    d.equipRight !== b.equipRight ||
    d.faaMode !== b.faaMode ||
    d.atyp !== b.atyp ||
    d.wtc !== b.wtc ||
    d.nrac !== b.nrac

  if (equipChanged) {
    // NRAC only goes into AircraftInfo when > 1 (omit NUMBER/ for single aircraft).
    // Still send 1 when clearing a previous formation so ES drops the prefix.
    const nrac = Math.max(1, parseInt(d.nrac || '1', 10) || 1)
    const prevNrac = Math.max(1, parseInt(b.nrac || '1', 10) || 1)
    if (nrac > 1 || prevNrac > 1) {
      fields.numberOfAircraft = nrac
    }
    if (d.faaMode) {
      const letter = d.equipLeft.slice(0, 1).toUpperCase()
      if (letter) fields.faaEquipment = letter
      if (d.atyp) fields.aircraftType = d.atyp
      if (d.wtc) fields.wakeTurbulence = d.wtc
    } else if (d.equipLeft !== b.equipLeft || d.equipRight !== b.equipRight || d.nrac !== b.nrac) {
      fields.equipment = d.equipLeft
      fields.surveillance = d.equipRight
      if (d.atyp) fields.aircraftType = d.atyp
      if (d.wtc) fields.wakeTurbulence = d.wtc
    } else if (d.atyp !== b.atyp || d.wtc !== b.wtc) {
      if (d.atyp) fields.aircraftType = d.atyp
      if (d.wtc) fields.wakeTurbulence = d.wtc
    }
  }

  if (Object.keys(fields).length === 0) {
    applySnapshot(baseline.value)
    return
  }

  store.amendFlightPlan(props.strip.id, fields)
  // Treat applied draft as new baseline (optimistic)
  baseline.value = { ...d }
  // Refresh display conversion for FAA after apply
  if (d.faaMode && isFaaEquipLetter(d.equipLeft)) {
    // keep letter in edit box; equipmentDisplay updates when flight refetch arrives
  }
}

watch(dialogOpen, (open) => {
  if (open) fetchFlight()
})
</script>

<style>
/* TopSky-inspired FPL form; grey chrome matches other efs-popup dialogs */
.fpl-dialog-wrapper {
  box-shadow: none !important;
  background: transparent !important;
}

.fpl-dialog {
  --s: var(--efs-scale, 1);
  position: relative;
  width: 100%;
  max-width: min(98vw, calc(780px * var(--s)));
  /* Prefer fitting full form; only RTE scrolls when long */
  max-height: none;
  overflow: visible;
}

.fpl-loading {
  text-align: center;
}

.fpl-body {
  display: flex;
  flex-direction: column;
  gap: calc(4px * var(--s));
  padding: calc(8px * var(--s));
  background: #d8d8d8;
  border-bottom: 1px solid #888;
  box-sizing: border-box;
}

.fpl-row {
  display: flex;
  flex-wrap: nowrap;
  align-items: flex-end;
  gap: calc(4px * var(--s));
  min-width: 0;
}

.fpl-row--area {
  align-items: stretch;
}

.fpl-row--inline {
  align-items: center;
}

.fpl-row--inline .fpl-lbl--side {
  padding-top: 0;
  align-self: center;
}

.fpl-divider {
  height: 0;
  margin: calc(2px * var(--s)) 0;
  border: none;
  border-top: 2px solid #555;
}

.fpl-field {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  flex: 1 1 0;
}

.fpl-grow-cs { flex: 1.5 1 0; }
.fpl-grow-atyp { flex: 1.35 1 0; }
.fpl-grow-altn { flex: 1.2 1 0; }
/* Compact ICAO / time boxes (ADEP, EOBT, RFL, …) */
.fpl-grow-sm {
  flex: 0 1 auto;
  width: calc(52px * var(--s));
  max-width: calc(58px * var(--s));
  min-width: calc(44px * var(--s));
}
/* EQCST needs ~W/EQ Y/EQ U/NO R/EQ P/EQ S/EQ — take remaining row width */
.fpl-grow-eqcst {
  flex: 1 1 auto;
  min-width: calc(220px * var(--s));
}
.fpl-grow-state { flex: 1.7 1 0; }
.fpl-grow-ifpl { flex: 1.3 1 0; }
.fpl-grow-full { flex: 1 1 auto; width: 100%; }
.fpl-grow-xs {
  flex: 0.55 1 0;
  max-width: calc(52px * var(--s));
}

.fpl-lbl {
  font-size: calc(8px * var(--s));
  font-weight: 800;
  letter-spacing: 0.06em;
  color: #555;
  text-transform: uppercase;
  line-height: 1.1;
  white-space: nowrap;
}

.fpl-lbl--side {
  flex: 0 0 calc(40px * var(--s));
  align-self: flex-start;
  padding-top: calc(5px * var(--s));
}

.fpl-pair {
  display: flex;
  align-items: stretch;
  gap: calc(3px * var(--s));
  min-width: 0;
}

.fpl-pair--equip .fpl-equip-left {
  flex: 1 1 auto;
  min-width: 0;
}

/* Left EQUIP: editable text + optional dimmed FAA→ICAO hint */
.fpl-equip-left {
  display: flex;
  align-items: center;
  gap: calc(4px * var(--s));
  background: #fff;
  cursor: text;
  padding-right: calc(4px * var(--s));
}

.fpl-equip-left-input {
  flex: 0 1 auto;
  min-width: calc(1.2em + 2px);
  width: auto;
  max-width: 100%;
  margin: 0;
  padding: 0;
  border: none;
  outline: none;
  appearance: none;
  -webkit-appearance: none;
  background: transparent;
  color: #000;
  font: inherit;
  font-weight: 800;
  letter-spacing: inherit;
  text-transform: uppercase;
  line-height: inherit;
  field-sizing: content;
}

.fpl-equip-left:not(.fpl-equip-left--faa) .fpl-equip-left-input {
  flex: 1 1 auto;
  width: 100%;
}

.fpl-equip-left:focus-within {
  border-color: #1a3a6e;
  box-shadow: inset 0 0 0 1px #1a3a6e;
}

.fpl-equip-faa-icao {
  flex: 1 1 auto;
  min-width: 0;
  color: #888;
  font-weight: 700;
  letter-spacing: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: clip;
  user-select: none;
  pointer-events: none;
}

.fpl-slash {
  flex: 0 0 auto;
  align-self: center;
  font-size: calc(11px * var(--s));
  font-weight: 800;
  color: #555;
}

.fpl-box {
  display: block;
  box-sizing: border-box;
  width: 100%;
  min-height: calc(24px * var(--s));
  padding: calc(4px * var(--s)) calc(5px * var(--s));
  border: 1px solid #888;
  background: #ebebeb;
  color: #000;
  font-size: calc(12px * var(--s));
  font-weight: 800;
  letter-spacing: 0.15px;
  text-transform: uppercase;
  line-height: 1.25;
  /* Single-line fields — never wrap (RTE/Other use --area) */
  white-space: nowrap;
  overflow: hidden;
  text-overflow: clip;
  font-family: ui-monospace, "Cascadia Mono", "Segoe UI Mono", Consolas, monospace;
}

.fpl-input {
  margin: 0;
  appearance: none;
  -webkit-appearance: none;
  border-radius: 0;
  outline: none;
  background: #fff;
  cursor: text;
}

.fpl-input:focus {
  border-color: #1a3a6e;
  box-shadow: inset 0 0 0 1px #1a3a6e;
}

.fpl-input:disabled {
  background: #ebebeb;
  color: #888;
  cursor: default;
}

.fpl-textarea {
  white-space: pre-wrap;
  word-break: break-word;
  resize: vertical;
  overflow-y: auto;
}

.fpl-box--wtc {
  flex: 0 0 calc(32px * var(--s));
  text-align: center;
  padding-left: 2px;
  padding-right: 2px;
  white-space: nowrap;
}

.fpl-box--equip-r {
  flex: 0 0 calc(40px * var(--s));
  text-align: center;
  white-space: nowrap;
}

.fpl-box--eqcst {
  font-size: calc(11px * var(--s));
  letter-spacing: 0;
  padding-left: calc(4px * var(--s));
  padding-right: calc(4px * var(--s));
  overflow: visible;
}

/* Multi-line fields grow with content — only RTE scrolls when very long */
.fpl-box--area {
  flex: 1 1 auto;
  white-space: pre-wrap;
  word-break: break-word;
  min-height: calc(52px * var(--s));
  max-height: none;
  overflow: visible;
  font-size: calc(11px * var(--s));
  font-weight: 700;
  line-height: 1.35;
  user-select: text;
  -webkit-user-select: text;
  cursor: text;
}

.fpl-box--area-lg {
  min-height: calc(64px * var(--s));
}

/* RTE only: cap height + scrollbar when route is long */
.fpl-rte .fpl-box--area {
  max-height: calc(140px * var(--s));
  overflow-y: auto;
}

.fpl-box:empty::before {
  content: '\00a0';
}

.fpl-note {
  font-size: calc(10px * var(--s));
  font-weight: 700;
  color: #333;
  line-height: 1.3;
  text-transform: uppercase;
}

.fpl-toggle {
  display: flex;
  align-items: center;
  gap: calc(6px * var(--s));
  width: 100%;
  margin: calc(2px * var(--s)) 0;
  padding: calc(3px * var(--s)) calc(4px * var(--s));
  border: none;
  border-top: 1px solid #999;
  background: transparent;
  cursor: pointer;
  text-align: left;
  font: inherit;
  color: #444;
}

.fpl-toggle:hover {
  background: rgba(0, 0, 0, 0.06);
}

.fpl-toggle-arrow {
  flex: 0 0 auto;
  width: 0;
  height: 0;
  border-left: calc(5px * var(--s)) solid transparent;
  border-right: calc(5px * var(--s)) solid transparent;
  border-top: calc(6px * var(--s)) solid #444;
  transform: rotate(-90deg);
  transition: transform 0.12s ease;
}

.fpl-toggle-arrow--open {
  transform: rotate(0deg);
}

.fpl-toggle-label {
  font-size: calc(9px * var(--s));
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.fpl-box--debug {
  background: #e2e2e2;
  font-size: calc(11px * var(--s));
  font-weight: 700;
  text-transform: none;
}

.fpl-actions {
  display: flex;
}

.fpl-actions .fpl-action {
  flex: 1;
  border-right: 1px solid #888;
}

.fpl-actions .fpl-action:last-child {
  border-right: none;
}

.fpl-action--apply:not(:disabled) {
  background: #8fbf7a;
  color: #0a2a0a;
}

.fpl-action--apply:not(:disabled):hover {
  background: #6aa05a;
  color: #fff;
}

.fpl-action--apply:disabled {
  opacity: 0.45;
  cursor: default;
}

@media (max-width: 640px) {
  .fpl-row {
    flex-wrap: wrap;
  }
  .fpl-field,
  .fpl-grow-cs,
  .fpl-grow-atyp,
  .fpl-grow-altn,
  .fpl-grow-eqcst,
  .fpl-grow-sm,
  .fpl-grow-state,
  .fpl-grow-ifpl,
  .fpl-grow-xs {
    flex: 1 1 calc(46% - 4px);
    max-width: none;
    min-width: 0;
    width: auto;
  }
  .fpl-grow-eqcst {
    flex: 1 1 100%;
    min-width: 0;
  }
  .fpl-lbl--side {
    flex-basis: 100%;
    padding-top: 0;
  }
}
</style>

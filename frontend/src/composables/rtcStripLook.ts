/**
 * RTC column strip chrome.
 * Airports come from data/airport-strip-mode.xlsx.
 * E-strip stays SAAB. Paper and Mix can be switched per airport.
 * Paper on ESGG is the ESGG strip; paper elsewhere is the generic strip.
 */
import { ref } from 'vue'

export type RtcStripChoice = 'saab' | 'paper'

/** Airports that use electronic strips. No RTC choice. */
const E_STRIP = new Set([
  'ESKS',
  'ESNN',
  'ESNO',
  'ESNQ',
  'ESNU',
  'ESNZ',
  'ESSA',
  'ESSL',
])

/** Paper, plus ESMS (mix). These columns can switch. */
const CHOOSABLE = new Set([
  'ESCF', 'ESCM', 'ESDF', 'ESGG', 'ESGJ', 'ESGT', 'ESIA', 'ESIB',
  'ESKM', 'ESKN', 'ESMK', 'ESMQ', 'ESMS', 'ESMT', 'ESMV', 'ESMX',
  'ESND', 'ESNG', 'ESNJ', 'ESNK', 'ESNL', 'ESNP', 'ESNS', 'ESNV',
  'ESNX', 'ESOE', 'ESOH', 'ESOK', 'ESOW', 'ESPA', 'ESPE', 'ESSB',
  'ESSD', 'ESSP', 'ESST', 'ESSU', 'ESSV', 'ESTA', 'ESTL', 'ESUP',
  'ESUT',
])

const STORAGE_KEY = 'vatefs.rtcStripLook'

/** Overrides from the paper default. Only 'saab' is stored. */
const choiceByAirport = ref<Record<string, RtcStripChoice>>({})

function loadChoices() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const next: Record<string, RtcStripChoice> = {}
    for (const [key, value] of Object.entries(parsed)) {
      const icao = key.toUpperCase()
      if (!CHOOSABLE.has(icao)) continue
      if (value === 'saab' || value === 'paper') next[icao] = value
    }
    choiceByAirport.value = next
  } catch {
    choiceByAirport.value = {}
  }
}

loadChoices()

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(choiceByAirport.value))
  } catch {
    /* private mode */
  }
}

export function rtcStripChoiceAvailable(icao: string | null | undefined): boolean {
  const code = (icao || '').toUpperCase()
  if (!code || E_STRIP.has(code)) return false
  return CHOOSABLE.has(code)
}

/** Selected look for a choosable airport. Others are SAAB. */
export function rtcStripChoice(icao: string | null | undefined): RtcStripChoice {
  const code = (icao || '').toUpperCase()
  if (!rtcStripChoiceAvailable(code)) return 'saab'
  return choiceByAirport.value[code] ?? 'paper'
}

export function setRtcStripChoice(icao: string | null | undefined, choice: RtcStripChoice) {
  const code = (icao || '').toUpperCase()
  if (!rtcStripChoiceAvailable(code)) return
  const next = { ...choiceByAirport.value }
  if (choice === 'paper') delete next[code]
  else next[code] = 'saab'
  choiceByAirport.value = next
  persist()
}

/** Chrome for one RTC column. Empty when the column has no airport. */
export function rtcColumnStripKind(
  icao: string | null | undefined,
): 'saab' | 'paper' | 'std' {
  const code = (icao || '').toUpperCase()
  if (!code) return 'saab'
  if (rtcStripChoice(code) === 'saab') return 'saab'
  return code === 'ESGG' ? 'paper' : 'std'
}

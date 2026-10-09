/**
 * ESSA G/A / MAP info-strip content.
 * Delivery heading / sector from Appendix A (essa-sid-prefs);
 * procedure text abbreviated from AIP IAC missed-approach.
 */

import {
  essaPhysicalPairForRunway,
  essaRunwaySectionId,
} from '@vatefs/common'

export type MapAppSector = 'ARR-E' | 'ARR-W'

export type EssaMapInfo = {
  /** Arrival runway shown on the strip */
  runway: string
  /** Missed-approach procedure lines */
  mapLines: string[]
  /** Appendix A delivery heading (degrees) */
  heading: number
  mapNextSector: MapAppSector
  /** Default APP frequency when offline */
  defaultFreq: string
  /** TWR box value (DME / IAS limit shorthand, AIP ≈ 4.0) */
  twrDme: string
  /** Emphasize MAP procedure text (e.g. config 5 special instruction) */
  highlightProc?: boolean
}

/** Fallback APP frequencies (ESSA E/W APP). */
const FREQ_ARR_E = '126.655'
const FREQ_ARR_W = '123.755'

/** AIP-style MAP text keyed by arrival runway (balanced across two rows). */
const MAP_TEXT_BY_RWY: Record<string, string[]> = {
  '01L': [
    'MAP: Climb straight ahead. At 600 or SSA DME 1.7,',
    'whichever is latest, turn left to track 328° climbing to 1500 ft',
  ],
  '01R': [
    'MAP: Climb straight ahead. At 600 or TSA DME 1.5,',
    'whichever is latest, turn right to track 038° climbing to 1500 ft',
  ],
  '19L': [
    'MAP: Climb straight ahead. At 600 or USA DME 1.5,',
    'whichever is latest, turn left to track 148° climbing to 1500 ft',
  ],
  '19R': [
    'MAP: Climb straight ahead to 1500 ft',
  ],
  '08': [
    'MAP: Climb on course 070° / straight ahead to 1500 ft',
  ],
  '26': [
    'MAP: Climb straight ahead to 1500 ft',
  ],
}

/** Config 5 (ARR 01R / DEP 08): TWR briefing override. */
const CONFIG_5_MAP_LINES = [
  'MAP: TWR shall inform all arrivals:',
  '“In case of missed approach, climb on RWY HDG to 1500 ft.”',
]

type PrefRow = {
  runway: string
  heading: number
  sector: MapAppSector
}

/**
 * Per-config ARR runway + Appendix A MAP delivery
 * (mirrors data/essa-sid-prefs.json mapHeading / mapNextSector).
 */
const PREFS_BY_CONFIG: Record<string, PrefRow> = {
  '1': { runway: '01R', heading: 90, sector: 'ARR-E' },
  '2': { runway: '19L', heading: 90, sector: 'ARR-E' },
  '3': { runway: '01L', heading: 270, sector: 'ARR-W' },
  '4': { runway: '01L', heading: 270, sector: 'ARR-W' },
  '5': { runway: '01R', heading: 270, sector: 'ARR-W' },
  '6': { runway: '01R', heading: 90, sector: 'ARR-E' },
  '7': { runway: '08', heading: 360, sector: 'ARR-E' },
  '8': { runway: '08', heading: 360, sector: 'ARR-E' },
  '9A': { runway: '19L', heading: 90, sector: 'ARR-E' },
  '9B': { runway: '19L', heading: 90, sector: 'ARR-E' },
  '9C': { runway: '19L', heading: 90, sector: 'ARR-E' },
  '10': { runway: '19R', heading: 270, sector: 'ARR-W' },
  '11': { runway: '19R', heading: 270, sector: 'ARR-W' },
  '12': { runway: '19R', heading: 270, sector: 'ARR-W' },
  '13': { runway: '26', heading: 180, sector: 'ARR-W' },
  '14': { runway: '26', heading: 300, sector: 'ARR-W' },
  '15A': { runway: '26', heading: 300, sector: 'ARR-W' },
  '15B': { runway: '26', heading: 300, sector: 'ARR-W' },
  '15C': { runway: '26', heading: 300, sector: 'ARR-W' },
  '16': { runway: '26', heading: 180, sector: 'ARR-W' },
}

function defaultFreqFor(sector: MapAppSector): string {
  return sector === 'ARR-E' ? FREQ_ARR_E : FREQ_ARR_W
}

export function getEssaMapInfo(configId: string): EssaMapInfo | null {
  const pref = PREFS_BY_CONFIG[configId]
  if (!pref) return null

  const highlightProc = configId === '5'
  const mapLines = highlightProc
    ? CONFIG_5_MAP_LINES
    : (MAP_TEXT_BY_RWY[pref.runway] ?? ['MAP: Climb straight ahead to 1500'])

  return {
    runway: pref.runway,
    mapLines,
    heading: pref.heading,
    mapNextSector: pref.sector,
    defaultFreq: defaultFreqFor(pref.sector),
    twrDme: '4.0',
    highlightProc: highlightProc || undefined,
  }
}

/** Physical ESSA runway section id that hosts this ARR runway. */
export function essaMapDefaultSectionId(runway: string): string | null {
  const pair = essaPhysicalPairForRunway(runway)
  return pair ? essaRunwaySectionId(pair) : null
}

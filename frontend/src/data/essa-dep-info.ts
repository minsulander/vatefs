/**
 * ESSA DEP RWY info-strip types / helpers.
 * Strip body content is loaded from GET /api/essa-dep-info (sid prefs + live freqs).
 */

import {
  essaPhysicalPairForRunway,
  essaRunwaySectionId,
  getEssaRwyCombination,
} from '@vatefs/common'

export type DepInfoTurn = 'LEFT' | 'RIGHT'

export type DepInfoRow = {
  label: string
  sector: string
  tone: 'east' | 'slow'
  defaultFreq: string
  frequency?: string
  /** Online login covering this sector (hover tooltip) */
  callsign?: string | null
}

export type EssaDepInfo = {
  configId: string
  runway: string
  turn?: DepInfoTurn
  primarySector: string
  primaryDefaultFreq: string
  primaryFreq?: string
  /** Online login covering primary sector (hover tooltip) */
  primaryCallsign?: string | null
  holdLines: [string, string]
  rows: DepInfoRow[]
}

/** DEP runway for the active ESSA config (for placement / AOR before fetch). */
export function essaDepRunwayForConfig(configId: string): string | null {
  const combo = getEssaRwyCombination(configId)
  const rwy = combo?.dep?.[0]
  return rwy ? rwy.toUpperCase() : null
}

/** Physical runway section that hosts this DEP runway. */
export function essaDepDefaultSectionId(runway: string): string | null {
  const pair = essaPhysicalPairForRunway(runway)
  return pair ? essaRunwaySectionId(pair) : null
}

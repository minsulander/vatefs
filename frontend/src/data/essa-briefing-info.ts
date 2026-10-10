/**
 * ESSA briefing info-strips: 08 LT/RT turn departure, 19L Q/E/mix SIDs.
 */

import { ESSA_RWY_COMBINATIONS, getEssaRwyCombination } from '@vatefs/common'
import { essaDepDefaultSectionId, essaDepRunwayForConfig } from '@/data/essa-dep-info'

export type TurnDepTurn = 'LEFT' | 'RIGHT' | 'BOTH'

export type TurnDepBriefing = {
  turn: TurnDepTurn
  runway: string
  title: string
  /** Combination numbers that use this turn (shown stacked like SAAB EFS). */
  configIds: string[]
}

export type Sid19LMode = 'Q' | 'E' | 'MIX'

export type Sid19LBriefing = {
  runway: '19L'
  mode: Sid19LMode
  title: string
  configIds: string[]
}

function turnFromDepName(depName: string): TurnDepTurn | null {
  const name = depName.toUpperCase()
  if (name.includes('08-LT')) return 'LEFT'
  if (name.includes('08-RT')) return 'RIGHT'
  // Config 7: DEP 08 with no LT/RT suffix → mixed (either) turns
  if (name === '08') return 'BOTH'
  return null
}

function titleForTurn(turn: TurnDepTurn): string {
  if (turn === 'LEFT') return 'LEFT TURN DEPARTURE'
  if (turn === 'RIGHT') return 'RIGHT TURN DEPARTURE'
  return 'MIXED TURN DEPARTURE'
}

/** All combination ids that share the same 08 turn briefing. */
function configIdsForTurn(turn: TurnDepTurn): string[] {
  return ESSA_RWY_COMBINATIONS.filter((c) => turnFromDepName(c.depName) === turn).map((c) => c.id)
}

/** 08-LT / 08-RT / mixed departure turn briefing for the active config. */
export function getEssaTurnDepBriefing(configId: string): TurnDepBriefing | null {
  const combo = getEssaRwyCombination(configId)
  if (!combo) return null
  const turn = turnFromDepName(combo.depName)
  if (!turn) return null
  return {
    turn,
    runway: '08',
    title: titleForTurn(turn),
    configIds: configIdsForTurn(turn),
  }
}

function modeFromDepName(depName: string): Sid19LMode | null {
  const name = depName.toUpperCase()
  if (!name.includes('19L')) return null
  if (name.includes('NIGHT')) return 'MIX'
  if (name.includes('19L-E')) return 'E'
  if (name.includes('19L-Q')) return 'Q'
  return 'MIX'
}

function configIdsForSid19LMode(mode: Sid19LMode): string[] {
  return ESSA_RWY_COMBINATIONS.filter((c) => modeFromDepName(c.depName) === mode).map((c) => c.id)
}

/**
 * 19L SID letter regime from config depName:
 *   19L-Q → Q SIDs, 19L-E → E SIDs, 19L-NIGHT → MIX OF SIDs
 */
export function getEssa19LSidBriefing(configId: string): Sid19LBriefing | null {
  const combo = getEssaRwyCombination(configId)
  if (!combo) return null
  const mode = modeFromDepName(combo.depName)
  if (!mode) return null
  const depIs19L = combo.dep.some((d) => d.toUpperCase() === '19L') || combo.depName.toUpperCase().includes('19L')
  if (!depIs19L) return null

  const title = mode === 'Q' ? 'Q SIDs' : mode === 'E' ? 'E SIDs' : 'MIX Q/E SIDs'
  return { runway: '19L', mode, title, configIds: configIdsForSid19LMode(mode) }
}

export function essaBriefingDefaultSectionId(configId: string): string | null {
  const rwy = essaDepRunwayForConfig(configId)
  return rwy ? essaDepDefaultSectionId(rwy) : null
}

/**
 * ESSA runway holding-point / intersection take-off options for the HP menu.
 * Base list from AIP ESSA 2.13 declared intersection distances; W7 added for 19L
 * (Arlanda TWR feedback). Full-length entries are not listed — use manual entry.
 *
 * When GND is split (2–3 ESSA_*_GND online), ZH and ZK are also offered as
 * preferred holds (GND/TWR boundary on TWY Z).
 */

import { normalizeEssaRwy } from '@vatefs/common'

/** Intersections keyed by bare runway (01L, 19R, …). */
export const ESSA_HP_BY_RWY: Readonly<Record<string, readonly string[]>> = {
  '01L': ['Y2', 'Y3'],
  '19R': ['Y8', 'Y9'],
  '01R': ['W3'],
  '19L': ['W6', 'W7'],
  '08': ['X3'],
  '26': [],
}

/** Extra preferred HPs when GND is split two/three ways. */
export const ESSA_HP_GND_SPLIT_EXTRAS = ['ZH', 'ZK'] as const

/** True when callsign is a physical ESSA E/N/W GND login. */
export function isEssaSplitGndCallsign(callsign: string | undefined | null): boolean {
  if (!callsign) return false
  return /^ESSA_[ENW]_GND$/i.test(callsign.trim())
}

/** Count distinct physical ESSA GND positions online (≥2 = split). */
export function countEssaOnlineGndPositions(
  controllers: ReadonlyArray<{ callsign: string }>,
): number {
  const set = new Set<string>()
  for (const c of controllers) {
    const cs = (c.callsign || '').trim().toUpperCase()
    if (/^ESSA_E_GND$/.test(cs)) set.add('E')
    else if (/^ESSA_N_GND$/.test(cs)) set.add('N')
    else if (/^ESSA_W_GND$/.test(cs)) set.add('W')
  }
  return set.size
}

export function isEssaGndSplit(
  controllers: ReadonlyArray<{ callsign: string }>,
): boolean {
  return countEssaOnlineGndPositions(controllers) >= 2
}

/**
 * HP preference chips for the strip (dropdown only when non-empty).
 * - DEP/local: runway intersection take-offs (+ ZH/ZK when GND split)
 * - ARR: no RWY intersections (DEP-only); ZH/ZK still when GND split
 * Manual / free-text HP is typed in the strip cell when this list is empty.
 */
export function essaHpIntersectionsForRunway(
  runway: string | undefined | null,
  opts?: { gndSplit?: boolean; forArrival?: boolean },
): readonly string[] {
  const base = (() => {
    if (opts?.forArrival) return [] as string[]
    if (!runway?.trim()) return [] as string[]
    const key = normalizeEssaRwy(runway)
    return [...(ESSA_HP_BY_RWY[key] ?? [])]
  })()
  if (!opts?.gndSplit) return base
  const out = [...base]
  for (const hp of ESSA_HP_GND_SPLIT_EXTRAS) {
    if (!out.includes(hp)) out.push(hp)
  }
  return out
}

/** Preference list for a strip (empty → edit HP in the cell). */
export function essaHpPreferencesForStrip(
  strip: { runway?: string | null; stripType?: string },
  controllers: ReadonlyArray<{ callsign: string }>,
  opts?: { gndSplit?: boolean },
): readonly string[] {
  // Prefer server essaGndSplit (counts self); controllers list excludes myself.
  const gndSplit =
    opts?.gndSplit !== undefined ? opts.gndSplit : isEssaGndSplit(controllers)
  return essaHpIntersectionsForRunway(strip.runway, {
    gndSplit,
    forArrival: strip.stripType === 'arrival',
  })
}

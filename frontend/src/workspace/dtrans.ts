/**
 * ESSA Direct Transfer (D-trans) workspace dividers — catalog + segment maps.
 * Backend resolves covering login + AFV XC freq via /api/essa-dtrans-target.
 */

export type DtransTargetId =
  | 'GND-E'
  | 'GND-W'
  | 'GND-N'
  | 'TWR-E'
  | 'TWR-W'
  | 'CD'
  | 'ARR-W'
  | 'DEP-W'
  | 'DEP-E'
  | 'ARR-E'

/** Individual targets only (no combined GND/TWR/APP splits). */
export type DtransVariantId =
  | 'gnd-e'
  | 'gnd-w'
  | 'gnd-n'
  | 'twr-e'
  | 'twr-w'
  | 'cd'
  | 'arr-w'
  | 'dep-w'
  | 'dep-e'
  | 'arr-e'

export interface DtransCatalogEntry {
  variant: DtransVariantId
  label: string
}

/** Direct Transfer menu (ESSA roles only) — singles only. */
export const DTRANS_CATALOG: DtransCatalogEntry[] = [
  { variant: 'gnd-e', label: 'GND-E' },
  { variant: 'gnd-w', label: 'GND-W' },
  { variant: 'gnd-n', label: 'GND-N' },
  { variant: 'twr-e', label: 'TWR-E' },
  { variant: 'twr-w', label: 'TWR-W' },
  { variant: 'cd', label: 'CD' },
  { variant: 'arr-w', label: 'ARR-W' },
  { variant: 'dep-w', label: 'DEP-W' },
  { variant: 'dep-e', label: 'DEP-E' },
  { variant: 'arr-e', label: 'ARR-E' },
]

const VARIANT_SEGMENTS: Record<DtransVariantId, DtransTargetId[]> = {
  'gnd-e': ['GND-E'],
  'gnd-w': ['GND-W'],
  'gnd-n': ['GND-N'],
  'twr-e': ['TWR-E'],
  'twr-w': ['TWR-W'],
  cd: ['CD'],
  'arr-w': ['ARR-W'],
  'dep-w': ['DEP-W'],
  'dep-e': ['DEP-E'],
  'arr-e': ['ARR-E'],
}

export function isDtransVariantId(v: string | undefined | null): v is DtransVariantId {
  return !!v && Object.prototype.hasOwnProperty.call(VARIANT_SEGMENTS, v)
}

export function segmentsForDtransVariant(variant: DtransVariantId): DtransTargetId[] {
  return VARIANT_SEGMENTS[variant]
}

/** Map drop X within [0, width) to a segment index. */
export function dtransZoneIndexFromX(
  clientX: number,
  left: number,
  width: number,
  zoneCount: number,
): number {
  if (zoneCount <= 1 || width <= 0) return 0
  const rel = Math.max(0, Math.min(width - 1e-6, clientX - left))
  return Math.min(zoneCount - 1, Math.floor((rel / width) * zoneCount))
}

export interface DtransTargetResolve {
  id: DtransTargetId
  callsign: string | null
  frequency: string | null
  online: boolean
  xc: boolean
  displaySi: string | null
}

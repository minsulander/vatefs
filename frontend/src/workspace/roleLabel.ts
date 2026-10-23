/**
 * Human-readable ESSA role labels for layout menus.
 * All GND positions → "GND"; all TWR positions → "TWR".
 */

const ALL_GND = ['GND-E', 'GND-N', 'GND-W'] as const
const ALL_TWR = ['TWR-E', 'TWR-W'] as const

const ROLE_ORDER = ['CD', 'GND-E', 'GND-N', 'GND-W', 'TWR-E', 'TWR-W'] as const

export function sortEssaRoleList(roles: string[]): string[] {
  const order = new Map(ROLE_ORDER.map((r, i) => [r, i]))
  return [...new Set(roles.map((r) => r.toUpperCase()))].sort(
    (a, b) => (order.get(a as (typeof ROLE_ORDER)[number]) ?? 99) - (order.get(b as (typeof ROLE_ORDER)[number]) ?? 99),
  )
}

/** Stable fingerprint for role config (sorted join). */
export function essaRoleKey(roles: string[]): string {
  return sortEssaRoleList(roles).join(',') || 'none'
}

/**
 * Collapse full GND / TWR families to short labels.
 * e.g. CD + all GND + TWR-W → "CD, GND, TWR-W"
 */
export function formatEssaRolesLabel(roles: string[]): string {
  const sorted = sortEssaRoleList(roles)
  if (sorted.length === 0) return '(no roles)'

  const set = new Set(sorted)
  const parts: string[] = []

  if (set.has('CD')) parts.push('CD')

  const allGnd = ALL_GND.every((r) => set.has(r))
  if (allGnd) {
    parts.push('GND')
  } else {
    for (const r of ALL_GND) {
      if (set.has(r)) parts.push(r)
    }
  }

  const allTwr = ALL_TWR.every((r) => set.has(r))
  if (allTwr) {
    parts.push('TWR')
  } else {
    for (const r of ALL_TWR) {
      if (set.has(r)) parts.push(r)
    }
  }

  // Any unexpected roles (e.g. TWR-S if ever present)
  for (const r of sorted) {
    if (r === 'CD' || r.startsWith('GND-') || r.startsWith('TWR-')) continue
    parts.push(r)
  }

  return parts.join(', ')
}

export type EssaRoleCombination = {
  roles: string[]
  roleKey: string
  label: string
}

/**
 * Layout-menu folders: every CD / GND / TWR family combo (full families only —
 * no separate E/N/W or E/W split folders). Partial splits from saved layouts are
 * merged in by the dialog.
 *
 * Omits CD+TWR without GND — VATSIM top-down: GND covers CD, so that combo
 * is never a real staffing profile.
 */
export function essaFamilyRoleCombinations(): EssaRoleCombination[] {
  const out: EssaRoleCombination[] = []
  for (let mask = 1; mask < 8; mask++) {
    const hasCd = !!(mask & 1)
    const hasGnd = !!(mask & 2)
    const hasTwr = !!(mask & 4)
    if (hasCd && hasTwr && !hasGnd) continue
    const roles: string[] = []
    if (hasCd) roles.push('CD')
    if (hasGnd) roles.push(...ALL_GND)
    if (hasTwr) roles.push(...ALL_TWR)
    out.push({
      roles,
      roleKey: essaRoleKey(roles),
      label: formatEssaRolesLabel(roles),
    })
  }
  out.sort((a, b) => a.label.localeCompare(b.label) || a.roleKey.localeCompare(b.roleKey))
  return out
}

export function builtinLayoutSelectionId(roleKey: string): string {
  return `builtin:${roleKey || 'none'}`
}

export function parseBuiltinLayoutSelectionId(id: string): string | null {
  if (!id.startsWith('builtin:')) return null
  return id.slice('builtin:'.length) || 'none'
}

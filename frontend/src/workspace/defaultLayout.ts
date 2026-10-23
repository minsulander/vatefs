import type { EfsLayout, Section } from '@vatefs/common'
import { isEssaDynamicRunwaySectionId } from '@vatefs/common'
import type { SortFlow, WorkspaceLayout, WorkspaceSection } from './types'
import { WORKSPACE_MAX_COLUMNS, WORKSPACE_MIN_COLUMNS } from './types'
import { essaRoleKey, formatEssaRolesLabel } from './roleLabel'
import { SPLIT_GROUPS, stripSectionIdsForMember } from './splitGroups'

type EssaFamily = 'CD' | 'GND' | 'TWR'

/**
 * Built-in ESSA default profile template (matches data/config/essa.yml bay order).
 * REQ PUSH is intentionally omitted — catalog only.
 */
const ESSA_DEFAULT_SECTIONS: readonly {
  sectionId: string
  title: string
  /** YAML bay index (0 = bay1 …) before empty-bay compaction */
  bayIndex: number
  families: readonly EssaFamily[]
  addFromTop?: boolean
}[] = [
  { sectionId: 'inbound', title: 'INBOUND', bayIndex: 0, families: ['GND', 'TWR'] },
  { sectionId: 'ctr_arr', title: 'CTR ARR', bayIndex: 0, families: ['TWR'] },
  { sectionId: 'taxi_arr', title: 'TAXIWAY ARR', bayIndex: 0, families: ['GND', 'TWR'] },
  { sectionId: 'ctr_dep', title: 'CTR DEP', bayIndex: 1, families: ['TWR'], addFromTop: false },
  // inbound_gnd: TWR without GND only — gated in sectionVisibleForRoles
  { sectionId: 'inbound_gnd', title: 'INBOUND GND', bayIndex: 2, families: ['TWR'] },
  { sectionId: 'taxi_dep', title: 'TAXIWAY DEP', bayIndex: 2, families: ['GND', 'TWR'], addFromTop: false },
  { sectionId: 'push_start', title: 'PUSH BACK / START-UP', bayIndex: 2, families: ['GND'], addFromTop: true },
  { sectionId: 'cleared', title: 'TSAT / EOBT', bayIndex: 3, families: ['CD', 'GND'], addFromTop: true },
  { sectionId: 'pending_dep', title: 'CD ALL', bayIndex: 4, families: ['CD'], addFromTop: true },
] as const

function roleFamilies(roles: string[]): Set<EssaFamily> {
  const out = new Set<EssaFamily>()
  for (const r of roles) {
    const u = r.toUpperCase()
    if (u === 'CD') out.add('CD')
    else if (u.startsWith('GND')) out.add('GND')
    else if (u.startsWith('TWR')) out.add('TWR')
  }
  return out
}

/** Whether a section belongs in the built-in default for these roles. */
export function sectionVisibleForRoles(sectionId: string, roles: string[]): boolean {
  if (sectionId === 'req_push' || sectionId.endsWith('_req_push')) return false
  const families = roleFamilies(roles)
  if (sectionId === 'inbound_gnd') return families.has('TWR') && !families.has('GND')
  if (isEssaDynamicRunwaySectionId(sectionId)) return families.has('TWR')
  const def = ESSA_DEFAULT_SECTIONS.find((s) => s.sectionId === sectionId)
  if (!def) return true
  return def.families.some((f) => families.has(f))
}

function sortFlowFromSection(
  sec: { addFromTop?: boolean } | undefined,
  defaultFlow: SortFlow,
  fallbackAddFromTop?: boolean,
): SortFlow {
  const flag = sec?.addFromTop ?? fallbackAddFromTop
  if (flag === false) return 'newestBottom'
  if (flag === true) return 'newestTop'
  return defaultFlow
}

function findServerSection(serverLayout: EfsLayout, sectionId: string): Section | undefined {
  for (const bay of serverLayout.bays) {
    const s = bay.sections.find((x) => x.id === sectionId)
    if (s) return s
  }
  return undefined
}

/**
 * Map a workspace section id (incl. synthetic split members like cleared_tsat)
 * to the YAML/server section id used for addFromTop / natural sort-flow.
 */
export function yamlSectionIdForWorkspace(sectionId: string): string {
  for (const g of SPLIT_GROUPS) {
    const mem = g.members.find((m) => m.sectionId === sectionId)
    if (!mem) continue
    const ids = stripSectionIdsForMember(g, mem)
    for (const id of ids) {
      if (g.mergedSectionIds.includes(id)) return id
    }
    if (ids[0]) return ids[0]
    if (g.mergedSectionIds[0]) return g.mergedSectionIds[0]
  }
  return sectionId
}

/** Infer split group metadata when section id matches a known member or merged id. */
export function annotateGroup(
  sectionId: string,
  title: string,
): Pick<WorkspaceSection, 'groupId' | 'member' | 'title'> {
  for (const g of SPLIT_GROUPS) {
    const mem = g.members.find((m) => m.sectionId === sectionId)
    if (mem) {
      return { groupId: g.id, member: mem.member, title: mem.title || title }
    }
  }
  return { title }
}

/**
 * Annotate a catalog-added header. Split members get group+member; known merged
 * forms (inbound_gnd, push_start, …) get groupId so they stay splittable.
 * Does not treat YAML `inbound` as inbound_twr (INBOUND APP shares that id).
 */
export function annotateCatalogSection(
  sectionId: string,
  title: string,
): Pick<WorkspaceSection, 'groupId' | 'member' | 'title'> {
  const asMember = annotateGroup(sectionId, title)
  if (asMember.member) return asMember
  for (const g of SPLIT_GROUPS) {
    if (!g.mergedSectionIds.includes(sectionId)) continue
    // `inbound` is shared with INBOUND APP — only tag when title is TWR-* form
    if (g.id === 'inbound_twr') {
      const t = title.toUpperCase()
      if (!/^INBOUND\s+TWR\b/.test(t)) continue
    }
    return { groupId: g.id, title: g.mergedTitle || title }
  }
  return { title }
}

/**
 * Build built-in default workspace for a role combination.
 * Uses the ESSA YAML template filtered by `roles` (not whatever the server
 * currently shows for the live role selection), so e.g. "CD DEFAULT" always
 * loads the CD profile even when the controller currently has all roles.
 * Dynamic RUNWAY headers are taken from the live server layout when TWR is included.
 */
export function buildDefaultWorkspaceLayout(
  serverLayout: EfsLayout,
  roles: string[],
  opts?: { defaultSortFlow?: SortFlow },
): WorkspaceLayout {
  const defaultFlow = opts?.defaultSortFlow ?? 'newestBottom'
  const families = roleFamilies(roles)
  /** yaml bayIndex → sections (before compacting empty bays) */
  const byBay = new Map<number, WorkspaceSection[]>()

  const pushAt = (bayIndex: number, sec: WorkspaceSection) => {
    const list = byBay.get(bayIndex) ?? []
    list.push(sec)
    byBay.set(bayIndex, list)
  }

  for (const def of ESSA_DEFAULT_SECTIONS) {
    if (!sectionVisibleForRoles(def.sectionId, roles)) continue
    const server = findServerSection(serverLayout, def.sectionId)
    const title = server?.title || def.title
    const anno = annotateGroup(def.sectionId, title)
    pushAt(def.bayIndex, {
      instanceId: def.sectionId,
      sectionId: def.sectionId,
      title: anno.title ?? title,
      groupId: anno.groupId,
      member: anno.member,
      anchorColumn: 0,
      stripSize: 'normal',
      sortFlow: sortFlowFromSection(server, defaultFlow, def.addFromTop),
    })
  }

  // Live RUNWAY pair headers when the target profile includes TWR
  if (families.has('TWR')) {
    serverLayout.bays.forEach((bay, serverBayIdx) => {
      for (const sec of bay.sections) {
        if (!isEssaDynamicRunwaySectionId(sec.id)) continue
        const anno = annotateGroup(sec.id, sec.title)
        pushAt(serverBayIdx, {
          instanceId: sec.id,
          sectionId: sec.id,
          title: anno.title ?? sec.title,
          groupId: anno.groupId,
          member: anno.member,
          anchorColumn: 0,
          stripSize: 'normal',
          sortFlow: sortFlowFromSection(sec, defaultFlow, false),
        })
      }
    })
  }

  const sortedBayIdx = [...byBay.keys()].sort((a, b) => a - b)
  const sections: WorkspaceSection[] = []
  sortedBayIdx.forEach((bayIndex, colIdx) => {
    const col = Math.min(colIdx, WORKSPACE_MAX_COLUMNS - 1)
    for (const s of byBay.get(bayIndex) ?? []) {
      sections.push({ ...s, anchorColumn: col })
    }
  })

  const roleKey = essaRoleKey(roles)
  const columnCount = Math.min(
    WORKSPACE_MAX_COLUMNS,
    Math.max(WORKSPACE_MIN_COLUMNS, sortedBayIdx.length || 1),
  )
  return {
    version: 1,
    columnCount,
    sections,
    roleKey,
    roles: [...roles],
    rolesLabel: formatEssaRolesLabel(roles),
  }
}

function bayIdContaining(serverLayout: EfsLayout, sectionId: string): string | undefined {
  for (const bay of serverLayout.bays) {
    if (bay.sections.some((s) => s.id === sectionId)) return bay.id
  }
  return undefined
}

/** Look up server bayId for a logical sectionId (for strip moves / drop targets). */
export function serverBayIdForSection(serverLayout: EfsLayout, sectionId: string): string | undefined {
  const direct = bayIdContaining(serverLayout, sectionId)
  if (direct) return direct

  // Split / synthetic member → parent YAML section (never recurse: members often
  // reuse the same id as mergedSectionIds, e.g. pending_dep / taxi_dep).
  // Prefer explicit stripSectionIds parents, then other mergedSectionIds.
  for (const g of SPLIT_GROUPS) {
    const mem = g.members.find((m) => m.sectionId === sectionId)
    if (!mem) continue
    const parents = [
      ...stripSectionIdsForMember(g, mem),
      ...g.mergedSectionIds,
    ]
    for (const parentId of parents) {
      if (parentId === sectionId) continue
      const bayId = bayIdContaining(serverLayout, parentId)
      if (bayId) return bayId
    }
  }
  return undefined
}

/** Server Section metadata for a workspace section (title fallback). */
export function serverSectionMeta(
  serverLayout: EfsLayout,
  sectionId: string,
): Section | undefined {
  for (const bay of serverLayout.bays) {
    const s = bay.sections.find((x) => x.id === sectionId)
    if (s) return s
  }
  return undefined
}

/**
 * Map a workspace section to the strip sectionId(s) used by the server.
 *
 * - Split member (has `member`): that member's `stripSectionIds` (or defaults)
 * - Partial multi-member merge: union of held members' strip ids
 * - Full merge with `groupId` set (e.g. taxiway): all `mergedSectionIds`
 * - Plain YAML / default `cleared`: that id only (REQ PUSH is catalog-only)
 * - Empty dividers: pass instanceId through (synthetic parking membership)
 */
export function stripSectionIdsForWorkspace(
  sectionId: string | null,
  opts?: { member?: string; groupId?: string },
): string[] {
  if (!sectionId) return []

  // Explicit split member — only that slice (taxi_dep vs taxi_arr, etc.)
  // Partial merges use slash-joined member (e.g. E/N) → union of those slices.
  if (opts?.member && opts.groupId) {
    const g = SPLIT_GROUPS.find((x) => x.id === opts.groupId)
    const keys = opts.member.split('/').map((m) => m.trim()).filter(Boolean)
    if (g && keys.length >= 2) {
      const ids = new Set<string>()
      for (const k of keys) {
        const mem = g.members.find((m) => m.member === k)
        if (!mem) continue
        for (const id of stripSectionIdsForMember(g, mem)) ids.add(id)
      }
      return ids.size > 0 ? [...ids] : [...g.mergedSectionIds]
    }
    const mem = g?.members.find((m) => m.member === opts.member)
    if (g && mem) {
      return stripSectionIdsForMember(g, mem)
    }
  }

  for (const g of SPLIT_GROUPS) {
    // Merged header whose primary id is in mergedSectionIds (no member on workspace sec)
    if (g.mergedSectionIds.includes(sectionId)) {
      // Multi-id merge (taxiway / cd_cleared full merge): only when this header
      // is tagged with the split group — not a plain YAML section sharing an id.
      if (
        g.mergedSectionIds.length > 1 &&
        !opts?.member &&
        opts?.groupId === g.id
      ) {
        return [...g.mergedSectionIds]
      }
      return [sectionId]
    }
    const mem = g.members.find((m) => m.sectionId === sectionId)
    if (mem) {
      return stripSectionIdsForMember(g, mem)
    }
  }
  return [sectionId]
}

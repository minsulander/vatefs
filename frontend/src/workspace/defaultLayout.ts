import type { EfsLayout, Section } from '@vatefs/common'
import { isEssaDynamicRunwaySectionId } from '@vatefs/common'
import type { SortFlow, WorkspaceLayout, WorkspaceSection } from './types'
import { WORKSPACE_MAX_COLUMNS, WORKSPACE_MIN_COLUMNS } from './types'
import { essaRoleKey, formatEssaRolesLabel } from './roleLabel'
import {
  SPLIT_GROUPS,
  findSplitGroupById,
  splitGroupsForMode,
  stripSectionIdsForMember,
  type WorkspaceCatalogMode,
} from './splitGroups'

export type { WorkspaceCatalogMode }

type EssaFamily = 'CD' | 'GND' | 'TWR'

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
  if (sectionId === 'cleared_tsat' || sectionId === 'cleared_eobt') {
    return families.has('CD') && !families.has('GND') && !families.has('TWR')
  }
  // Family presence gates (matches delivered DEFAULT profiles)
  if (sectionId === 'pending_dep') return families.has('CD')
  if (sectionId === 'cleared') return families.has('CD') || families.has('GND')
  if (sectionId === 'push_start') return families.has('GND')
  if (sectionId === 'ctr_arr' || sectionId === 'ctr_dep') return families.has('TWR')
  if (sectionId === 'inbound') return families.has('GND') || families.has('TWR')
  if (sectionId === 'taxi_arr' || sectionId === 'taxi_dep') {
    return families.has('GND') || families.has('TWR')
  }
  return true
}

/** Live RUNWAY pair headers: ARR bay (with CTR ARR / TAXI ARR) vs DEP bay. */
function classifyRunwaySections(serverLayout: EfsLayout): {
  arr: Section[]
  dep: Section[]
} {
  const arr: Section[] = []
  const dep: Section[] = []
  for (const bay of serverLayout.bays) {
    const ids = new Set(bay.sections.map((s) => s.id))
    const arrSide = ids.has('ctr_arr') || ids.has('taxi_arr')
    const depSide = ids.has('ctr_dep')
    for (const sec of bay.sections) {
      if (!isEssaDynamicRunwaySectionId(sec.id)) continue
      if (arrSide && !depSide) arr.push(sec)
      else if (depSide && !arrSide) dep.push(sec)
      else if (arrSide) arr.push(sec)
      else dep.push(sec)
    }
  }
  return { arr, dep }
}

type SecDraft = {
  sectionId: string
  title?: string
  groupId?: WorkspaceSection['groupId']
  member?: string
  addFromTop?: boolean
  y?: number
  yRatio?: number
  instanceId?: string
}

function draftToSection(
  draft: SecDraft,
  serverLayout: EfsLayout,
  defaultFlow: SortFlow,
  anchorColumn: number,
): WorkspaceSection {
  const server = findServerSection(serverLayout, draft.sectionId)
  const title = draft.title ?? server?.title ?? draft.sectionId
  const anno =
    draft.groupId != null || draft.member != null
      ? { title, groupId: draft.groupId, member: draft.member }
      : annotateCatalogSection(draft.sectionId, title, 'essa')
  return {
    instanceId: draft.instanceId ?? draft.sectionId,
    sectionId: draft.sectionId,
    title: anno.title ?? title,
    groupId: anno.groupId,
    member: anno.member,
    anchorColumn,
    stripSize: 'normal',
    sortFlow: sortFlowFromSection(server, defaultFlow, draft.addFromTop),
    ...(draft.y != null ? { y: draft.y } : {}),
    ...(draft.yRatio != null ? { yRatio: draft.yRatio } : {}),
  }
}

/** INBOUND TWR-* merged header (GND covering, no TWR). */
function inboundTwrMergedDraft(serverLayout: EfsLayout): SecDraft {
  const server = findServerSection(serverLayout, 'inbound')
  const title = server?.title?.startsWith('INBOUND TWR')
    ? server.title
    : 'INBOUND TWR-E, TWR-W'
  return {
    sectionId: 'inbound',
    title,
    groupId: 'inbound_twr',
  }
}

function runwayDrafts(secs: Section[], defaultAddFromTop = false): SecDraft[] {
  return secs.map((sec) => ({
    sectionId: sec.id,
    title: sec.title,
    addFromTop: sec.addFromTop ?? defaultAddFromTop,
  }))
}

/**
 * Profile column plans for built-in DEFAULT only (not saved layouts).
 * Column lists are top→bottom; ARR RWY always above TAXIWAY ARR when present.
 */
function essaDefaultColumnPlan(
  families: Set<EssaFamily>,
  runways: { arr: Section[]; dep: Section[] },
  serverLayout: EfsLayout,
): { columns: SecDraft[][]; columnCount: number } {
  const hasCd = families.has('CD')
  const hasGnd = families.has('GND')
  const hasTwr = families.has('TWR')

  // CD alone — real TSAT/EOBT split; EOBT at bottom quarter (TSAT overflow above);
  // empty 4th column for CD overflow.
  if (hasCd && !hasGnd && !hasTwr) {
    return {
      columnCount: 4,
      columns: [
        [
          {
            sectionId: 'cleared_tsat',
            title: 'TSAT',
            groupId: 'cd_cleared',
            member: 'tsat',
            addFromTop: true,
          },
        ],
        [
          {
            sectionId: 'cleared_eobt',
            title: 'EOBT',
            groupId: 'cd_cleared',
            member: 'eobt',
            addFromTop: true,
            yRatio: 0.75,
          },
        ],
        [
          {
            sectionId: 'pending_dep',
            title: 'CD',
            groupId: 'cd_all',
            member: 'pending',
            addFromTop: true,
          },
        ],
        [],
      ],
    }
  }

  // GND alone
  if (!hasCd && hasGnd && !hasTwr) {
    return {
      columnCount: 4,
      columns: [
        [inboundTwrMergedDraft(serverLayout), { sectionId: 'taxi_arr' }],
        [{ sectionId: 'taxi_dep', addFromTop: false }],
        [{ sectionId: 'push_start', addFromTop: true }],
        [{ sectionId: 'cleared', title: 'TSAT / EOBT', addFromTop: true }],
      ],
    }
  }

  // TWR alone — INBOUND APP own column; INBOUND GND above TAXI DEP
  if (!hasCd && !hasGnd && hasTwr) {
    return {
      columnCount: 4,
      columns: [
        [{ sectionId: 'inbound' }],
        [
          { sectionId: 'ctr_arr' },
          ...runwayDrafts(runways.arr),
          { sectionId: 'taxi_arr' },
        ],
        [
          { sectionId: 'ctr_dep', addFromTop: false },
          ...runwayDrafts(runways.dep),
        ],
        [
          { sectionId: 'inbound_gnd' },
          { sectionId: 'taxi_dep', addFromTop: false },
        ],
      ],
    }
  }

  // CD + GND (no TWR) — no INBOUND GND; CD and TSAT/EOBT separate columns
  if (hasCd && hasGnd && !hasTwr) {
    return {
      columnCount: 4,
      columns: [
        [inboundTwrMergedDraft(serverLayout), { sectionId: 'taxi_arr' }],
        [
          { sectionId: 'taxi_dep', addFromTop: false },
          { sectionId: 'push_start', addFromTop: true },
        ],
        [{ sectionId: 'cleared', title: 'TSAT / EOBT', addFromTop: true }],
        [
          {
            sectionId: 'pending_dep',
            title: 'CD',
            groupId: 'cd_all',
            member: 'pending',
            addFromTop: true,
          },
        ],
      ],
    }
  }

  // GND + TWR (no CD) — ARR RWY above TAXI ARR; no inbound_gnd
  if (!hasCd && hasGnd && hasTwr) {
    return {
      columnCount: 4,
      columns: [
        [
          { sectionId: 'inbound' },
          { sectionId: 'ctr_arr' },
          ...runwayDrafts(runways.arr),
          { sectionId: 'taxi_arr' },
        ],
        [
          { sectionId: 'ctr_dep', addFromTop: false },
          ...runwayDrafts(runways.dep),
        ],
        [
          { sectionId: 'taxi_dep', addFromTop: false },
          { sectionId: 'push_start', addFromTop: true },
        ],
        [{ sectionId: 'cleared', title: 'TSAT / EOBT', addFromTop: true }],
      ],
    }
  }

  // CD + GND + TWR — CD stacked above TSAT/EOBT in one column; ARR RWY above taxi
  if (hasCd && hasGnd && hasTwr) {
    return {
      columnCount: 4,
      columns: [
        [
          { sectionId: 'inbound' },
          { sectionId: 'ctr_arr' },
          ...runwayDrafts(runways.arr),
          { sectionId: 'taxi_arr' },
        ],
        [
          { sectionId: 'ctr_dep', addFromTop: false },
          ...runwayDrafts(runways.dep),
        ],
        [
          { sectionId: 'taxi_dep', addFromTop: false },
          { sectionId: 'push_start', addFromTop: true },
        ],
        [
          {
            sectionId: 'pending_dep',
            title: 'CD',
            groupId: 'cd_all',
            member: 'pending',
            addFromTop: true,
          },
          { sectionId: 'cleared', title: 'TSAT / EOBT', addFromTop: true },
        ],
      ],
    }
  }

  // Fallback (e.g. empty roles): empty board
  return { columnCount: WORKSPACE_MIN_COLUMNS, columns: [[]] }
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
export function yamlSectionIdForWorkspace(
  sectionId: string,
  mode?: WorkspaceCatalogMode,
): string {
  const pool = mode ? splitGroupsForMode(mode) : SPLIT_GROUPS
  for (const g of pool) {
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

/**
 * Infer split group metadata for a section id within one config flavor only.
 * ESSA and OTHER share some YAML ids (pending_dep, cleared, …) but never titles.
 */
export function annotateGroup(
  sectionId: string,
  title: string,
  mode: WorkspaceCatalogMode = 'essa',
): Pick<WorkspaceSection, 'groupId' | 'member' | 'title'> {
  for (const g of splitGroupsForMode(mode)) {
    const mem = g.members.find((m) => m.sectionId === sectionId)
    if (mem) {
      return { groupId: g.id, member: mem.member, title: mem.title || title }
    }
  }
  return { title }
}

/**
 * Annotate a catalog-added / YAML header for one config flavor.
 * Split members get group+member; known merged forms get groupId.
 * Does not treat YAML `inbound` as inbound_twr (INBOUND APP shares that id).
 */
export function annotateCatalogSection(
  sectionId: string,
  title: string,
  mode: WorkspaceCatalogMode = 'essa',
): Pick<WorkspaceSection, 'groupId' | 'member' | 'title'> {
  const titleU = (title || '').toUpperCase().trim()
  const groups = splitGroupsForMode(mode)

  if (mode === 'essa') {
    // pending_dep: "CD ALL" only when merged with TSAT / EOBT; else slice "CD"
    if (sectionId === 'pending_dep') {
      if (titleU === 'CD ALL' || titleU === 'CDALL') {
        return { groupId: 'cd_all', title: 'CD ALL' }
      }
      return {
        groupId: 'cd_all',
        member: 'pending',
        title: title.trim() || 'CD',
      }
    }
    // cleared / TSAT / EOBT — cd_all member so it can merge with CD → CD ALL;
    // nested split (childGroupId) → TSAT + EOBT
    if (sectionId === 'cleared') {
      return {
        groupId: 'cd_all',
        member: 'cleared',
        title: title.trim() || 'TSAT / EOBT',
      }
    }
    if (sectionId === 'push_start') {
      return { groupId: 'push_start', title: title.trim() || 'PUSH BACK / START UP' }
    }
  }

  if (mode === 'saab') {
    // Merged DEP (primary id pending_dep)
    if ((sectionId === 'pending_dep' || sectionId === 'cleared') && titleU === 'DEP') {
      return { groupId: 'saab_clearance', title: 'DEP' }
    }
    // Split PENDING CLR / CLEARED — keep delivered title
    if (sectionId === 'pending_dep' || sectionId === 'cleared') {
      const g = findSplitGroupById('saab_clearance')
      const mem = g?.members.find((m) => m.sectionId === sectionId)
      if (g && mem) {
        return {
          groupId: g.id,
          member: mem.member,
          title: title.trim() || mem.title,
        }
      }
    }
    // TMA / CTR merged
    if (
      (sectionId === 'ctr_arr' || sectionId === 'ctr_dep' || sectionId === 'tma') &&
      (titleU === 'TMA / CTR' || titleU === 'TMA/CTR' || titleU === 'CTR / TMA' || titleU === 'CTR/TMA')
    ) {
      return { groupId: 'saab_ctr_tma', title: 'TMA / CTR' }
    }
    // Plain "CTR" after TMA / CTR → TMA + CTR
    if (sectionId === 'ctr' || titleU === 'CTR') {
      if (sectionId === 'ctr' || sectionId === 'ctr_arr' || sectionId === 'ctr_dep') {
        return { groupId: 'saab_ctr_tma', member: 'ctr', title: 'CTR' }
      }
    }
    // Catalog-added TMA (alongside existing CTR)
    if (sectionId === 'tma') {
      return {
        groupId: 'saab_ctr_tma',
        member: 'tma',
        title: title.trim() || 'TMA',
      }
    }
    // Catalog-added CTR (unions ctr_arr + ctr_dep; splittable to CTR ARR / CTR DEP)
    if (sectionId === 'ctr' && titleU === 'CTR') {
      return {
        groupId: 'saab_ctr_tma',
        member: 'ctr',
        title: 'CTR',
      }
    }
    // PUSH&START is not splittable on OTHER
    if (sectionId === 'push_start') {
      const t = (title || '').toUpperCase().replace(/\s+/g, '')
      if (t.includes('PUSH&START') || t === 'PUSH&START' || !titleU) {
        return { title: title.trim() || 'PUSH&START' }
      }
    }
    // TAXIWAY: never splittable
    if (sectionId === 'taxi') {
      return { title: title.trim() || 'TAXIWAY' }
    }
  }

  const asMember = annotateGroup(sectionId, title, mode)
  if (asMember.member) return asMember
  for (const g of groups) {
    if (!g.mergedSectionIds.includes(sectionId)) continue
    // `inbound` is shared with INBOUND APP — only tag when title is TWR-* form
    if (g.id === 'inbound_twr') {
      const t = title.toUpperCase()
      if (!/^INBOUND\s+TWR\b/.test(t)) continue
    }
    if (g.id === 'saab_ctr_tma') {
      const mem = g.members.find((m) => m.sectionId === sectionId)
      if (mem) return { groupId: g.id, member: mem.member, title: mem.title || title }
      return { groupId: g.id, title: g.mergedTitle }
    }
    if (g.id === 'saab_ctr' || g.id === 'saab_clearance' || g.id === 'saab_runway') {
      if (g.id === 'saab_clearance') {
        if (titleU === 'DEP' || titleU === (g.mergedTitle || '').toUpperCase()) {
          return { groupId: g.id, title: g.mergedTitle || 'DEP' }
        }
        const mem = g.members.find((m) => m.sectionId === sectionId)
        if (mem) return { groupId: g.id, member: mem.member, title: title.trim() || mem.title }
        return { groupId: g.id, title: g.mergedTitle || 'DEP' }
      }
      const isUnified = g.id === 'saab_runway' && sectionId === 'runway'
      if (!isUnified && g.members.some((m) => m.sectionId === sectionId)) {
        const mem = g.members.find((m) => m.sectionId === sectionId)
        if (mem) return { groupId: g.id, member: mem.member, title: mem.title || title }
      }
      if (g.id === 'saab_runway' && sectionId === 'runway') {
        return { groupId: g.id, title: g.mergedTitle || title }
      }
      continue
    }
    if (g.id === 'saab_taxi' && sectionId === 'taxi') {
      return { title: g.mergedTitle || title }
    }
    if (g.id === 'push_start') {
      return { groupId: g.id, title: title || g.mergedTitle }
    }
    return { groupId: g.id, title: g.mergedTitle || title }
  }
  return { title }
}

/**
 * Mirror the live server bay map into a workspace layout (OTHER / classic).
 * Annotates split/merge group metadata so CTR, RUNWAY, TAXI, PUSH, etc. work.
 */
export function buildWorkspaceLayoutFromServer(
  serverLayout: EfsLayout,
  opts?: {
    roleKey?: string
    roles?: string[]
    rolesLabel?: string
    defaultSortFlow?: SortFlow
  },
): WorkspaceLayout {
  const defaultFlow = opts?.defaultSortFlow ?? 'newestBottom'
  const sections: WorkspaceSection[] = []
  let col = 0
  for (const bay of serverLayout.bays) {
    const anchor = Math.min(col, WORKSPACE_MAX_COLUMNS - 1)
    for (const sec of bay.sections) {
      const anno = annotateCatalogSection(sec.id, sec.title, 'saab')
      sections.push({
        instanceId: sec.id,
        sectionId: sec.id,
        title: anno.title ?? sec.title,
        groupId: anno.groupId,
        member: anno.member,
        anchorColumn: anchor,
        stripSize: 'normal',
        sortFlow: sortFlowFromSection(sec, defaultFlow, sec.addFromTop),
      })
    }
    col++
  }
  const columnCount = Math.min(
    WORKSPACE_MAX_COLUMNS,
    Math.max(WORKSPACE_MIN_COLUMNS, serverLayout.bays.length || 1),
  )
  return {
    version: 1,
    columnCount,
    // Collapse co-located TMA+CTR* and pending+cleared into merged headers
    sections: collapseSaabDepHeaders(collapseSaabCtrTmaHeaders(sections)),
    roleKey: opts?.roleKey ?? 'saab',
    roles: opts?.roles ? [...opts.roles] : [],
    rolesLabel: opts?.rolesLabel,
  }
}

/**
 * OTHER: when tma + ctr_arr + ctr_dep are delivered together (same titles / bay),
 * show one merged TMA / CTR header (splittable). Split YAML titles stay split.
 */
function collapseSaabCtrTmaHeaders(sections: WorkspaceSection[]): WorkspaceSection[] {
  const family = sections.filter(
    (s) =>
      s.sectionId === 'tma' ||
      s.sectionId === 'ctr_arr' ||
      s.sectionId === 'ctr_dep',
  )
  if (family.length < 2) return sections
  // Only collapse when YAML marks them as the merged form (not CTR ARR / TMA slices)
  const allMergedTitle = family.every((s) => {
    const t = (s.title || '').toUpperCase().replace(/\s+/g, '')
    return t === 'TMA/CTR' || t === 'CTR/TMA'
  })
  if (!allMergedTitle) return sections

  const keep =
    family.find((s) => s.sectionId === 'ctr_arr') ??
    family.find((s) => s.sectionId === 'tma') ??
    family[0]!
  const drop = new Set(
    family.map((s) => s.instanceId).filter((id) => id !== keep.instanceId),
  )
  const placeAt = family.reduce((a, b) => ((a.y ?? 0) <= (b.y ?? 0) ? a : b))
  return sections
    .filter((s) => !drop.has(s.instanceId))
    .map((s) => {
      if (s.instanceId !== keep.instanceId) return s
      return {
        ...s,
        sectionId: 'ctr_arr',
        title: 'TMA / CTR',
        groupId: 'saab_ctr_tma' as const,
        member: undefined,
        members: undefined,
        anchorColumn: placeAt.anchorColumn,
        ...(placeAt.y != null ? { y: placeAt.y } : {}),
      }
    })
}

/**
 * OTHER: pending_dep + cleared titled DEP → one DEP header (splits to PENDING CLR / CLEARED).
 */
function collapseSaabDepHeaders(sections: WorkspaceSection[]): WorkspaceSection[] {
  const pending = sections.find((s) => s.sectionId === 'pending_dep')
  const cleared = sections.find((s) => s.sectionId === 'cleared')
  if (!pending || !cleared) return sections
  const isDep = (t: string | undefined) => (t || '').toUpperCase().trim() === 'DEP'
  if (!isDep(pending.title) || !isDep(cleared.title)) return sections

  const dropId = cleared.instanceId
  return sections
    .filter((s) => s.instanceId !== dropId)
    .map((s) => {
      if (s.instanceId !== pending.instanceId) return s
      return {
        ...s,
        sectionId: 'pending_dep',
        title: 'DEP',
        groupId: 'saab_clearance' as const,
        member: undefined,
        members: undefined,
      }
    })
}

/**
 * Build built-in default workspace for a role combination.
 * Profile-specific column plans (not the live server bay map), so e.g.
 * "CD DEFAULT" always loads the CD-alone overflow layout even when the
 * controller currently has all roles. Dynamic RUNWAY headers come from the
 * live server layout when TWR is included. Saved user layouts are untouched.
 */
export function buildDefaultWorkspaceLayout(
  serverLayout: EfsLayout,
  roles: string[],
  opts?: { defaultSortFlow?: SortFlow },
): WorkspaceLayout {
  const defaultFlow = opts?.defaultSortFlow ?? 'newestBottom'
  const families = roleFamilies(roles)
  const runways = families.has('TWR')
    ? classifyRunwaySections(serverLayout)
    : { arr: [], dep: [] }
  const plan = essaDefaultColumnPlan(families, runways, serverLayout)

  const sections: WorkspaceSection[] = []
  plan.columns.forEach((colDrafts, colIdx) => {
    const col = Math.min(colIdx, WORKSPACE_MAX_COLUMNS - 1)
    for (const draft of colDrafts) {
      sections.push(draftToSection(draft, serverLayout, defaultFlow, col))
    }
  })

  const roleKey = essaRoleKey(roles)
  const columnCount = Math.min(
    WORKSPACE_MAX_COLUMNS,
    Math.max(WORKSPACE_MIN_COLUMNS, plan.columnCount),
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

/** Union of server section ids that feed every member of a split group. */
function stripSectionIdsForFullMerge(g: (typeof SPLIT_GROUPS)[number]): string[] {
  const ids = new Set<string>()
  for (const mem of g.members) {
    for (const id of stripSectionIdsForMember(g, mem)) ids.add(id)
  }
  for (const id of g.mergedSectionIds) ids.add(id)
  return [...ids]
}

/**
 * Map a workspace section to the strip sectionId(s) used by the server.
 *
 * Always: when sections are merged under a `groupId`, strips from **all** held
 * members show together. A fully merged header (groupId, no member) unions every
 * member's strips — e.g. DEP = pending_dep + cleared, TMA/CTR = tma + ctr_arr + ctr_dep.
 *
 * - Split member(s): union of those members' strip ids
 * - Full merge (`groupId`, no `member`): union of all members' strip ids
 * - Untagged plain section: that id only (or a single member match by sectionId)
 */
export function stripSectionIdsForWorkspace(
  sectionId: string | null,
  opts?: { member?: string; groupId?: string; mode?: WorkspaceCatalogMode },
): string[] {
  if (!sectionId) return []

  if (opts?.groupId) {
    const g = findSplitGroupById(opts.groupId)
    if (g) {
      const keys = (opts.member || '')
        .split('/')
        .map((m) => m.trim())
        .filter(Boolean)

      // One or more member slices (including partial merges like E/N)
      if (keys.length > 0) {
        const ids = new Set<string>()
        for (const k of keys) {
          const mem = g.members.find((m) => m.member === k)
          if (!mem) continue
          for (const id of stripSectionIdsForMember(g, mem)) ids.add(id)
        }
        if (ids.size > 0) return [...ids]
      } else {
        // Fully merged divider — strips from every member, always
        const all = stripSectionIdsForFullMerge(g)
        if (all.length > 0) return all
      }
    }
  }

  // Untagged: prefer an exact member match within the active config flavor
  const pool = opts?.mode ? splitGroupsForMode(opts.mode) : SPLIT_GROUPS
  for (const g of pool) {
    const mem = g.members.find((m) => m.sectionId === sectionId)
    if (mem) return stripSectionIdsForMember(g, mem)
  }
  return [sectionId]
}

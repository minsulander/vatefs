import { normalizeEssaRwy } from '@vatefs/common'
import type { SplitGroupId, WorkspaceSection } from './types'
import { WORKSPACE_HEADER_H, newInstanceId } from './types'

export interface SplitMemberDef {
  member: string
  /** Logical section id when split (may equal parent for filter-only splits) */
  sectionId: string
  title: string
  /**
   * Server section id(s) whose strips feed this slice.
   * Required for synthetic members that share a parent (TSAT/EOBT → cleared,
   * PUSH/START → push_start, INBOUND TWR/GND → inbound*) so they do not
   * inherit every mergedSectionId.
   */
  stripSectionIds?: string[]
}

export interface SplitGroupDef {
  id: SplitGroupId
  /** Merged title */
  mergedTitle: string
  /** sectionId(s) that represent the merged form */
  mergedSectionIds: string[]
  members: SplitMemberDef[]
  /** Nested child group when further splitting a member (e.g. TSAT → TSAT/EOBT) */
  childGroupId?: SplitGroupId
  childOfMember?: string
}

/** Minimal strip fields used by workspace membership filters. */
export interface WorkspaceStripFilterFields {
  tsat?: string
  groundstate?: string
  /** Assigned runway (arrivals: arrRwy) — inbound_twr AoR filter */
  runway?: string
  /** XFER-target SI (display or raw) — inbound_gnd family filter */
  nextSi?: string
  /** Tracking controller SI — inbound_gnd fallback */
  ownerSi?: string
}

/**
 * Splittable hierarchies for ESSA flexible sections.
 * Logical sectionIds map onto existing YAML ids where possible; member filters
 * refine strip visibility on the client until backend rules catch up.
 */
export const SPLIT_GROUPS: SplitGroupDef[] = [
  {
    id: 'inbound_twr',
    mergedTitle: 'INBOUND TWR-E, TWR-W',
    mergedSectionIds: ['inbound'],
    members: [
      {
        member: 'E',
        sectionId: 'inbound_twr_e',
        title: 'INBOUND TWR-E',
        stripSectionIds: ['inbound'],
      },
      {
        member: 'W',
        sectionId: 'inbound_twr_w',
        title: 'INBOUND TWR-W',
        stripSectionIds: ['inbound'],
      },
    ],
  },
  {
    id: 'inbound_gnd',
    mergedTitle: 'INBOUND GND-E, GND-N, GND-W',
    mergedSectionIds: ['inbound_gnd'],
    members: [
      {
        member: 'E',
        sectionId: 'inbound_gnd_e',
        title: 'INBOUND GND-E',
        stripSectionIds: ['inbound_gnd'],
      },
      {
        member: 'N',
        sectionId: 'inbound_gnd_n',
        title: 'INBOUND GND-N',
        stripSectionIds: ['inbound_gnd'],
      },
      {
        member: 'W',
        sectionId: 'inbound_gnd_w',
        title: 'INBOUND GND-W',
        stripSectionIds: ['inbound_gnd'],
      },
    ],
  },
  {
    id: 'cd_all',
    mergedTitle: 'CD ALL',
    mergedSectionIds: ['pending_dep'],
    members: [
      { member: 'pending', sectionId: 'pending_dep', title: 'CD' },
      { member: 'cleared', sectionId: 'cleared', title: 'TSAT / EOBT' },
    ],
    childGroupId: 'cd_cleared',
    childOfMember: 'cleared',
  },
  {
    id: 'cd_cleared',
    mergedTitle: 'TSAT / EOBT',
    // Split → TSAT + EOBT only. REQ PUSH / START is catalog-only (never in
    // default profiles or the default split of this group).
    mergedSectionIds: ['cleared'],
    members: [
      {
        member: 'tsat',
        sectionId: 'cleared_tsat',
        title: 'TSAT',
        stripSectionIds: ['cleared'],
      },
      {
        member: 'eobt',
        sectionId: 'cleared_eobt',
        title: 'EOBT',
        stripSectionIds: ['cleared'],
      },
    ],
  },
  {
    id: 'push_start',
    mergedTitle: 'PUSH BACK / START UP',
    mergedSectionIds: ['push_start'],
    members: [
      {
        member: 'push',
        sectionId: 'push_back',
        title: 'PUSH BACK',
        stripSectionIds: ['push_start'],
      },
      {
        member: 'start',
        sectionId: 'start_up',
        title: 'START UP',
        stripSectionIds: ['push_start'],
      },
    ],
  },
  {
    id: 'taxiway',
    mergedTitle: 'TAXIWAY DEP / TAXIWAY ARR',
    mergedSectionIds: ['taxi_dep', 'taxi_arr'],
    members: [
      { member: 'dep', sectionId: 'taxi_dep', title: 'TAXIWAY DEP' },
      { member: 'arr', sectionId: 'taxi_arr', title: 'TAXIWAY ARR' },
    ],
  },
]

function hasTsat(strip: WorkspaceStripFilterFields): boolean {
  return !!(strip.tsat && String(strip.tsat).replace(/\D/g, '').length >= 3)
}

/**
 * ESSA TWR AoR column from arr runway — mirrors backend essa-next-si
 * aorColumnForRunway (TW=01L/19R, TS=08/26=07/25, TE=01R/19L).
 */
type EssaInboundTwrAor = 'TW' | 'TS' | 'TE'

function inboundTwrAorFromRunway(runway: string | undefined): EssaInboundTwrAor | undefined {
  const r = normalizeEssaRwy(runway || '')
  if (!r) return undefined
  if (r === '01L' || r === '19R') return 'TW'
  if (r === '08' || r === '26' || r === '07' || r === '25') return 'TS'
  if (r === '01R' || r === '19L') return 'TE'
  return undefined
}

/** Split member for inbound_twr: TW→W; TE+TS→E (08/26/07/25 with TWR-E). */
function inboundTwrMemberFromAor(aor: EssaInboundTwrAor): 'E' | 'W' {
  return aor === 'TW' ? 'W' : 'E'
}

type EssaGndFamily = 'GE' | 'GN' | 'GW'

/**
 * Map SI → GND family. Accepts display labels (GE/GN/GW) and raw ESSA
 * position ids (AGE/AGN/AGW) — same as backend siToGndFamily + formatEssaDisplaySi.
 */
function gndFamilyFromSi(si: string | undefined): EssaGndFamily | undefined {
  if (!si) return undefined
  const u = si.toUpperCase().trim()
  if (u === 'GE' || u === 'AGE') return 'GE'
  if (u === 'GN' || u === 'AGN') return 'GN'
  if (u === 'GW' || u === 'AGW') return 'GW'
  return undefined
}

/**
 * Which GND AoR a strip belongs under when inbound_gnd is split.
 * Prefer nextSi when it maps to GE/GN/GW (GND→GND hop still in chain);
 * otherwise ownerSi (tracker). nextSi is often TE/TW when TWR-bound, so
 * ownerSi is the usual source for taxi-out toward tower.
 */
function inboundGndFamily(strip: WorkspaceStripFilterFields): EssaGndFamily | undefined {
  return gndFamilyFromSi(strip.nextSi) ?? gndFamilyFromSi(strip.ownerSi)
}

function inboundGndMemberFromFamily(fam: EssaGndFamily): 'E' | 'N' | 'W' {
  if (fam === 'GE') return 'E'
  if (fam === 'GN') return 'N'
  return 'W'
}

/**
 * Client-side membership filter for synthetic split slices that share a parent
 * server sectionId (TSAT vs EOBT; PUSH vs STUP; INBOUND TWR E/W; INBOUND GND E/N/W).
 *
 * Split vs bandbox/unsplit:
 * - Member header (`member` set, or synthetic sectionId like inbound_twr_e):
 *   apply AoR / field filters so each strip appears under exactly one column.
 * - Combined parent (full merge / catalog `inbound` / `inbound_gnd` with
 *   groupId but no `member`): accept ALL strips for that server section —
 *   do not apply AoR filters (one controller covering several/all roles).
 * - Partial merge (e.g. member `E/N`): handled above as OR of member filters.
 */
export function workspaceMemberAcceptsStrip(
  opts: { groupId?: string; member?: string; sectionId?: string | null },
  strip: WorkspaceStripFilterFields,
): boolean {
  const sid = opts.sectionId || ''
  const keys = (opts.member || '')
    .split('/')
    .map((m) => m.trim())
    .filter(Boolean)
  // Partial merge of filter slices: accept if any held member accepts
  if (keys.length >= 2 && opts.groupId) {
    return keys.some((k) =>
      workspaceMemberAcceptsStrip({ groupId: opts.groupId, member: k, sectionId: sid }, strip),
    )
  }

  const member = keys[0] || opts.member
  const g = opts.groupId

  // TSAT / EOBT
  if (
    g === 'cd_cleared' ||
    sid === 'cleared_tsat' ||
    sid === 'cleared_eobt'
  ) {
    if (member === 'tsat' || sid === 'cleared_tsat') return hasTsat(strip)
    if (member === 'eobt' || sid === 'cleared_eobt') return !hasTsat(strip)
    // Merged / unsplit: both
    return true
  }

  // PUSH BACK / START UP
  if (g === 'push_start' || sid === 'push_back' || sid === 'start_up') {
    const gs = (strip.groundstate || '').toUpperCase()
    if (member === 'push' || sid === 'push_back') return gs === 'PUSH'
    if (member === 'start' || sid === 'start_up') return gs === 'STUP'
    return true
  }

  // INBOUND TWR-E / TWR-W — arr runway AoR only on split member headers
  if (
    g === 'inbound_twr' ||
    sid === 'inbound_twr_e' ||
    sid === 'inbound_twr_w'
  ) {
    const isMemberSlice =
      member === 'E' ||
      member === 'W' ||
      sid === 'inbound_twr_e' ||
      sid === 'inbound_twr_w'
    // Bandboxed / unsplit parent (inbound + groupId, no member): show all
    if (!isMemberSlice) return true
    const aor = inboundTwrAorFromRunway(strip.runway)
    if (!aor) return false
    const want = inboundTwrMemberFromAor(aor)
    if (member === 'E' || sid === 'inbound_twr_e') return want === 'E'
    if (member === 'W' || sid === 'inbound_twr_w') return want === 'W'
    return true
  }

  // INBOUND GND-E / N / W — SI family only on split member headers
  if (
    g === 'inbound_gnd' ||
    sid === 'inbound_gnd_e' ||
    sid === 'inbound_gnd_n' ||
    sid === 'inbound_gnd_w'
  ) {
    const isMemberSlice =
      member === 'E' ||
      member === 'N' ||
      member === 'W' ||
      sid === 'inbound_gnd_e' ||
      sid === 'inbound_gnd_n' ||
      sid === 'inbound_gnd_w'
    // Bandboxed / unsplit parent (inbound_gnd + groupId, no member): show all
    if (!isMemberSlice) return true
    const fam = inboundGndFamily(strip)
    if (!fam) return false
    const want = inboundGndMemberFromFamily(fam)
    if (member === 'E' || sid === 'inbound_gnd_e') return want === 'E'
    if (member === 'N' || sid === 'inbound_gnd_n') return want === 'N'
    if (member === 'W' || sid === 'inbound_gnd_w') return want === 'W'
    return true
  }

  return true
}

/** Server strip section ids for a split member (explicit override or defaults). */
export function stripSectionIdsForMember(
  g: SplitGroupDef,
  mem: SplitMemberDef,
): string[] {
  if (mem.stripSectionIds && mem.stripSectionIds.length > 0) {
    return [...mem.stripSectionIds]
  }
  if (g.mergedSectionIds.includes(mem.sectionId)) {
    return [mem.sectionId]
  }
  // Real server id used as a member of another group (e.g. pending_dep)
  if (SPLIT_GROUPS.some((x) => x.mergedSectionIds.includes(mem.sectionId))) {
    return [mem.sectionId]
  }
  return [...g.mergedSectionIds]
}

/**
 * INBOUND APP (TWR covering) and INBOUND TWR-* (GND covering) share YAML id
 * `inbound` but are different headers. Only the TWR-* form is splittable.
 */
function isInboundTwrMergedHeader(section: WorkspaceSection): boolean {
  const t = (section.title || '').toUpperCase().trim()
  if (!t || t.includes('APP')) return false
  // "INBOUND TWR-E, TWR-W" / "INBOUND TWR-E/W" — not plain "INBOUND"
  return /^INBOUND\s+TWR\b/.test(t)
}

export function splitGroupForSection(section: WorkspaceSection): SplitGroupDef | undefined {
  if (section.groupId) {
    return SPLIT_GROUPS.find((g) => g.id === section.groupId)
  }
  if (!section.sectionId) return undefined
  return SPLIT_GROUPS.find((g) => {
    const isMember = g.members.some((m) => m.sectionId === section.sectionId)
    const isMerged = g.mergedSectionIds.includes(section.sectionId!)
    if (!isMember && !isMerged) return false
    if (g.id === 'inbound_twr' && isMerged && !section.member) {
      return isInboundTwrMergedHeader(section)
    }
    return true
  })
}

/** Whether this workspace section can show a split button (merged / partial-merge). */
export function canSplitSection(section: WorkspaceSection): boolean {
  if (!section.sectionId) return false
  const held = membersOfSection(section)
  // Partial combo (e.g. GND-E/N) — split back into those pieces
  if (held.length >= 2 && section.groupId) return true
  // Nested split: e.g. TSAT member of CD ALL → TSAT / EOBT
  if (section.member && section.groupId && held.length === 1) {
    const parent = SPLIT_GROUPS.find((g) => g.id === section.groupId)
    if (parent?.childGroupId && parent.childOfMember === section.member) {
      return true
    }
    return false
  }
  const g = splitGroupForSection(section)
  if (!g) return false
  if (!g.mergedSectionIds.includes(section.sectionId)) return false
  if (g.id === 'inbound_twr' && !isInboundTwrMergedHeader(section)) return false
  return true
}

/** Member keys carried by a header (single, partial combo, or empty if fully merged). */
export function membersOfSection(section: WorkspaceSection): string[] {
  if (section.members && section.members.length > 0) {
    return [...section.members]
  }
  if (section.member) {
    return section.member.split('/').map((m) => m.trim()).filter(Boolean)
  }
  return []
}

/** Whether this header can accept/participate in a drop-to-merge. */
export function canMergeSection(section: WorkspaceSection): boolean {
  return !!section.groupId && membersOfSection(section).length > 0
}

function orderedMemberKeys(g: SplitGroupDef, keys: Iterable<string>): string[] {
  const want = new Set(keys)
  return g.members.map((m) => m.member).filter((k) => want.has(k))
}

function titleForMemberKeys(g: SplitGroupDef, keys: string[]): string {
  if (keys.length === 0 || keys.length >= g.members.length) return g.mergedTitle
  // Match backend: "INBOUND GND-E, GND-N" / "INBOUND TWR-E, TWR-W"
  if (g.id === 'inbound_gnd') {
    return `INBOUND ${keys.map((k) => `GND-${k}`).join(', ')}`
  }
  if (g.id === 'inbound_twr') {
    return `INBOUND ${keys.map((k) => `TWR-${k}`).join(', ')}`
  }
  // Fallback: join member titles
  return keys
    .map((k) => g.members.find((m) => m.member === k)?.title || k)
    .join(', ')
}

export function splitWorkspaceSection(
  section: WorkspaceSection,
  all: WorkspaceSection[],
  opts?: {
    headerH?: number
    /** Y of the next header below (or column bottom). Span is subdivided evenly. */
    spanEnd?: number
  },
): WorkspaceSection[] {
  if (!canSplitSection(section)) return all

  let g = splitGroupForSection(section)
  // Nested child group (CD ALL → TSAT/EOBT member → TSAT + EOBT)
  if (section.member && section.groupId && membersOfSection(section).length === 1) {
    const parent = SPLIT_GROUPS.find((x) => x.id === section.groupId)
    if (parent?.childGroupId && parent.childOfMember === section.member) {
      g = SPLIT_GROUPS.find((x) => x.id === parent.childGroupId)
    }
  }
  if (!g) return all

  const idx = all.findIndex((s) => s.instanceId === section.instanceId)
  if (idx < 0) return all

  const held = membersOfSection(section)
  // Partial merge → only those members; full merge / plain merged → whole group
  const splitDefs =
    held.length >= 2
      ? g.members.filter((m) => held.includes(m.member))
      : g.members
  if (splitDefs.length < 2) return all

  const headerH = Math.max(1, opts?.headerH ?? WORKSPACE_HEADER_H)
  const col = section.anchorColumn
  const n = splitDefs.length
  // Always assign absolute Y so new headers cannot sort past neighbours and
  // collapse onto the next divider (height 0).
  const baseY = Math.max(0, Math.round(section.y ?? 0))
  const minSpan = n * headerH
  const rawEnd = opts?.spanEnd
  let spanEnd =
    rawEnd != null && rawEnd > baseY
      ? Math.round(rawEnd)
      : baseY + Math.max(minSpan, n * 80)
  let span = spanEnd - baseY
  let grow = 0
  if (span < minSpan) {
    grow = minSpan - span
    span = minSpan
    spanEnd = baseY + span
  }
  const step = span / n

  const replacements: WorkspaceSection[] = splitDefs.map((m, i) => ({
    instanceId: newInstanceId(m.sectionId),
    sectionId: m.sectionId,
    title: m.title,
    groupId: g!.id,
    member: m.member,
    anchorColumn: col,
    stripSize: section.stripSize,
    sortFlow: section.sortFlow,
    // First stays put; later members evenly divide the old section (halfway for 2)
    y: Math.round(baseY + i * step),
  }))

  let next = [...all]
  next.splice(idx, 1, ...replacements)

  // Only push neighbours if the old span was too short to fit N headers
  if (grow > 0) {
    const newIds = new Set(replacements.map((r) => r.instanceId))
    const oldEnd = spanEnd - grow
    next = next.map((s) => {
      if (newIds.has(s.instanceId)) return s
      if (s.anchorColumn !== col || s.y == null) return s
      if (s.y >= oldEnd) return { ...s, y: s.y + grow }
      return s
    })
  }

  return next
}

export function mergeWorkspaceMembers(
  a: WorkspaceSection,
  b: WorkspaceSection,
  all: WorkspaceSection[],
  opts?: { placeAtInstanceId?: string },
): WorkspaceSection[] {
  if (!a.groupId || a.groupId !== b.groupId) return all
  const g = SPLIT_GROUPS.find((x) => x.id === a.groupId)
  if (!g) return all

  const placeAt =
    (opts?.placeAtInstanceId &&
      [a, b].find((m) => m.instanceId === opts.placeAtInstanceId)) ||
    b
  const aKeys = membersOfSection(a)
  const bKeys = membersOfSection(b)
  const aSet = new Set(aKeys)
  const bSet = new Set(bKeys)
  // No-op if one header already contains the other (e.g. E onto E/N)
  if (
    aKeys.every((k) => bSet.has(k)) ||
    bKeys.every((k) => aSet.has(k))
  ) {
    return all
  }
  const combined = orderedMemberKeys(g, [...aKeys, ...bKeys])
  if (combined.length < 2) return all

  const isFull = combined.length >= g.members.length
  const merged: WorkspaceSection = {
    instanceId: newInstanceId(g.mergedSectionIds[0] || g.id),
    sectionId: g.mergedSectionIds[0] ?? null,
    title: titleForMemberKeys(g, combined),
    groupId: g.id,
    // Full merge: no member keys (splittable via mergedSectionIds).
    // Partial (e.g. GND-E/N): keep keys so a third sibling can still drop-merge in.
    ...(isFull
      ? {}
      : { member: combined.join('/'), members: combined }),
    anchorColumn: placeAt.anchorColumn,
    stripSize: placeAt.stripSize,
    sortFlow: placeAt.sortFlow,
    ...(placeAt.y != null ? { y: placeAt.y } : {}),
  }

  // Only absorb the two dropped headers — leave other siblings (e.g. GND-W) alone
  const removeIds = new Set([a.instanceId, b.instanceId])
  const without = all.filter((s) => !removeIds.has(s.instanceId))
  const insertAt = all.findIndex((s) => s.instanceId === placeAt.instanceId)
  const next = [...without]
  next.splice(
    insertAt < 0 ? next.length : Math.min(insertAt, next.length),
    0,
    merged,
  )
  return next
}

/**
 * Close (X) on a split member: rebuild the combined divider at the *surviving*
 * sibling's location (not where Close was pressed).
 */
export function closeOrMergeOnX(
  section: WorkspaceSection,
  all: WorkspaceSection[],
): WorkspaceSection[] {
  if (canMergeSection(section)) {
    const siblings = all.filter(
      (s) => s.groupId === section.groupId && membersOfSection(s).length > 0,
    )
    // Only auto-combine when exactly one sibling remains (pairwise close)
    if (siblings.length === 2) {
      const other = siblings.find((s) => s.instanceId !== section.instanceId)
      if (other) {
        return mergeWorkspaceMembers(section, other, all, {
          placeAtInstanceId: other.instanceId,
        })
      }
    }
  }
  return all.filter((s) => s.instanceId !== section.instanceId)
}

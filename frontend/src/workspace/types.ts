/** ESSA flexible workspace — local-only continuous-flow layout (#51). */

import type { DtransVariantId } from './dtrans'

export type SortFlow = 'newestBottom' | 'newestTop'
export type SectionStripSize = 'compact' | 'normal' | 'expanded'

export type { DtransVariantId }

/** Split/merge family ids (ESSA + OTHER; RTC will reuse OTHER groups) */
export type SplitGroupId =
  | 'inbound_twr'
  | 'inbound_gnd'
  | 'cd_all'
  | 'cd_cleared'
  | 'push_start'
  | 'taxiway'
  /** ESSA: TMA → TMA ARR + TMA DEP (same YAML ids as CTR; title selects family) */
  | 'essa_tma'
  /** ESSA: CTR → CTR ARR + CTR DEP */
  | 'essa_ctr'
  /** OTHER: TMA / CTR → TMA + CTR */
  | 'saab_ctr_tma'
  /** OTHER: CTR → CTR ARR + CTR DEP (child of saab_ctr_tma) */
  | 'saab_ctr'
  /** OTHER / classic: RUNWAY ↔ RUNWAY ARR / DEP */
  | 'saab_runway'
  /** OTHER / classic: TAXIWAY ↔ TAXIWAY ARR / DEP */
  | 'saab_taxi'
  /** OTHER / classic: PENDING CLR ↔ CLEARED */
  | 'saab_clearance'

export interface WorkspaceSection {
  /** Stable UI id (uuid for empty blockers; usually sectionId for real sections) */
  instanceId: string
  /**
   * null = empty overflow blocker (not a YAML/catalog section).
   * Strip membership still uses `instanceId` as a synthetic sectionId so
   * manually dropped strips can park under the divider; rules never target it.
   */
  sectionId: string | null
  /** Display title override (empty blockers have none) */
  title?: string
  groupId?: SplitGroupId
  /**
   * Member within a split group, e.g. E/W/N, pending, tsat, eobt, push, start, dep, arr.
   * Partial merges may use slash-joined keys (e.g. `E/N`) with `members` set.
   */
  member?: string
  /**
   * When 2+ siblings were dropped together but not the whole group (e.g. GND-E+N
   * while W stays separate). Full merge clears this (and `member`).
   */
  members?: string[]
  /** Column index where this header is anchored (0-based) */
  anchorColumn: number
  /**
   * Header top offset from the column body top (px).
   * First header with y>0 → overflow gap (extension of previous bay).
   * When unset, column uses classic equal-flex until positions are synced.
   */
  y?: number
  /**
   * Fraction of column body height (0–1). When set, effective Y is
   * `round(bodyH * yRatio)` (e.g. CD default EOBT at 0.75 = bottom quarter).
   * Wins over a stale absolute `y` when body height is known.
   */
  yRatio?: number
  /** Pixel height for non-last sections (derived from y when present; last always flexes) */
  height?: number
  stripSize: SectionStripSize
  sortFlow: SortFlow
  /**
   * ESSA Direct Transfer divider (sectionId stays null).
   * Green segmented header + body zones → manualTransfer; strips park until accept.
   */
  dtrans?: DtransVariantId
}

/** Resolve header top Y (px) from yRatio and/or absolute y. */
export function effectiveSectionY(
  section: Pick<WorkspaceSection, 'y' | 'yRatio'>,
  bodyHeightPx: number,
): number | undefined {
  if (
    section.yRatio != null &&
    Number.isFinite(section.yRatio) &&
    bodyHeightPx > 0
  ) {
    return Math.max(0, Math.round(bodyHeightPx * section.yRatio))
  }
  return section.y
}

/** Minimum section block height between headers */
export const WORKSPACE_MIN_SECTION_H = 80

/** Fallback header bar height if DOM measure is unavailable */
export const WORKSPACE_HEADER_H = 28

/**
 * Saved/active ESSA workspace: bay count + section dividers only.
 * Info strips are not part of this config (separate localStorage).
 */
export interface WorkspaceLayout {
  version: 1
  columnCount: number
  sections: WorkspaceSection[]
  /** Fingerprint of ESSA roles this layout was built for */
  roleKey: string
  /** Structured roles at save time */
  roles: string[]
  /** Optional display label (collapsed GND/TWR) */
  rolesLabel?: string
}

export interface SavedWorkspaceLayout {
  id: string
  name: string
  savedAt: number
  layout: WorkspaceLayout
  /** When true, this is the user default for layout.roleKey */
  isUserDefault?: boolean
}

export interface WorkspaceStoreFile {
  version: 1
  /** roleKey → default saved layout id */
  userDefaults: Record<string, string>
  layouts: SavedWorkspaceLayout[]
  /** Active workspace for current session (optional persist) */
  active?: WorkspaceLayout | null
  /** Global default sort/flow for new sections */
  defaultSortFlow?: SortFlow
}

export const WORKSPACE_STORAGE_KEY = 'efs/essaWorkspace'
export const WORKSPACE_MIN_COLUMNS = 1
export const WORKSPACE_MAX_COLUMNS = 6

export function newInstanceId(prefix = 'ws'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

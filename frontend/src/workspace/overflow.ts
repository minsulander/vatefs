/**
 * ESSA workspace continuous multi-column strip overflow (display-only).
 * Logical membership stays on sectionId; packing only chooses where strips paint.
 */

import { isStripCompact } from '@/composables/useStripSizeMode'
import { isRunwayOrderSectionId } from '@vatefs/common'
import type { WorkspaceSection } from './types'
import { WORKSPACE_HEADER_H } from './types'

export type OverflowHostPlan = {
  column: number
  stripIds: string[]
  sourceInstanceId: string
  /** Logical strip sectionId (server / synthetic parking id) */
  sourceSectionId: string
  sourceBayId: string
  /** Last host may scroll when leftovers remain */
  allowScroll: boolean
}

export type SectionOverflowPlan = {
  instanceId: string
  /** How many leading top-strips stay in the primary section */
  primaryCount: number
  /** Next column(s) have top capacity (gap>0 or empty) */
  hasOverflowPath: boolean
  /** Clip primary scrollbar — packed strips continue in hosts */
  hidePrimaryScroll: boolean
}

export type OverflowPackResult = {
  byInstance: Record<string, SectionOverflowPlan>
  /** column → strips to paint in that column's top overflow gap */
  byHostColumn: Record<number, OverflowHostPlan>
}

export type OverflowPackInput = {
  columnCount: number
  sectionsInColumn: (col: number) => WorkspaceSection[]
  getColumnTopGap: (col: number) => number
  columnBodyHeight: (col: number) => number
  /** Ordered top strip ids per workspace instance (visual order) */
  topOrderByInstance: Record<string, string[]>
  /** Resolve display bayId for strip actions / DnD */
  bayIdForSection: (sectionId: string) => string
  measureHeaderHeight: (instanceId?: string) => number
  measurePinnedChrome: (instanceId: string) => number
  bayScaleForColumn: (col: number) => number
  gapPxBeforeIndex?: (sectionId: string, bayId: string, index: number) => number
}

const BOTTOM_DROP_ZONE_PX = 25
const STRIP_PAD_PX = 2

export function estimateStripHeightPx(stripId: string, bayScale: number): number {
  const el = document.querySelector(
    `[data-strip-id="${CSS.escape(stripId)}"]`,
  ) as HTMLElement | null
  if (el) {
    const h = el.getBoundingClientRect().height
    if (h > 0) return h
  }
  const body = (isStripCompact(stripId) ? 25 : 50) * Math.max(0.55, bayScale || 1)
  return body + STRIP_PAD_PX
}

/** How many leading strips fit in `capacityPx` (gaps before each index included). */
export function countFittingStrips(
  stripIds: string[],
  capacityPx: number,
  bayScale: number,
  gapBefore?: (index: number) => number,
): number {
  if (capacityPx <= 0 || stripIds.length === 0) return 0
  let used = 0
  let n = 0
  for (let i = 0; i < stripIds.length; i++) {
    const gap = gapBefore?.(i) ?? 0
    const h = estimateStripHeightPx(stripIds[i]!, bayScale) + gap
    if (used + h > capacityPx + 0.5) break
    used += h
    n++
  }
  return n
}

function primaryCapacityPx(
  col: number,
  lastReal: WorkspaceSection,
  sorted: WorkspaceSection[],
  lastRealIdx: number,
  input: OverflowPackInput,
): number {
  const bodyH = input.columnBodyHeight(col)
  if (bodyH <= 0) return 0
  const y = lastReal.y ?? 0
  const next = sorted[lastRealIdx + 1]
  const sectionBottom = next?.y != null ? next.y : bodyH
  const headerH = input.measureHeaderHeight(lastReal.instanceId) || WORKSPACE_HEADER_H
  const pinned = input.measurePinnedChrome(lastReal.instanceId)
  const content = sectionBottom - y - headerH - pinned
  // top-strips-container vertical padding
  return Math.max(0, content - 4)
}

/**
 * Pack last-real-section strips into primary + consecutive host top-gaps.
 * Host columns are claimed left-to-right so two sources never share one gap.
 */
export function packWorkspaceOverflow(input: OverflowPackInput): OverflowPackResult {
  const byInstance: Record<string, SectionOverflowPlan> = {}
  const byHostColumn: Record<number, OverflowHostPlan> = {}
  const claimedHosts = new Set<number>()

  for (let c = 0; c < input.columnCount; c++) {
    const sorted = input.sectionsInColumn(c)
    let lastRealIdx = -1
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (sorted[i]!.sectionId) {
        lastRealIdx = i
        break
      }
    }
    if (lastRealIdx < 0) continue

    const lastReal = sorted[lastRealIdx]!
    const sectionId = lastReal.sectionId!
    const order = input.topOrderByInstance[lastReal.instanceId] ?? []
    const bayId = input.bayIdForSection(sectionId)
    const bayScale = input.bayScaleForColumn(c)
    const gapAt = (globalIndex: number) =>
      input.gapPxBeforeIndex?.(sectionId, bayId, globalIndex) ?? 0

    // RUNWAY stays in-bay (autofit + scroll). Spilling to the next column made
    // the primary list never overflow, so Auto resize never compacted RUNWAY.
    if (isRunwayOrderSectionId(sectionId)) {
      byInstance[lastReal.instanceId] = {
        instanceId: lastReal.instanceId,
        primaryCount: order.length,
        hasOverflowPath: false,
        hidePrimaryScroll: false,
      }
      continue
    }

    const hostCaps: { column: number; px: number }[] = []
    for (let nc = c + 1; nc < input.columnCount; nc++) {
      if (claimedHosts.has(nc)) break
      const gap = input.getColumnTopGap(nc)
      if (gap <= 0) break
      hostCaps.push({ column: nc, px: gap })
    }
    const hasOverflowPath = hostCaps.length > 0

    if (!hasOverflowPath) {
      byInstance[lastReal.instanceId] = {
        instanceId: lastReal.instanceId,
        primaryCount: order.length,
        hasOverflowPath: false,
        hidePrimaryScroll: false,
      }
      continue
    }

    const primaryCap = primaryCapacityPx(c, lastReal, sorted, lastRealIdx, input)
    const primaryCount = countFittingStrips(order, primaryCap, bayScale, (i) => gapAt(i))
    let cursor = primaryCount
    let remaining = order.slice(cursor)

    for (let hi = 0; hi < hostCaps.length; hi++) {
      const host = hostCaps[hi]!
      if (remaining.length === 0) break
      const hostScale = input.bayScaleForColumn(host.column)
      const fit = countFittingStrips(remaining, host.px, hostScale, (i) => gapAt(cursor + i))
      const isLast = hi === hostCaps.length - 1
      // Last host absorbs leftovers (scroll); intermediate hosts only take what fits
      const take = isLast ? remaining.length : fit
      if (take <= 0) break

      const slice = remaining.slice(0, take)
      claimedHosts.add(host.column)
      byHostColumn[host.column] = {
        column: host.column,
        stripIds: slice,
        sourceInstanceId: lastReal.instanceId,
        sourceSectionId: sectionId,
        sourceBayId: bayId,
        allowScroll: isLast && take > fit,
      }
      remaining = remaining.slice(take)
      cursor += take
    }

    byInstance[lastReal.instanceId] = {
      instanceId: lastReal.instanceId,
      primaryCount,
      hasOverflowPath: true,
      // Primary only paints fitted strips; continuation is in hosts (or empty if all fit)
      hidePrimaryScroll: true,
    }
  }

  return { byInstance, byHostColumn }
}

/** Pinned chrome below the scrollport (drop tray + pinned strips). */
export function measurePinnedChromePx(instanceId: string): number {
  const root = document.querySelector(
    `[data-ws-instance="${CSS.escape(instanceId)}"]`,
  ) as HTMLElement | null
  if (!root) return BOTTOM_DROP_ZONE_PX
  const zone = root.querySelector('.bottom-drop-zone') as HTMLElement | null
  const pinned = root.querySelector('.bottom-strips-container') as HTMLElement | null
  const zh = zone?.getBoundingClientRect().height ?? BOTTOM_DROP_ZONE_PX
  const ph = pinned?.getBoundingClientRect().height ?? 0
  return zh + ph
}

export function measureBayScale(col: number): number {
  const bay = document.querySelector(
    `.efs-bay[data-ws-column="${col}"]`,
  ) as HTMLElement | null
  if (!bay) return 1
  const raw =
    bay.style.getPropertyValue('--bay-scale') ||
    getComputedStyle(bay).getPropertyValue('--bay-scale')
  const n = parseFloat(raw)
  return Number.isFinite(n) && n > 0 ? n : 1
}

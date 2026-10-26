/**
 * Client-only RTC column extras: empty dividers, hidden sections, free-Y order.
 * Merged into bay.sections for display; survives layout broadcasts via localStorage.
 *
 * Divider drag matches OTHER/ESSA workspace: absolute header Y → section heights
 * (gaps between headers), not midpoint list-swapping.
 */

import { ref } from 'vue'
import type { Bay, Section } from '@vatefs/common'

const STORAGE_KEY = 'efs/rtcColumnExtras'
/** Fallback header bar height (matches .section-header CSS). */
const RTC_HEADER_H = 18

export type RtcEmptyDivider = {
  id: string
  title: string
}

export type RtcStripSize = 'compact' | 'normal' | 'expanded'
const RTC_STRIP_SIZE_ORDER: RtcStripSize[] = ['normal', 'compact', 'expanded']

export type RtcBayExtras = {
  emptyDividers: RtcEmptyDivider[]
  /** Logical ids: arr | tma | app | rwy | twy | dep */
  hiddenLogical: string[]
  /** Display order of section ids (template + empty). Missing ids append in server order. */
  sectionOrder: string[]
  /** Absolute Y of each section header within .bay-body (px from top). */
  sectionYs: Record<string, number>
  /** ARR + CTR combined into one "ARR / CTR" header */
  arrAppMerged: boolean
  /** CTR + TMA combined into one "CTR/TMA" (or "TMA/CTR") header */
  ctrTmaMerged: boolean
  /** DEP split into CLR + PUSH&START (push/start leave TAXIWAY visually) */
  depSplit: boolean
  /**
   * When covering TMA without CTR, DEP split yields RUNWAY + TAXIWAY + CLR
   * instead of CLR + PUSH&START.
   */
  depSplitTmaOnly: boolean
  /** Per display-section strip size (normal → compact → expanded), like workspace */
  stripSizes: Record<string, RtcStripSize>
}

/** Synthetic display ids (not server section ids). */
export function rtcArrAppMergedId(bayId: string): string {
  return `${bayId}_arr_app`
}
export function rtcClrId(bayId: string): string {
  return `${bayId}_clr`
}
export function rtcPushStartId(bayId: string): string {
  return `${bayId}_push_start`
}

export function isRtcArrAppMergedId(sectionId: string): boolean {
  return /^(?:bay\d+|idle)_arr_app$/i.test(sectionId)
}
export function isRtcClrId(sectionId: string): boolean {
  return /^(?:bay\d+|idle)_clr$/i.test(sectionId)
}
export function isRtcPushStartId(sectionId: string): boolean {
  return /^(?:bay\d+|idle)_push_start$/i.test(sectionId)
}

/** Groundstates that belong under PUSH&START when DEP is split. */
export function isRtcPushStartGroundstate(gs: string | undefined | null): boolean {
  const g = (gs || '').toUpperCase()
  return g === 'STUP' || g === 'PUSH'
}

/** Basics that must not be closed with X. */
export function isRtcBasicSectionId(sectionId: string): boolean {
  if (isRtcEmptyDividerId(sectionId)) return false
  if (isRtcClrId(sectionId) || isRtcPushStartId(sectionId)) return false
  if (isRtcArrAppMergedId(sectionId) || isRtcCtrTmaMergedId(sectionId)) return true
  const log = logicalSectionIdFromRtc(sectionId)
  return (
    log === 'arr' ||
    log === 'tma' ||
    log === 'app' ||
    log === 'rwy' ||
    log === 'twy' ||
    log === 'dep'
  )
}

/** All RTC dividers can show X (close hides via catalog / removes empty / merges DEP halves). */
export function rtcCanCloseSection(_sectionId: string): boolean {
  return true
}

export function rtcCanSplitSection(sectionId: string): boolean {
  return (
    isRtcArrAppMergedId(sectionId) ||
    isRtcCtrTmaMergedId(sectionId) ||
    logicalSectionIdFromRtc(sectionId) === 'dep'
  )
}

export function getRtcStripSize(bayId: string, sectionId: string): RtcStripSize {
  const s = normalizeExtras(bayId).stripSizes[sectionId]
  return s === 'compact' || s === 'expanded' ? s : 'normal'
}

export function cycleRtcStripSize(bayId: string, sectionId: string): RtcStripSize {
  const cur = normalizeExtras(bayId)
  const prev = getRtcStripSize(bayId, sectionId)
  const next = RTC_STRIP_SIZE_ORDER[(RTC_STRIP_SIZE_ORDER.indexOf(prev) + 1) % RTC_STRIP_SIZE_ORDER.length]!
  extrasByBay.value = {
    ...extrasByBay.value,
    [bayId]: {
      ...cur,
      stripSizes: { ...cur.stripSizes, [sectionId]: next },
    },
  }
  bump()
  return next
}

/** Close a divider: empty remove, DEP halves merge, basics hide (catalog restore). */
export function closeRtcSection(bayId: string, sectionId: string) {
  if (isRtcEmptyDividerId(sectionId)) {
    removeRtcEmptyDivider(bayId, sectionId)
    return
  }
  if (isRtcClrId(sectionId) || isRtcPushStartId(sectionId)) {
    mergeRtcDep(bayId)
    return
  }
  if (isRtcArrAppMergedId(sectionId)) {
    hideRtcLogicalSection(bayId, 'arr')
    hideRtcLogicalSection(bayId, 'app')
    return
  }
  const log = logicalSectionIdFromRtc(sectionId)
  if (
    log === 'arr' ||
    log === 'tma' ||
    log === 'app' ||
    log === 'rwy' ||
    log === 'twy' ||
    log === 'dep'
  ) {
    hideRtcLogicalSection(bayId, log)
  }
  if (isRtcCtrTmaMergedId(sectionId)) {
    hideRtcLogicalSection(bayId, 'app')
    hideRtcLogicalSection(bayId, 'tma')
  }
}

/** RTC bay template logical section ids (catalog). */
export const RTC_CATALOG_SECTIONS: readonly { logical: string; title: string }[] = [
  { logical: 'arr', title: 'ARR' },
  { logical: 'tma', title: 'TMA' },
  { logical: 'app', title: 'CTR' },
  { logical: 'rwy', title: 'RUNWAY' },
  { logical: 'twy', title: 'TAXIWAY' },
  { logical: 'dep', title: 'DEP' },
] as const

export function rtcCtrTmaMergedId(bayId: string): string {
  return `${bayId}_ctr_tma`
}

export function isRtcCtrTmaMergedId(sectionId: string): boolean {
  return /^(?:bay\d+|idle)_ctr_tma$/i.test(sectionId)
}

const extrasByBay = ref<Record<string, RtcBayExtras>>(loadExtras())
/** Bumps when extras change so Vue computeds re-run */
const extrasEpoch = ref(0)
/** Section id currently being dragged (RTC divider) */
export const rtcDraggingSectionId = ref<string | null>(null)

function loadExtras(): Record<string, RtcBayExtras> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const obj = JSON.parse(raw) as unknown
    if (!obj || typeof obj !== 'object') return {}
    const out: Record<string, RtcBayExtras> = {}
    for (const [bayId, v] of Object.entries(obj as Record<string, Partial<RtcBayExtras> & {
      emptyDividers?: Array<{ id: string; title?: string; afterSectionId?: string | null }>
    }>)) {
      const empties = (v.emptyDividers ?? []).map((e) => ({
        id: e.id,
        title: e.title || '',
      }))
      // Migrate legacy afterSectionId empties into sectionOrder if needed
      let order = Array.isArray(v.sectionOrder) ? [...v.sectionOrder] : []
      if (order.length === 0 && empties.length > 0) {
        for (const e of v.emptyDividers ?? []) {
          const after = (e as { afterSectionId?: string | null }).afterSectionId
          if (!after) order.unshift(e.id)
          else {
            const i = order.indexOf(after)
            if (i >= 0) order.splice(i + 1, 0, e.id)
            else order.push(e.id)
          }
        }
      }
      const ys: Record<string, number> = {}
      if (v.sectionYs && typeof v.sectionYs === 'object') {
        for (const [id, y] of Object.entries(v.sectionYs)) {
          if (typeof y === 'number' && Number.isFinite(y)) ys[id] = Math.round(y)
        }
      }
      const stripSizes: Record<string, RtcStripSize> = {}
      if (v.stripSizes && typeof v.stripSizes === 'object') {
        for (const [id, sz] of Object.entries(v.stripSizes)) {
          if (sz === 'compact' || sz === 'normal' || sz === 'expanded') stripSizes[id] = sz
        }
      }
      out[bayId] = {
        emptyDividers: empties,
        hiddenLogical: Array.isArray(v.hiddenLogical) ? [...v.hiddenLogical] : [],
        sectionOrder: order,
        sectionYs: ys,
        arrAppMerged: !!v.arrAppMerged,
        ctrTmaMerged: !!(v as { ctrTmaMerged?: boolean }).ctrTmaMerged,
        depSplit: !!v.depSplit,
        depSplitTmaOnly: !!(v as { depSplitTmaOnly?: boolean }).depSplitTmaOnly,
        stripSizes,
      }
    }
    return out
  } catch {
    return {}
  }
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(extrasByBay.value))
  } catch {
    /* ignore */
  }
}

function bump(write = true) {
  extrasByBay.value = { ...extrasByBay.value }
  extrasEpoch.value++
  if (write) persist()
}

function normalizeExtras(bayId: string): RtcBayExtras {
  const cur = extrasByBay.value[bayId]
  if (!cur) {
    return {
      emptyDividers: [],
      hiddenLogical: [],
      sectionOrder: [],
      sectionYs: {},
      arrAppMerged: false,
      ctrTmaMerged: false,
      depSplit: false,
      depSplitTmaOnly: false,
      stripSizes: {},
    }
  }
  return {
    emptyDividers: cur.emptyDividers ?? [],
    hiddenLogical: cur.hiddenLogical ?? [],
    sectionOrder: cur.sectionOrder ?? [],
    sectionYs: cur.sectionYs ?? {},
    arrAppMerged: !!cur.arrAppMerged,
    ctrTmaMerged: !!cur.ctrTmaMerged,
    depSplit: !!cur.depSplit,
    depSplitTmaOnly: !!cur.depSplitTmaOnly,
    stripSizes: cur.stripSizes ?? {},
  }
}

export function getRtcBayExtras(bayId: string): RtcBayExtras {
  return normalizeExtras(bayId)
}

/** Reactive version tick — depend on this in computeds. */
export function rtcExtrasVersion(): number {
  return extrasEpoch.value
}

export function logicalSectionIdFromRtc(sectionId: string): string {
  const m = sectionId.match(/^(?:bay\d+|idle)_(.+)$/i)
  return m?.[1] ?? sectionId
}

export function isRtcEmptyDividerId(sectionId: string): boolean {
  return sectionId.startsWith('rtc_empty_')
}

export function fullRtcSectionId(bayId: string, logical: string): string {
  return `${bayId}_${logical}`
}

function stripYs(ys: Record<string, number>, dropId: string): Record<string, number> {
  if (!(dropId in ys)) return ys
  const next = { ...ys }
  delete next[dropId]
  return next
}

export function addRtcEmptyDivider(bayId: string, afterSectionId: string | null = null) {
  const cur = normalizeExtras(bayId)
  const id = `rtc_empty_${bayId}_${Date.now().toString(36)}`
  let order = [...cur.sectionOrder]
  if (order.length === 0 && afterSectionId) {
    order = [afterSectionId, id]
  } else if (!afterSectionId) {
    order.unshift(id)
  } else {
    const i = order.indexOf(afterSectionId)
    if (i >= 0) order.splice(i + 1, 0, id)
    else order.push(afterSectionId, id)
  }
  const ys = { ...cur.sectionYs }
  if (Object.keys(ys).length > 0) {
    const afterY = afterSectionId != null ? ys[afterSectionId] : undefined
    if (afterY != null) ys[id] = afterY + RTC_HEADER_H
    else {
      const maxY = Math.max(0, ...Object.values(ys))
      ys[id] = maxY + RTC_HEADER_H
    }
  }
  extrasByBay.value = {
    ...extrasByBay.value,
    [bayId]: {
      ...cur,
      emptyDividers: [...cur.emptyDividers, { id, title: '' }],
      sectionOrder: order,
      sectionYs: ys,
    },
  }
  bump()
}

export function removeRtcEmptyDivider(bayId: string, emptyId: string) {
  const cur = normalizeExtras(bayId)
  extrasByBay.value = {
    ...extrasByBay.value,
    [bayId]: {
      ...cur,
      emptyDividers: cur.emptyDividers.filter((e) => e.id !== emptyId),
      sectionOrder: cur.sectionOrder.filter((id) => id !== emptyId),
      sectionYs: stripYs(cur.sectionYs, emptyId),
    },
  }
  bump()
}

export function hideRtcLogicalSection(bayId: string, logical: string) {
  const cur = normalizeExtras(bayId)
  if (cur.hiddenLogical.includes(logical)) return
  const full = fullRtcSectionId(bayId, logical)
  let order = cur.sectionOrder.filter(
    (id) => id !== full && logicalSectionIdFromRtc(id) !== logical,
  )
  let ys = stripYs(cur.sectionYs, full)
  let arrAppMerged = cur.arrAppMerged
  let depSplit = cur.depSplit
  if (logical === 'arr' || logical === 'app') {
    arrAppMerged = false
    const mergedId = rtcArrAppMergedId(bayId)
    order = order.filter((id) => id !== mergedId)
    ys = stripYs(ys, mergedId)
  }
  if (logical === 'dep') {
    depSplit = false
    const clrId = rtcClrId(bayId)
    const pushId = rtcPushStartId(bayId)
    order = order.filter((id) => id !== clrId && id !== pushId)
    ys = stripYs(stripYs(ys, clrId), pushId)
  }
  extrasByBay.value = {
    ...extrasByBay.value,
    [bayId]: {
      ...cur,
      hiddenLogical: [...cur.hiddenLogical, logical],
      sectionOrder: order,
      sectionYs: ys,
      arrAppMerged,
      depSplit,
    },
  }
  bump()
}

export function ensureRtcLogicalSection(bayId: string, logical: string) {
  const cur = normalizeExtras(bayId)
  if (!cur.hiddenLogical.includes(logical)) return
  const full = fullRtcSectionId(bayId, logical)
  const order = cur.sectionOrder.includes(full) ? cur.sectionOrder : [...cur.sectionOrder, full]
  const ys = { ...cur.sectionYs }
  if (Object.keys(ys).length > 0 && ys[full] == null) {
    const maxY = Math.max(0, ...Object.values(ys))
    ys[full] = maxY + RTC_HEADER_H
  }
  extrasByBay.value = {
    ...extrasByBay.value,
    [bayId]: {
      ...cur,
      hiddenLogical: cur.hiddenLogical.filter((l) => l !== logical),
      sectionOrder: order,
      sectionYs: ys,
    },
  }
  bump()
}

export function isRtcLogicalPresent(bay: Bay, logical: string): boolean {
  void extrasByBay.value
  const extras = getRtcBayExtras(bay.id)
  if (extras.hiddenLogical.includes(logical)) return false
  if (extras.arrAppMerged && (logical === 'arr' || logical === 'app')) return true
  if (extras.ctrTmaMerged && (logical === 'app' || logical === 'tma')) return true
  if (extras.depSplit && logical === 'dep') return true
  const full = fullRtcSectionId(bay.id, logical)
  return bay.sections.some((s) => s.id === full || logicalSectionIdFromRtc(s.id) === logical)
}

/** Replace order entry `from` with `toIds` (preserving neighbours). */
function replaceOrderIds(order: string[], from: string | string[], toIds: string[]): string[] {
  const fromSet = new Set(Array.isArray(from) ? from : [from])
  const out: string[] = []
  let inserted = false
  for (const id of order) {
    if (fromSet.has(id)) {
      if (!inserted) {
        out.push(...toIds)
        inserted = true
      }
      continue
    }
    if (toIds.includes(id)) continue
    out.push(id)
  }
  if (!inserted) out.push(...toIds)
  return out
}

function rewriteYs(
  ys: Record<string, number>,
  removeIds: string[],
  add: Record<string, number>,
): Record<string, number> {
  const next = { ...ys }
  for (const id of removeIds) delete next[id]
  Object.assign(next, add)
  return next
}

/** Merge ARR + CTR into one header (drop one onto the other). */
export function mergeRtcArrApp(bayId: string) {
  const cur = normalizeExtras(bayId)
  if (cur.arrAppMerged) return
  const arrId = fullRtcSectionId(bayId, 'arr')
  const appId = fullRtcSectionId(bayId, 'app')
  const mergedId = rtcArrAppMergedId(bayId)
  const yArr = cur.sectionYs[arrId]
  const yApp = cur.sectionYs[appId]
  const yMerged =
    yArr != null && yApp != null ? Math.min(yArr, yApp) : (yArr ?? yApp ?? undefined)
  extrasByBay.value = {
    ...extrasByBay.value,
    [bayId]: {
      ...cur,
      arrAppMerged: true,
      sectionOrder: replaceOrderIds(cur.sectionOrder, [arrId, appId], [mergedId]),
      sectionYs:
        yMerged != null
          ? rewriteYs(cur.sectionYs, [arrId, appId], { [mergedId]: yMerged })
          : stripYs(stripYs(cur.sectionYs, arrId), appId),
    },
  }
  bump()
}

/** Split merged ARR / CTR back into ARR + CTR. */
export function splitRtcArrApp(bayId: string) {
  const cur = normalizeExtras(bayId)
  if (!cur.arrAppMerged) return
  const arrId = fullRtcSectionId(bayId, 'arr')
  const appId = fullRtcSectionId(bayId, 'app')
  const mergedId = rtcArrAppMergedId(bayId)
  const y0 = cur.sectionYs[mergedId]
  const addYs: Record<string, number> = {}
  if (y0 != null) {
    addYs[arrId] = y0
    addYs[appId] = y0 + RTC_HEADER_H
  }
  extrasByBay.value = {
    ...extrasByBay.value,
    [bayId]: {
      ...cur,
      arrAppMerged: false,
      sectionOrder: replaceOrderIds(cur.sectionOrder, mergedId, [arrId, appId]),
      sectionYs: rewriteYs(cur.sectionYs, [mergedId], addYs),
    },
  }
  bump()
}

/** Split DEP → CLR + PUSH&START. */
export function splitRtcDep(bayId: string) {
  const cur = normalizeExtras(bayId)
  if (cur.depSplit) return
  const depId = fullRtcSectionId(bayId, 'dep')
  const clrId = rtcClrId(bayId)
  const pushId = rtcPushStartId(bayId)
  const y0 = cur.sectionYs[depId]
  const addYs: Record<string, number> = {}
  if (y0 != null) {
    addYs[clrId] = y0
    addYs[pushId] = y0 + RTC_HEADER_H
  }
  extrasByBay.value = {
    ...extrasByBay.value,
    [bayId]: {
      ...cur,
      depSplit: true,
      sectionOrder: replaceOrderIds(cur.sectionOrder, depId, [clrId, pushId]),
      sectionYs: rewriteYs(cur.sectionYs, [depId], addYs),
    },
  }
  bump()
}

/** Recombine CLR + PUSH&START → DEP (also used when closing either half). */
export function mergeRtcDep(bayId: string) {
  const cur = normalizeExtras(bayId)
  if (!cur.depSplit) return
  const depId = fullRtcSectionId(bayId, 'dep')
  const clrId = rtcClrId(bayId)
  const pushId = rtcPushStartId(bayId)
  const yClr = cur.sectionYs[clrId]
  const yPush = cur.sectionYs[pushId]
  const yDep =
    yClr != null && yPush != null ? Math.min(yClr, yPush) : (yClr ?? yPush ?? undefined)
  extrasByBay.value = {
    ...extrasByBay.value,
    [bayId]: {
      ...cur,
      depSplit: false,
      sectionOrder: replaceOrderIds(cur.sectionOrder, [clrId, pushId], [depId]),
      sectionYs:
        yDep != null
          ? rewriteYs(cur.sectionYs, [clrId, pushId], { [depId]: yDep })
          : stripYs(stripYs(cur.sectionYs, clrId), pushId),
    },
  }
  bump()
}

/** True when dragging ARR onto CTR (or vice versa) in the same bay. */
export function tryRtcMergeArrApp(bayId: string, aId: string, bId: string): boolean {
  const logs = new Set([logicalSectionIdFromRtc(aId), logicalSectionIdFromRtc(bId)])
  if (!logs.has('arr') || !logs.has('app')) return false
  if (aId === bId) return false
  mergeRtcArrApp(bayId)
  return true
}

/** Split CTR/TMA → CTR + TMA. */
export function splitRtcCtrTma(bayId: string) {
  const cur = normalizeExtras(bayId)
  if (!cur.ctrTmaMerged) return
  const appId = fullRtcSectionId(bayId, 'app')
  const tmaId = fullRtcSectionId(bayId, 'tma')
  const mergedId = rtcCtrTmaMergedId(bayId)
  const y0 = cur.sectionYs[mergedId]
  const addYs: Record<string, number> = {}
  if (y0 != null) {
    addYs[appId] = y0
    addYs[tmaId] = y0 + RTC_HEADER_H
  }
  extrasByBay.value = {
    ...extrasByBay.value,
    [bayId]: {
      ...cur,
      ctrTmaMerged: false,
      sectionOrder: replaceOrderIds(cur.sectionOrder, mergedId, [appId, tmaId]),
      sectionYs: rewriteYs(cur.sectionYs, [mergedId], addYs),
    },
  }
  bump()
}

export function mergeRtcCtrTma(bayId: string) {
  const cur = normalizeExtras(bayId)
  if (cur.ctrTmaMerged) return
  const appId = fullRtcSectionId(bayId, 'app')
  const tmaId = fullRtcSectionId(bayId, 'tma')
  const mergedId = rtcCtrTmaMergedId(bayId)
  const yApp = cur.sectionYs[appId]
  const yTma = cur.sectionYs[tmaId]
  const yMerged =
    yApp != null && yTma != null ? Math.min(yApp, yTma) : (yApp ?? yTma ?? undefined)
  extrasByBay.value = {
    ...extrasByBay.value,
    [bayId]: {
      ...cur,
      ctrTmaMerged: true,
      hiddenLogical: cur.hiddenLogical.filter((l) => l !== 'app' && l !== 'tma'),
      sectionOrder: replaceOrderIds(cur.sectionOrder, [appId, tmaId], [mergedId]),
      sectionYs:
        yMerged != null
          ? rewriteYs(cur.sectionYs, [appId, tmaId], { [mergedId]: yMerged })
          : rewriteYs(cur.sectionYs, [appId, tmaId], {}),
    },
  }
  bump()
}

export function splitRtcSection(bayId: string, sectionId: string) {
  if (isRtcArrAppMergedId(sectionId)) {
    splitRtcArrApp(bayId)
    return
  }
  if (isRtcCtrTmaMergedId(sectionId)) {
    splitRtcCtrTma(bayId)
    return
  }
  if (logicalSectionIdFromRtc(sectionId) === 'dep') {
    splitRtcDep(bayId)
  }
}

/**
 * Server section ids whose strips paint under this RTC display section.
 */
export function rtcStripMatchIds(bayId: string, displaySectionId: string): string[] {
  if (isRtcEmptyDividerId(displaySectionId)) return [displaySectionId]
  if (isRtcArrAppMergedId(displaySectionId)) {
    return [fullRtcSectionId(bayId, 'arr'), fullRtcSectionId(bayId, 'app')]
  }
  if (isRtcCtrTmaMergedId(displaySectionId)) {
    return [fullRtcSectionId(bayId, 'app'), fullRtcSectionId(bayId, 'tma')]
  }
  if (isRtcClrId(displaySectionId)) {
    return [fullRtcSectionId(bayId, 'dep')]
  }
  if (isRtcPushStartId(displaySectionId)) {
    return [fullRtcSectionId(bayId, 'twy')]
  }
  return [displaySectionId]
}

/**
 * Server section id used for strip moves / gaps when dropping on a display header.
 */
export function rtcDropSectionId(bayId: string, displaySectionId: string): string {
  if (isRtcArrAppMergedId(displaySectionId)) return fullRtcSectionId(bayId, 'arr')
  if (isRtcCtrTmaMergedId(displaySectionId)) return fullRtcSectionId(bayId, 'app')
  if (isRtcClrId(displaySectionId)) return fullRtcSectionId(bayId, 'dep')
  if (isRtcPushStartId(displaySectionId)) return fullRtcSectionId(bayId, 'twy')
  return displaySectionId
}

/** Apply ARR/CTR merge, CTR/TMA merge, and DEP split to the ordered section list. */
function applyRtcSplitViews(bayId: string, sections: Section[], extras: RtcBayExtras): Section[] {
  let list = [...sections]
  if (extras.arrAppMerged) {
    const arrId = fullRtcSectionId(bayId, 'arr')
    const appId = fullRtcSectionId(bayId, 'app')
    const mergedId = rtcArrAppMergedId(bayId)
    const hasArr = list.some((s) => s.id === arrId)
    const hasApp = list.some((s) => s.id === appId)
    if (hasArr || hasApp) {
      const firstIdx = list.findIndex((s) => s.id === arrId || s.id === appId)
      list = list.filter((s) => s.id !== arrId && s.id !== appId)
      list.splice(Math.max(0, firstIdx), 0, { id: mergedId, title: 'ARR / CTR' })
    }
  }
  if (extras.ctrTmaMerged) {
    const appId = fullRtcSectionId(bayId, 'app')
    const tmaId = fullRtcSectionId(bayId, 'tma')
    const mergedId = rtcCtrTmaMergedId(bayId)
    const hasApp = list.some((s) => s.id === appId)
    const hasTma = list.some((s) => s.id === tmaId)
    if (hasApp || hasTma) {
      const firstIdx = list.findIndex((s) => s.id === appId || s.id === tmaId)
      list = list.filter((s) => s.id !== appId && s.id !== tmaId)
      list.splice(Math.max(0, firstIdx), 0, { id: mergedId, title: 'CTR/TMA' })
    }
  }
  if (extras.depSplit) {
    const depId = fullRtcSectionId(bayId, 'dep')
    const clrId = rtcClrId(bayId)
    const pushId = rtcPushStartId(bayId)
    const depIdx = list.findIndex((s) => s.id === depId)
    if (depIdx >= 0) {
      if (extras.depSplitTmaOnly) {
        // TMA-only coverage: CLR → TAXIWAY → RUNWAY (not CLR + PUSH&START)
        const rwyId = fullRtcSectionId(bayId, 'rwy')
        const twyId = fullRtcSectionId(bayId, 'twy')
        list.splice(
          depIdx,
          1,
          { id: clrId, title: 'CLR' },
          { id: twyId, title: 'TAXIWAY' },
          { id: rwyId, title: 'RUNWAY' },
        )
      } else {
        list.splice(depIdx, 1, { id: clrId, title: 'CLR' }, { id: pushId, title: 'PUSH&START' })
      }
    }
  }
  return list
}

/**
 * Apply coverage-based builtin defaults for a fresh RTC column.
 * Only fills empty extras (does not rewrite a layout the controller already changed).
 */
export function applyRtcCoverageDefaults(
  bayId: string,
  coverage: { tma: boolean; ctr: boolean } | undefined,
): void {
  if (!coverage) return
  const cur = extrasByBay.value[bayId]
  // Already customized — leave alone
  if (cur && (cur.sectionOrder?.length || cur.hiddenLogical?.length || cur.arrAppMerged || cur.ctrTmaMerged || cur.depSplit)) {
    return
  }
  const hidden: string[] = []
  let ctrTmaMerged = false
  let depSplitTmaOnly = false
  if (coverage.tma && coverage.ctr) {
    ctrTmaMerged = true
  } else if (coverage.tma && !coverage.ctr) {
    // ARR, TMA, CTR, DEP — hide runway/taxiway as separate headers on fresh default
    hidden.push('rwy', 'twy')
    depSplitTmaOnly = true
  } else if (!coverage.tma && coverage.ctr) {
    hidden.push('tma')
  } else {
    // Neither — hide TMA
    hidden.push('tma')
  }
  extrasByBay.value = {
    ...extrasByBay.value,
    [bayId]: {
      ...normalizeExtras(bayId),
      hiddenLogical: hidden,
      ctrTmaMerged,
      depSplitTmaOnly,
    },
  }
  bump()
}

/**
 * Apply saved sectionOrder to a list of sections (unknown ids keep relative server order at end).
 */
function applySectionOrder(sections: Section[], order: string[]): Section[] {
  if (order.length === 0) return sections
  const byId = new Map(sections.map((s) => [s.id, s]))
  const out: Section[] = []
  const seen = new Set<string>()
  for (const id of order) {
    const s = byId.get(id)
    if (!s || seen.has(id)) continue
    out.push(s)
    seen.add(id)
  }
  for (const s of sections) {
    if (seen.has(s.id)) continue
    out.push(s)
  }
  return out
}

/** Sort by absolute Y when present; otherwise keep current order. */
function sortSectionsByY(sections: Section[], ys: Record<string, number>): Section[] {
  const keys = Object.keys(ys)
  if (keys.length === 0) return sections
  return sections
    .slice()
    .sort((a, b) => {
      const ay = ys[a.id]
      const by = ys[b.id]
      if (ay == null && by == null) return 0
      if (ay == null) return 1
      if (by == null) return -1
      return ay - by || a.id.localeCompare(b.id)
    })
}

/**
 * Derive section heights from header Ys (workspace-style): non-last height =
 * nextY - thisY; last flexes. Clears store-locked heights when Ys unused so
 * equal-flex is not stuck on a prior mount lock.
 */
function applyRtcSectionHeights(
  sections: Section[],
  ys: Record<string, number>,
  bodyH = 0,
): Section[] {
  const sorted = sortSectionsByY(sections, ys)
  const useY = Object.keys(ys).length > 0 && sorted.some((s) => ys[s.id] != null)
  if (!useY) {
    // Ignore store-locked equal-flex heights — they squash last sections (DEP)
    return sorted.map((s) => ({ ...s, height: undefined }))
  }
  // Stale Ys from a taller window must not push section chrome past the bay floor.
  let fitted = ys
  if (bodyH > 0) {
    const maxAllowed = Math.max(0, bodyH - RTC_HEADER_H)
    const present = sorted.map((s) => ys[s.id]).filter((y): y is number => y != null)
    const maxTop = present.length ? Math.max(...present) : 0
    if (maxTop > maxAllowed && maxTop > 0) {
      const scale = maxAllowed / maxTop
      fitted = { ...ys }
      for (const s of sorted) {
        const y = ys[s.id]
        if (y != null) fitted[s.id] = Math.round(y * scale)
      }
    }
  }
  return sorted.map((s, i) => {
    if (i >= sorted.length - 1) {
      return { ...s, height: undefined }
    }
    const y0 = fitted[s.id]
    const y1 = fitted[sorted[i + 1]!.id]
    if (y0 == null || y1 == null) return { ...s, height: undefined }
    return { ...s, height: Math.max(0, Math.round(y1 - y0)) }
  })
}

/**
 * Merge server bay sections with extras: drop hidden logicals, inject empty dividers,
 * apply order / free-Y heights.
 */
export function mergeRtcBaySections(bay: Bay): Section[] {
  void extrasByBay.value
  const extras = getRtcBayExtras(bay.id)
  const hidden = new Set(extras.hiddenLogical)
  const base = bay.sections.filter((s) => {
    if (isRtcEmptyDividerId(s.id)) return false
    const log = logicalSectionIdFromRtc(s.id)
    return !hidden.has(log)
  })

  const empties: Section[] = extras.emptyDividers.map((e) => ({
    id: e.id,
    title: e.title || '',
  }))
  const combined = [...base, ...empties.filter((e) => !base.some((b) => b.id === e.id))]
  const ordered = applySectionOrder(combined, extras.sectionOrder)
  const withSplits = applyRtcSplitViews(bay.id, ordered, extras)
  // Re-apply order so synthetic ids (arr_app / clr / push_start) follow sectionOrder
  const reordered = applySectionOrder(withSplits, extras.sectionOrder)
  const bodyEl =
    typeof document !== 'undefined'
      ? (document.querySelector(
          `.efs-bay[data-bay-id="${CSS.escape(bay.id)}"] .bay-body`,
        ) as HTMLElement | null)
      : null
  const bodyH = bodyEl?.clientHeight ?? rtcBayBodyHeightById.value[bay.id] ?? 0
  return applyRtcSectionHeights(reordered, extras.sectionYs, bodyH)
}

/** Per-bay body heights — resize rescale so free-Y headers stay in-bay. */
const rtcBayBodyHeightById = ref<Record<string, number>>({})

/** Call from EfsBay ResizeObserver (RTC / multi-airport). */
export function setRtcBayBodyHeight(bayId: string, height: number) {
  const h = Math.max(0, Math.round(height))
  const prev = rtcBayBodyHeightById.value[bayId]
  if (prev === h) return
  rtcBayBodyHeightById.value = { ...rtcBayBodyHeightById.value, [bayId]: h }
  if (prev != null && prev > 0 && h > 0 && h !== prev) {
    const cur = normalizeExtras(bayId)
    const ys = cur.sectionYs
    const vals = Object.values(ys)
    if (vals.length > 0) {
      const maxAllowed = Math.max(0, h - RTC_HEADER_H)
      const maxTop = Math.max(...vals)
      if (maxTop > maxAllowed && maxTop > 0) {
        const scale = maxAllowed / maxTop
        const next: Record<string, number> = {}
        for (const [id, y] of Object.entries(ys)) {
          next[id] = Math.round(y * scale)
        }
        extrasByBay.value = {
          ...extrasByBay.value,
          [bayId]: { ...cur, sectionYs: next },
        }
        bump(true)
        return
      }
    }
  }
  // Body grew / no overflow — still bump so heights recompute against new bodyH
  bump(false)
}

function measureRtcHeaderH(bayBodyEl: HTMLElement): number {
  const h = bayBodyEl.querySelector('.section-header')?.getBoundingClientRect().height
  return h && h > 0 ? h : RTC_HEADER_H
}

/** Snapshot current header tops into sectionYs (equal-flex → absolute). */
export function syncRtcSectionYsFromDom(
  bayId: string,
  bayBodyEl: HTMLElement | null,
  opts?: { persist?: boolean },
): boolean {
  if (!bayBodyEl) return false
  const bodyTop = bayBodyEl.getBoundingClientRect().top
  const sectionEls = Array.from(bayBodyEl.querySelectorAll<HTMLElement>('.efs-section'))
  const ys: Record<string, number> = {}
  const order: string[] = []
  for (const el of sectionEls) {
    // Prefer display id (synthetics: arr_app / clr / push_start)
    const id = el.getAttribute('data-section-id') || el.getAttribute('data-efs-section-id')
    if (!id) continue
    const top = Math.max(0, Math.round(el.getBoundingClientRect().top - bodyTop))
    ys[id] = top
    order.push(id)
  }
  if (order.length === 0) return false
  const cur = normalizeExtras(bayId)
  extrasByBay.value = {
    ...extrasByBay.value,
    [bayId]: {
      ...cur,
      sectionYs: ys,
      sectionOrder: order,
    },
  }
  bump(opts?.persist !== false)
  return true
}

function ensureRtcAbsoluteYs(
  bayId: string,
  bayBodyEl: HTMLElement | null,
  opts?: { persist?: boolean },
) {
  const cur = normalizeExtras(bayId)
  if (Object.keys(cur.sectionYs).length > 0) return
  syncRtcSectionYsFromDom(bayId, bayBodyEl, opts)
}

function collideRtcHeaderY(
  desiredY: number,
  movingId: string,
  ys: Record<string, number>,
  headerH: number,
): number {
  const obstacles = Object.entries(ys)
    .filter(([id]) => id !== movingId)
    .map(([id, y]) => ({ id, y }))
    .sort((a, b) => a.y - b.y)
  let y = Math.max(0, desiredY)
  for (let pass = 0; pass < 12; pass++) {
    let blocked: { id: string; y: number } | null = null
    for (const o of obstacles) {
      if (y < o.y + headerH && y + headerH > o.y) {
        blocked = o
        break
      }
    }
    if (!blocked) break
    const mid = blocked.y + headerH / 2
    y = y + headerH / 2 < mid ? Math.max(0, blocked.y - headerH) : blocked.y + headerH
  }
  return Math.round(y)
}

/**
 * Place a divider at absolute Y in the bay (workspace-style free drag with gaps).
 */
export function placeRtcSectionByClientY(
  bayId: string,
  sectionId: string,
  clientY: number,
  bayBodyEl: HTMLElement | null,
  opts?: { persist?: boolean },
) {
  if (!bayBodyEl) return
  ensureRtcAbsoluteYs(bayId, bayBodyEl, { persist: false })
  const cur = normalizeExtras(bayId)
  const bodyRect = bayBodyEl.getBoundingClientRect()
  const headerH = measureRtcHeaderH(bayBodyEl)
  const rawY = Math.max(
    0,
    Math.min(bodyRect.height - headerH, Math.round(clientY - bodyRect.top)),
  )
  const ys = { ...cur.sectionYs }
  // If moving id missing (new empty), seed others from DOM first
  if (Object.keys(ys).length === 0 || (ys[sectionId] == null && Object.keys(ys).length > 0)) {
    syncRtcSectionYsFromDom(bayId, bayBodyEl, { persist: false })
    Object.assign(ys, normalizeExtras(bayId).sectionYs)
  }
  const y = collideRtcHeaderY(rawY, sectionId, ys, headerH)
  ys[sectionId] = y
  const order = Object.keys(ys).sort((a, b) => (ys[a]! - ys[b]!) || a.localeCompare(b))
  // Keep any known order ids that lack Y at end
  for (const id of cur.sectionOrder) {
    if (!order.includes(id)) order.push(id)
  }
  extrasByBay.value = {
    ...extrasByBay.value,
    [bayId]: {
      ...normalizeExtras(bayId),
      sectionYs: ys,
      sectionOrder: order,
    },
  }
  bump(opts?.persist !== false)
}

export function beginRtcSectionDrag(sectionId: string) {
  rtcDraggingSectionId.value = sectionId
}

export function endRtcSectionDrag() {
  rtcDraggingSectionId.value = null
}

/** Move an empty divider from one bay to another (template sections stay put). */
export function moveRtcEmptyDividerToBay(
  fromBayId: string,
  toBayId: string,
  emptyId: string,
  clientY: number,
  toBayBodyEl: HTMLElement | null,
) {
  if (!isRtcEmptyDividerId(emptyId)) return
  if (fromBayId === toBayId) {
    placeRtcSectionByClientY(toBayId, emptyId, clientY, toBayBodyEl)
    return
  }
  const from = normalizeExtras(fromBayId)
  const empty = from.emptyDividers.find((e) => e.id === emptyId)
  if (!empty) return
  const to = normalizeExtras(toBayId)
  extrasByBay.value = {
    ...extrasByBay.value,
    [fromBayId]: {
      ...from,
      emptyDividers: from.emptyDividers.filter((e) => e.id !== emptyId),
      sectionOrder: from.sectionOrder.filter((id) => id !== emptyId),
      sectionYs: stripYs(from.sectionYs, emptyId),
    },
    [toBayId]: {
      ...to,
      emptyDividers: [...to.emptyDividers, empty],
      sectionOrder: to.sectionOrder.includes(emptyId)
        ? to.sectionOrder
        : [...to.sectionOrder, emptyId],
      sectionYs: to.sectionYs,
    },
  }
  bump()
  placeRtcSectionByClientY(toBayId, emptyId, clientY, toBayBodyEl)
}

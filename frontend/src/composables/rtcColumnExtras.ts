/**
 * Client-only RTC column extras: empty dividers + hidden template sections.
 * Merged into bay.sections for display; survives layout broadcasts via localStorage.
 */

import { ref } from 'vue'
import type { Bay, Section } from '@vatefs/common'

const STORAGE_KEY = 'efs/rtcColumnExtras'

export type RtcEmptyDivider = {
  id: string
  /** Insert after this section id (full bayN_* id); null = top */
  afterSectionId: string | null
  title: string
}

export type RtcBayExtras = {
  emptyDividers: RtcEmptyDivider[]
  /** Logical ids: arr | app | rwy | twy | dep */
  hiddenLogical: string[]
}

/** RTC bay template logical section ids (catalog). */
export const RTC_CATALOG_SECTIONS: readonly { logical: string; title: string }[] = [
  { logical: 'arr', title: 'ARR' },
  { logical: 'app', title: 'CTR' },
  { logical: 'rwy', title: 'RUNWAY' },
  { logical: 'twy', title: 'TAXIWAY' },
  { logical: 'dep', title: 'DEP' },
] as const

const extrasByBay = ref<Record<string, RtcBayExtras>>(loadExtras())
/** Bumps when extras change so Vue computeds re-run */
const extrasEpoch = ref(0)

function loadExtras(): Record<string, RtcBayExtras> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const obj = JSON.parse(raw) as unknown
    if (!obj || typeof obj !== 'object') return {}
    return obj as Record<string, RtcBayExtras>
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

function bump() {
  extrasByBay.value = { ...extrasByBay.value }
  extrasEpoch.value++
  persist()
}

export function getRtcBayExtras(bayId: string): RtcBayExtras {
  return extrasByBay.value[bayId] ?? { emptyDividers: [], hiddenLogical: [] }
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

export function addRtcEmptyDivider(bayId: string, afterSectionId: string | null = null) {
  const cur = getRtcBayExtras(bayId)
  const id = `rtc_empty_${bayId}_${Date.now().toString(36)}`
  extrasByBay.value = {
    ...extrasByBay.value,
    [bayId]: {
      ...cur,
      emptyDividers: [
        ...cur.emptyDividers,
        { id, afterSectionId, title: '' },
      ],
    },
  }
  bump()
}

export function removeRtcEmptyDivider(bayId: string, emptyId: string) {
  const cur = getRtcBayExtras(bayId)
  extrasByBay.value = {
    ...extrasByBay.value,
    [bayId]: {
      ...cur,
      emptyDividers: cur.emptyDividers.filter((e) => e.id !== emptyId),
    },
  }
  bump()
}

export function hideRtcLogicalSection(bayId: string, logical: string) {
  const cur = getRtcBayExtras(bayId)
  if (cur.hiddenLogical.includes(logical)) return
  extrasByBay.value = {
    ...extrasByBay.value,
    [bayId]: {
      ...cur,
      hiddenLogical: [...cur.hiddenLogical, logical],
    },
  }
  bump()
}

export function ensureRtcLogicalSection(bayId: string, logical: string) {
  const cur = getRtcBayExtras(bayId)
  if (!cur.hiddenLogical.includes(logical)) return
  extrasByBay.value = {
    ...extrasByBay.value,
    [bayId]: {
      ...cur,
      hiddenLogical: cur.hiddenLogical.filter((l) => l !== logical),
    },
  }
  bump()
}

export function isRtcLogicalPresent(bay: Bay, logical: string): boolean {
  void extrasByBay.value
  const extras = getRtcBayExtras(bay.id)
  if (extras.hiddenLogical.includes(logical)) return false
  const full = fullRtcSectionId(bay.id, logical)
  return bay.sections.some((s) => s.id === full || logicalSectionIdFromRtc(s.id) === logical)
}

/**
 * Merge server bay sections with extras: drop hidden logicals, inject empty dividers.
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

  let out = [...base]
  for (const empty of extras.emptyDividers) {
    const sec: Section = { id: empty.id, title: empty.title || '' }
    if (!empty.afterSectionId) {
      out = [sec, ...out]
      continue
    }
    const idx = out.findIndex((s) => s.id === empty.afterSectionId)
    if (idx < 0) {
      out.push(sec)
    } else {
      out.splice(idx + 1, 0, sec)
    }
  }
  return out
}

import { computed, toValue, type ComputedRef, type MaybeRefOrGetter, type Ref } from 'vue'
import {
  ESSA_PHYSICAL_RWY_PAIRS,
  essaRunwaySectionId,
  isEssaDynamicRunwaySectionId,
} from '@vatefs/common'
import { useEfsStore } from '@/store/efs'
import { logicalSectionIdFromRtc } from '@/composables/rtcColumnExtras'

export const RWY_OCCUPIED_FLAG_KIND = 'rwyOccupied'
export const RWY_CLOSED_FLAG_KIND = 'rwyClosed'

export type RwyFlagKind = typeof RWY_OCCUPIED_FLAG_KIND | typeof RWY_CLOSED_FLAG_KIND

export const RWY_FLAG_KINDS = [RWY_OCCUPIED_FLAG_KIND, RWY_CLOSED_FLAG_KIND] as const

export function rwyFlagId(kind: RwyFlagKind, homeSectionId: string): string {
  return `${kind}:${homeSectionId}`
}

export function parseRwyFlagId(id: string): { kind: RwyFlagKind; homeSectionId: string } | null {
  for (const kind of RWY_FLAG_KINDS) {
    const prefix = `${kind}:`
    if (id.startsWith(prefix)) {
      const homeSectionId = id.slice(prefix.length)
      if (homeSectionId) return { kind, homeSectionId }
    }
  }
  return null
}

export function isRwyFlagStripId(id: string): boolean {
  return parseRwyFlagId(id) != null
}

/** Sections that may host RWY occupied / closed flags. */
export function isRwyFlagHostSection(sectionId: string, sectionTitle?: string): boolean {
  if (isEssaDynamicRunwaySectionId(sectionId)) return true
  if (sectionId === 'arr_runway' || sectionId === 'dep_runway') return true
  if (sectionId === 'rwy' || sectionId.endsWith('_rwy')) return true
  const title = (sectionTitle || '').toUpperCase()
  return title === 'RUNWAY' || title.startsWith('RUNWAY ')
}

/** Centered runway text on the flag (e.g. 01L/19R, 08/26). */
export function rwyFlagLabel(homeSectionId: string, sectionTitle?: string): string {
  for (const pair of ESSA_PHYSICAL_RWY_PAIRS) {
    if (essaRunwaySectionId(pair) === homeSectionId) return pair.label
  }
  const title = (sectionTitle || '').trim()
  const m = title.match(/^RUNWAY\s+(.+)/i)
  if (m?.[1]) return m[1].trim()
  if (homeSectionId.startsWith('runway_')) {
    return homeSectionId.slice('runway_'.length).replace(/_/g, '/')
  }
  return title.replace(/^RUNWAY\s+/i, '') || homeSectionId
}

export function isRwyFlagActive(kind: RwyFlagKind, homeSectionId: string): boolean {
  const store = useEfsStore()
  return store.isRwyFlagActive(rwyFlagId(kind, homeSectionId))
}

export function setRwyFlagActive(kind: RwyFlagKind, homeSectionId: string, on: boolean) {
  const store = useEfsStore()
  store.setRwyFlag(rwyFlagId(kind, homeSectionId), on)
}

export function toggleRwyFlag(kind: RwyFlagKind, homeSectionId: string) {
  setRwyFlagActive(kind, homeSectionId, !isRwyFlagActive(kind, homeSectionId))
}

export function dismissRwyFlag(id: string) {
  const parsed = parseRwyFlagId(id)
  if (!parsed) return
  setRwyFlagActive(parsed.kind, parsed.homeSectionId, false)
}

/** Reactive helpers for one flag kind bound to its home runway section (always top of that bay). */
export function useRwyFlagStrip(
  kind: RwyFlagKind,
  homeSectionId: Ref<string> | ComputedRef<string>,
  sectionTitle?: Ref<string | undefined> | ComputedRef<string | undefined>,
) {
  const store = useEfsStore()
  const id = computed(() => rwyFlagId(kind, homeSectionId.value))
  const label = computed(() =>
    rwyFlagLabel(homeSectionId.value, sectionTitle?.value),
  )
  const active = computed(() => {
    void store.activeRwyFlagsVersion
    return store.isRwyFlagActive(id.value)
  })

  function dismiss() {
    dismissRwyFlag(id.value)
  }

  return { kind, id, label, active, dismiss, homeSectionId }
}

/** One row in the RWY flags table (ESSA physical pairs only — not 07/25). */
export type RwyFlagMenuRow = {
  sectionId: string
  label: string
  occupied: boolean
  closed: boolean
}

/**
 * Bottom-bar / catalog: RWY occupied / closed rows.
 * Optional `airport` / `bayId` scope rows to one RTC column.
 */
export function useRwyFlagMenu(
  airportSource?: MaybeRefOrGetter<string | null | undefined>,
  bayIdSource?: MaybeRefOrGetter<string | null | undefined>,
) {
  const store = useEfsStore()

  /** ESSA pairs, OTHER runway headers, or RTC bay runway. */
  const showTable = computed(() => {
    if (store.multiAirport) return true
    if (store.essaRolesMode) return true
    if (store.saabLayoutsMode) return true
    return store.myAirports.some((a) => a.toUpperCase() === 'ESSA')
  })

  const rows = computed<RwyFlagMenuRow[]>(() => {
    void store.activeRwyFlagsVersion
    void store.stripsVersion
    const scopeAirport = (toValue(airportSource) || '').toUpperCase() || null
    const scopeBayId = toValue(bayIdSource) || null

    // RTC column: only this bay’s RUNWAY section(s)
    if (store.multiAirport && scopeBayId) {
      const bay = store.layout.bays.find((b) => b.id === scopeBayId)
      if (!bay) return []
      const out: RwyFlagMenuRow[] = []
      for (const sec of bay.sections) {
        const log = logicalSectionIdFromRtc(sec.id)
        if (log !== 'rwy' && !sec.id.endsWith('_rwy') && sec.id !== 'rwy') continue
        const label =
          scopeAirport ||
          (sec.title || '').replace(/^.*RUNWAY\s+/i, '') ||
          sec.id
        out.push({
          sectionId: sec.id,
          label,
          occupied: store.isRwyFlagActive(rwyFlagId(RWY_OCCUPIED_FLAG_KIND, sec.id)),
          closed: store.isRwyFlagActive(rwyFlagId(RWY_CLOSED_FLAG_KIND, sec.id)),
        })
      }
      return out
    }

    if (store.saabLayoutsMode && !store.essaRolesMode) {
      const out: RwyFlagMenuRow[] = []
      const seen = new Set<string>()
      for (const bay of store.layout.bays) {
        for (const sec of bay.sections) {
          const id = sec.id
          const isRwy =
            id === 'runway' ||
            id === 'arr_runway' ||
            id === 'dep_runway' ||
            (id.startsWith('runway_') && id !== 'arr_runway' && id !== 'dep_runway')
          if (!isRwy || seen.has(id)) continue
          seen.add(id)
          const label = (sec.title || id).replace(/^.*RUNWAY\s+/i, '') || id
          out.push({
            sectionId: id,
            label,
            occupied: store.isRwyFlagActive(rwyFlagId(RWY_OCCUPIED_FLAG_KIND, id)),
            closed: store.isRwyFlagActive(rwyFlagId(RWY_CLOSED_FLAG_KIND, id)),
          })
        }
      }
      return out
    }
    // ESSA physical pairs — optional airport filter (only ESSA has these)
    if (scopeAirport && scopeAirport !== 'ESSA') return []
    return ESSA_PHYSICAL_RWY_PAIRS.map((pair) => {
      const sectionId = essaRunwaySectionId(pair)
      return {
        sectionId,
        label: pair.label,
        occupied: store.isRwyFlagActive(rwyFlagId(RWY_OCCUPIED_FLAG_KIND, sectionId)),
        closed: store.isRwyFlagActive(rwyFlagId(RWY_CLOSED_FLAG_KIND, sectionId)),
      }
    })
  })

  const hasInactive = computed(
    () => showTable.value && rows.value.some((r) => !r.occupied || !r.closed),
  )

  function toggle(sectionId: string, kind: RwyFlagKind) {
    toggleRwyFlag(kind, sectionId)
  }

  return { showTable, rows, hasInactive, toggle }
}

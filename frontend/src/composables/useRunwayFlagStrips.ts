import { computed, type ComputedRef, type Ref } from 'vue'
import {
  ESSA_PHYSICAL_RWY_PAIRS,
  essaRunwaySectionId,
  isEssaDynamicRunwaySectionId,
} from '@vatefs/common'
import { useEfsStore } from '@/store/efs'

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

/** Bottom-bar / catalog: RWY occupied / closed rows. */
export function useRwyFlagMenu() {
  const store = useEfsStore()

  /** ESSA pairs, or OTHER runway headers currently on the board. */
  const showTable = computed(() => {
    if (store.essaRolesMode) return true
    if (store.saabLayoutsMode) return true
    return store.myAirports.some((a) => a.toUpperCase() === 'ESSA')
  })

  const rows = computed<RwyFlagMenuRow[]>(() => {
    void store.activeRwyFlagsVersion
    void store.stripsVersion
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

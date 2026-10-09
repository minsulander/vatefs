import { computed, ref } from 'vue'
import { useEfsStore } from '@/store/efs'
import {
  essaMapDefaultSectionId,
  getEssaMapInfo,
  type EssaMapInfo,
} from '@/data/essa-map-info'

const DISMISS_KEY = 'efs/infoStrips/dismissed'
const PLACEMENT_KEY = 'efs/infoStrips/placement'

/** Stable kind for breakout (placement); dismiss may still be per-runway. */
export const BREAKOUT_INFO_KIND = 'breakout'

/** Stable kind for G/A / MAP strip (placement); dismiss per arrival runway. */
export const MAP_INFO_KIND = 'map'

export const INFO_STRIP_KINDS = [BREAKOUT_INFO_KIND, MAP_INFO_KIND] as const

export type InfoStripPlacement = {
  bayId: string
  sectionId: string
  /** Pinned to section bottom area */
  bottom: boolean
  /** Index among top or bottom strips (0 = first) */
  index: number
}

/** Persistent set of dismissed info-strip ids (e.g. breakout:01R). */
const dismissed = ref<Set<string>>(loadDismissed())
const placements = ref<Record<string, InfoStripPlacement>>(loadPlacements())

function loadDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISS_KEY)
    if (!raw) return new Set()
    const arr = JSON.parse(raw) as unknown
    if (!Array.isArray(arr)) return new Set()
    return new Set(arr.filter((x): x is string => typeof x === 'string'))
  } catch {
    return new Set()
  }
}

function loadPlacements(): Record<string, InfoStripPlacement> {
  try {
    const raw = localStorage.getItem(PLACEMENT_KEY)
    if (!raw) return {}
    const obj = JSON.parse(raw) as unknown
    if (!obj || typeof obj !== 'object') return {}
    return obj as Record<string, InfoStripPlacement>
  } catch {
    return {}
  }
}

function persistDismissed() {
  try {
    localStorage.setItem(DISMISS_KEY, JSON.stringify([...dismissed.value]))
  } catch {
    /* ignore */
  }
}

function persistPlacements() {
  try {
    localStorage.setItem(PLACEMENT_KEY, JSON.stringify(placements.value))
  } catch {
    /* ignore */
  }
}

export function dismissInfoStrip(id: string) {
  if (dismissed.value.has(id)) return
  const next = new Set(dismissed.value)
  next.add(id)
  dismissed.value = next
  persistDismissed()
}

export function restoreInfoStrip(id: string) {
  if (!dismissed.value.has(id)) return
  const next = new Set(dismissed.value)
  next.delete(id)
  dismissed.value = next
  persistDismissed()
}

export function isInfoStripDismissed(id: string): boolean {
  return dismissed.value.has(id)
}

export function setInfoStripPlacement(kind: string, placement: InfoStripPlacement) {
  placements.value = { ...placements.value, [kind]: placement }
  persistPlacements()
}

export function getInfoStripPlacement(kind: string): InfoStripPlacement | null {
  return placements.value[kind] ?? null
}

export function clearInfoStripPlacement(kind: string) {
  if (!(kind in placements.value)) return
  const next = { ...placements.value }
  delete next[kind]
  placements.value = next
  persistPlacements()
}

/** Catalog of info strips for the bottom-bar restore menu. */
export type InfoStripMenuEntry = {
  kind: string
  /** Dismiss / restore id (e.g. breakout:01R) */
  id: string
  label: string
  /** False when not applicable to current config / mode */
  available: boolean
  dismissed: boolean
  hasCustomPlacement: boolean
}

export type BreakoutVariant = {
  /** Dismiss id (per runway) */
  id: string
  runway: '01R' | '19L'
  turn: 'RIGHT' | 'LEFT'
  heading: string
  climbFt: string
  /** Mirror plane icons (19L) */
  mirror: boolean
}

/** Breakout strip data for ESSA config 1 (01R) / 2 (19L). */
export function useBreakoutInfoStrip() {
  const store = useEfsStore()

  const variant = computed<BreakoutVariant | null>(() => {
    if (!store.essaRolesMode) return null
    const cfg = store.essaRwyConfigIdResolved
    if (cfg === '1') {
      return {
        id: 'breakout:01R',
        runway: '01R',
        turn: 'RIGHT',
        heading: '040',
        climbFt: 'XXXX',
        mirror: false,
      }
    }
    if (cfg === '2') {
      return {
        id: 'breakout:19L',
        runway: '19L',
        turn: 'LEFT',
        heading: '220',
        climbFt: 'XXXX',
        mirror: true,
      }
    }
    return null
  })

  const placement = computed(() => getInfoStripPlacement(BREAKOUT_INFO_KIND))

  const visible = computed(() => {
    const v = variant.value
    if (!v) return false
    return !dismissed.value.has(v.id)
  })

  function dismiss() {
    const v = variant.value
    if (v) dismissInfoStrip(v.id)
  }

  function moveTo(bayId: string, sectionId: string, bottom: boolean, index: number) {
    setInfoStripPlacement(BREAKOUT_INFO_KIND, { bayId, sectionId, bottom, index })
  }

  return { variant, visible, placement, dismiss, moveTo, kind: BREAKOUT_INFO_KIND }
}

export type MapInfoVariant = EssaMapInfo & {
  /** Dismiss id (per arrival runway) */
  id: string
  configId: string
}

/** G/A / MAP strip for current ESSA runway config. */
export function useMapInfoStrip() {
  const store = useEfsStore()

  const variant = computed<MapInfoVariant | null>(() => {
    if (!store.essaRolesMode) return null
    const cfg = store.essaRwyConfigIdResolved
    if (!cfg) return null
    const info = getEssaMapInfo(cfg)
    if (!info) return null
    return {
      ...info,
      id: `map:${info.runway}`,
      configId: cfg,
    }
  })

  const placement = computed(() => getInfoStripPlacement(MAP_INFO_KIND))

  const visible = computed(() => {
    const v = variant.value
    if (!v) return false
    return !dismissed.value.has(v.id)
  })

  const defaultSectionId = computed(() => {
    const v = variant.value
    if (!v) return null
    return essaMapDefaultSectionId(v.runway)
  })

  function dismiss() {
    const v = variant.value
    if (v) dismissInfoStrip(v.id)
  }

  function moveTo(bayId: string, sectionId: string, bottom: boolean, index: number) {
    setInfoStripPlacement(MAP_INFO_KIND, { bayId, sectionId, bottom, index })
  }

  return {
    variant,
    visible,
    placement,
    defaultSectionId,
    dismiss,
    moveTo,
    kind: MAP_INFO_KIND,
  }
}

/** Bottom-bar menu: restore dismissed info strips / reset placement. */
export function useInfoStripMenu() {
  const breakout = useBreakoutInfoStrip()
  const map = useMapInfoStrip()

  const entries = computed<InfoStripMenuEntry[]>(() => {
    const out: InfoStripMenuEntry[] = []

    const bv = breakout.variant.value
    if (!bv) {
      out.push({
        kind: BREAKOUT_INFO_KIND,
        id: 'breakout',
        label: 'Breakout',
        available: false,
        dismissed: false,
        hasCustomPlacement: !!getInfoStripPlacement(BREAKOUT_INFO_KIND),
      })
    } else {
      out.push({
        kind: BREAKOUT_INFO_KIND,
        id: bv.id,
        label: `Breakout (${bv.runway})`,
        available: true,
        dismissed: dismissed.value.has(bv.id),
        hasCustomPlacement: !!getInfoStripPlacement(BREAKOUT_INFO_KIND),
      })
    }

    const mv = map.variant.value
    if (!mv) {
      out.push({
        kind: MAP_INFO_KIND,
        id: 'map',
        label: 'G/A · MAP',
        available: false,
        dismissed: false,
        hasCustomPlacement: !!getInfoStripPlacement(MAP_INFO_KIND),
      })
    } else {
      out.push({
        kind: MAP_INFO_KIND,
        id: mv.id,
        label: `G/A · MAP (${mv.runway})`,
        available: true,
        dismissed: dismissed.value.has(mv.id),
        hasCustomPlacement: !!getInfoStripPlacement(MAP_INFO_KIND),
      })
    }

    return out
  })

  const hasDismissedAvailable = computed(() =>
    entries.value.some((e) => e.available && e.dismissed),
  )

  function showEntry(entry: InfoStripMenuEntry) {
    if (!entry.available) return
    restoreInfoStrip(entry.id)
    // Fresh show → default host section
    clearInfoStripPlacement(entry.kind)
  }

  function resetPlacement(entry: InfoStripMenuEntry) {
    clearInfoStripPlacement(entry.kind)
  }

  return { entries, hasDismissedAvailable, showEntry, resetPlacement }
}

import { computed, ref } from 'vue'
import { useEfsStore } from '@/store/efs'
import {
  essaMapDefaultSectionId,
  getEssaMapInfo,
  type EssaMapInfo,
} from '@/data/essa-map-info'
import {
  essaDepDefaultSectionId,
  essaDepRunwayForConfig,
  type DepInfoTurn,
  type EssaDepInfo,
} from '@/data/essa-dep-info'
import {
  essaBriefingDefaultSectionId,
  getEssa19LSidBriefing,
  getEssaTurnDepBriefing,
} from '@/data/essa-briefing-info'

const DISMISS_KEY = 'efs/infoStrips/dismissed'
const PLACEMENT_KEY = 'efs/infoStrips/placement'

/** Stable kind for breakout (placement); dismiss may still be per-runway. */
export const BREAKOUT_INFO_KIND = 'breakout'

/** Stable kind for G/A / MAP strip (placement); dismiss per arrival runway. */
export const MAP_INFO_KIND = 'map'

/** Stable kind for DEP RWY info strip (placement); dismiss per departure runway. */
export const DEP_INFO_KIND = 'dep'

/** Stable kind for 08 LT/RT turn-departure briefing strip. */
export const TURN_DEP_INFO_KIND = 'turnDep'

/** Stable kind for 19L Q/E/mix SID briefing strip. */
export const SID19L_INFO_KIND = 'sid19l'

/** Stable kind for AUP "R16 utökad" yellow strip; dismiss per active window (r16:<from>). */
export const R16_INFO_KIND = 'r16'

export const INFO_STRIP_KINDS = [
  BREAKOUT_INFO_KIND,
  MAP_INFO_KIND,
  DEP_INFO_KIND,
  TURN_DEP_INFO_KIND,
  SID19L_INFO_KIND,
  R16_INFO_KIND,
] as const

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
  /** Shown when !available (defaults to "Not available") */
  unavailableReason?: string
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

/** True when TWR AOR covers this runway (or no AOR split). */
function essaCoversInfoRunway(store: ReturnType<typeof useEfsStore>, runway: string): boolean {
  const covered = store.essaCoveredRunways
  if (!covered) return true
  const r = runway.toUpperCase()
  return covered.some((x) => x.toUpperCase() === r)
}

/** Breakout strip data for ESSA config 1 (01R) / 2 (19L). */
export function useBreakoutInfoStrip() {
  const store = useEfsStore()

  const variant = computed<BreakoutVariant | null>(() => {
    if (!store.essaRolesMode) return null
    const cfg = store.essaRwyConfigIdResolved
    let v: BreakoutVariant | null = null
    if (cfg === '1') {
      v = {
        id: 'breakout:01R',
        runway: '01R',
        turn: 'RIGHT',
        heading: '040',
        climbFt: 'XXXX',
        mirror: false,
      }
    } else if (cfg === '2') {
      v = {
        id: 'breakout:19L',
        runway: '19L',
        turn: 'LEFT',
        heading: '220',
        climbFt: 'XXXX',
        mirror: true,
      }
    }
    if (v && !essaCoversInfoRunway(store, v.runway)) return null
    return v
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
    if (!essaCoversInfoRunway(store, info.runway)) return null
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

export type DepInfoVariant = {
  id: string
  configId: string
  runway: string
  turn?: DepInfoTurn
  primarySector: string
  primaryDefaultFreq: string
  primaryFreq?: string
  primaryCallsign?: string | null
  holdLines: [string, string]
  rows: EssaDepInfo['rows']
}

/** DEP RWY info strip for current ESSA runway config. */
export function useDepInfoStrip() {
  const store = useEfsStore()

  const variant = computed<DepInfoVariant | null>(() => {
    if (!store.essaRolesMode) return null
    const cfg = store.essaRwyConfigIdResolved
    if (!cfg) return null
    const runway = essaDepRunwayForConfig(cfg)
    if (!runway) return null
    if (!essaCoversInfoRunway(store, runway)) return null
    return {
      id: `dep:${runway}`,
      configId: cfg,
      runway,
      primarySector: 'DEP-W',
      primaryDefaultFreq: '124.105',
      holdLines: [
        'HOLD POSITION, CANCEL TAKE-OFF, I SAY AGAIN HOLD',
        'STOP IMMEDIATELY + CS: STOP IMMEDIATELY',
      ],
      rows: [],
    }
  })

  const placement = computed(() => getInfoStripPlacement(DEP_INFO_KIND))

  const visible = computed(() => {
    const v = variant.value
    if (!v) return false
    return !dismissed.value.has(v.id)
  })

  const defaultSectionId = computed(() => {
    const v = variant.value
    if (!v) return null
    return essaDepDefaultSectionId(v.runway)
  })

  function dismiss() {
    const v = variant.value
    if (v) dismissInfoStrip(v.id)
  }

  function moveTo(bayId: string, sectionId: string, bottom: boolean, index: number) {
    setInfoStripPlacement(DEP_INFO_KIND, { bayId, sectionId, bottom, index })
  }

  return {
    variant,
    visible,
    placement,
    defaultSectionId,
    dismiss,
    moveTo,
    kind: DEP_INFO_KIND,
  }
}

export type TurnDepInfoVariant = {
  id: string
  configId: string
  turn: 'LEFT' | 'RIGHT' | 'BOTH'
  runway: string
  title: string
  configIds: string[]
}

/** Green 08 LT/RT “LEFT/RIGHT TURN DEPARTURE” briefing strip. */
export function useTurnDepInfoStrip() {
  const store = useEfsStore()

  const variant = computed<TurnDepInfoVariant | null>(() => {
    if (!store.essaRolesMode) return null
    const cfg = store.essaRwyConfigIdResolved
    if (!cfg) return null
    const briefing = getEssaTurnDepBriefing(cfg)
    if (!briefing) return null
    if (!essaCoversInfoRunway(store, briefing.runway)) return null
    return {
      id: `turnDep:${briefing.runway}:${briefing.turn}`,
      configId: cfg,
      ...briefing,
    }
  })

  const placement = computed(() => getInfoStripPlacement(TURN_DEP_INFO_KIND))

  const visible = computed(() => {
    const v = variant.value
    if (!v) return false
    return !dismissed.value.has(v.id)
  })

  const defaultSectionId = computed(() => {
    const v = variant.value
    if (!v) return null
    return essaBriefingDefaultSectionId(v.configId)
  })

  function dismiss() {
    const v = variant.value
    if (v) dismissInfoStrip(v.id)
  }

  function moveTo(bayId: string, sectionId: string, bottom: boolean, index: number) {
    setInfoStripPlacement(TURN_DEP_INFO_KIND, { bayId, sectionId, bottom, index })
  }

  return {
    variant,
    visible,
    placement,
    defaultSectionId,
    dismiss,
    moveTo,
    kind: TURN_DEP_INFO_KIND,
  }
}

export type Sid19LInfoVariant = {
  id: string
  configId: string
  runway: '19L'
  mode: 'Q' | 'E' | 'MIX'
  title: string
  configIds: string[]
}

/** Green 19L Q / E / MIX OF SIDs briefing strip. */
export function useSid19LInfoStrip() {
  const store = useEfsStore()

  const variant = computed<Sid19LInfoVariant | null>(() => {
    if (!store.essaRolesMode) return null
    const cfg = store.essaRwyConfigIdResolved
    if (!cfg) return null
    const briefing = getEssa19LSidBriefing(cfg)
    if (!briefing) return null
    if (!essaCoversInfoRunway(store, briefing.runway)) return null
    return {
      id: `sid19l:${briefing.mode}`,
      configId: cfg,
      ...briefing,
    }
  })

  const placement = computed(() => getInfoStripPlacement(SID19L_INFO_KIND))

  const visible = computed(() => {
    const v = variant.value
    if (!v) return false
    return !dismissed.value.has(v.id)
  })

  const defaultSectionId = computed(() => {
    const v = variant.value
    if (!v) return null
    return essaBriefingDefaultSectionId(v.configId)
  })

  function dismiss() {
    const v = variant.value
    if (v) dismissInfoStrip(v.id)
  }

  function moveTo(bayId: string, sectionId: string, bottom: boolean, index: number) {
    setInfoStripPlacement(SID19L_INFO_KIND, { bayId, sectionId, bottom, index })
  }

  return {
    variant,
    visible,
    placement,
    defaultSectionId,
    dismiss,
    moveTo,
    kind: SID19L_INFO_KIND,
  }
}

export type R16InfoVariant = {
  /** Dismiss id (per active AUP window, so a new window re-shows the strip) */
  id: string
  topAltitudeFt: number
  from: string | null
  to: string | null
  suggestConfigId: '9C' | '15C' | null
}

/** Yellow "R16 utökad ↑" strip — auto-shown while AUP says R16 active with upper limit > 1600 ft. */
export function useR16InfoStrip() {
  const store = useEfsStore()

  const variant = computed<R16InfoVariant | null>(() => {
    if (!store.myAirports.some((a) => a.toUpperCase() === 'ESSA')) return null
    const r = store.aupR16
    if (!r || !r.active || r.topAltitudeFt == null || r.topAltitudeFt <= 1600) return null
    return {
      id: `r16:${r.from ?? 'now'}`,
      topAltitudeFt: r.topAltitudeFt,
      from: r.from,
      to: r.to,
      suggestConfigId: r.suggestConfigId,
    }
  })

  const placement = computed(() => getInfoStripPlacement(R16_INFO_KIND))

  const visible = computed(() => {
    const v = variant.value
    if (!v) return false
    return !dismissed.value.has(v.id)
  })

  /** Default host: first section of the first bay (top of the EFS). */
  const defaultBayId = computed(() => store.layout.bays[0]?.id ?? null)
  const defaultSectionId = computed(() => store.layout.bays[0]?.sections[0]?.id ?? null)

  function dismiss() {
    const v = variant.value
    if (v) dismissInfoStrip(v.id)
  }

  function moveTo(bayId: string, sectionId: string, bottom: boolean, index: number) {
    setInfoStripPlacement(R16_INFO_KIND, { bayId, sectionId, bottom, index })
  }

  return {
    variant,
    visible,
    placement,
    defaultBayId,
    defaultSectionId,
    dismiss,
    moveTo,
    kind: R16_INFO_KIND,
  }
}

function menuEntry(
  kind: string,
  id: string,
  label: string,
  available: boolean,
  dismissedFlag: boolean,
  unavailableReason?: string,
): InfoStripMenuEntry {
  return {
    kind,
    id,
    label,
    available,
    dismissed: dismissedFlag,
    hasCustomPlacement: !!getInfoStripPlacement(kind),
    unavailableReason,
  }
}

/** Bottom-bar menu: restore dismissed info strips / reset placement. */
export function useInfoStripMenu() {
  const store = useEfsStore()
  const breakout = useBreakoutInfoStrip()
  const map = useMapInfoStrip()
  const dep = useDepInfoStrip()
  const turnDep = useTurnDepInfoStrip()
  const sid19l = useSid19LInfoStrip()
  const r16 = useR16InfoStrip()

  const entries = computed<InfoStripMenuEntry[]>(() => {
    const out: InfoStripMenuEntry[] = []

    const bv = breakout.variant.value
    out.push(
      bv
        ? menuEntry(BREAKOUT_INFO_KIND, bv.id, `Breakout (${bv.runway})`, true, dismissed.value.has(bv.id))
        : menuEntry(BREAKOUT_INFO_KIND, 'breakout', 'Breakout', false, false),
    )

    const mv = map.variant.value
    out.push(
      mv
        ? menuEntry(MAP_INFO_KIND, mv.id, `G/A · MAP (${mv.runway})`, true, dismissed.value.has(mv.id))
        : menuEntry(MAP_INFO_KIND, 'map', 'G/A · MAP', false, false),
    )

    const dv = dep.variant.value
    out.push(
      dv
        ? menuEntry(DEP_INFO_KIND, dv.id, `DEP RWY (${dv.runway})`, true, dismissed.value.has(dv.id))
        : menuEntry(DEP_INFO_KIND, 'dep', 'DEP RWY', false, false),
    )

    const tv = turnDep.variant.value
    out.push(
      tv
        ? menuEntry(
            TURN_DEP_INFO_KIND,
            tv.id,
            `Turn DEP (${tv.turn === 'LEFT' ? 'LT' : tv.turn === 'RIGHT' ? 'RT' : 'MIXED'})`,
            true,
            dismissed.value.has(tv.id),
          )
        : menuEntry(TURN_DEP_INFO_KIND, 'turnDep', 'Turn DEP (08 LT/RT/MIXED)', false, false),
    )

    const sv = sid19l.variant.value
    out.push(
      sv
        ? menuEntry(SID19L_INFO_KIND, sv.id, `19L SIDs (${sv.mode})`, true, dismissed.value.has(sv.id))
        : menuEntry(SID19L_INFO_KIND, 'sid19l', '19L SIDs (Q/E/MIX)', false, false),
    )

    const rv = r16.variant.value
    if (rv) {
      out.push(menuEntry(R16_INFO_KIND, rv.id, 'R16 utökad', true, dismissed.value.has(rv.id)))
    } else {
      const aup = store.aupR16
      let reason = 'Not available'
      if (!store.myAirports.some((a) => a.toUpperCase() === 'ESSA')) {
        reason = 'ESSA only'
      } else if (aup?.fetchStatus === 'error') {
        reason = 'AUP fetch failed'
      } else if (aup?.fetchStatus === 'pending' || aup == null) {
        reason = 'AUP loading…'
      } else if (!aup.active) {
        // Live plan often has ESR16 @ 1600 ft — that is NOT utökad
        reason = 'Not extended (≤1600 ft or outside window)'
      }
      out.push(menuEntry(R16_INFO_KIND, 'r16', 'R16 utökad', false, false, reason))
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

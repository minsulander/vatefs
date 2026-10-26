import { computed, ref, toValue, type MaybeRefOrGetter } from 'vue'
import { useEfsStore } from '@/store/efs'
import {
  ESSA_RWY_COMBINATIONS,
  formatEssaRwyPdfName,
} from '@vatefs/common'
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
/** Kinds the user forced on via the catalog (survive when auto rules do not apply). */
const MANUAL_KEY = 'efs/infoStrips/manual'
/** Per-kind forced catalog key (config id, SID mode, turn, …). */
const FORCED_KEY = 'efs/infoStrips/forced'

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
const manualKinds = ref<Set<string>>(loadManualKinds())
/**
 * kind → force keys currently pinned from the catalog (ESSA config ids, SID modes, …).
 * Multiple keys allowed for MAP / DEP / Breakout so several configs can show at once.
 */
const forcedKeysByKind = ref<Record<string, string[]>>(loadForcedKeysByKind())

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

function isTaxiArrSectionId(sectionId: string): boolean {
  return sectionId === 'taxi_arr' || sectionId.endsWith('_taxi_arr')
}

function placementKind(key: string): string | null {
  if ((INFO_STRIP_KINDS as readonly string[]).includes(key as (typeof INFO_STRIP_KINDS)[number])) {
    return key
  }
  const idx = key.indexOf(':')
  if (idx <= 0) return null
  const kind = key.slice(0, idx)
  return (INFO_STRIP_KINDS as readonly string[]).includes(kind as (typeof INFO_STRIP_KINDS)[number])
    ? kind
    : null
}

/**
 * Breakout / MAP used to stick above ARR RWY (often landing on TAXIWAY ARR).
 * Migrate those pins to CTR ARR bottom.
 */
function migrateBreakoutMapPlacements(
  raw: Record<string, InfoStripPlacement>,
): { placements: Record<string, InfoStripPlacement>; changed: boolean } {
  let changed = false
  const out: Record<string, InfoStripPlacement> = {}
  for (const [key, p] of Object.entries(raw)) {
    const kind = placementKind(key)
    if (
      (kind === BREAKOUT_INFO_KIND || kind === MAP_INFO_KIND) &&
      isTaxiArrSectionId(p.sectionId)
    ) {
      out[key] = { ...p, sectionId: 'ctr_arr', bottom: true }
      changed = true
    } else {
      out[key] = p
    }
  }
  return { placements: out, changed }
}

function loadPlacements(): Record<string, InfoStripPlacement> {
  try {
    const raw = localStorage.getItem(PLACEMENT_KEY)
    if (!raw) return {}
    const obj = JSON.parse(raw) as unknown
    if (!obj || typeof obj !== 'object') return {}
    const { placements: migrated, changed } = migrateBreakoutMapPlacements(
      obj as Record<string, InfoStripPlacement>,
    )
    if (changed) {
      try {
        localStorage.setItem(PLACEMENT_KEY, JSON.stringify(migrated))
      } catch {
        /* ignore */
      }
    }
    return migrated
  } catch {
    return {}
  }
}

function loadManualKinds(): Set<string> {
  try {
    const raw = localStorage.getItem(MANUAL_KEY)
    if (!raw) return new Set()
    const arr = JSON.parse(raw) as unknown
    if (!Array.isArray(arr)) return new Set()
    return new Set(arr.filter((x): x is string => typeof x === 'string'))
  } catch {
    return new Set()
  }
}

function loadForcedKeysByKind(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(FORCED_KEY)
    if (!raw) return {}
    const obj = JSON.parse(raw) as unknown
    if (!obj || typeof obj !== 'object') return {}
    const out: Record<string, string[]> = {}
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (typeof v === 'string' && v) out[k] = [v]
      else if (Array.isArray(v)) {
        out[k] = v.filter((x): x is string => typeof x === 'string' && !!x)
      }
    }
    return out
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

function persistManualKinds() {
  try {
    localStorage.setItem(MANUAL_KEY, JSON.stringify([...manualKinds.value]))
  } catch {
    /* ignore */
  }
}

export function isInfoStripManual(kind: string): boolean {
  return manualKinds.value.has(kind)
}

export function setInfoStripManual(kind: string, on: boolean) {
  if (on === manualKinds.value.has(kind)) return
  const next = new Set(manualKinds.value)
  if (on) next.add(kind)
  else next.delete(kind)
  manualKinds.value = next
  persistManualKinds()
}

function persistForcedKeysByKind() {
  try {
    localStorage.setItem(FORCED_KEY, JSON.stringify(forcedKeysByKind.value))
  } catch {
    /* ignore */
  }
}

export function getInfoStripForcedKeys(kind: string): string[] {
  return forcedKeysByKind.value[kind] ?? []
}

/** @deprecated single-key API — returns first forced key if any */
export function getInfoStripForced(kind: string): string | undefined {
  return getInfoStripForcedKeys(kind)[0]
}

export function addInfoStripForced(kind: string, key: string) {
  if (!key) return
  const cur = getInfoStripForcedKeys(kind)
  if (cur.includes(key)) return
  forcedKeysByKind.value = { ...forcedKeysByKind.value, [kind]: [...cur, key] }
  persistForcedKeysByKind()
}

export function removeInfoStripForced(kind: string, key: string) {
  const cur = getInfoStripForcedKeys(kind)
  if (!cur.includes(key)) return
  const nextKeys = cur.filter((k) => k !== key)
  const next = { ...forcedKeysByKind.value }
  if (nextKeys.length) next[kind] = nextKeys
  else delete next[kind]
  forcedKeysByKind.value = next
  persistForcedKeysByKind()
}

export function setInfoStripForced(kind: string, key: string | null) {
  if (key == null || key === '') {
    if (!(kind in forcedKeysByKind.value)) return
    const next = { ...forcedKeysByKind.value }
    delete next[kind]
    forcedKeysByKind.value = next
    persistForcedKeysByKind()
    return
  }
  forcedKeysByKind.value = { ...forcedKeysByKind.value, [kind]: [key] }
  persistForcedKeysByKind()
}

function clearInfoStripForce(kind: string) {
  setInfoStripForced(kind, null)
  setInfoStripManual(kind, false)
}

/** Placement / drag id for a multi-instance strip (e.g. map:5). */
export function infoStripInstanceKey(kind: string, forceKey: string): string {
  return `${kind}:${forceKey}`
}

export function parseInfoStripPlacementKey(raw: string): { kind: string; forceKey?: string } | null {
  if ((INFO_STRIP_KINDS as readonly string[]).includes(raw as (typeof INFO_STRIP_KINDS)[number])) {
    return { kind: raw }
  }
  const idx = raw.indexOf(':')
  if (idx <= 0) return null
  const kind = raw.slice(0, idx)
  const forceKey = raw.slice(idx + 1)
  if (!(INFO_STRIP_KINDS as readonly string[]).includes(kind as (typeof INFO_STRIP_KINDS)[number])) {
    return null
  }
  return { kind, forceKey }
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

/** Catalog of info strips for the restore / add menu. */
export type InfoStripMenuEntry = {
  kind: string
  /** Dismiss / restore id (e.g. breakout:01R) */
  id: string
  label: string
  /** Force key: ESSA config id, SID mode, or turn */
  forceKey: string
  /**
   * True when the strip can be shown (always for ESSA catalog — auto or manual).
   * False only when the strip kind cannot exist in this mode (e.g. non-ESSA).
   */
  available: boolean
  dismissed: boolean
  /** Auto rules currently match (RWY / config / AUP / AOR) */
  auto: boolean
  /** User forced this kind on while auto rules do not apply */
  manual: boolean
  /** Currently painted on a bay (grey out in add menu) */
  shown: boolean
  hasCustomPlacement: boolean
  /** Hint when auto rules do not apply */
  unavailableReason?: string
}

export type InfoCatalogFolderId = 'breakout' | 'map' | 'dep' | 'sid'

export type InfoCatalogFolder = {
  id: InfoCatalogFolderId
  label: string
  items: InfoStripMenuEntry[]
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

function breakoutVariantForConfig(cfg: string | null | undefined): BreakoutVariant | null {
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
}

function breakoutForceKey(v: BreakoutVariant): string {
  return v.runway === '19L' ? '2' : '1'
}

/** Active breakout variants (auto + each manually added config). */
export function getActiveBreakoutVariants(): BreakoutVariant[] {
  const store = useEfsStore()
  // ESSA roles layout, or RTC with an ESSA column (manual catalog / auto if config known)
  if (!store.essaRolesMode && !store.multiAirport) return []
  const out: BreakoutVariant[] = []
  const seen = new Set<string>()
  const add = (v: BreakoutVariant | null) => {
    if (!v || seen.has(v.id) || dismissed.value.has(v.id)) return
    seen.add(v.id)
    out.push(v)
  }
  const auto = breakoutVariantForConfig(store.essaRwyConfigIdResolved)
  if (auto && essaCoversInfoRunway(store, auto.runway)) add(auto)
  for (const key of getInfoStripForcedKeys(BREAKOUT_INFO_KIND)) {
    add(breakoutVariantForConfig(key))
  }
  return out
}

/** Breakout strip — pass `configId` (`1`/`2`) for multi-instance. */
export function useBreakoutInfoStrip(configIdSource?: MaybeRefOrGetter<string | undefined>) {
  const store = useEfsStore()

  const autoVariant = computed<BreakoutVariant | null>(() => {
    if (!store.essaRolesMode && !store.multiAirport) return null
    const v = breakoutVariantForConfig(store.essaRwyConfigIdResolved)
    if (v && !essaCoversInfoRunway(store, v.runway)) return null
    return v
  })

  const variant = computed<BreakoutVariant | null>(() => {
    const cfg = toValue(configIdSource)
    if (cfg) {
      return getActiveBreakoutVariants().find((v) => breakoutForceKey(v) === cfg) ?? null
    }
    return getActiveBreakoutVariants()[0] ?? null
  })

  const instanceKey = computed(() => {
    const v = variant.value
    if (!v) return BREAKOUT_INFO_KIND
    return infoStripInstanceKey(BREAKOUT_INFO_KIND, breakoutForceKey(v))
  })

  const placement = computed(
    () =>
      getInfoStripPlacement(instanceKey.value) ??
      getInfoStripPlacement(BREAKOUT_INFO_KIND),
  )

  const visible = computed(() => !!variant.value)

  function dismiss() {
    const v = variant.value
    if (!v) return
    dismissInfoStrip(v.id)
    removeInfoStripForced(BREAKOUT_INFO_KIND, breakoutForceKey(v))
  }

  function moveTo(bayId: string, sectionId: string, bottom: boolean, index: number) {
    setInfoStripPlacement(instanceKey.value, { bayId, sectionId, bottom, index })
  }

  return {
    variant,
    autoVariant,
    visible,
    placement,
    instanceKey,
    dismiss,
    moveTo,
    kind: BREAKOUT_INFO_KIND,
  }
}

export type MapInfoVariant = EssaMapInfo & {
  /** Dismiss id (per arrival runway) */
  id: string
  configId: string
}

function mapVariantForConfig(cfg: string): MapInfoVariant | null {
  const info = getEssaMapInfo(cfg)
  if (!info) return null
  // Per-config dismiss / catalog greying (max one strip per config)
  return { ...info, id: `map:${cfg}`, configId: cfg }
}

/** Active MAP variants (auto config + each manually added config). */
export function getActiveMapVariants(): MapInfoVariant[] {
  const store = useEfsStore()
  if (!store.essaRolesMode && !store.multiAirport) return []
  const out: MapInfoVariant[] = []
  const seen = new Set<string>()
  const add = (v: MapInfoVariant | null) => {
    if (!v || seen.has(v.configId) || dismissed.value.has(v.id)) return
    seen.add(v.configId)
    out.push(v)
  }
  const cfg = store.essaRwyConfigIdResolved
  if (cfg) {
    const v = mapVariantForConfig(cfg)
    if (v && essaCoversInfoRunway(store, v.runway)) add(v)
  }
  for (const key of getInfoStripForcedKeys(MAP_INFO_KIND)) {
    add(mapVariantForConfig(key))
  }
  return out
}

/** G/A / MAP strip — pass `configId` for multi-instance. */
export function useMapInfoStrip(configIdSource?: MaybeRefOrGetter<string | undefined>) {
  const store = useEfsStore()

  const autoVariant = computed<MapInfoVariant | null>(() => {
    if (!store.essaRolesMode && !store.multiAirport) return null
    const cfg = store.essaRwyConfigIdResolved
    if (!cfg) return null
    const v = mapVariantForConfig(cfg)
    if (v && !essaCoversInfoRunway(store, v.runway)) return null
    return v
  })

  const variant = computed<MapInfoVariant | null>(() => {
    const cfg = toValue(configIdSource)
    if (cfg) {
      return getActiveMapVariants().find((v) => v.configId === cfg) ?? null
    }
    return getActiveMapVariants()[0] ?? null
  })

  const instanceKey = computed(() => {
    const v = variant.value
    if (!v) return MAP_INFO_KIND
    return infoStripInstanceKey(MAP_INFO_KIND, v.configId)
  })

  const placement = computed(
    () =>
      getInfoStripPlacement(instanceKey.value) ?? getInfoStripPlacement(MAP_INFO_KIND),
  )

  const visible = computed(() => !!variant.value)

  const defaultSectionId = computed(() => {
    const v = variant.value
    if (!v) return null
    return essaMapDefaultSectionId(v.runway)
  })

  function dismiss() {
    const v = variant.value
    if (!v) return
    dismissInfoStrip(v.id)
    removeInfoStripForced(MAP_INFO_KIND, v.configId)
  }

  function moveTo(bayId: string, sectionId: string, bottom: boolean, index: number) {
    setInfoStripPlacement(instanceKey.value, { bayId, sectionId, bottom, index })
  }

  return {
    variant,
    autoVariant,
    visible,
    placement,
    instanceKey,
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

function depVariantForConfig(cfg: string): DepInfoVariant | null {
  const runway = essaDepRunwayForConfig(cfg)
  if (!runway) return null
  return {
    id: `dep:${cfg}`,
    configId: cfg,
    runway,
    primarySector: 'DEP-W',
    primaryDefaultFreq: '122.800',
    holdLines: [
      'HOLD POSITION, CANCEL TAKE-OFF, I SAY AGAIN HOLD',
      'STOP IMMEDIATELY + CS: STOP IMMEDIATELY',
    ],
    rows: [],
  }
}

/** Active DEP variants (auto config + each manually added config). */
export function getActiveDepVariants(): DepInfoVariant[] {
  const store = useEfsStore()
  if (!store.essaRolesMode && !store.multiAirport) return []
  const out: DepInfoVariant[] = []
  const seen = new Set<string>()
  const add = (v: DepInfoVariant | null) => {
    if (!v || seen.has(v.configId) || dismissed.value.has(v.id)) return
    seen.add(v.configId)
    out.push(v)
  }
  const cfg = store.essaRwyConfigIdResolved
  if (cfg) {
    const v = depVariantForConfig(cfg)
    if (v && essaCoversInfoRunway(store, v.runway)) add(v)
  }
  for (const key of getInfoStripForcedKeys(DEP_INFO_KIND)) {
    add(depVariantForConfig(key))
  }
  return out
}

/** DEP RWY strip — pass `configId` for multi-instance. */
export function useDepInfoStrip(configIdSource?: MaybeRefOrGetter<string | undefined>) {
  const store = useEfsStore()

  const autoVariant = computed<DepInfoVariant | null>(() => {
    if (!store.essaRolesMode && !store.multiAirport) return null
    const cfg = store.essaRwyConfigIdResolved
    if (!cfg) return null
    const v = depVariantForConfig(cfg)
    if (v && !essaCoversInfoRunway(store, v.runway)) return null
    return v
  })

  const variant = computed<DepInfoVariant | null>(() => {
    const cfg = toValue(configIdSource)
    if (cfg) {
      return getActiveDepVariants().find((v) => v.configId === cfg) ?? null
    }
    return getActiveDepVariants()[0] ?? null
  })

  const instanceKey = computed(() => {
    const v = variant.value
    if (!v) return DEP_INFO_KIND
    return infoStripInstanceKey(DEP_INFO_KIND, v.configId)
  })

  const placement = computed(
    () =>
      getInfoStripPlacement(instanceKey.value) ?? getInfoStripPlacement(DEP_INFO_KIND),
  )

  const visible = computed(() => !!variant.value)

  const defaultSectionId = computed(() => {
    const v = variant.value
    if (!v) return null
    return essaDepDefaultSectionId(v.runway)
  })

  function dismiss() {
    const v = variant.value
    if (!v) return
    dismissInfoStrip(v.id)
    removeInfoStripForced(DEP_INFO_KIND, v.configId)
  }

  function moveTo(bayId: string, sectionId: string, bottom: boolean, index: number) {
    setInfoStripPlacement(instanceKey.value, { bayId, sectionId, bottom, index })
  }

  return {
    variant,
    autoVariant,
    visible,
    placement,
    instanceKey,
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

function turnDepVariantForConfig(cfg: string): TurnDepInfoVariant | null {
  const briefing = getEssaTurnDepBriefing(cfg)
  if (!briefing) return null
  return {
    id: `turnDep:${briefing.runway}:${briefing.turn}`,
    configId: cfg,
    ...briefing,
  }
}

function turnDepVariantForTurn(turn: string): TurnDepInfoVariant | null {
  if (turn !== 'LEFT' && turn !== 'RIGHT' && turn !== 'BOTH') return null
  const cfg = ESSA_RWY_COMBINATIONS.find((c) => getEssaTurnDepBriefing(c.id)?.turn === turn)
  return cfg ? turnDepVariantForConfig(cfg.id) : null
}

/** Green 08 LT/RT “LEFT/RIGHT TURN DEPARTURE” briefing strip; manual fallback → 08-LT. */
export function useTurnDepInfoStrip() {
  const store = useEfsStore()

  const autoVariant = computed<TurnDepInfoVariant | null>(() => {
    if (!store.essaRolesMode) return null
    const cfg = store.essaRwyConfigIdResolved
    if (!cfg) return null
    const v = turnDepVariantForConfig(cfg)
    if (v && !essaCoversInfoRunway(store, v.runway)) return null
    return v
  })

  const variant = computed<TurnDepInfoVariant | null>(() => {
    if (!store.essaRolesMode) return null
    const forced = getInfoStripForced(TURN_DEP_INFO_KIND)
    if (forced) {
      // force key is turn (LEFT/RIGHT/BOTH) or a config id
      const byTurn = turnDepVariantForTurn(forced as TurnDepInfoVariant['turn'])
      if (byTurn) return byTurn
      const byCfg = turnDepVariantForConfig(forced)
      if (byCfg) return byCfg
    }
    if (autoVariant.value) return autoVariant.value
    if (!manualKinds.value.has(TURN_DEP_INFO_KIND)) return null
    const cfg = store.essaRwyConfigIdResolved
    return (cfg && turnDepVariantForConfig(cfg)) || turnDepVariantForConfig('4')
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
    clearInfoStripForce(TURN_DEP_INFO_KIND)
  }

  function moveTo(bayId: string, sectionId: string, bottom: boolean, index: number) {
    setInfoStripPlacement(TURN_DEP_INFO_KIND, { bayId, sectionId, bottom, index })
  }

  return {
    variant,
    autoVariant,
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

function sid19lVariantForConfig(cfg: string): Sid19LInfoVariant | null {
  const briefing = getEssa19LSidBriefing(cfg)
  if (!briefing) return null
  return {
    id: `sid19l:${briefing.mode}`,
    configId: cfg,
    ...briefing,
  }
}

function sid19lVariantForMode(mode: string): Sid19LInfoVariant | null {
  if (mode !== 'Q' && mode !== 'E' && mode !== 'MIX') return null
  const cfg = ESSA_RWY_COMBINATIONS.find((c) => getEssa19LSidBriefing(c.id)?.mode === mode)
  return cfg ? sid19lVariantForConfig(cfg.id) : null
}

/** Green 19L Q / E / MIX OF SIDs briefing strip; manual fallback → 19L-Q. */
export function useSid19LInfoStrip() {
  const store = useEfsStore()

  const autoVariant = computed<Sid19LInfoVariant | null>(() => {
    if (!store.essaRolesMode) return null
    const cfg = store.essaRwyConfigIdResolved
    if (!cfg) return null
    const v = sid19lVariantForConfig(cfg)
    if (v && !essaCoversInfoRunway(store, v.runway)) return null
    return v
  })

  const variant = computed<Sid19LInfoVariant | null>(() => {
    if (!store.essaRolesMode) return null
    const forced = getInfoStripForced(SID19L_INFO_KIND)
    if (forced) {
      const byMode = sid19lVariantForMode(forced)
      if (byMode) return byMode
      const byCfg = sid19lVariantForConfig(forced)
      if (byCfg) return byCfg
    }
    if (autoVariant.value) return autoVariant.value
    if (!manualKinds.value.has(SID19L_INFO_KIND)) return null
    const cfg = store.essaRwyConfigIdResolved
    return (cfg && sid19lVariantForConfig(cfg)) || sid19lVariantForConfig('9A')
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
    clearInfoStripForce(SID19L_INFO_KIND)
  }

  function moveTo(bayId: string, sectionId: string, bottom: boolean, index: number) {
    setInfoStripPlacement(SID19L_INFO_KIND, { bayId, sectionId, bottom, index })
  }

  return {
    variant,
    autoVariant,
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

/** Yellow "R16 utökad ↑" strip — auto when AUP >1600 ft; manual always allowed on ESSA. */
export function useR16InfoStrip() {
  const store = useEfsStore()

  const autoVariant = computed<R16InfoVariant | null>(() => {
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

  const variant = computed<R16InfoVariant | null>(() => {
    if (autoVariant.value) return autoVariant.value
    if (!manualKinds.value.has(R16_INFO_KIND)) return null
    if (!store.myAirports.some((a) => a.toUpperCase() === 'ESSA')) return null
    const r = store.aupR16
    return {
      id: 'r16:manual',
      topAltitudeFt: r?.topAltitudeFt && r.topAltitudeFt > 0 ? r.topAltitudeFt : 3500,
      from: r?.from ?? null,
      to: r?.to ?? null,
      suggestConfigId: r?.suggestConfigId ?? null,
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
    clearInfoStripForce(R16_INFO_KIND)
  }

  function moveTo(bayId: string, sectionId: string, bottom: boolean, index: number) {
    setInfoStripPlacement(R16_INFO_KIND, { bayId, sectionId, bottom, index })
  }

  return {
    variant,
    autoVariant,
    visible,
    placement,
    defaultBayId,
    defaultSectionId,
    dismiss,
    moveTo,
    kind: R16_INFO_KIND,
  }
}

function menuEntry(opts: {
  kind: string
  id: string
  label: string
  forceKey: string
  available: boolean
  auto: boolean
  shown: boolean
  unavailableReason?: string
}): InfoStripMenuEntry {
  const manual = isInfoStripManual(opts.kind) && !opts.auto
  const multi =
    opts.kind === MAP_INFO_KIND ||
    opts.kind === DEP_INFO_KIND ||
    opts.kind === BREAKOUT_INFO_KIND
  const placementKey = multi
    ? infoStripInstanceKey(opts.kind, opts.forceKey)
    : opts.kind
  return {
    kind: opts.kind,
    id: opts.id,
    label: opts.label,
    forceKey: opts.forceKey,
    available: opts.available,
    dismissed: !opts.shown && opts.available,
    auto: opts.auto,
    manual,
    shown: opts.shown,
    hasCustomPlacement:
      !!getInfoStripPlacement(placementKey) ||
      (!!multi && !!getInfoStripPlacement(opts.kind)),
    unavailableReason: opts.unavailableReason,
  }
}

function configMenuLabel(configId: string): string {
  const combo = ESSA_RWY_COMBINATIONS.find((c) => c.id === configId)
  if (!combo) return configId
  return `${configId} · ${formatEssaRwyPdfName(combo)}`
}

/**
 * Catalog / bottom-bar: auto strips + per-config manual add folders.
 * `forceEssaCatalog` — show ESSA info folders (RTC ESSA column).
 */
export function useInfoStripMenu(opts?: {
  forceEssaCatalog?: MaybeRefOrGetter<boolean>
}) {
  const store = useEfsStore()
  const breakout = useBreakoutInfoStrip()
  const map = useMapInfoStrip()
  const dep = useDepInfoStrip()
  const turnDep = useTurnDepInfoStrip()
  const sid19l = useSid19LInfoStrip()
  const r16 = useR16InfoStrip()

  const folders = computed<InfoCatalogFolder[]>(() => {
    const essa = store.essaRolesMode || !!toValue(opts?.forceEssaCatalog)
    if (!essa) return []

    const activeBreakoutIds = new Set(getActiveBreakoutVariants().map((v) => v.id))
    const activeMapIds = new Set(getActiveMapVariants().map((v) => v.configId))
    const activeDepIds = new Set(getActiveDepVariants().map((v) => v.configId))

    const breakoutItems: InfoStripMenuEntry[] = (['1', '2'] as const).map((cfg) => {
      const v = breakoutVariantForConfig(cfg)!
      return menuEntry({
        kind: BREAKOUT_INFO_KIND,
        id: v.id,
        label: `Breakout ${v.runway}`,
        forceKey: cfg,
        available: true,
        auto: breakout.autoVariant.value?.id === v.id,
        shown: activeBreakoutIds.has(v.id),
      })
    })

    const mapItems: InfoStripMenuEntry[] = []
    for (const combo of ESSA_RWY_COMBINATIONS) {
      const v = mapVariantForConfig(combo.id)
      if (!v) continue
      mapItems.push(
        menuEntry({
          kind: MAP_INFO_KIND,
          id: v.id,
          label: configMenuLabel(combo.id),
          forceKey: combo.id,
          available: true,
          auto: map.autoVariant.value?.configId === combo.id,
          shown: activeMapIds.has(combo.id),
        }),
      )
    }

    const depItems: InfoStripMenuEntry[] = []
    for (const combo of ESSA_RWY_COMBINATIONS) {
      const v = depVariantForConfig(combo.id)
      if (!v) continue
      depItems.push(
        menuEntry({
          kind: DEP_INFO_KIND,
          id: v.id,
          label: configMenuLabel(combo.id),
          forceKey: combo.id,
          available: true,
          auto: dep.autoVariant.value?.configId === combo.id,
          shown: activeDepIds.has(combo.id),
        }),
      )
    }
    for (const turn of ['LEFT', 'RIGHT', 'BOTH'] as const) {
      const v = turnDepVariantForTurn(turn)
      if (!v) continue
      const tag = turn === 'LEFT' ? 'LT' : turn === 'RIGHT' ? 'RT' : 'MIXED'
      const shown =
        turnDep.visible.value && turnDep.variant.value?.turn === turn
      depItems.push(
        menuEntry({
          kind: TURN_DEP_INFO_KIND,
          id: v.id,
          label: `Turn DEP ${tag}`,
          forceKey: turn,
          available: true,
          auto: turnDep.autoVariant.value?.turn === turn,
          shown,
        }),
      )
    }

    const sidItems: InfoStripMenuEntry[] = []
    for (const mode of ['Q', 'E', 'MIX'] as const) {
      const v = sid19lVariantForMode(mode)
      if (!v) continue
      const shown =
        sid19l.visible.value && sid19l.variant.value?.mode === mode
      sidItems.push(
        menuEntry({
          kind: SID19L_INFO_KIND,
          id: v.id,
          label: mode === 'MIX' ? 'MIX Q/E SIDs' : `${mode} SIDs`,
          forceKey: mode,
          available: true,
          auto: sid19l.autoVariant.value?.mode === mode,
          shown,
        }),
      )
    }
    {
      const essaAirport = store.myAirports.some((a) => a.toUpperCase() === 'ESSA')
      const rv = r16.variant.value
      const auto = r16.autoVariant.value
      sidItems.push(
        menuEntry({
          kind: R16_INFO_KIND,
          id: rv?.id ?? auto?.id ?? 'r16:manual',
          label: 'R16 utökad',
          forceKey: 'manual',
          available: essaAirport,
          auto: !!auto,
          shown: r16.visible.value,
          unavailableReason: essaAirport ? undefined : 'ESSA only',
        }),
      )
    }

    return [
      { id: 'breakout', label: 'Breakout', items: breakoutItems },
      { id: 'map', label: 'Missed APP', items: mapItems },
      { id: 'dep', label: 'Dep', items: depItems },
      { id: 'sid', label: 'SID', items: sidItems },
    ]
  })

  /** Flat list for bottom-bar compatibility. */
  const entries = computed<InfoStripMenuEntry[]>(() => {
    const out: InfoStripMenuEntry[] = []
    for (const folder of folders.value) out.push(...folder.items)
    return out
  })

  const r16Entry = computed(() =>
    entries.value.find((e) => e.kind === R16_INFO_KIND) ?? null,
  )

  const hasDismissedAvailable = computed(() =>
    entries.value.some((e) => e.available && e.dismissed),
  )

  function showEntry(entry: InfoStripMenuEntry) {
    if (!entry.available || entry.shown) return
    // MAP / DEP / Breakout: add alongside existing (one per config). Others: replace.
    const multi =
      entry.kind === MAP_INFO_KIND ||
      entry.kind === DEP_INFO_KIND ||
      entry.kind === BREAKOUT_INFO_KIND
    if (multi) addInfoStripForced(entry.kind, entry.forceKey)
    else setInfoStripForced(entry.kind, entry.forceKey)
    setInfoStripManual(entry.kind, true)
    // Only clear shared placement for single-instance kinds
    if (!multi) clearInfoStripPlacement(entry.kind)
    restoreInfoStrip(entry.id)
    if (entry.kind === BREAKOUT_INFO_KIND) {
      restoreInfoStrip('breakout:01R')
      restoreInfoStrip('breakout:19L')
    }
    if (entry.kind === R16_INFO_KIND) restoreInfoStrip('r16:manual')
  }

  function resetPlacement(entry: InfoStripMenuEntry) {
    const multi =
      entry.kind === MAP_INFO_KIND ||
      entry.kind === DEP_INFO_KIND ||
      entry.kind === BREAKOUT_INFO_KIND
    if (multi && entry.forceKey) {
      clearInfoStripPlacement(infoStripInstanceKey(entry.kind, entry.forceKey))
    }
    clearInfoStripPlacement(entry.kind)
  }

  return {
    entries,
    folders,
    r16Entry,
    hasDismissedAvailable,
    showEntry,
    resetPlacement,
  }
}


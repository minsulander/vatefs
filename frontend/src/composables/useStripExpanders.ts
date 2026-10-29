import { computed, reactive, type Ref, unref, type WritableComputedRef } from 'vue'

export interface StripExpanderState {
  top: boolean
  bottom: boolean
}

const expandersById = reactive<Record<string, StripExpanderState>>({})
/** Strip IDs that already received spawn defaults (open both for IFR DEP). */
const initializedIds = new Set<string>()

function ensure(stripId: string): StripExpanderState {
  let state = expandersById[stripId]
  if (!state) {
    state = reactive({ top: false, bottom: false })
    expandersById[stripId] = state
  }
  return state
}

/**
 * Apply spawn defaults once per strip id.
 * IFR DEP: both expanders open — except in CD / TSAT / PUSH where the section
 * size control owns expanded vs normal (auto-open fought that selector).
 * ARR / VFR / note / vehicle: closed.
 */
export function applySpawnExpanderDefaults(
  stripId: string,
  opts: { ifrDeparture: boolean; sectionId?: string | null },
): void {
  if (initializedIds.has(stripId)) return
  initializedIds.add(stripId)
  const state = ensure(stripId)
  if (!opts.ifrDeparture) return
  if (sectionSkipsSpawnExpanderOpen(opts.sectionId)) return
  state.top = true
  state.bottom = true
}

/** CD / TSAT / PUSH — strip-size button manages expanders; no IFR-DEP auto-open. */
function sectionSkipsSpawnExpanderOpen(sectionId: string | null | undefined): boolean {
  if (!sectionId) return false
  if (isCdAllOrTsatSection(sectionId)) return true
  if (
    sectionId === 'cleared_tsat' ||
    sectionId === 'cleared_eobt' ||
    sectionId === 'push_start' ||
    sectionId.endsWith('_push_start') ||
    sectionId === 'push_back' ||
    sectionId === 'start_up'
  ) {
    return true
  }
  return false
}

/** Collapse both expanders (e.g. on transfer / XFER). */
export function collapseStripExpanders(stripId: string): void {
  const state = ensure(stripId)
  state.top = false
  state.bottom = false
}

/** CD ALL section (incl. multi-airport *_pending_dep). */
export function isCdAllSection(sectionId: string): boolean {
  return sectionId === 'pending_dep' || sectionId.endsWith('_pending_dep')
}

/** TSAT section (incl. multi-airport *_cleared). */
export function isTsatSection(sectionId: string): boolean {
  return sectionId === 'cleared' || sectionId.endsWith('_cleared')
}

/** CD ALL / TSAT expander sections (incl. multi-airport *_pending_dep / *_cleared). */
export function isCdAllOrTsatSection(sectionId: string): boolean {
  return isCdAllSection(sectionId) || isTsatSection(sectionId)
}

export function getStripExpanderState(stripId: string): StripExpanderState {
  const s = ensure(stripId)
  return { top: s.top, bottom: s.bottom }
}

export function setStripExpanderState(
  stripId: string,
  state: Partial<StripExpanderState>,
): void {
  const s = ensure(stripId)
  if (typeof state.top === 'boolean') s.top = state.top
  if (typeof state.bottom === 'boolean') s.bottom = state.bottom
}

/** Shared expander open state — bay strip and zoomed strip stay in sync. */
export function useStripExpanders(stripId: Ref<string> | string): {
  topExpanded: WritableComputedRef<boolean>
  bottomExpanded: WritableComputedRef<boolean>
} {
  const topExpanded = computed({
    get: () => ensure(unref(stripId)).top,
    set: (v: boolean) => {
      ensure(unref(stripId)).top = v
    },
  })
  const bottomExpanded = computed({
    get: () => ensure(unref(stripId)).bottom,
    set: (v: boolean) => {
      ensure(unref(stripId)).bottom = v
    },
  })
  return { topExpanded, bottomExpanded }
}

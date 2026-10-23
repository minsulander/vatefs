import { computed, reactive, type Ref, unref, type WritableComputedRef } from 'vue'

/** Bay strip size: normal, compact (half-height), or expanded (normal + expanders). Zoom is separate. */
export type StripSizeMode = 'normal' | 'compact' | 'expanded'

/** Ceiling size before auto-fit reduced a strip (survives autofit-module HMR with size). */
export interface StripFitBaseline {
  compact: boolean
  top: boolean
  bottom: boolean
}

const sizeById = reactive<Record<string, StripSizeMode>>({})
/** Kept next to sizeById so compact strips still know their grow ceiling after HMR. */
const fitBaselineById = reactive<Record<string, StripFitBaseline>>({})

function ensure(stripId: string): StripSizeMode {
  return sizeById[stripId] ?? 'normal'
}

export function getStripSizeMode(stripId: string): StripSizeMode {
  return ensure(stripId)
}

export function setStripSizeMode(stripId: string, mode: StripSizeMode): void {
  if (mode === 'normal') {
    delete sizeById[stripId]
  } else if (mode === 'expanded') {
    // Expanded renders as normal height; expanders are opened by the caller.
    delete sizeById[stripId]
  } else {
    sizeById[stripId] = mode
  }
}

export function isStripCompact(stripId: string): boolean {
  return ensure(stripId) === 'compact'
}

export function getStripFitBaseline(stripId: string): StripFitBaseline | undefined {
  return fitBaselineById[stripId]
}

export function setStripFitBaseline(stripId: string, baseline: StripFitBaseline): void {
  fitBaselineById[stripId] = { ...baseline }
}

export function clearStripFitBaseline(stripId: string): void {
  delete fitBaselineById[stripId]
}

/** Shared size mode — bay strip and zoomed strip stay in sync for compact flag. */
export function useStripSizeMode(stripId: Ref<string> | string): {
  sizeMode: WritableComputedRef<StripSizeMode>
  isCompact: WritableComputedRef<boolean>
} {
  const sizeMode = computed({
    get: () => ensure(unref(stripId)),
    set: (v: StripSizeMode) => {
      setStripSizeMode(unref(stripId), v)
    },
  })
  const isCompact = computed({
    get: () => ensure(unref(stripId)) === 'compact',
    set: (v: boolean) => {
      setStripSizeMode(unref(stripId), v ? 'compact' : 'normal')
    },
  })
  return { sizeMode, isCompact }
}

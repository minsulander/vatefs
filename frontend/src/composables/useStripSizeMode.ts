import { computed, reactive, type Ref, unref, type WritableComputedRef } from 'vue'

/** Bay strip size: normal (full SAAB body) or compact (half-height). Zoom is separate. */
export type StripSizeMode = 'normal' | 'compact'

const sizeById = reactive<Record<string, StripSizeMode>>({})

function ensure(stripId: string): StripSizeMode {
  return sizeById[stripId] ?? 'normal'
}

export function getStripSizeMode(stripId: string): StripSizeMode {
  return ensure(stripId)
}

export function setStripSizeMode(stripId: string, mode: StripSizeMode): void {
  if (mode === 'normal') {
    delete sizeById[stripId]
  } else {
    sizeById[stripId] = mode
  }
}

export function isStripCompact(stripId: string): boolean {
  return ensure(stripId) === 'compact'
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

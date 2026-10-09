import { computed, reactive, type Ref, unref, type WritableComputedRef } from 'vue'

export interface StripExpanderState {
  top: boolean
  bottom: boolean
}

const expandersById = reactive<Record<string, StripExpanderState>>({})

function ensure(stripId: string): StripExpanderState {
  let state = expandersById[stripId]
  if (!state) {
    state = reactive({ top: false, bottom: false })
    expandersById[stripId] = state
  }
  return state
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

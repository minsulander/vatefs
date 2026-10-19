import { reactive } from 'vue'

/** Bays with an in-progress sideways klack pull (before klack is committed). */
export const paperKlackPullBayIds = reactive(new Set<string>())

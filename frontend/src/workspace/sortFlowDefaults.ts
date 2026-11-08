import type { SortFlow } from './types'

/**
 * Built-in sort-flow for ESSA / OTHER workspace dividers.
 * All boards use newestTop (“new on top, first at bottom”).
 */
export function preferredSortFlowForWorkspaceSection(_opts: {
  sectionId?: string | null
  title?: string
  groupId?: string
  member?: string
}): SortFlow | undefined {
  return 'newestTop'
}

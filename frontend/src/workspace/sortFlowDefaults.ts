import type { SortFlow } from './types'

/**
 * Built-in sort-flow for specific dividers (ESSA / SAAB profiles).
 * newestTop = “first at bottom”; newestBottom = “first on top”.
 */
export function preferredSortFlowForWorkspaceSection(opts: {
  sectionId?: string | null
  title?: string
  groupId?: string
  member?: string
}): SortFlow | undefined {
  const sid = (opts.sectionId || '').trim()
  const titleU = (opts.title || '').toUpperCase().replace(/\s+/g, ' ').trim()
  const member = opts.member
  const groupId = opts.groupId

  // Push / start — first on top
  if (
    sid === 'push_start' ||
    sid === 'push_back' ||
    sid === 'start_up' ||
    groupId === 'push_start' ||
    titleU === 'PUSH BACK / START-UP' ||
    titleU === 'PUSH BACK / START UP' ||
    titleU === 'PUSH&START' ||
    titleU === 'PUSH BACK' ||
    titleU === 'START UP'
  ) {
    return 'newestBottom'
  }

  // CD / TSAT / EOBT — first on top
  if (
    sid === 'pending_dep' ||
    sid === 'cleared' ||
    sid === 'cleared_tsat' ||
    sid === 'cleared_eobt' ||
    groupId === 'cd_all' ||
    groupId === 'cd_cleared' ||
    titleU === 'CD' ||
    titleU === 'CD ALL' ||
    titleU === 'CDALL' ||
    titleU === 'TSAT / EOBT' ||
    titleU === 'TSAT' ||
    titleU === 'EOBT'
  ) {
    return 'newestBottom'
  }

  // INBOUND APP / ACC / TWR — first at bottom
  if (sid === 'inbound_acc' || titleU === 'INBOUND ACC') return 'newestTop'
  if (
    sid === 'inbound' ||
    sid.startsWith('inbound_twr') ||
    groupId === 'inbound_twr' ||
    titleU === 'INBOUND' ||
    titleU === 'INBOUND APP' ||
    titleU.startsWith('INBOUND APP') ||
    /^INBOUND\s+TWR\b/.test(titleU)
  ) {
    return 'newestTop'
  }

  // CTR ARR / TMA ARR — first at bottom
  if (
    sid === 'ctr_arr' ||
    titleU === 'CTR ARR' ||
    titleU === 'TMA ARR' ||
    (groupId === 'essa_ctr' && member === 'arr') ||
    (groupId === 'essa_tma' && member === 'arr') ||
    (groupId === 'saab_ctr' && member === 'arr')
  ) {
    return 'newestTop'
  }

  // ARR RWY — first at bottom
  if (
    sid === 'arr_runway' ||
    titleU === 'RUNWAY ARR' ||
    titleU === 'ARR RWY' ||
    (groupId === 'saab_runway' && member === 'arr')
  ) {
    return 'newestTop'
  }

  // TAXIWAY ARR — first at bottom
  if (
    sid === 'taxi_arr' ||
    titleU === 'TAXIWAY ARR' ||
    (groupId === 'taxiway' && member === 'arr') ||
    (groupId === 'saab_taxi' && member === 'arr')
  ) {
    return 'newestTop'
  }

  return undefined
}

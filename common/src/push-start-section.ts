/**
 * Workspace split ids for PUSH BACK / START UP map onto YAML `push_start`.
 */

/** Synthetic split members + merged YAML id */
export function isPushStartFamilySectionId(sectionId: string): boolean {
  return (
    sectionId === 'push_start' ||
    sectionId === 'push_back' ||
    sectionId === 'start_up' ||
    sectionId.endsWith('_push_start')
  )
}

/** Store / rules always use the YAML section id. */
export function canonicalPushStartSectionId(sectionId: string): string {
  if (sectionId === 'push_back' || sectionId === 'start_up') return 'push_start'
  // RTC: bayN_push_start is a DEP split view — STUP/PUSH live under bayN_dep
  const rtc = /^(bay\d+|idle)_push_start$/i.exec(sectionId)
  if (rtc) return `${rtc[1]}_dep`
  return sectionId
}

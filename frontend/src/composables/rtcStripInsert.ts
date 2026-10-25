/**
 * RTC mixed-stack default insert:
 * - ARR/CTR: arrivals → top; departures → bottom
 * - DEP/CLR/PUSH&START: first on top (append / bottom insert)
 * - TWY/RWY: arrivals → top; departures → bottom
 */
export function rtcInsertAtTop(
  sectionId: string,
  stripType: string | undefined,
  groundstate?: string,
): boolean {
  const logical = sectionId.includes('_')
    ? sectionId.slice(sectionId.lastIndexOf('_') + 1)
    : sectionId

  // Merged ARR/CTR synthetic id ends with arr_app → last segment is "app"
  const isArrCtr =
    logical === 'arr' ||
    logical === 'app' ||
    sectionId.endsWith('_arr_app') ||
    sectionId === 'arr_app'

  if (isArrCtr) {
    if (stripType === 'arrival') return true
    if (stripType === 'departure') return false
    if (stripType === 'local') {
      const gs = (groundstate || '').toUpperCase()
      if (gs === 'ARR' || gs === 'TXIN' || gs === 'PARK') return true
      return false
    }
    return true
  }

  // DEP / CLR / PUSH&START — first on top (new strips append)
  if (logical === 'dep' || logical === 'clr' || logical === 'start' || sectionId.includes('push_start')) {
    return false
  }

  if (logical === 'twy' || logical === 'rwy') {
    if (stripType === 'arrival') return true
    if (stripType === 'departure') return false
    if (stripType === 'local') {
      const gs = (groundstate || '').toUpperCase()
      if (gs === 'ARR' || gs === 'TXIN' || gs === 'PARK') return true
      return false
    }
    return false
  }

  return true
}

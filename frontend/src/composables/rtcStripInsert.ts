/**
 * RTC mixed-stack default insert: arrivals → top; departures → bottom.
 * Used for header drops / unspecified insert into TWY, RWY, CTR, DEP.
 */
export function rtcInsertAtTop(
  sectionId: string,
  stripType: string | undefined,
  groundstate?: string,
): boolean {
  const logical = sectionId.includes('_') ? sectionId.slice(sectionId.lastIndexOf('_') + 1) : sectionId

  if (logical === 'app' || logical === 'arr') return true
  if (logical === 'dep') return false

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

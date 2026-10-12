/**
 * TopSky FAA → ICAO field 10 (EQUIP shows `G (SDFGRY/H)`).
 * ATYP/X-style single-letter FAA codes from EuroScope GetCapibilities / GetAircraftInfo.
 */
export const FAA_TO_ICAO: Record<string, string> = {
  X: 'SF/X',
  T: 'SF/I',
  U: 'SF/H',
  D: 'SDF/X',
  B: 'SDF/I',
  A: 'SDF/H',
  M: 'DFILTUV/X',
  N: 'DFILTUV/I',
  P: 'DFILTUV/H',
  Y: 'SDF/X',
  C: 'SDF/I',
  I: 'SDF/H',
  Z: 'SDE2E3FIJ1RWY/H',
  V: 'SDFGRY/X',
  S: 'SDFGRY/I',
  G: 'SDFGRY/H',
  W: 'SDFWY/H',
  L: 'SDE2E3FGIJ1RWY/H',
  H: '/H',
  O: '/X',
}

/** ICAO conversion string for a FAA letter, or undefined if unknown. */
export function faaToIcaoEquip(faa: string | undefined | null): string | undefined {
  if (!faa) return undefined
  const code = String(faa).trim().toUpperCase()
  if (code.length !== 1) return undefined
  return FAA_TO_ICAO[code]
}

/** TopSky EQUIP display for FAA: `G (SDFGRY/H)`. */
export function formatFaaEquipDisplay(faa: string | undefined | null): string {
  const code = String(faa || '').trim().toUpperCase()
  if (code.length !== 1) return code
  const icao = FAA_TO_ICAO[code]
  return icao != null ? `${code} (${icao})` : code
}

export function isFaaEquipLetter(letter: string | undefined | null): boolean {
  if (!letter) return false
  const c = String(letter).trim().toUpperCase()
  return c.length === 1 && c in FAA_TO_ICAO
}

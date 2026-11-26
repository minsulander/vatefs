/** Printed fields for the standard (non-Landvetter) paper strip. */

/** Four-letter ICAO as filed. Missing codes stay blank. */
export function airportCode(code: string | undefined): string {
  if (!code || code === '????') return ''
  return code.trim().toUpperCase()
}

/**
 * Swedish ES** airports print only the last two letters (PA for ESPA), but keep
 * an invisible "ES" prefix so glyph position matches a full four-letter ICAO.
 */
export function airportDisplayParts(code: string | undefined): {
  prefix: string
  visible: string
} {
  const full = airportCode(code)
  if (full.length === 4 && full.startsWith('ES')) {
    return { prefix: 'ES', visible: full.slice(2) }
  }
  return { prefix: '', visible: full }
}

/**
 * RFL in ICAO FPL item-15 form: F320 / A050.
 * Accepts FL320, A50, bare hundreds (320), or feet (32000).
 */
export function compactRfl(rfl: string | undefined): string {
  if (!rfl) return ''
  const raw = rfl.trim().toUpperCase()
  const prefixed = raw.match(/^([AFSM])(\d{1,4})$/)
  if (prefixed?.[1] && prefixed[2]) {
    return prefixed[1] + prefixed[2].padStart(3, '0').slice(-3)
  }
  const fl = raw.match(/^FL(\d+)$/)
  if (fl?.[1]) return 'F' + fl[1].padStart(3, '0').slice(-3)
  if (/^\d+$/.test(raw)) {
    const n = Number(raw)
    const hundreds = n >= 1000 ? Math.round(n / 100) : n
    // Bare digits from formatCflMenuLabel are FL hundreds (A* keeps its prefix).
    return 'F' + String(hundreds).padStart(3, '0').slice(-3)
  }
  return raw
}

/** HRN1B → HRN. Prefer the already-parsed TMA exit when present. */
export function exitFix(sid: string | undefined, tmaExit: string | undefined): string {
  const exit = tmaExit?.trim().toUpperCase()
  if (exit) return exit
  const base = sid?.trim().toUpperCase().split(/[·•*]/)[0]
  if (!base) return ''
  return base.replace(/\d+[A-Z]?$/, '')
}

function routeTokens(route: string | undefined): string[] {
  if (!route) return []
  const out: string[] = []
  for (const raw of route.split(/\s+/)) {
    if (!raw) continue
    const upper = raw.toUpperCase()
    if (upper === 'DCT') continue
    const slash = upper.indexOf('/')
    const token = slash >= 0 ? upper.slice(0, slash) : upper
    if (!token) continue
    if (/^\d{1,2}[LRC]?$/.test(token)) continue
    if (slash >= 0 && /^[A-Z]{4}$/.test(token)) continue
    if (/^[NKM]\d{3,4}[FASM]\d{2,4}$/.test(token)) continue
    out.push(token)
  }
  return out
}

/**
 * Two words of the filed route for the std strip points column.
 * Departures: first two. Arrivals: last two (end of route).
 * DCT, speed/level and runway tokens are skipped.
 */
export function routeWords(
  route: string | undefined,
  fromEnd = false,
): [string, string] {
  const tokens = routeTokens(route)
  const slice = fromEnd ? tokens.slice(-2) : tokens.slice(0, 2)
  return [slice[0] ?? '', slice[1] ?? '']
}

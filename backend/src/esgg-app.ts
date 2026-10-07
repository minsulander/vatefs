/**
 * ESGG APP-E / APP-W handoff helpers (Landvetter Appendix DEP RNAV SIDs + MISAP).
 *
 * SID prefs are AIRAC-independent like ESSA: prefix + letter (number flexible).
 *   LABAN3M / LABAN4M / "LABAN 3M" all match { prefix: LABAN, letter: M }.
 * Route exit (e.g. LABAN in FPL) also resolves when designator is missing.
 *
 * RWY 21: DETNA/SABAK/TOPLA/VADIN → W; LABAN/LUKAX/SULIX/NEGIL/PEVAK/MISVI → E
 * RWY 03: DETNA/LABAN/LUKAX/NEGIL/SABAK/TAKOV/TISAB → E; TOPLA/VADIN/SOJWI → W
 * MISAP: 03 → W, 21 → E
 */

import type { ControllerRole } from "./config-types.js"
import { findRouteExit } from "./essa-sid-prefs.js"

export type EsggAppSide = "W" | "E"

/** Prefix + letter; AIRAC number is ignored (ESSA-style). */
export interface EsggSidPref {
    prefix: string
    letter: string
    side: EsggAppSide
}

/** Normalize to "03" / "21" when possible. */
export function normalizeEsggRwy(rwy: string | undefined): string | undefined {
    if (!rwy) return undefined
    const digits = rwy.replace(/\D/g, "")
    if (!digits) return undefined
    const n = parseInt(digits, 10)
    if (n === 3) return "03"
    if (n === 21) return "21"
    return digits.padStart(2, "0")
}

/** Compact SID: "LABAN 3M" → "LABAN3M" */
export function compactEsggSid(sid: string | undefined): string | undefined {
    if (!sid) return undefined
    const c = sid.toUpperCase().replace(/\s+/g, "")
    return c || undefined
}

/** SID base name: "DETNA3M" / "DETNA 3M" → "DETNA" */
export function esggSidPrefix(sid: string | undefined): string | undefined {
    const c = compactEsggSid(sid)
    if (!c) return undefined
    const m = c.match(/^([A-Z]+)/)
    return m?.[1]
}

function escapeRe(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** ESSA-style: PREFIX + digits + LETTER (number AIRAC-flexible). */
export function namedEsggSidRegex(prefix: string, letter: string): RegExp {
    return new RegExp(`^${escapeRe(prefix)}\\d+${escapeRe(letter)}$`, "i")
}

/** Landvetter Tower Runway 03 DEP RNAV SIDs */
const DEP_APP_03: EsggSidPref[] = [
    { prefix: "DETNA", letter: "M", side: "E" },
    { prefix: "LABAN", letter: "M", side: "E" },
    { prefix: "LUKAX", letter: "M", side: "E" },
    { prefix: "NEGIL", letter: "M", side: "E" },
    { prefix: "SABAK", letter: "M", side: "E" },
    { prefix: "TOPLA", letter: "M", side: "W" },
    { prefix: "VADIN", letter: "M", side: "W" },
    { prefix: "SOJWI", letter: "P", side: "W" },
    { prefix: "TAKOV", letter: "R", side: "E" }, // night only
    { prefix: "TISAB", letter: "R", side: "E" }, // night only
]

/** Landvetter Tower Runway 21 DEP RNAV SIDs (+ G/P specials) */
const DEP_APP_21: EsggSidPref[] = [
    { prefix: "DETNA", letter: "J", side: "W" },
    { prefix: "LABAN", letter: "J", side: "E" },
    { prefix: "LUKAX", letter: "J", side: "E" },
    { prefix: "SABAK", letter: "J", side: "W" },
    { prefix: "SULIX", letter: "J", side: "E" },
    { prefix: "TOPLA", letter: "J", side: "W" },
    { prefix: "VADIN", letter: "J", side: "W" },
    { prefix: "NEGIL", letter: "G", side: "E" },
    { prefix: "PEVAK", letter: "G", side: "E" },
    { prefix: "MISVI", letter: "P", side: "E" },
]

function prefsForRwy(rwy: string): EsggSidPref[] | undefined {
    if (rwy === "03") return DEP_APP_03
    if (rwy === "21") return DEP_APP_21
    return undefined
}

/** Split APP side for MISAP: 03→W, 21→E. */
export function esggMisapAppSide(arrRwy?: string): EsggAppSide {
    const r = normalizeEsggRwy(arrRwy)
    if (r === "03") return "W"
    return "E" // 21 or unknown → E
}

/**
 * DEP SID → APP side.
 * Match order (AIRAC-independent):
 * 1. Designator PREFIX + number + letter (LABAN3M, LABAN4M, …)
 * 2. FPL route exit matching a known prefix
 * 3. Prefix-only when all letter variants on that runway share the same side
 */
export function esggDepAppSide(
    depRwy: string | undefined,
    sidOrRoute?: string | undefined,
    route?: string | undefined
): EsggAppSide | undefined {
    // Back-compat: esggDepAppSide(rwy, sid) or esggDepAppSide(rwy, sid, route)
    const sid = sidOrRoute
    const rwy = normalizeEsggRwy(depRwy)
    if (!rwy) return undefined
    const prefs = prefsForRwy(rwy)
    if (!prefs) return undefined

    const compact = compactEsggSid(sid)
    if (compact) {
        for (const p of prefs) {
            if (namedEsggSidRegex(p.prefix, p.letter).test(compact)) return p.side
        }
    }

    const exits = prefs.map((p) => p.prefix)
    const exitFromRoute = findRouteExit(route, exits) ?? findRouteExit(sid, exits)
    if (exitFromRoute) {
        const hits = prefs.filter((p) => p.prefix === exitFromRoute.toUpperCase())
        if (hits.length === 0) return undefined
        if (hits.every((h) => h.side === hits[0]!.side)) return hits[0]!.side
        // Ambiguous letters on same exit — prefer designator match only
    }

    // Prefix-only fallback (e.g. display "LABAN" with no letter)
    const prefix = esggSidPrefix(sid)
    if (prefix) {
        const hits = prefs.filter((p) => p.prefix === prefix)
        if (hits.length > 0 && hits.every((h) => h.side === hits[0]!.side)) {
            return hits[0]!.side
        }
    }

    return undefined
}

export function resolveEsggMapDelivery(arrRwy?: string): {
    heading?: number
    altitudeFt: number
    appSide: EsggAppSide
} {
    const r = normalizeEsggRwy(arrRwy)
    const appSide = esggMisapAppSide(arrRwy)
    const altitudeFt = 3000
    if (r === "03") return { heading: 20, altitudeFt, appSide }
    if (r === "21") return { heading: 200, altitudeFt, appSide }
    return { altitudeFt, appSide }
}

type OnlineCtrl = { callsign: string; frequency: number; role: ControllerRole }

/** Callsign sector tokens for appendix APP-E / APP-W (ESGG uses A for east). */
function esggAppCallsignTokens(side: EsggAppSide): string[] {
    if (side === "W") return ["_W_APP"]
    // Appendix APP-E ↔ ESGG_A_APP (primary) or *_E_APP
    return ["_A_APP", "_E_APP"]
}

function callsignMatchesAppSide(callsign: string, side: EsggAppSide): boolean {
    const u = callsign.toUpperCase()
    return esggAppCallsignTokens(side).some((t) => u.includes(t))
}

/**
 * Prefer ESGG_A_APP / ESGG_W_APP (or *_E_APP) for the given appendix side; else any APP.
 */
export function resolveEsggAppBySide(
    side: EsggAppSide,
    online: Iterable<OnlineCtrl> | undefined,
    airportPrefix = "ESGG"
): { callsign: string; frequency: number; side: EsggAppSide } | undefined {
    if (!online) return undefined
    const prefix = airportPrefix.toUpperCase()
    const all = [...online].filter((c) => c.role === "APP")
    if (all.length === 0) return undefined

    const bySide = all.filter((c) => callsignMatchesAppSide(c.callsign, side))
    const preferred =
        bySide.find((c) => c.callsign.toUpperCase().startsWith(prefix)) ?? bySide[0]
    if (preferred) {
        return { callsign: preferred.callsign, frequency: preferred.frequency, side }
    }

    // Solo APP (no A/E/W in callsign) — still valid handoff target
    const solo = all[0]!
    return { callsign: solo.callsign, frequency: solo.frequency, side }
}

export function resolveEsggMisapApp(
    arrRwy: string | undefined,
    online: Iterable<OnlineCtrl> | undefined,
    airportPrefix = "ESGG"
): { callsign: string; frequency: number; side: EsggAppSide } | undefined {
    return resolveEsggAppBySide(esggMisapAppSide(arrRwy), online, airportPrefix)
}

export function resolveEsggDepApp(
    depRwy: string | undefined,
    sid: string | undefined,
    online: Iterable<OnlineCtrl> | undefined,
    airportPrefix = "ESGG",
    route?: string
): { callsign: string; frequency: number; side: EsggAppSide } | undefined {
    const side = esggDepAppSide(depRwy, sid, route)
    if (!side) return undefined
    return resolveEsggAppBySide(side, online, airportPrefix)
}

/**
 * Strip ownership / transfer SI labels at ESGG:
 * DEL→DEL, GND→GND, TWR→TWR; APP letter from callsign (ESGG_A_APP→A, ESGG_W_APP→W).
 */
export function formatEsggDisplaySi(
    si: string | undefined | null,
    callsign?: string | undefined | null
): string | undefined {
    const fromCs = esggSiFromCallsign(callsign)
    if (fromCs) return fromCs

    if (!si) return undefined
    const key = si.toUpperCase().trim()
    if (!key) return undefined

    // Already canonical
    if (key === "DEL" || key === "GND" || key === "TWR") return key
    if (/^[A-Z]$/.test(key)) return key // A / W / …

    // Common TopSky / login-style tokens
    if (key.endsWith("_DEL") || key === "CD" || key === "LD") return "DEL"
    if (key.endsWith("_GND") || key === "LG" || key === "GG" || key === "G") return "GND"
    if (key.endsWith("_TWR") || key === "LT" || key === "TG" || key === "T") return "TWR"
    const appLetter = esggAppLetterFromToken(key)
    if (appLetter) return appLetter
    if (key.endsWith("_APP") || key === "APP") return key

    return si
}

/** ESGG_A_APP / FOO_W_APP → sector letter; remote _R_APP → TWR. */
export function esggSiFromCallsign(callsign: string | undefined | null): string | undefined {
    if (!callsign) return undefined
    const u = callsign.toUpperCase()
    if (u.endsWith("_DEL")) return "DEL"
    if (u.endsWith("_GND")) return "GND"
    if (u.endsWith("_R_APP") || u.endsWith("_R_CTR")) return "TWR"
    if (u.endsWith("_TWR")) return "TWR"
    // Split APP: ESGG_A_APP → A, ESGG_W_APP → W, ESGG_E_APP → E
    const m = u.match(/_([A-Z])_APP$/)
    if (m) return m[1]!
    if (u.endsWith("_APP")) return "APP"
    return undefined
}

function esggAppLetterFromToken(key: string): string | undefined {
    const m = key.toUpperCase().match(/_([A-Z])_APP$/)
    if (m) return m[1]!
    if (key === "AW" || key === "LW" || key === "APP-W" || key === "W_APP") return "W"
    if (key === "AA" || key === "LA" || key === "APP-A" || key === "A_APP") return "A"
    if (key === "AE" || key === "LE" || key === "APP-E" || key === "E_APP") return "E"
    return undefined
}

/** Display SI for ESGG APP XFER target (callsign letter, else appendix side). */
export function formatEsggAppSi(
    callsign: string | undefined,
    side: EsggAppSide,
    positionId?: string
): string {
    return formatEsggDisplaySi(positionId, callsign) || side
}

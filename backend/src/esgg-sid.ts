/**
 * ESGG (Landvetter) preferred SID matching — LOP §2.3 IFR Departures.
 *
 * Prop SIDs (propeller P/T only):
 *   RWY 03 TOPLA → SOJWI#P
 *   RWY 21 LABAN → MISVI#P; NEGIL → NEGIL#G; SABAK → PEVAK#G
 *   else → normal RNAV SID
 * Jet RWY 21 via NEGIL → SULIX#J
 * Night 22–06 LT: DETNA#M → TAKOV#R; SABAK#M → TISAB#R
 * Normal letters: RWY 03 → #M, RWY 21 → #J
 */

import { findRouteExit } from "./essa-sid-prefs.js"
import { getSidsForRunway } from "./sid-data.js"
import { isPropellerEngine } from "./slow-aircraft.js"

/** FPL TMA exits used for route matching (not SID designators like SOJWI/SULIX). */
export const ESGG_ROUTE_EXITS = [
    "DETNA",
    "LABAN",
    "LUKAX",
    "NEGIL",
    "SABAK",
    "TOPLA",
    "VADIN",
] as const

export type EsggRouteExit = (typeof ESGG_ROUTE_EXITS)[number]
export type EsggDepRwy = "03" | "21"

export interface EsggPreferredSidResult {
    sid: string | null
    sortGroup: string[]
    exit?: string
    /** SID prefix+letter chosen before ESE lookup */
    designator?: { prefix: string; letter: string }
}

/** Prop remap: runway:exit → SID prefix + letter */
const PROP_SID: Record<string, { prefix: string; letter: string }> = {
    "03:TOPLA": { prefix: "SOJWI", letter: "P" },
    "21:LABAN": { prefix: "MISVI", letter: "P" },
    "21:NEGIL": { prefix: "NEGIL", letter: "G" },
    "21:SABAK": { prefix: "PEVAK", letter: "G" },
}

const NORMAL_LETTER: Record<EsggDepRwy, string> = {
    "03": "M",
    "21": "J",
}

export function normalizeEsggDepRwy(runway: string | undefined): EsggDepRwy | undefined {
    if (!runway) return undefined
    const d = runway.replace(/^[A-Z]+/i, "").replace(/[LRC]$/i, "")
    const n = parseInt(d, 10)
    if (n === 3) return "03"
    if (n === 21) return "21"
    return undefined
}

/**
 * Night restrictions 22:00–06:00 local (Europe/Stockholm).
 * Window is [22:00, 06:00).
 */
export function isEsggNightSidHours(now: Date = new Date()): boolean {
    const hourStr = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Stockholm",
        hour: "2-digit",
        hour12: false,
    }).format(now)
    const hour = Number(hourStr)
    const h = hour === 24 ? 0 : hour
    return h >= 22 || h < 6
}

function escapeRe(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function namedSidRegex(prefix: string, letter: string): RegExp {
    return new RegExp(`^${escapeRe(prefix)}\\d+${escapeRe(letter)}$`, "i")
}

/** Pick SID name from a list (tests inject names; production uses ESE). */
export function findEsggSidInNames(
    names: string[],
    prefix: string,
    letter: string,
): string | undefined {
    const matches = names.filter(
        (name) => !name.includes("?") && namedSidRegex(prefix, letter).test(name),
    )
    if (matches.length === 0) return undefined
    return [...matches].sort()[0]
}

/**
 * Resolve SID prefix + letter for exit / prop / jet NEGIL→SULIX / night.
 */
export function resolveEsggSidDesignator(options: {
    runway: EsggDepRwy
    exit: string
    prop?: boolean
    night?: boolean
}): { prefix: string; letter: string } {
    const exit = options.exit.toUpperCase()
    const rwy = options.runway
    const prop = !!options.prop
    const night = !!options.night

    if (prop) {
        const mapped = PROP_SID[`${rwy}:${exit}`]
        if (mapped) return { ...mapped }
        // No prop SID → normal RNAV (below)
    } else if (rwy === "21" && exit === "NEGIL") {
        return { prefix: "SULIX", letter: "J" }
    }

    const letter = NORMAL_LETTER[rwy]
    if (night && rwy === "03" && letter === "M") {
        if (exit === "DETNA") return { prefix: "TAKOV", letter: "R" }
        if (exit === "SABAK") return { prefix: "TISAB", letter: "R" }
    }
    return { prefix: exit, letter }
}

/** Letters that may appear in the clearance SID sort group for this mode. */
function sortLetters(rwy: EsggDepRwy, night: boolean): string[] {
    if (rwy === "03") {
        // Day: M + prop P; night adds R replacements for DETNA/SABAK
        return night ? ["M", "P", "R"] : ["M", "P"]
    }
    // 21: jet J + prop G/P
    return ["J", "G", "P"]
}

/**
 * Resolve preferred SID from an explicit SID name list (unit-testable).
 */
export function resolveEsggPreferredSidFromNames(
    names: string[],
    options: {
        runway: string
        route?: string
        prop?: boolean
        night?: boolean
        engineType?: string | null
    },
): EsggPreferredSidResult {
    const runway = normalizeEsggDepRwy(options.runway)
    if (!runway) return { sid: null, sortGroup: [] }

    const night = options.night ?? isEsggNightSidHours()
    const prop =
        options.prop !== undefined
            ? options.prop
            : isPropellerEngine(options.engineType)

    const letters = sortLetters(runway, night)
    const sortGroup = names
        .filter((name) => {
            if (name.includes("?") || name.toUpperCase().startsWith("VFR")) return false
            // Match PREFIX+digits+LETTER for any known exit/designator letter set
            return letters.some((L) => new RegExp(`^[A-Z]+\\d+${escapeRe(L)}$`, "i").test(name))
        })
        .sort()

    const exit = findRouteExit(options.route, ESGG_ROUTE_EXITS)
    if (!exit) return { sid: null, sortGroup }

    const designator = resolveEsggSidDesignator({ runway, exit, prop, night })
    const sid = findEsggSidInNames(names, designator.prefix, designator.letter) ?? null
    return { sid, sortGroup, exit, designator }
}

/**
 * Resolve preferred ESGG SID from loaded ESE data.
 */
export function resolveEsggPreferredSid(options: {
    runway: string
    route?: string
    prop?: boolean
    night?: boolean
    engineType?: string | null
}): EsggPreferredSidResult {
    const runway = normalizeEsggDepRwy(options.runway)
    if (!runway) return { sid: null, sortGroup: [] }
    const names = getSidsForRunway("ESGG", runway).map((s) => s.name)
    return resolveEsggPreferredSidFromNames(names, options)
}

/** All ESGG SIDs on the runway for a TMA exit (active letter variants). */
export function collectEsggSidsForTmaExit(options: {
    runway: string
    tmaExit: string
    prop?: boolean
    night?: boolean
    engineType?: string | null
}): string[] {
    const runway = normalizeEsggDepRwy(options.runway)
    if (!runway) return []
    const exit = options.tmaExit.trim().toUpperCase()
    if (!exit || !(ESGG_ROUTE_EXITS as readonly string[]).includes(exit)) return []

    const night = options.night ?? isEsggNightSidHours()
    const prop =
        options.prop !== undefined
            ? options.prop
            : isPropellerEngine(options.engineType)

    const designator = resolveEsggSidDesignator({ runway, exit, prop, night })
    const names = getSidsForRunway("ESGG", runway).map((s) => s.name)

    // Include the preferred designator + same-exit normal letter (for menu variety)
    const letters = new Set<string>([designator.letter, NORMAL_LETTER[runway]])
    if (runway === "03" && night) letters.add("R")
    if (runway === "21") {
        letters.add("G")
        letters.add("P")
        letters.add("J")
    }

    const prefixes = new Set<string>([exit, designator.prefix])
    // Related designators for this exit
    if (exit === "NEGIL" && runway === "21") prefixes.add("SULIX")
    if (exit === "TOPLA" && runway === "03") prefixes.add("SOJWI")
    if (exit === "LABAN" && runway === "21") prefixes.add("MISVI")
    if (exit === "SABAK" && runway === "21") prefixes.add("PEVAK")
    if (exit === "DETNA" && runway === "03") prefixes.add("TAKOV")
    if (exit === "SABAK" && runway === "03") prefixes.add("TISAB")

    return names.filter(
        (name) =>
            !name.includes("?") &&
            [...prefixes].some((p) =>
                [...letters].some((L) => namedSidRegex(p, L).test(name)),
            ),
    )
}

/** True when SID is MISVI/SOJWI (LOP: initial climb 4000 ft). */
export function isEsggPropLowClimbSid(sidName: string | undefined | null): boolean {
    if (!sidName) return false
    const c = sidName.toUpperCase().replace(/\s+/g, "")
    return /^MISVI\d+P$/i.test(c) || /^SOJWI\d+P$/i.test(c)
}

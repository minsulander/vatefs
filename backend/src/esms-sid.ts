/**
 * ESMS (Sturup) preferred SID matching from LOA / TopSky auto rules.
 *
 * Normal: RWY 17 → *K, RWY 35 → *L
 * EKCH RWY 30: BABSI/ERNOV → G on 17; DISGO/SALLO → H on 35; rest K/L
 */

import { findRouteExit } from "./essa-sid-prefs.js"
import { getSidsForRunway } from "./sid-data.js"

export const ESMS_EXITS = [
    "BABSI",
    "DISGO",
    "EKRAL",
    "ERNOV",
    "NEXIL",
    "SALLO",
    "TELMO",
] as const

export type EsmsExit = (typeof ESMS_EXITS)[number]

export interface EsmsPreferredSidResult {
    sid: string | null
    sortGroup: string[]
    exit?: string
}

/** Normalize to 17 / 35 (instrument). Other runways → undefined. */
export function normalizeEsmsDepRwy(runway: string | undefined): "17" | "35" | undefined {
    if (!runway) return undefined
    const d = runway.replace(/^[A-Z]+/i, "").replace(/[LRC]$/i, "")
    const n = parseInt(d, 10)
    if (n === 17) return "17"
    if (n === 35) return "35"
    return undefined
}

/**
 * Letter for exit + runway (+ optional EKCH 30 set).
 */
export function esmsSidLetter(
    exit: string,
    runway: "17" | "35",
    ekch30: boolean
): string {
    const ex = exit.toUpperCase()
    if (runway === "17") {
        if (ekch30 && (ex === "BABSI" || ex === "ERNOV")) return "G"
        return "K"
    }
    // 35
    if (ekch30 && (ex === "DISGO" || ex === "SALLO")) return "H"
    return "L"
}

function escapeRe(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function namedSidRegex(prefix: string, letter: string): RegExp {
    return new RegExp(`^${escapeRe(prefix)}\\d+${escapeRe(letter)}$`, "i")
}

/** Pick SID name from a list (tests inject names; production uses ESE). */
export function findEsmsSidInNames(
    names: string[],
    exit: string,
    letter: string
): string | undefined {
    const matches = names.filter(
        (name) => !name.includes("?") && namedSidRegex(exit, letter).test(name)
    )
    if (matches.length === 0) return undefined
    return [...matches].sort()[0]
}

/** Letters active for sort-group on this runway/mode. */
function sortLetters(runway: "17" | "35", ekch30: boolean): string[] {
    if (runway === "17") return ekch30 ? ["K", "G"] : ["K"]
    return ekch30 ? ["L", "H"] : ["L"]
}

/**
 * Resolve preferred SID from an explicit SID name list (unit-testable).
 */
export function resolveEsmsPreferredSidFromNames(
    names: string[],
    options: { runway: string; route?: string; ekch30?: boolean }
): EsmsPreferredSidResult {
    const runway = normalizeEsmsDepRwy(options.runway)
    if (!runway) return { sid: null, sortGroup: [] }

    const ekch30 = !!options.ekch30
    const letters = sortLetters(runway, ekch30)
    const sortGroup = names
        .filter((name) => {
            if (name.includes("?") || name.toUpperCase().startsWith("VFR")) return false
            return letters.some((L) =>
                ESMS_EXITS.some((ex) => namedSidRegex(ex, L).test(name))
            )
        })
        .sort()

    const exit = findRouteExit(options.route, ESMS_EXITS)
    if (!exit) return { sid: null, sortGroup }

    const letter = esmsSidLetter(exit, runway, ekch30)
    const sid = findEsmsSidInNames(names, exit, letter) ?? null
    return { sid, sortGroup, exit }
}

/**
 * True when EuroScope active runways include EKCH 30 (arr or dep).
 * Drives G/H SID set per LOA when Copenhagen uses RWY 30.
 */
export function isEkchRwy30Active(
    activeRunways: Record<string, { arr?: string[]; dep?: string[] }> | undefined
): boolean {
    const ekch = activeRunways?.["EKCH"] ?? activeRunways?.["ekch"]
    if (!ekch) return false
    const ids = [...(ekch.arr ?? []), ...(ekch.dep ?? [])]
    return ids.some((r) => {
        const d = String(r).replace(/^[A-Z]+/i, "").replace(/[LRC]$/i, "")
        return parseInt(d, 10) === 30
    })
}

/**
 * Resolve preferred ESMS SID from loaded ESE data.
 */
export function resolveEsmsPreferredSid(options: {
    runway: string
    route?: string
    ekch30?: boolean
}): EsmsPreferredSidResult {
    const runway = normalizeEsmsDepRwy(options.runway)
    if (!runway) return { sid: null, sortGroup: [] }
    const names = getSidsForRunway("ESMS", runway).map((s) => s.name)
    return resolveEsmsPreferredSidFromNames(names, options)
}

/**
 * Ownership / transfer SI labels for ESMS logins.
 * ESMS_TWR → TWR, ESMS_GND → AD2 (must win over ESGG *_GND→GND).
 */
export function formatEsmsDisplaySi(
    callsign: string | undefined | null,
    positionId?: string | undefined | null
): string | undefined {
    const cs = (callsign ?? "").toUpperCase()
    if (cs.startsWith("ESMS_")) {
        if (cs.endsWith("_TWR") || cs.endsWith("_R_APP") || cs.endsWith("_R_CTR")) return "TWR"
        if (cs.endsWith("_GND") || cs.endsWith("_DEL")) return "AD2"
        return undefined
    }
    const si = (positionId ?? "").toUpperCase().trim()
    if (si === "AD2" || si === "AD1" || si === "TWR") {
        if (si === "AD1") return "TWR"
        return si === "AD2" ? "AD2" : "TWR"
    }
    return undefined
}

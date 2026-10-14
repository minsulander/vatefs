/**
 * EFS-wide airport-specific operational rules (departure coordination, etc.).
 * Sibling to auto-direct LOP DCT/FPR rules — shared by frontend and backend.
 */

import { isIfrSidEligible } from "./sid-format.js"
import { isThickAtypBorderAircraftType } from "./wake-highlight.js"

export type EssaHeavyPreferredDepRwyInput = {
    adep?: string | null
    aircraftType?: string | null
    /** Active ESSA arrival runways from ES rwyconfig */
    activeArr?: readonly string[] | null
    /** Active ESSA departure runways from ES rwyconfig */
    activeDep?: readonly string[] | null
    /** Current FPL/ES departure runway (if any) */
    currentDepRwy?: string | null
}

/**
 * ESSA heavy take-off RWY (wingspan >65 m): 01L / 19R.
 * Any active 01 (ARR or DEP) → 01L; else any active 19 → 19R.
 * Returns the preferred DEP RWY when a change is warranted, else undefined.
 *
 * Intended for the auto-LOP / clearance-prep path (not a disconnected picker).
 */
export function resolveEssaHeavyPreferredDepRwy(
    input: EssaHeavyPreferredDepRwyInput,
): string | undefined {
    const adep = (input.adep || "").trim().toUpperCase()
    if (adep !== "ESSA") return undefined
    if (!isThickAtypBorderAircraftType(input.aircraftType)) return undefined

    const all = [...(input.activeArr ?? []), ...(input.activeDep ?? [])].map((r) =>
        r.trim().toUpperCase(),
    )
    const prefer = all.some((r) => r.startsWith("01"))
        ? "01L"
        : all.some((r) => r.startsWith("19"))
          ? "19R"
          : undefined
    if (!prefer) return undefined

    const cur = (input.currentDepRwy || "").trim().toUpperCase()
    if (cur === prefer) return undefined
    // Only auto-assign when unset or still on the parallel / non-heavy side
    if (cur && cur !== "01R" && cur !== "19L" && cur !== "08" && cur !== "26") {
        return undefined
    }
    return prefer
}

/**
 * ICAOs where IFR DEPs need Departure Coordination (coo checkmark / strip ann 6 DepC).
 * ESNU is included; exempt TMA exits suppress the requirement (see below).
 */
const NEEDS_COORDINATION = new Set([
    "ESCF",
    "ESCM",
    "ESGJ",
    "ESGT",
    "ESIA",
    "ESIB",
    "ESKM",
    "ESKN",
    "ESKS",
    "ESMK",
    "ESMQ",
    "ESMS",
    "ESMT",
    "ESMX",
    "ESND",
    "ESNG",
    "ESNL",
    "ESNN",
    "ESNO",
    "ESNQ",
    "ESNS",
    "ESNU",
    "ESNV",
    "ESNX",
    "ESNZ",
    "ESOE",
    "ESOH",
    "ESOK",
    "ESOW",
    "ESPE",
    "ESSB",
    "ESSD",
    "ESSL",
    "ESSP",
    "ESST",
    "ESSU",
    "ESTA",
    "ESTL",
    "ESUP",
    "ESUT",
])

/**
 * Per-airport TMA exits that do NOT need EST.
 * ESNU LOP §3.1: traffic via TMA exit ↑FL90 need not be coordinated.
 * ESSB / ESMS: no exit exemptions — all IFR DEPs need EST.
 */
const NEEDS_COORDINATION_EXITS: Readonly<Record<string, ReadonlySet<string>>> = {
    ESNU: new Set(["SOPLI", "GADDE", "DEDIT", "TINDO"]),
}

/**
 * True when IFR DEP from `adep` needs Departure Coordination (coo / DepC field).
 * For ESNU: false when `tmaExit` is one of the exempt TMA exits.
 */
export function requiresAccCoordination(
    adep: string | undefined | null,
    tmaExit?: string | undefined | null,
): boolean {
    if (!adep) return false
    const icao = adep.trim().toUpperCase()
    if (!NEEDS_COORDINATION.has(icao)) return false

    const exempt = NEEDS_COORDINATION_EXITS[icao]
    if (!exempt) return true

    const exit = (tmaExit || "").trim().toUpperCase()
    if (exit && exempt.has(exit)) return false
    return true
}

/**
 * LOP airports where SSR is passed verbally during ACC coordination
 * (hide live ES ASSR until override / TopSky generate).
 * ESTL intentionally omitted — always show normal ES SSR there.
 */
const SSR_COORDINATION_AIRPORTS = new Set([
    "ESCF",
    "ESGJ",
    "ESGT",
    "ESIA",
    "ESKN",
    "ESMK",
    "ESMQ",
    "ESMX",
    "ESNS",
    "ESNX",
    "ESOE",
    "ESOK",
    "ESPE",
    "ESSD",
    "ESSL",
    "ESSP",
])

export type SsrCoordinationOpts = {
    /** Local strips keep normal ES SSR at all SSR-callout airports (no hide mode). */
    stripType?: string | null
}

/**
 * True when ADEP uses verbal-ACC SSR coordination (hide ES ASSR until override).
 * Local strips are exempt at every airport on the list. Independent of EST / NeedsCoordination.
 */
export function requiresSsrCoordination(
    adep: string | undefined | null,
    opts?: SsrCoordinationOpts,
): boolean {
    if (!adep) return false
    const icao = adep.trim().toUpperCase()
    if (!SSR_COORDINATION_AIRPORTS.has(icao)) return false
    if ((opts?.stripType || "").toLowerCase() === "local") return false
    return true
}

/**
 * ESMS IRL special DEP coordination (TWR ↔ ACC):
 * TWR sends pink XFL **1000** → ACC counters **4000** → TWR Accept sets DepC.
 *
 * Eligible only for SIDs with published initial climb / XFL **4000 ft** on the
 * strip's dep runway (RWY 17/35 RNAV SIDs to TMA exits). Other SIDs / RWYs stay
 * manual (verbal beyond pink; long-press DepC).
 *
 * AIP AD 2 ESMS RNAV SIDs (BABSI/DISGO/EKRAL/ERNOV/NEXIL/SALLO/TELMO):
 * - RWY 17 → letter K (G for BABSI/ERNOV when EKCH 30)
 * - RWY 35 → letter L (H for DISGO/SALLO when EKCH 30)
 * Initial climb published **4000 FT**. Cross-runway 11/29 and non-matching
 * letters are not auto-coord.
 */
export const ESMS_AUTO_COORD_INIT_XFL_FT = 1000
export const ESMS_AUTO_COORD_REPLY_XFL_FT = 4000

/** TMA exits whose RWY 17/35 RNAV SIDs publish climb to 4000 ft. */
export const ESMS_AUTO_COORD_EXITS = [
    "BABSI",
    "DISGO",
    "EKRAL",
    "ERNOV",
    "NEXIL",
    "SALLO",
    "TELMO",
] as const

/** Normalize ESMS instrument dep runway to 17 / 35 (else undefined). */
export function normalizeEsmsAutoCoordRwy(
    runway: string | undefined | null,
): "17" | "35" | undefined {
    if (!runway) return undefined
    const d = String(runway)
        .trim()
        .toUpperCase()
        .replace(/^[A-Z]+/, "")
        .replace(/[LRC]$/, "")
    const n = parseInt(d, 10)
    if (n === 17) return "17"
    if (n === 35) return "35"
    return undefined
}

/**
 * True when ADEP=ESMS and SID is a published-to-4000 RNAV SID for depRwy 17/35.
 * Does not check flight rules — callers should also require IFR I/Y DEP.
 */
export function isEsmsAutoCoordSid(
    adep: string | undefined | null,
    sid: string | undefined | null,
    depRwy: string | undefined | null,
): boolean {
    if ((adep || "").trim().toUpperCase() !== "ESMS") return false
    const rwy = normalizeEsmsAutoCoordRwy(depRwy)
    if (!rwy) return false
    const raw = (sid || "").trim().toUpperCase().replace(/\s+/g, "")
    if (!raw) return false

    const exit = ESMS_AUTO_COORD_EXITS.find((ex) => raw.startsWith(ex))
    if (!exit) return false
    const rest = raw.slice(exit.length)
    // e.g. 2K, 3G — one or more digits + single letter
    const m = rest.match(/^(\d+)([A-Z])$/)
    if (!m) return false
    const letter = m[2]!
    if (rwy === "17") return letter === "K" || letter === "G"
    return letter === "L" || letter === "H"
}

/** ACC counter-proposal level that completes the ESMS auto handshake (4000 ft). */
export function isEsmsAutoCoordReplyAltitude(
    altitudeFeet: number | undefined | null,
): boolean {
    return (
        typeof altitudeFeet === "number" &&
        Number.isFinite(altitudeFeet) &&
        Math.round(altitudeFeet) === ESMS_AUTO_COORD_REPLY_XFL_FT
    )
}

/** Preferred ESSA APP/DEP sector (Appendix A) — SID black box when east. */
export type EssaAppDepNextSector = "DEP-W" | "DEP-E" | "ARR-W" | "ARR-E"

/**
 * ESSA: black SID box when preferred next sector is DEP-E or ARR-E
 * (all eastbound / east-delivery departures — not only TOVRI/BABAP 19R MDI).
 */
export function needsEssaEastSidBox(
    appDepNextSector: EssaAppDepNextSector | string | null | undefined,
): boolean {
    const s = (appDepNextSector || "").trim().toUpperCase()
    return s === "DEP-E" || s === "ARR-E"
}

/** @deprecated Use needsEssaEastSidBox(appDepNextSector) — kept for older call sites. */
export type EssaMdi2MinSidBoxInput = {
    adep?: string | null
    depRwy?: string | null
    displaySid?: string | null
    stripType?: string | null
    flightRules?: string | null
    /** Preferred Appendix A sector when known (preferred over SID heuristics). */
    appDepNextSector?: EssaAppDepNextSector | string | null
}

/** @deprecated Prefer strip.appDepNextSector + needsEssaEastSidBox. */
export function sidMatchesEssaMdi2MinExit(sid: string | undefined | null): boolean {
    const raw = (sid || "").trim().toUpperCase().replace(/\s+/g, "")
    if (!raw) return false
    for (const exit of ["TOVRI", "BABAP"] as const) {
        if (raw === exit) return true
        if (raw.startsWith(exit) && /^[0-9]/.test(raw.slice(exit.length))) return true
        if (raw === `VE${exit}`) return true
        if (raw.endsWith(`VE${exit}`)) return true
        if (
            raw.endsWith(`·${exit}`) ||
            raw.endsWith(`•${exit}`) ||
            raw.endsWith(`*${exit}`)
        ) {
            return true
        }
    }
    return false
}

/** @deprecated Prefer strip.appDepNextSector + needsEssaEastSidBox. */
export function needsEssaMdi2MinSidBox(input: EssaMdi2MinSidBoxInput): boolean {
    if (input.appDepNextSector != null && input.appDepNextSector !== "") {
        return needsEssaEastSidBox(input.appDepNextSector)
    }
    // Legacy heuristic (19R TOVRI/BABAP) when sector not provided
    const adep = (input.adep || "").trim().toUpperCase()
    if (adep !== "ESSA") return false
    const t = (input.stripType || "").toLowerCase()
    if (t !== "departure" && t !== "local") return false
    if (!isIfrSidEligible(input.flightRules)) return false
    const rwy = (input.depRwy || "").trim().toUpperCase().replace(/[^0-9LRC]/g, "")
    if (rwy !== "19R") return false
    return sidMatchesEssaMdi2MinExit(input.displaySid)
}

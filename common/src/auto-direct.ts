/**
 * LOP IFR DEP direct-to (FPR/DCT) rules — airport-specific.
 *
 * - mode "auto": assign DCT (CD spawn / CLR open) + green highlight
 * - mode "suggest": green highlight only (softer "may" rules)
 */

import { extractSignificantRouteFixes, hasForcedSidInRoute } from "./sid-format.js"

/**
 * Airports where standard IFR DEP clearance is via flight planned route (FPR),
 * not RNAV SID — SID cell shows first FPL fix when a DEP RWY is known (no DCT needed).
 * Includes ÖKC satellites (ESCF/ESSL/ESSP) and other LOP FPL→FL90 (or similar) fields.
 */
const LOP_FPR_DEP_AIRPORTS = new Set([
    "ESCF",
    "ESDF",
    "ESGJ",
    "ESGT",
    "ESIA",
    "ESIB",
    "ESMK",
    "ESMQ",
    "ESMT",
    "ESMX",
    "ESNO",
    "ESOE",
    "ESOK",
    "ESOW",
    "ESPE",
    "ESSD",
    "ESSL",
    "ESSP",
    "ESTA",
    "ESTL",
])

/** True when LOP standard DEP clearance is FPR (not SID). */
export function isLopFprDepAirport(adep: string | undefined | null): boolean {
    if (!adep) return false
    return LOP_FPR_DEP_AIRPORTS.has(adep.trim().toUpperCase())
}

/**
 * Major TMA airports that keep the "SID" field label (not "DEP RTE").
 * ESDF is treated as major for labeling despite also being LOP FPR.
 */
const MAJOR_SID_LABEL_AIRPORTS = new Set(["ESSA", "ESGG", "ESMS", "ESDF"])

/**
 * Strip / clearance field label for departure route.
 * - RTC (`multiAirport`): always "SID"
 * - Major TMA (ESSA/ESGG/ESMS/ESDF): "SID"
 * - Regional LOP FPR airports (non-RTC): "DEP RTE"
 * - Otherwise: "SID"
 */
export function sidFieldLabel(
    adep: string | undefined | null,
    multiAirport: boolean,
): "SID" | "DEP RTE" {
    if (multiAirport) return "SID"
    const icao = (adep || "").trim().toUpperCase()
    if (!icao || MAJOR_SID_LABEL_AIRPORTS.has(icao)) return "SID"
    if (isLopFprDepAirport(icao)) return "DEP RTE"
    return "SID"
}

/**
 * DEP runway for FPR gate: ES GetDepartureRwy, caller-resolved display RWY
 * (incl. ES-active DEP), or ADEP/rwy / SID/rwy on the first FPL route term.
 * No usable RWY ⇒ no FPR preview on strip.
 */
export function hasExplicitDepRunway(
    depRwy: string | undefined | null,
    route: string | undefined | null,
): boolean {
    const rwy = (depRwy || "").trim().toUpperCase()
    if (/^\d{1,2}[LRC]?$/.test(rwy)) return true
    if (!route) return false
    const first = route.trim().split(/\s+/)[0] || ""
    const slash = first.indexOf("/")
    if (slash <= 0) return false
    return /^\d{1,2}[LRC]?$/i.test(first.slice(slash + 1))
}

/**
 * Strip SID-cell preview for FPR airports: first significant FPL fix.
 * Requires a DEP RWY (ES / FPL / caller-resolved active); empty when none.
 * Forced SID/rwy in FPL wins (caller).
 * VFR / VFR→IFR (V/Z): never auto-preview — SID cell stays empty unless a SID was entered.
 */
export function fprDepDisplayFix(
    adep: string | undefined | null,
    route: string | undefined | null,
    depRwy?: string | null,
    flightRules?: string | null,
): string | undefined {
    if (!isLopFprDepAirport(adep)) return undefined
    // V = VFR, Z = VFR→IFR — no auto FPR first-fix display
    if (flightRules === "V" || flightRules === "Z") return undefined
    if (!hasExplicitDepRunway(depRwy, route)) return undefined
    if (hasForcedSidInRoute(route)) return undefined
    return extractSignificantRouteFixes(route)[0]
}

export type LopDirectMode = "auto" | "suggest"

export type LopDirectSuggestion = {
    point: string
    mode: LopDirectMode
    /** Short reason for logs / debug */
    reason: string
}

export type LopDirectInput = {
    adep: string
    ades?: string
    route?: string
    /** Requested level in feet (FL285 → 28500) */
    rflFeet?: number
    runway?: string
    /** Propeller (P/T) — ESNZ soft rule */
    isProp?: boolean
}

/** Parse strip/FPL RFL ("FL340", "340", "A050", feet) → feet. */
export function parseRflToFeet(rfl: string | number | undefined | null): number | undefined {
    if (rfl === undefined || rfl === null || rfl === "") return undefined
    if (typeof rfl === "number" && Number.isFinite(rfl) && rfl > 0) {
        return rfl < 1000 ? rfl * 100 : rfl
    }
    const s = String(rfl).trim().toUpperCase()
    const fl = s.match(/^FL?(\d{1,3})$/)
    if (fl) return parseInt(fl[1]!, 10) * 100
    const a = s.match(/^A(\d{2,3})$/)
    if (a) return parseInt(a[1]!, 10) * 100
    const n = parseInt(s.replace(/[^\d]/g, ""), 10)
    if (!Number.isFinite(n) || n <= 0) return undefined
    return n < 1000 ? n * 100 : n
}

function routeTokens(route: string | undefined): string[] {
    if (!route) return []
    return route
        .toUpperCase()
        .split(/\s+/)
        .map((t) => t.split("/")[0] || "")
        .filter(Boolean)
}

function routeHasFix(route: string | undefined, fix: string): boolean {
    const u = fix.toUpperCase()
    if (extractSignificantRouteFixes(route).includes(u)) return true
    return routeTokens(route).includes(u)
}

function routeHasAirway(route: string | undefined, airway: string): boolean {
    return routeTokens(route).includes(airway.toUpperCase())
}

function routeHasMiknaOrBedos(route: string | undefined): boolean {
    return routeHasFix(route, "MIKNA") || routeHasFix(route, "BEDOS")
}

/**
 * Unconditional / RFL-split LOP DCT — auto-assign when matched.
 */
export function resolveLopAutoDirect(input: LopDirectInput): LopDirectSuggestion | undefined {
    const adep = (input.adep || "").toUpperCase()
    if (!adep) return undefined
    const route = input.route
    const rfl = input.rflFeet

    // ESMT / ESTA — via MIKNA/BEDOS: RFL285− → MIKNA, RFL285+ → BEDOS
    if ((adep === "ESMT" || adep === "ESTA") && routeHasMiknaOrBedos(route)) {
        if (rfl === undefined) return undefined
        if (rfl <= 28500) {
            return { point: "MIKNA", mode: "auto", reason: `${adep} RFL285- → MIKNA` }
        }
        return { point: "BEDOS", mode: "auto", reason: `${adep} RFL285+ → BEDOS` }
    }

    // ESMK — via BEDOS → DCT BEDOS
    if (adep === "ESMK" && routeHasFix(route, "BEDOS")) {
        return { point: "BEDOS", mode: "auto", reason: "ESMK via BEDOS" }
    }

    // ESMX — N851 → BEDOS, N872 → MISMA
    if (adep === "ESMX") {
        if (routeHasAirway(route, "N851") || routeHasFix(route, "BEDOS")) {
            return { point: "BEDOS", mode: "auto", reason: "ESMX via N851/BEDOS" }
        }
        if (routeHasAirway(route, "N872") || routeHasFix(route, "MISMA")) {
            return { point: "MISMA", mode: "auto", reason: "ESMX via N872/MISMA" }
        }
    }

    // ESNO — via SIPRI → DCT SIPRI
    if (adep === "ESNO" && routeHasFix(route, "SIPRI")) {
        return { point: "SIPRI", mode: "auto", reason: "ESNO via SIPRI" }
    }

    return undefined
}

/**
 * Softer "may" LOP DCT — green highlight only (no auto-assign).
 */
export function resolveLopSuggestDirects(input: LopDirectInput): LopDirectSuggestion[] {
    const adep = (input.adep || "").toUpperCase()
    if (!adep) return []
    const out: LopDirectSuggestion[] = []
    const ades = (input.ades || "").toUpperCase()
    const route = input.route

    // ESDF — may DCT NILUG (ADES ESSA) / INWIQ (ADES ESSB)
    if (adep === "ESDF") {
        if (ades === "ESSA") {
            out.push({ point: "NILUG", mode: "suggest", reason: "ESDF→ESSA may DCT NILUG" })
        } else if (ades === "ESSB") {
            out.push({ point: "INWIQ", mode: "suggest", reason: "ESDF→ESSB may DCT INWIQ" })
        }
    }

    // ESNZ — prop RWY 30 may DCT first FPL point
    if (adep === "ESNZ" && input.isProp) {
        const rwy = (input.runway || "").toUpperCase().replace(/[LRC]$/, "")
        if (rwy === "30") {
            const first = extractSignificantRouteFixes(route)[0]
            if (first) {
                out.push({
                    point: first,
                    mode: "suggest",
                    reason: "ESNZ prop RWY 30 may DCT first FPL point",
                })
            }
        }
    }

    return out
}

/**
 * Auto rule first, then soft suggestions (for menu highlighting).
 * Soft points that duplicate the auto point are omitted.
 */
export function resolveLopDirectHighlights(input: LopDirectInput): LopDirectSuggestion[] {
    const auto = resolveLopAutoDirect(input)
    const suggest = resolveLopSuggestDirects(input)
    const out: LopDirectSuggestion[] = []
    if (auto) out.push(auto)
    for (const s of suggest) {
        if (auto && s.point === auto.point) continue
        out.push(s)
    }
    return out
}

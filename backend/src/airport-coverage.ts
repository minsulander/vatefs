/**
 * Per-airport TMA/CTR ownership from ESE OWNER chains.
 * A login covers a volume when its SI is the first online SI on that chain.
 */

import { staticConfig } from "./static-config.js"
import {
    coversCtr,
    coversTma,
    getEsePositionByCallsign,
} from "./ese-airspace.js"

export type AirportCoverage = { tma: boolean; ctr: boolean }

/** Collect online position SIs (including self). */
export function collectOnlineSis(): Set<string> {
    const online = new Set<string>()
    if (staticConfig.myPositionId) {
        online.add(staticConfig.myPositionId.toUpperCase())
    }
    if (staticConfig.onlineControllers) {
        for (const c of staticConfig.onlineControllers.values()) {
            let si = c.positionId?.toUpperCase()
            if (!si) {
                const fromCs = getEsePositionByCallsign(c.callsign)?.si
                if (fromCs) si = fromCs.toUpperCase()
            }
            if (si) online.add(si)
        }
    }
    return online
}

export function mySiForCoverage(): string | undefined {
    if (staticConfig.myPositionId) return staticConfig.myPositionId.toUpperCase()
    const fromCs = getEsePositionByCallsign(staticConfig.myCallsign)?.si
    return fromCs?.toUpperCase()
}

/** Coverage for one airport. */
export function coverageForAirport(airport: string): AirportCoverage {
    const mySi = mySiForCoverage()
    const online = collectOnlineSis()
    return {
        tma: coversTma(airport, mySi, online),
        ctr: coversCtr(airport, mySi, online),
    }
}

/** Coverage map for status broadcast / rule evaluation. */
export function buildAirportCoverageMap(
    airports: string[] | undefined
): Record<string, AirportCoverage> {
    const out: Record<string, AirportCoverage> = {}
    for (const a of airports ?? []) {
        const icao = a.toUpperCase()
        out[icao] = coverageForAirport(icao)
    }
    return out
}

/** Resolve flight airport for coverage checks (prefer destination, then origin). */
export function flightCoverageAirport(
    flight: { destination?: string; origin?: string },
    myAirports: string[]
): string | undefined {
    const dest = flight.destination?.toUpperCase()
    const orig = flight.origin?.toUpperCase()
    if (dest && myAirports.some((a) => a.toUpperCase() === dest)) return dest
    if (orig && myAirports.some((a) => a.toUpperCase() === orig)) return orig
    if (dest) return dest
    if (orig) return orig
    return myAirports[0]?.toUpperCase()
}

/** True when login looks like area CTR (FIR) — ETN 0 is not TMA entry. */
export function isAreaCtrLogin(callsign: string | undefined): boolean {
    if (!callsign) return false
    const u = callsign.toUpperCase()
    if (u === "ESAA_CTR") return true
    if (/^ESOS(_|$)/.test(u) && u.includes("CTR")) return true
    if (/^ESMM(_|$)/.test(u) && u.includes("CTR")) return true
    // Remote tower / RTC are not area
    if (u.startsWith("ESSR")) return false
    return false
}

/**
 * Custom SI labels (ESSA CD/GE…, ESGG DEL/GND/TWR/A/W, ESMS TWR/AD2)
 * apply only when exactly one of ESSA/ESGG/ESMS is among the active airports.
 * Otherwise return the raw EuroScope SI unchanged.
 */

import type { EfsStaticConfig } from "./config-types.js"
import { isMultiAirportConfig } from "./multi-airport.js"
import { formatEssaDisplaySi } from "./essa-roles.js"
import { formatEsggDisplaySi } from "./esgg-app.js"
import { formatEsmsDisplaySi } from "./esms-sid.js"

export type CustomSiAirport = "ESSA" | "ESGG" | "ESMS"

/** Airports that drive SI labeling: multi-airport active set, else myAirports. */
export function airportsForSiScope(config: EfsStaticConfig): string[] {
    if (isMultiAirportConfig(config) && config.activeAirports && config.activeAirports.length > 0) {
        return config.activeAirports
    }
    return config.myAirports
}

/**
 * If exactly one of ESSA/ESGG/ESMS is active, return it; otherwise undefined (use raw SI).
 */
export function exclusiveCustomSiAirport(airports: string[]): CustomSiAirport | undefined {
    const hits = new Set<CustomSiAirport>()
    for (const a of airports) {
        const u = a.toUpperCase()
        if (u === "ESSA" || u === "ESGG" || u === "ESMS") hits.add(u)
    }
    if (hits.size !== 1) return undefined
    return [...hits][0]
}

export function exclusiveCustomSiAirportFromConfig(
    config: EfsStaticConfig
): CustomSiAirport | undefined {
    return exclusiveCustomSiAirport(airportsForSiScope(config))
}

/**
 * Format ownership / transfer / ROF SI for strip display.
 * When not exclusive, returns rawSi unchanged.
 */
export function formatCustomDisplaySi(
    exclusive: CustomSiAirport | undefined,
    rawSi: string | undefined,
    callsign: string | undefined
): string | undefined {
    if (!exclusive) return rawSi
    if (exclusive === "ESMS") {
        return formatEsmsDisplaySi(callsign, rawSi) ?? rawSi
    }
    if (exclusive === "ESSA") {
        return formatEssaDisplaySi(rawSi) ?? rawSi
    }
    // ESGG
    return formatEsggDisplaySi(rawSi, callsign) ?? rawSi
}

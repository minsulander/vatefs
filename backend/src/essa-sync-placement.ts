/**
 * Map peer strip placement across ESSA role boards.
 * INBOUND APP / INBOUND TWR / INBOUND GND are different columns — do not
 * copy section ids blindly (scribble + move sync).
 */

import type { FlightStrip } from "@vatefs/common"
import type { Flight } from "./types.js"
import {
    familiesFromRoles,
    isEssaDynamicRunwaySectionId,
    isEssaLegacyRunwaySectionId,
    isEssaRolesConfig,
    type EssaPositionRole,
} from "./essa-roles.js"
import type { EfsStaticConfig } from "./config-types.js"

function layoutHasSection(config: EfsStaticConfig, sectionId: string): boolean {
    for (const bay of config.layout.bays) {
        for (const sec of bay.sections) {
            if (sec.id === sectionId) return true
            // Dynamic runway headers share prefix with arr_runway / dep_runway
            if (
                isEssaDynamicRunwaySectionId(sectionId) &&
                (sec.id === "arr_runway" ||
                    sec.id === "dep_runway" ||
                    isEssaDynamicRunwaySectionId(sec.id) ||
                    isEssaLegacyRunwaySectionId(sec.id))
            ) {
                return true
            }
        }
    }
    return false
}

function bayIdForSection(config: EfsStaticConfig, sectionId: string): string | undefined {
    for (const bay of config.layout.bays) {
        for (const sec of bay.sections) {
            if (sec.id === sectionId) return bay.id
        }
    }
    // Dynamic runway: prefer bay that already hosts a runway_* section
    if (isEssaDynamicRunwaySectionId(sectionId) || isEssaLegacyRunwaySectionId(sectionId)) {
        for (const bay of config.layout.bays) {
            for (const sec of bay.sections) {
                if (
                    sec.id === sectionId ||
                    sec.id === "arr_runway" ||
                    sec.id === "dep_runway" ||
                    isEssaDynamicRunwaySectionId(sec.id) ||
                    isEssaLegacyRunwaySectionId(sec.id)
                ) {
                    return bay.id
                }
            }
        }
    }
    return undefined
}

function isInboundFamilySection(sectionId: string): boolean {
    return (
        sectionId === "inbound" ||
        sectionId === "inbound_acc" ||
        sectionId === "inbound_gnd" ||
        sectionId.startsWith("inbound_gnd") ||
        sectionId.startsWith("inbound_twr")
    )
}

function isTaxiDepSection(sectionId: string): boolean {
    return sectionId === "taxi_dep" || sectionId.endsWith("_taxi_dep")
}

function isTaxiArrSection(sectionId: string): boolean {
    return sectionId === "taxi_arr" || sectionId.endsWith("_taxi_arr")
}

function isRunwaySection(sectionId: string): boolean {
    return (
        sectionId === "runway" ||
        sectionId.includes("runway") ||
        isEssaDynamicRunwaySectionId(sectionId) ||
        isEssaLegacyRunwaySectionId(sectionId)
    )
}

/**
 * Resolve remote bay/section for this session's role board.
 * Returns null when the peer placement must not move the local strip
 * (role-column mismatch or vacated arrival already past INBOUND).
 */
export function mapEssaRemotePlacement(
    config: EfsStaticConfig,
    remoteBayId: string,
    remoteSectionId: string,
    strip: FlightStrip,
    flight: Flight | undefined,
    opts?: { assumedByMe?: boolean },
): { bayId: string; sectionId: string } | null {
    if (!isEssaRolesConfig(config)) {
        return { bayId: remoteBayId, sectionId: remoteSectionId }
    }

    const roles = (config.essaRoles ?? []) as EssaPositionRole[]
    const families = familiesFromRoles(roles)
    const assumedByMe = !!opts?.assumedByMe
    let sectionId = remoteSectionId
    let bayId = remoteBayId

    // TWR INBOUND GND (other-owned taxi-out) → GND TAXIWAY DEP
    if (sectionId === "inbound_gnd" || sectionId.startsWith("inbound_gnd")) {
        if (!layoutHasSection(config, "inbound_gnd")) {
            sectionId = "taxi_dep"
            bayId = bayIdForSection(config, "taxi_dep") || bayId
        }
    }

    // GND TAXIWAY DEP → TWR INBOUND GND when TWR alone and not assumed
    if (isTaxiDepSection(sectionId) && layoutHasSection(config, "inbound_gnd")) {
        if (families.has("TWR") && !families.has("GND") && !assumedByMe) {
            sectionId = "inbound_gnd"
            bayId = bayIdForSection(config, "inbound_gnd") || bayId
        }
    }

    // Shared `inbound` id means INBOUND APP (TWR) vs INBOUND TWR (GND).
    // Do not pull a vacated / taxi-in / runway strip back into INBOUND.
    if (isInboundFamilySection(sectionId)) {
        const localSec = strip.sectionId || ""
        if (isTaxiArrSection(localSec) || isTaxiDepSection(localSec) || isRunwaySection(localSec)) {
            return null
        }
        const gs = (flight?.groundstate || "").toUpperCase()
        const vacated =
            flight &&
            !flight.airborne &&
            (gs === "ARR" || gs === "TXIN" || gs === "TAXI")
        if (vacated && (strip.stripType === "arrival" || strip.stripType === "local")) {
            // Prefer TAXIWAY ARR for vacated arrivals instead of peer INBOUND
            if (layoutHasSection(config, "taxi_arr")) {
                sectionId = "taxi_arr"
                bayId = bayIdForSection(config, "taxi_arr") || bayId
            } else {
                return null
            }
        }
    }

    if (!layoutHasSection(config, sectionId)) {
        return null
    }

    // Prefer the bay that actually hosts the mapped section
    const hostBay = bayIdForSection(config, sectionId)
    if (hostBay) bayId = hostBay

    return { bayId, sectionId }
}

/** Strip meta for ink-only sync — omit bay/section/position so peers keep their column. */
export function stripMetaWithoutPlacement<T extends { bayId?: string; sectionId?: string; position?: number; bottom?: boolean }>(
    meta: T,
): T {
    const next = { ...meta }
    delete next.bayId
    delete next.sectionId
    delete next.position
    delete next.bottom
    return next
}

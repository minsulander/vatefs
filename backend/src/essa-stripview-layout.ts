/**
 * ESSA (and future ESMS) Strip TV layout snapshot from local EFS bay order.
 *
 * Publishes only EFS-owned order for TWR/GND bay sections. Callsigns that have
 * moved to CTR DEP / APP handoff sections are omitted so Strip TV drops them.
 * ES-native status is NOT included — IRIS joins esdata by callsign.
 */

import {
    isRunwayOrderSectionId,
    normalizeEssaRwy,
    sortRunwayLuOrder,
    type FlightStrip,
} from "@vatefs/common"

/** Ground states still on the TWR/GND DEP stripview (taxi onwards). */
const TAXI_PLUS = new Set(["TAXI", "LINEUP", "DEPA"])

const ESSA_TWR_E = new Set(["01R", "19L"])
const ESSA_TWR_W = new Set(["01L", "19R", "08", "26"])

export type StripviewColumnId = "TWR-W" | "TWR-E"

export type StripviewColumn = {
    id: StripviewColumnId
    callsigns: string[]
}

export type StripviewSepParams = {
    sep: string
    dlv: string
    depGap: string
    info: string
}

export type StripviewLayoutPayload = {
    source: "efs"
    columns: StripviewColumn[]
    sep: StripviewSepParams
}

/** Strip trailing " nm" for Strip TV (UI does not show the unit). */
export function stripNmSuffix(value: string): string {
    return String(value ?? "")
        .replace(/\s*nm\s*$/i, "")
        .trim()
}

export function formatStripviewSep(indicators: {
    sep: string
    dlv: string
    depGap: string
}): StripviewSepParams {
    return {
        sep: stripNmSuffix(indicators.sep),
        dlv: stripNmSuffix(indicators.dlv),
        depGap: stripNmSuffix(indicators.depGap),
        info: "", // EFS live → INFO empty; IRIS shows NO EFS when layout stale
    }
}

/** Sections that belong on DEP Strip TV (not CTR/APP handoff). */
export function isStripviewOrderSectionId(sectionId: string): boolean {
    if (sectionId === "taxi_arr" || sectionId.endsWith("_taxi_arr")) return false
    if (sectionId === "taxi_dep" || sectionId.endsWith("_taxi_dep")) return true
    if (sectionId === "taxi" || sectionId.endsWith("_taxi")) return true
    return isRunwayOrderSectionId(sectionId)
}

/** True when strip is still on TWR/GND DEP bay (exclude CTR DEP / inbound APP). */
export function isStripviewEligibleStrip(strip: Pick<
    FlightStrip,
    "callsign" | "sectionId" | "stripType" | "groundstate" | "airport"
>): boolean {
    if (!strip.callsign?.trim()) return false
    if (strip.stripType === "note" || strip.stripType === "vehicle") return false
    if (strip.stripType === "arrival") return false
    if (!isStripviewOrderSectionId(strip.sectionId)) return false
    const gs = (strip.groundstate || "").toUpperCase()
    // Runway section: include L/U / CFTO even if groundstate briefly empty
    if (isRunwayOrderSectionId(strip.sectionId)) {
        if (!gs || TAXI_PLUS.has(gs) || gs === "ARR") {
            // ARR on runway header is landing — not DEP stripview
            if (gs === "ARR") return false
            return true
        }
        return TAXI_PLUS.has(gs)
    }
    return TAXI_PLUS.has(gs)
}

export function essaStripviewColumnForRunway(rwy: string | undefined | null): StripviewColumnId {
    const r = normalizeEssaRwy(rwy || "")
    if (!r) return "TWR-W"
    if (ESSA_TWR_E.has(r)) return "TWR-E"
    if (ESSA_TWR_W.has(r)) return "TWR-W"
    return "TWR-W"
}

type OrderStrip = {
    callsign: string
    position: number
    groundstate?: string
    clearedForTakeoff?: boolean
    sectionId: string
    runway?: string
}

/**
 * Build TWR-W / TWR-E callsign columns from local EFS strips.
 * Order: runway L/U (CFTO above LINEUP, then position), then taxi_dep by position.
 * Transferred-to-APP (ctr_dep etc.) are excluded via section filter.
 */
export function buildEssaStripviewColumns(
    strips: ReadonlyArray<
        Pick<
            FlightStrip,
            | "callsign"
            | "sectionId"
            | "position"
            | "stripType"
            | "groundstate"
            | "clearedForTakeoff"
            | "runway"
            | "airport"
        >
    >,
    airport = "ESSA",
): StripviewColumn[] {
    const apt = airport.toUpperCase()
    const eligible: OrderStrip[] = []
    for (const s of strips) {
        const stripApt = (s.airport || "").toUpperCase()
        if (stripApt && stripApt !== apt) continue
        if (!isStripviewEligibleStrip(s)) continue
        eligible.push({
            callsign: s.callsign.toUpperCase(),
            position: s.position,
            groundstate: s.groundstate,
            clearedForTakeoff: s.clearedForTakeoff,
            sectionId: s.sectionId,
            runway: s.runway,
        })
    }

    const byCol: Record<StripviewColumnId, OrderStrip[]> = {
        "TWR-W": [],
        "TWR-E": [],
    }
    for (const s of eligible) {
        byCol[essaStripviewColumnForRunway(s.runway)].push(s)
    }

    const orderColumn = (list: OrderStrip[]): string[] => {
        const runway = list.filter((s) => isRunwayOrderSectionId(s.sectionId))
        const taxi = list.filter((s) => !isRunwayOrderSectionId(s.sectionId))
        const runwayOrdered = sortRunwayLuOrder(runway)
        const taxiOrdered = [...taxi].sort((a, b) => {
            if (a.position !== b.position) return a.position - b.position
            return a.callsign.localeCompare(b.callsign)
        })
        // Stripview top = next action: runway L/U first, then taxi-out queue
        const seen = new Set<string>()
        const out: string[] = []
        for (const s of [...runwayOrdered, ...taxiOrdered]) {
            if (seen.has(s.callsign)) continue
            seen.add(s.callsign)
            out.push(s.callsign)
        }
        return out
    }

    return [
        { id: "TWR-W", callsigns: orderColumn(byCol["TWR-W"]) },
        { id: "TWR-E", callsigns: orderColumn(byCol["TWR-E"]) },
    ]
}

export function buildEssaStripviewLayout(
    strips: ReadonlyArray<
        Pick<
            FlightStrip,
            | "callsign"
            | "sectionId"
            | "position"
            | "stripType"
            | "groundstate"
            | "clearedForTakeoff"
            | "runway"
            | "airport"
        >
    >,
    indicators: { sep: string; dlv: string; depGap: string },
    airport = "ESSA",
): StripviewLayoutPayload {
    return {
        source: "efs",
        columns: buildEssaStripviewColumns(strips, airport),
        sep: formatStripviewSep(indicators),
    }
}

/**
 * VatIRIS EFS sync order mapping (locked contract).
 *
 * Publishes EFS-owned bay order only. ES-native status is never included.
 * ESSA Strip TV bayIds: TWR-W / TWR-E; sections: TAXI | LINEUP | DEPA.
 * Transferred to APP/DEP (ctr_dep etc.) → omitted from order.
 */

import {
    isRunwayOrderSectionId,
    normalizeEssaRwy,
    sortRunwayLuOrder,
    type FlightStrip,
} from "@vatefs/common"

const TAXI_PLUS = new Set(["TAXI", "LINEUP", "DEPA"])
const ESSA_TWR_E = new Set(["01R", "19L"])
const ESSA_TWR_W = new Set(["01L", "19R", "08", "26"])

/** Sections that mean the strip left TWR/GND bay for APP/DEP (absent from order). */
const TRANSFERRED_SECTION = new Set([
    "ctr_dep",
    "ctr_arr",
    "inbound", // INBOUND APP — not on TWR DEP stripview
])

export type IrisOrderBayId = "TWR-W" | "TWR-E"
export type IrisOrderSectionId = "TAXI" | "LINEUP" | "DEPA"

export type IrisOrderEntry = {
    stripKey: string
    bayId: string
    sectionId: string
    position: number
}

export type IrisOrderPayload = {
    revision: number
    entries: IrisOrderEntry[]
}

/** Allowed EFS-only strip fields for PUT …/strips/:stripKey (no ES status). */
export type StripEfsFields = {
    callsign?: string
    kind?: string
    bayId?: string
    sectionId?: string
    position?: number
    clearanceRead?: boolean
    qnhGiven?: number | null
    atisGiven?: string | null
    noteText?: string
    /** Synthetic / special-strip create meta (not ES-native status) */
    aircraftType?: string
    adep?: string
    ades?: string
    flightRules?: string
    paperInfoKind?: string
    std?: string
}

export type IrisSepPayload = {
    sep: string
    dlv: string
    depGap: string
}

/** stripKey: UPPERCASE callsign for aircraft; stable id for synthetic/empty CS. */
export function irisStripKey(strip: Pick<FlightStrip, "callsign" | "syncKey" | "id">): string {
    const cs = (strip.callsign || "").trim().toUpperCase()
    if (cs) return cs
    return strip.syncKey || strip.id
}

export function stripNmSuffix(value: string): string {
    return String(value ?? "")
        .replace(/\s*nm\s*$/i, "")
        .trim()
}

export function formatIrisSep(indicators: {
    sep: string
    dlv: string
    depGap: string
}): IrisSepPayload {
    return {
        sep: stripNmSuffix(indicators.sep),
        dlv: stripNmSuffix(indicators.dlv),
        depGap: stripNmSuffix(indicators.depGap),
    }
}

export function isTransferredOffTwrgndBay(sectionId: string): boolean {
    const id = sectionId || ""
    if (TRANSFERRED_SECTION.has(id)) return true
    if (id.startsWith("ctr_")) return true
    return false
}

export function isStripviewOrderSectionId(sectionId: string): boolean {
    if (sectionId === "taxi_arr" || sectionId.endsWith("_taxi_arr")) return false
    if (sectionId === "taxi_dep" || sectionId.endsWith("_taxi_dep")) return true
    if (sectionId === "taxi" || sectionId.endsWith("_taxi")) return true
    return isRunwayOrderSectionId(sectionId)
}

export function essaTwBayForRunway(rwy: string | undefined | null): IrisOrderBayId {
    const r = normalizeEssaRwy(rwy || "")
    if (ESSA_TWR_E.has(r)) return "TWR-E"
    if (ESSA_TWR_W.has(r)) return "TWR-W"
    return "TWR-W"
}

/** Map ground flow → IRIS section TAXI | LINEUP | DEPA. */
export function irisDepSectionForStrip(strip: {
    sectionId: string
    groundstate?: string
    clearedForTakeoff?: boolean
}): IrisOrderSectionId | null {
    const gs = (strip.groundstate || "").toUpperCase()
    if (strip.clearedForTakeoff || gs === "DEPA") return "DEPA"
    if (gs === "LINEUP") return "LINEUP"
    if (gs === "TAXI") return "TAXI"
    // Runway bay without GS yet — treat as LINEUP host
    if (isRunwayOrderSectionId(strip.sectionId)) return "LINEUP"
    if (isStripviewOrderSectionId(strip.sectionId)) return "TAXI"
    return null
}

export function isEssaStripviewOrderStrip(strip: Pick<
    FlightStrip,
    "callsign" | "sectionId" | "stripType" | "groundstate" | "airport" | "clearedForTakeoff"
>): boolean {
    if (isTransferredOffTwrgndBay(strip.sectionId)) return false
    if (strip.stripType === "note" || strip.stripType === "vehicle") return false
    if (strip.stripType === "arrival") return false
    if (!isStripviewOrderSectionId(strip.sectionId)) return false
    const gs = (strip.groundstate || "").toUpperCase()
    if (gs === "ARR") return false
    if (isRunwayOrderSectionId(strip.sectionId)) {
        return !gs || TAXI_PLUS.has(gs)
    }
    return TAXI_PLUS.has(gs)
}

type Ranked = {
    stripKey: string
    bayId: IrisOrderBayId
    sectionId: IrisOrderSectionId
    position: number
    groundstate?: string
    clearedForTakeoff?: boolean
    callsign: string
}

/**
 * Build IRIS /order payload for ESSA Strip TV + APP bay mirror.
 * Only TWR-W/E + TAXI|LINEUP|DEPA entries; transferred strips omitted.
 */
export function buildEssaIrisOrder(
    strips: ReadonlyArray<
        Pick<
            FlightStrip,
            | "id"
            | "syncKey"
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
    revision: number,
    airport = "ESSA",
): IrisOrderPayload {
    const apt = airport.toUpperCase()
    const ranked: Ranked[] = []
    for (const s of strips) {
        const stripApt = (s.airport || "").toUpperCase()
        if (stripApt && stripApt !== apt) continue
        if (!isEssaStripviewOrderStrip(s)) continue
        const sectionId = irisDepSectionForStrip(s)
        if (!sectionId) continue
        const stripKey = irisStripKey(s)
        if (!stripKey) continue
        ranked.push({
            stripKey,
            bayId: essaTwBayForRunway(s.runway),
            sectionId,
            position: s.position,
            groundstate: s.groundstate,
            clearedForTakeoff: s.clearedForTakeoff,
            callsign: (s.callsign || stripKey).toUpperCase(),
        })
    }

    // Sort within bay+section: DEPA/LINEUP use runway LU rank; TAXI by position
    const groups = new Map<string, Ranked[]>()
    for (const r of ranked) {
        const g = `${r.bayId}|${r.sectionId}`
        const list = groups.get(g) || []
        list.push(r)
        groups.set(g, list)
    }

    const entries: IrisOrderEntry[] = []
    for (const [, list] of groups) {
        let ordered: Ranked[]
        if (list[0]!.sectionId === "TAXI") {
            ordered = [...list].sort((a, b) => {
                if (a.position !== b.position) return a.position - b.position
                return a.callsign.localeCompare(b.callsign)
            })
        } else {
            ordered = sortRunwayLuOrder(list) as Ranked[]
        }
        ordered.forEach((r, i) => {
            entries.push({
                stripKey: r.stripKey,
                bayId: r.bayId,
                sectionId: r.sectionId,
                position: i,
            })
        })
    }

    // Stable overall order: bay W then E, section DEPA → LINEUP → TAXI, then position
    const sectionRank = (s: string) => (s === "DEPA" ? 0 : s === "LINEUP" ? 1 : 2)
    const bayRank = (b: string) => (b === "TWR-W" ? 0 : 1)
    entries.sort((a, b) => {
        if (a.bayId !== b.bayId) return bayRank(a.bayId) - bayRank(b.bayId)
        if (a.sectionId !== b.sectionId) return sectionRank(a.sectionId) - sectionRank(b.sectionId)
        return a.position - b.position
    })

    return { revision, entries }
}

/**
 * Map a strip to IRIS StripEfsFields (EFS-only).
 * Taxi-out + runway: bayId = TWR-W | TWR-E from responsible TWR role (dep RWY).
 */
export function buildStripEfsFields(
    strip: FlightStrip,
    opts?: { includeQnhAtisClear?: boolean },
): StripEfsFields {
    const stripKey = irisStripKey(strip)
    const onStripview = isEssaStripviewOrderStrip(strip)
    let bayId = strip.bayId
    let sectionId = strip.sectionId
    let position = strip.position
    if (onStripview) {
        const irisSec = irisDepSectionForStrip(strip)
        if (irisSec) {
            bayId = essaTwBayForRunway(strip.runway)
            sectionId = irisSec
        }
    }

    const fields: StripEfsFields = {
        callsign: strip.callsign?.trim() ? strip.callsign.toUpperCase() : undefined,
        bayId,
        sectionId,
        position,
    }

    if (strip.stripType === "note") {
        fields.kind = "note"
        fields.noteText = strip.noteText ?? ""
        if (strip.paperInfoKind) fields.paperInfoKind = strip.paperInfoKind
        return fields
    }
    if (strip.stripType === "vehicle") {
        fields.kind = "vehicle"
        if (strip.std) fields.std = strip.std
        return fields
    }

    // Anonymous / synthetic special strips
    if (!strip.callsign?.trim() || stripKey !== strip.callsign.toUpperCase()) {
        fields.kind =
            strip.stripType === "cross"
                ? "cross"
                : strip.stripType === "vfr" || strip.stripType === "departure"
                  ? "vfrdep"
                  : strip.stripType
        if (strip.aircraftType) fields.aircraftType = strip.aircraftType
        if (strip.adep) fields.adep = strip.adep
        if (strip.ades) fields.ades = strip.ades
        if (strip.flightRules) fields.flightRules = String(strip.flightRules)
    } else {
        fields.kind = "flight"
    }

    fields.clearanceRead = !!(strip.clearanceRead || strip.clearance || strip.clearanceReadback)
    if (opts?.includeQnhAtisClear) {
        fields.qnhGiven = strip.qnhGiven ?? null
        fields.atisGiven = strip.atisGiven ?? null
    } else {
        if (strip.qnhGiven != null) fields.qnhGiven = strip.qnhGiven
        if (strip.atisGiven) fields.atisGiven = strip.atisGiven
    }
    return fields
}

/** Assert payload has no forbidden ES-native keys (for tests / dry-run). */
export const FORBIDDEN_SYNC_KEYS = [
    "groundstate",
    "clearance",
    "clearence",
    "clearedForTakeoff",
    "cfto",
    "depRwy",
    "arrRwy",
    "sid",
    "stand",
    "cfl",
    "temporaryAltitude",
    "ownership",
    "sector",
    "atd",
    "squawk",
    "type",
    "wtc",
] as const

export function assertNoForbiddenSyncKeys(obj: unknown, path = ""): string[] {
    const errs: string[] = []
    if (!obj || typeof obj !== "object") return errs
    if (Array.isArray(obj)) {
        obj.forEach((v, i) => errs.push(...assertNoForbiddenSyncKeys(v, `${path}[${i}]`)))
        return errs
    }
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        if ((FORBIDDEN_SYNC_KEYS as readonly string[]).includes(k)) {
            errs.push(`${path}.${k}`)
        }
        errs.push(...assertNoForbiddenSyncKeys(v, path ? `${path}.${k}` : k))
    }
    return errs
}

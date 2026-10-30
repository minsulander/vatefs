/**
 * VatIRIS EFS sync order mapping (locked contract).
 *
 * Publishes EFS-owned bay order, plus the EFS CFTO flag and ATD (HHmm).
 * IRIS must use these instead of its own ground-speed track.
 * ESSA Strip TV bayIds: TWR-W / TWR-E; sections: TAXI | LINEUP | DEPA.
 *
 * Stripview drops when tower/ground hands off to APP, DEP, or Unicom
 * (label "released"). Split TWR↔TWR and GND↔GND handoffs keep the strip.
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

/** Sections that are not the TWR departure sequence (absent from order). */
const TRANSFERRED_SECTION = new Set([
    "ctr_arr",
    "inbound", // INBOUND APP — not on TWR DEP stripview
])

function isCtrDepSection(sectionId: string): boolean {
    const id = sectionId || ""
    return id === "ctr_dep" || id.endsWith("_ctr_dep")
}

export type IrisOrderBayId = "TWR-W" | "TWR-E"
export type IrisOrderSectionId = "TAXI" | "LINEUP" | "DEPA"

const IRIS_ORDER_BAYS = new Set<string>(["TWR-W", "TWR-E"])
const IRIS_ORDER_SECTIONS = new Set<string>(["TAXI", "LINEUP", "DEPA"])

/**
 * True for VatIRIS Stripview coordinates (TWR-W/E + TAXI|LINEUP|DEPA).
 * Those are published on the strip record for IRIS; they are not EFS layout ids.
 */
export function isIrisStripviewPlacement(bayId?: string, sectionId?: string): boolean {
    return !!bayId && !!sectionId && IRIS_ORDER_BAYS.has(bayId) && IRIS_ORDER_SECTIONS.has(sectionId)
}

export type IrisOrderEntry = {
    stripKey: string
    bayId: string
    sectionId: string
    position: number
    /** EFS cleared-for-takeoff. False clears the Stripview mark (RTO / no longer CFTO). */
    cfto: boolean
    /** EFS ATD as UTC HHmm. Null clears a previous time. */
    atd: string | null
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
    /** EFS cleared-for-takeoff. False clears the Stripview mark. */
    cfto?: boolean
    /** EFS ATD as UTC HHmm. Null clears a previous time. */
    atd?: string | null
    /** Paper CTL (cleared to land) — EFS sync so peers show the same L and bay. */
    ctl?: boolean
    /** Paper CLR-read shows the DCL word (not the check). */
    dclMark?: boolean
    /** Paper: DCL dismissed; hide left check until the next read click. */
    clrReadSuppressed?: boolean
    /** Paper col 5 CLR correct, separate from the collapsed clearanceRead bit. */
    clearanceReadback?: boolean
    /** Paper sideways offset (klack). Null clears on peers. */
    klack?: 'left' | 'right' | null
    /** SAAB global highlight (local is not published). */
    highlight?: 'global' | null
}

export type IrisSepPayload = {
    sep: string
    dlv: string
    depGap: string
}

/** Options for stripview membership (TWR top-down cover). */
export type IrisStripviewOpts = {
    /** This session covers ESSA TWR (myRolesByAirport ESSA includes TWR). */
    sessionCoversEssaTower?: boolean
}

/** stripKey: UPPERCASE callsign for aircraft; stable id for synthetic/empty CS. */
/** UTC HHmm, or null when EFS has no ATD (clears a previous value). */
export function normalizeAtd(value: string | null | undefined): string | null {
    const hhmm = (value || "").trim()
    return /^\d{4}$/.test(hhmm) ? hhmm : null
}

export function irisStripKey(strip: Pick<FlightStrip, "callsign" | "syncKey" | "id">): string {
    const cs = (strip.callsign || "").trim().toUpperCase()
    if (cs) return cs
    return strip.syncKey || strip.id
}

/**
 * VatIRIS stores every stripKey uppercased (`note:uuid` → `NOTE:UUID`).
 * Match the local strip anyway so a create echo does not materialize a second strip.
 */
export function stripMatchesRemoteKey(
    strip: Pick<FlightStrip, "callsign" | "syncKey" | "id">,
    remoteKey: string,
): boolean {
    const key = remoteKey.trim().toUpperCase()
    if (!key) return false
    if (irisStripKey(strip).toUpperCase() === key) return true
    if (strip.id.toUpperCase() === key) return true
    return (strip.syncKey || "").toUpperCase() === key
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
    // CTR DEP is the airborne bay. Stripview stays until transfer or release.
    if (isCtrDepSection(id)) return false
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
    // Airborne bay — still the departure roll on Stripview until transfer/release.
    if (isCtrDepSection(strip.sectionId)) return "DEPA"
    if (strip.clearedForTakeoff || gs === "DEPA") return "DEPA"
    if (gs === "LINEUP") return "LINEUP"
    if (gs === "TAXI") return "TAXI"
    // Runway bay without GS yet — treat as LINEUP host
    if (isRunwayOrderSectionId(strip.sectionId)) return "LINEUP"
    if (isStripviewOrderSectionId(strip.sectionId)) return "TAXI"
    return null
}

/** EuroScope Unknown/Unicom handoff — SI/callsign "released" or UNICOM. */
export function isReleasedOrUnicomLabel(
    callsign?: string | null,
    si?: string | null,
): boolean {
    const cs = (callsign || "").trim().toUpperCase()
    const s = (si || "").trim().toUpperCase()
    return (
        cs === "RELEASED" ||
        cs === "UNICOM" ||
        s === "RELEASED" ||
        s === "UNICOM"
    )
}

/**
 * APP or DEP (not remote-tower _R_APP / _R_CTR).
 * `_DEP` is matched explicitly — parseControllerRole treats it as TWR.
 */
export function isAppOrDepCallsign(callsign?: string | null): boolean {
    const cs = (callsign || "").trim().toUpperCase()
    if (!cs) return false
    if (cs.endsWith("_DEP")) return true
    if (cs.endsWith("_R_APP") || cs.endsWith("_R_CTR")) return false
    if (cs.endsWith("_APP")) return true
    return false
}

/**
 * ESSA aerodrome positions: DEL / GND / TWR (incl. TWR-S, remote tower).
 * Split TWR↔TWR and GND↔GND handoffs stay on stripview.
 */
export function isEssaAerodromeCallsign(callsign?: string | null): boolean {
    const cs = (callsign || "").trim().toUpperCase()
    if (!cs || isReleasedOrUnicomLabel(cs)) return false
    if (isAppOrDepCallsign(cs)) return false
    if (cs.endsWith("_CTR") && !cs.endsWith("_R_CTR")) return false
    if (cs.endsWith("_DEL") || cs.endsWith("_GND") || cs.endsWith("_TWR")) return true
    if (cs.endsWith("_R_APP") || cs.endsWith("_R_CTR")) return true
    return false
}

type OwnershipStrip = Pick<
    FlightStrip,
    | "ownerCallsign"
    | "ownerSi"
    | "transferCallsign"
    | "transferSi"
    | "transferPending"
    | "isAssumed"
>

/** True when this strip is leaving the aerodrome (APP/DEP/Unicom/released). */
export function isLeavingAerodromeForStripview(strip: OwnershipStrip): boolean {
    const target = strip.transferCallsign
    const targetSi = strip.transferSi
    if (strip.transferPending === "out") {
        if (isReleasedOrUnicomLabel(target, targetSi)) return true
        if (isAppOrDepCallsign(target)) return true
        // Pending handoff to another GND/TWR — stay
        if (isEssaAerodromeCallsign(target)) return false
        // Unknown target with pending out — treat as leaving
        if (target || targetSi) return true
    }
    const owner = strip.ownerCallsign
    const ownerSi = strip.ownerSi
    if (isReleasedOrUnicomLabel(owner, ownerSi)) return true
    if (isAppOrDepCallsign(owner)) return true
    // Owner is ACC/CTR (not remote tower)
    const o = (owner || "").trim().toUpperCase()
    if (o.endsWith("_CTR") && !o.endsWith("_R_CTR")) return true
    return false
}

/**
 * Whether a departure still belongs on TWR Stripview.
 * Drops on TWR→APP/DEP and TWR→Unicom (released). Keeps split TWR/GND handoffs.
 */
export function isEssaStripviewOrderStrip(
    strip: Pick<
        FlightStrip,
        | "callsign"
        | "sectionId"
        | "stripType"
        | "groundstate"
        | "airport"
        | "clearedForTakeoff"
        | "isAssumed"
        | "transferPending"
        | "ownerCallsign"
        | "ownerSi"
        | "transferCallsign"
        | "transferSi"
    >,
    opts?: IrisStripviewOpts,
): boolean {
    if (strip.stripType === "note" || strip.stripType === "vehicle") return false
    if (strip.stripType === "arrival") return false

    // Leaving aerodrome (APP/DEP/Unicom) — drop even on taxi/runway.
    if (isLeavingAerodromeForStripview(strip)) return false

    if (isCtrDepSection(strip.sectionId)) {
        // Top-down TWR cover + assumed + no leave → stay
        if (opts?.sessionCoversEssaTower && strip.isAssumed) return true
        // Owned by ESSA GND/TWR/DEL → stay (airborne until TWR→APP)
        if (isEssaAerodromeCallsign(strip.ownerCallsign)) return true
        // Cleared owner (completed release) or APP/CTR — already handled by isLeaving;
        // empty owner with no assume → off
        return false
    }

    if (isTransferredOffTwrgndBay(strip.sectionId)) return false
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
    atd?: string
    callsign: string
}

type StripviewStrip = Pick<
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
    | "isAssumed"
    | "transferPending"
    | "ownerCallsign"
    | "ownerSi"
    | "transferCallsign"
    | "transferSi"
    | "atd"
>

/**
 * Build IRIS /order payload for ESSA Strip TV + APP bay mirror.
 * Only TWR-W/E + TAXI|LINEUP|DEPA entries. CTR DEP stays until TWR→APP/DEP/Unicom.
 */
export function buildEssaIrisOrder(
    strips: ReadonlyArray<StripviewStrip>,
    revision: number,
    airport = "ESSA",
    opts?: IrisStripviewOpts,
): IrisOrderPayload {
    const apt = airport.toUpperCase()
    const ranked: Ranked[] = []
    for (const s of strips) {
        const stripApt = (s.airport || "").toUpperCase()
        if (stripApt && stripApt !== apt) continue
        if (!isEssaStripviewOrderStrip(s, opts)) continue
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
            atd: s.atd,
            callsign: (s.callsign || stripKey).toUpperCase(),
        })
    }

    // Sort within bay+section.
    // Stripview stacks TAXI → LINEUP → DEPA top→bottom. Higher position within
    // a section sits further down that section.
    // TAXI: invert vs TAXIWAY DEP. EFS top (first in sequence, pos 0) is the
    // bottom of the taxiing strips (highest IRIS position, closest to LINEUP).
    // LINEUP/DEPA: invert vs EFS. Stripview puts DEPA at the bottom of the
    // column; first L/U / CFTO on the EFS RWY bay must sit closest to that
    // end (highest position within the section). Publishing EFS order
    // ascending put the first LINEUP furthest from DEPA until CFTO moved it.
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
            // EFS top-first → reverse so the top TAXIWAY DEP strip is last
            // among taxiing aircraft (bottom of the TAXI block in Stripview).
            ordered = [...list]
                .sort((a, b) => {
                    if (a.position !== b.position) return a.position - b.position
                    return a.callsign.localeCompare(b.callsign)
                })
                .reverse()
        } else {
            // EFS top-first → reverse so first L/U/CFTO gets the highest IRIS position
            ordered = sortRunwayLuOrder(list).reverse() as Ranked[]
        }
        ordered.forEach((r, i) => {
            entries.push({
                stripKey: r.stripKey,
                bayId: r.bayId,
                sectionId: r.sectionId,
                position: i,
                cfto: !!r.clearedForTakeoff,
                atd: normalizeAtd(r.atd),
            })
        })
    }

    return sortIrisOrderEntries(entries, revision)
}

function sortIrisOrderEntries(entries: IrisOrderEntry[], revision: number): IrisOrderPayload {
    // Stable overall order: bay W then E, section DEPA → LINEUP → TAXI, then position
    const sectionRank = (s: string) => (s === "DEPA" ? 0 : s === "LINEUP" ? 1 : 2)
    const bayRank = (b: string) => (b === "TWR-W" ? 0 : 1)
    const sorted = [...entries].sort((a, b) => {
        if (a.bayId !== b.bayId) return bayRank(a.bayId) - bayRank(b.bayId)
        if (a.sectionId !== b.sectionId) return sectionRank(a.sectionId) - sectionRank(b.sectionId)
        return a.position - b.position
    })
    return { revision, entries: sorted }
}

/**
 * Merge local order with last remote snapshot for split TWR/GND publishers.
 * - Replace entries for flights this client knows and still on stripview
 * - Drop keys this client has that left to APP/DEP/Unicom
 * - Drop keys we previously published that disappeared from local strips
 *   (disconnect / soft-delete) — otherwise peers re-keep them forever
 * - Keep remote keys this client never knew (other split position)
 */
export function mergeEssaIrisOrderForSplitPublish(
    local: IrisOrderPayload,
    remoteEntries: ReadonlyArray<IrisOrderEntry>,
    localStrips: ReadonlyArray<StripviewStrip>,
    opts?: IrisStripviewOpts & {
        /** Strip keys this session last published on stripview (callsign upper). */
        previouslyPublishedKeys?: ReadonlySet<string>
    },
): IrisOrderPayload {
    const knownKeys = new Set<string>()
    const dropKeys = new Set<string>()
    for (const s of localStrips) {
        const key = irisStripKey(s).toUpperCase()
        if (!key) continue
        const apt = (s.airport || "").toUpperCase()
        if (apt && apt !== "ESSA") continue
        knownKeys.add(key)
        if (!isEssaStripviewOrderStrip(s, opts)) {
            dropKeys.add(key)
        }
    }
    // Gone from our strip list entirely after we had published them → drop
    // (NSZ51M / DLH6LL disconnect left remote DEPA entries stuck on Stripview).
    if (opts?.previouslyPublishedKeys) {
        for (const k of opts.previouslyPublishedKeys) {
            const key = k.toUpperCase()
            if (!knownKeys.has(key)) dropKeys.add(key)
        }
    }

    const localByKey = new Map(local.entries.map((e) => [e.stripKey.toUpperCase(), e]))
    const merged = new Map<string, IrisOrderEntry>()

    for (const e of remoteEntries) {
        const k = e.stripKey.toUpperCase()
        if (dropKeys.has(k)) continue
        if (knownKeys.has(k)) {
            const loc = localByKey.get(k)
            if (loc) merged.set(k, { ...loc })
            // known but not in local order (shouldn't happen if still on stripview) → skip
            continue
        }
        // Other position's strip — keep
        merged.set(k, { ...e })
    }

    for (const e of local.entries) {
        const k = e.stripKey.toUpperCase()
        if (dropKeys.has(k)) continue
        merged.set(k, { ...e })
    }

    // Re-number positions within bay+section
    const groups = new Map<string, IrisOrderEntry[]>()
    for (const e of merged.values()) {
        const g = `${e.bayId}|${e.sectionId}`
        const list = groups.get(g) || []
        list.push(e)
        groups.set(g, list)
    }
    const entries: IrisOrderEntry[] = []
    for (const [, list] of groups) {
        const ordered = [...list].sort((a, b) => {
            if (a.position !== b.position) return a.position - b.position
            return a.stripKey.localeCompare(b.stripKey)
        })
        ordered.forEach((e, i) => {
            entries.push({ ...e, position: i })
        })
    }

    return sortIrisOrderEntries(entries, local.revision)
}

/**
 * Map a strip to IRIS StripEfsFields (EFS-only).
 * Taxi-out + runway: bayId = TWR-W | TWR-E from responsible TWR role (dep RWY).
 */
export function buildStripEfsFields(
    strip: FlightStrip,
    opts?: { includeQnhAtisClear?: boolean; sessionCoversEssaTower?: boolean },
): StripEfsFields {
    const stripKey = irisStripKey(strip)
    const onStripview = isEssaStripviewOrderStrip(strip, {
        sessionCoversEssaTower: opts?.sessionCoversEssaTower,
    })
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
        fields.klack = strip.klack ?? null
        return fields
    }
    if (strip.stripType === "vehicle") {
        fields.kind = "vehicle"
        if (strip.std) fields.std = strip.std
        fields.klack = strip.klack ?? null
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

    fields.cfto = !!strip.clearedForTakeoff
    fields.atd = normalizeAtd(strip.atd)
    fields.ctl = !!strip.clearedToLand
    const dclShown =
        !strip.paperClrReadSuppressed &&
        !strip.dclDismissed &&
        (strip.dclStatus === "SENT" ||
            strip.dclStatus === "DONE" ||
            strip.dclStatus === "WILCO" ||
            !!strip.syncedDclMark)
    fields.dclMark = dclShown
    fields.clrReadSuppressed = !!strip.paperClrReadSuppressed
    fields.clearanceReadback = !!(strip.clearanceReadback || strip.clearance)
    fields.clearanceRead = !!(strip.clearanceRead || strip.clearance || strip.clearanceReadback)
    fields.klack = strip.klack ?? null
    fields.highlight = strip.highlight === "global" ? "global" : null
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
    "depRwy",
    "arrRwy",
    "sid",
    "stand",
    "cfl",
    "temporaryAltitude",
    "ownership",
    "sector",
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

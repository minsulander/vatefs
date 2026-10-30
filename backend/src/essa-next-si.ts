/**
 * ESSA custom position sequence: next SI resolution, DEP/ARR taxi tables,
 * config-6 specials, movement direction, and role-based strip visibility.
 */

import type { FlightStrip } from "@vatefs/common"
import { resolveEssaRwyConfigId } from "@vatefs/common"
import type { EssaPositionRole } from "./essa-roles.js"
import {
    ALL_GND_POSITIONS,
    ALL_TWR_POSITIONS,
    formatEssaDisplaySi,
    isEssaDynamicRunwaySectionId,
    isEssaGndOnly,
    isEssaTwrOnly,
    isEssaRolesConfig,
    isGndOnlyInboundSection,
    parseEssaLoginId,
    parseOnlineEssaLoginIds,
} from "./essa-roles.js"
import {
    bearingDeg,
    angleDiffDeg,
    findContainingSectors,
    findSectorByShortName,
    getAppDepOwnerChain,
    getEsePositionByCallsign,
    getEsePositionBySi,
    getGndOwnerChain,
    getSectorCentroid,
    gndFamilyPrimarySi,
    isEseAirspaceLoaded,
    primaryGndFamilyAt,
    primaryCtrFamilyAt,
    siToGndFamily,
    twFamilyPrimarySi,
    getTwrOwnerChain,
    type EssaCtrFamily,
    type EssaGndFamily,
    type EseCoord,
} from "./ese-airspace.js"
import {
    appDepSectorToSi,
    resolveAppDepNextSector,
    type AppDepSector,
} from "./essa-sid-prefs.js"
import { controllerMonitorsFrequency } from "./afv-transceivers.js"
import { isSlowAircraft, isEssaAutoSlowHours } from "./slow-aircraft.js"
import { getStandCoords } from "./stand-data.js"
import { staticConfig, getFrequencyForCallsign, getControllerPositionId } from "./config.js"
import type { Flight } from "./types.js"
import type { ControllerRole } from "./config-types.js"

export type EssaHop =
    | { kind: "gnd"; family: EssaGndFamily }
    | { kind: "twr"; family: EssaCtrFamily }
    | { kind: "app"; sector?: AppDepSector }

export interface EssaNextSiResult {
    /** Login callsign of next controller (online) */
    callsign?: string
    /** EuroScope SI */
    si?: string
    /** Frequency MHz */
    frequency?: number
    /** Display SI (GE/GN/GW/…) */
    displaySi?: string
    /** Full hop chain before skip-offline (for visibility / debug) */
    hopChain: EssaHop[]
    /** Roles relevant for strip visibility */
    relevantRoles: EssaPositionRole[]
}

const GS_MOVING_KT = 3
const HISTORY_MAX = 8

interface PosSample {
    lat: number
    lon: number
    t: number
}

const positionHistory = new Map<string, PosSample[]>()

export function recordFlightMovement(callsign: string, lat: number, lon: number, groundSpeed?: number): void {
    if (groundSpeed !== undefined && groundSpeed < GS_MOVING_KT) return
    const list = positionHistory.get(callsign) ?? []
    const last = list[list.length - 1]
    if (last && Math.abs(last.lat - lat) < 1e-6 && Math.abs(last.lon - lon) < 1e-6) return
    list.push({ lat, lon, t: Date.now() })
    while (list.length > HISTORY_MAX) list.shift()
    positionHistory.set(callsign, list)
}

export function clearFlightMovement(callsign: string): void {
    positionHistory.delete(callsign)
}

function movementVector(callsign: string): { from: EseCoord; to: EseCoord } | undefined {
    const list = positionHistory.get(callsign)
    if (!list || list.length < 2) return undefined
    const from = list[0]!
    const to = list[list.length - 1]!
    if (Math.abs(from.lat - to.lat) < 1e-7 && Math.abs(from.lon - to.lon) < 1e-7) return undefined
    return { from, to }
}

function movingTowardSector(callsign: string, sectorSubstring: string): boolean {
    const vec = movementVector(callsign)
    const sector = findSectorByShortName(sectorSubstring)
    if (!vec || !sector) return false
    const target = getSectorCentroid(sector)
    const moveBrg = bearingDeg(vec.from, vec.to)
    const toSector = bearingDeg(vec.to, target)
    return angleDiffDeg(moveBrg, toSector) < 55
}

function insideSectorFamily(lat: number, lon: number, family: EssaGndFamily, active?: { arr: string[]; dep: string[] }): boolean {
    return primaryGndFamilyAt(lat, lon, active) === family
}

function insideNamedSector(lat: number, lon: number, substring: string, active?: { arr: string[]; dep: string[] }): boolean {
    const hits = findContainingSectors(lat, lon, { activeRunways: active })
    const u = substring.toUpperCase()
    return hits.some((h) => h.shortName.toUpperCase().includes(u))
}

function normalizeRwy(rwy: string | undefined): string {
    return (rwy ?? "").toUpperCase().replace(/^RWY/, "")
}

function activeEssaRunways(): { arr: string[]; dep: string[] } {
    return staticConfig.activeRunways?.["ESSA"] ?? { arr: [], dep: [] }
}

function essaConfigId(): string | null {
    const { arr, dep } = activeEssaRunways()
    return resolveEssaRwyConfigId(arr, dep)
}

function isConfig6(): boolean {
    return essaConfigId() === "6"
}

function essaAirportForFlight(flight: Flight): string {
    return flight.origin === "ESSA" || flight.destination === "ESSA"
        ? "ESSA"
        : staticConfig.myAirports?.find((a) => a === "ESSA") ?? "ESSA"
}

/** Stand coordinates when a stand is assigned. */
export function resolveStandPoint(flight: Flight): EseCoord | undefined {
    if (!flight.stand) return undefined
    return getStandCoords(essaAirportForFlight(flight), flight.stand)
}

/** Aircraft radar position. */
export function resolveAircraftPoint(flight: Flight): EseCoord | undefined {
    if (flight.latitude !== undefined && flight.longitude !== undefined) {
        return { lat: flight.latitude, lon: flight.longitude }
    }
    return undefined
}

/**
 * Resolve lat/lon: stand first, else aircraft.
 * Prefer resolveStandPoint / resolveAircraftPoint when destination vs current matter.
 */
export function resolveLookupPoint(flight: Flight): EseCoord | undefined {
    return resolveStandPoint(flight) ?? resolveAircraftPoint(flight)
}

/** GND family for parking destination (stand), falling back to aircraft. */
export function parkingGndFamily(flight: Flight): EssaGndFamily | undefined {
    const pt = resolveStandPoint(flight) ?? resolveAircraftPoint(flight)
    if (!pt) return undefined
    return primaryGndFamilyAt(pt.lat, pt.lon, activeEssaRunways())
}

/** GND family for the logged-in controller (not visibility roles / aircraft position). */
function myLoggedInGndFamily(): EssaGndFamily | undefined {
    const si =
        staticConfig.myPositionId?.toUpperCase() ||
        (staticConfig.myCallsign ? resolveOnlineControllerSi(staticConfig.myCallsign) : undefined)
    return si ? siToGndFamily(si) : undefined
}

/**
 * Who should see a cleared strip when AGE is offline (TSAT visibility).
 * GNDE traffic falls to GW. Do not use this as the CD hop — that drops the
 * ideal SI, so AFV cross-couple cannot show AGE/AGN frequency.
 */
export function delTargetGndFamily(parking: EssaGndFamily | undefined, ageOnline: boolean): EssaGndFamily {
    if (!parking) return ageOnline ? "GE" : "GW"
    if (parking === "GE" && !ageOnline) return "GW"
    return parking
}

/** CD next hop: parking sector stays ideal. OWNER chain picks the online GND. */
function cdIdealGndFamily(parking: EssaGndFamily | undefined, ageOnline: boolean): EssaGndFamily {
    return parking ?? (ageOnline ? "GE" : "GW")
}

/**
 * True when myCallsign is the first online SI in the ESE OWNER chain for this GND family
 * (i.e. CD would hand this traffic to us next).
 */
export function isNextOnlineForGndFamily(
    family: EssaGndFamily,
    myCallsign: string | undefined
): boolean {
    if (!myCallsign) return false
    const me = myCallsign.toUpperCase()
    for (const si of getGndOwnerChain(family)) {
        const online = isOnlineSi(si)
        if (!online) continue
        return online.callsign.toUpperCase() === me
    }
    return false
}

/**
 * AOR column for a runway (ESAA TWR split table):
 *   TW = 01L/19R (+ CTR W)
 *   TS = 08/26 = 07/25 (+ CTR E)
 *   TE = 01R/19L
 */
type EssaAorColumn = "TW" | "TS" | "TE"

function aorColumnForRunway(rwy: string, pt?: EseCoord): EssaAorColumn {
    const r = normalizeRwy(rwy)
    if (r === "01L" || r === "19R") return "TW"
    if (r === "08" || r === "26" || r === "07" || r === "25") return "TS"
    if (r === "01R" || r === "19L") return "TE"
    if (pt) {
        const ctr = primaryCtrFamilyAt(pt.lat, pt.lon, activeEssaRunways())
        if (ctr === "TW") return "TW"
        if (ctr === "TS") return "TS"
        if (ctr === "TE") return "TE"
    }
    return "TE"
}

function twrFamilyForRunway(rwy: string, pt?: EseCoord): EssaCtrFamily {
    return aorColumnForRunway(rwy, pt)
}

/**
 * TWR → RWY priority (first online wins each column independently):
 *   01L/19R (TW):  W → E → S
 *   08/26=07/25 (TS): E → S → W
 *   01R/19L (TE):  S → E → W
 */
const AOR_PRIO_TW = ["TWR-W", "TWR-E", "TWR-S"] as const
const AOR_PRIO_TS = ["TWR-E", "TWR-S", "TWR-W"] as const
const AOR_PRIO_TE = ["TWR-S", "TWR-E", "TWR-W"] as const

function firstOnlineInPrio(
    prio: readonly string[],
    online: Set<string>
): string | undefined {
    for (const id of prio) {
        if (online.has(id)) return id
    }
    return undefined
}

/** Who covers [TW, TS, TE] from online TWR logins; null = solo (all columns). */
function aorRowForOnlineTwrs(
    online: Set<string>
): [string, string, string] | null {
    const n =
        (online.has("TWR-E") ? 1 : 0) +
        (online.has("TWR-W") ? 1 : 0) +
        (online.has("TWR-S") ? 1 : 0)
    if (n <= 1) return null // solo → all columns
    const tw = firstOnlineInPrio(AOR_PRIO_TW, online)
    const ts = firstOnlineInPrio(AOR_PRIO_TS, online)
    const te = firstOnlineInPrio(AOR_PRIO_TE, online)
    if (!tw || !ts || !te) return null
    return [tw, ts, te]
}

/** AOR columns covered by this TWR login given who is online. */
function aorColumnsForTwrLogin(login: string, onlineLogins: Iterable<string>): Set<EssaAorColumn> {
    const online = new Set<string>()
    for (const id of onlineLogins) {
        if (id === "TWR-E" || id === "TWR-W" || id === "TWR-S") online.add(id)
    }
    online.add(login)
    const row = aorRowForOnlineTwrs(online)
    if (!row) return new Set(["TW", "TS", "TE"])
    const cols = new Set<EssaAorColumn>()
    if (row[0] === login) cols.add("TW")
    if (row[1] === login) cols.add("TS")
    if (row[2] === login) cols.add("TE")
    return cols
}

/**
 * AOR columns for this session's TWR. null = cover all (solo / non-split / not TWR).
 * Used to hide RUNWAY bays + MAP/breakout for uncovered ARR RWYs.
 * Prefer login callsign (incl. TWR-S) over physical EFS roles — S may hold both
 * E+W roles for section visibility while still owning only the TE AOR column.
 */
export function getMyEssaAorColumns(): Set<EssaAorColumn> | null {
    const roles = staticConfig.essaRoles ?? []
    const myTwrs = roles.filter((r) => ALL_TWR_POSITIONS.includes(r))
    if (myTwrs.length === 0) return null

    const myLogin = staticConfig.myCallsign
        ? parseEssaLoginId(staticConfig.myCallsign)
        : undefined
    if (myLogin === "TWR-E" || myLogin === "TWR-W" || myLogin === "TWR-S") {
        const onlineCallsigns = staticConfig.onlineControllers
            ? [...staticConfig.onlineControllers.keys()]
            : []
        const onlineLogins = parseOnlineEssaLoginIds(onlineCallsigns)
        const cols = aorColumnsForTwrLogin(myLogin, onlineLogins)
        if (cols.size >= 3) return null
        return cols
    }

    // Top-down / no ESSA_*_TWR login: both physical roles → all; else no AOR filter
    if (ALL_TWR_POSITIONS.every((r) => myTwrs.includes(r))) return null
    return null
}

function aorColumnForPairId(pairId: string): EssaAorColumn {
    if (pairId === "01L_19R") return "TW"
    if (pairId === "08_26") return "TS"
    return "TE" // 01R_19L
}

/** Stable key for layout fingerprint when AOR split changes. */
export function essaAorLayoutKey(): string {
    const cols = getMyEssaAorColumns()
    if (!cols) return "ALL"
    return [...cols].sort().join("+")
}

/**
 * Drop RUNWAY pair headers not covered by our TWR AOR columns.
 * Includes traffic-forced (non-standard) pairs — only the TWR covering that
 * strip sees the header; GND/CD never get RWY headers via role filter.
 */
export function filterEssaRunwayPlacementsForMyAor<
    T extends { pair: { id: string } },
>(placements: T[]): T[] {
    const cols = getMyEssaAorColumns()
    if (!cols) return placements
    return placements.filter((p) => cols.has(aorColumnForPairId(p.pair.id)))
}

/**
 * Runway ends we cover under current TWR AOR split.
 * undefined → all runways (no split / not TWR).
 */
export function getMyEssaCoveredRunways(): string[] | undefined {
    const cols = getMyEssaAorColumns()
    if (!cols) return undefined
    const ends: string[] = []
    if (cols.has("TW")) ends.push("01L", "19R")
    if (cols.has("TS")) ends.push("08", "26", "07", "25")
    if (cols.has("TE")) ends.push("01R", "19L")
    return ends
}

/** True when MAP/breakout for this ARR runway should show for us. */
export function essaAorCoversRunway(rwy: string): boolean {
    const cols = getMyEssaAorColumns()
    if (!cols) return true
    return cols.has(aorColumnForRunway(rwy))
}

/** Resolve EuroScope SI for an online controller (plugin position, ESE, or callsign pattern). */
function resolveOnlineControllerSi(callsign: string, positionId?: string): string | undefined {
    if (positionId) return positionId.toUpperCase()
    const fromEse = getEsePositionByCallsign(callsign)?.si
    if (fromEse) return fromEse.toUpperCase()
    const login = parseEssaLoginId(callsign)
    if (login === "GND-E") return "AGE"
    if (login === "GND-N") return "AGN"
    if (login === "GND-W") return "AGW"
    if (login === "CD") return "SAD"
    if (login === "TWR-E") return "TE"
    if (login === "TWR-W") return "TW"
    if (login === "TWR-S") return "TS"
    const u = callsign.toUpperCase()
    if (u.includes("_W_DEP")) return "DW"
    if (u.includes("_E_DEP")) return "DE"
    if (u.includes("_W_APP")) return "W"
    if (u.includes("_E_APP")) return "E"
    if (u.includes("_A_APP")) return "A"
    if (u.includes("_F_APP")) return "AW"
    return undefined
}

function isOnlineSi(si: string): { callsign: string; frequency: number; si: string } | undefined {
    const online = staticConfig.onlineControllers
    if (!online) return undefined
    const want = si.toUpperCase()
    for (const c of online.values()) {
        const posSi = resolveOnlineControllerSi(c.callsign, c.positionId)
        if (posSi === want) {
            return { callsign: c.callsign, frequency: c.frequency, si: posSi }
        }
    }
    // Also match myself
    const mySi =
        staticConfig.myPositionId?.toUpperCase() ||
        (staticConfig.myCallsign ? resolveOnlineControllerSi(staticConfig.myCallsign) : undefined)
    if (mySi === want && staticConfig.myCallsign) {
        return {
            callsign: staticConfig.myCallsign,
            frequency: staticConfig.myFrequency ?? getEsePositionBySi(want)?.frequency ?? 0,
            si: want,
        }
    }
    return undefined
}

function isSiOnline(si: string): boolean {
    return !!isOnlineSi(si)
}

/**
 * Display ideal SI/freq when covering controller monitors ideal freq on AFV (XC),
 * or when settings force ideal frequency — same rules as APP/DEP.
 */
function applyIdealXcDisplay(
    idealSi: string,
    transfer: { callsign: string; frequency: number; si: string },
    options?: { forceIdealFrequency?: boolean }
): { displaySi: string; displayFrequency: number; xc: boolean } {
    const idealFreq = getEsePositionBySi(idealSi)?.frequency
    const coveringIsIdeal = transfer.si.toUpperCase() === idealSi.toUpperCase()
    const forceIdeal = options?.forceIdealFrequency ?? forceIdealAppDepFrequency
    const afvXc =
        !coveringIsIdeal &&
        idealFreq != null &&
        controllerMonitorsFrequency(transfer.callsign, idealFreq)
    const showIdeal = coveringIsIdeal || afvXc || (!coveringIsIdeal && forceIdeal)

    if (showIdeal) {
        return {
            displaySi: idealSi,
            displayFrequency: idealFreq && idealFreq > 0 ? idealFreq : transfer.frequency,
            xc: !coveringIsIdeal && (afvXc || forceIdeal),
        }
    }
    return {
        displaySi: transfer.si,
        displayFrequency: transfer.frequency || getEsePositionBySi(transfer.si)?.frequency || 0,
        xc: false,
    }
}

function firstOnlineInChain(
    hops: EssaHop[],
    myCallsign: string | undefined
): {
    callsign: string
    frequency: number
    si: string
    hop: EssaHop
    displayFrequency: number
    displaySi: string
    xc: boolean
} | undefined {
    for (const hop of hops) {
        if (hop.kind === "app") continue // APP handled separately
        // GND/TWR: walk ESE OWNER (e.g. GNDN AGN:AGW; CTRE TE:TS:TW)
        const idealSi = hop.kind === "gnd" ? gndFamilyPrimarySi(hop.family) : twFamilyPrimarySi(hop.family)
        const sis =
            hop.kind === "gnd" ? getGndOwnerChain(hop.family) : getTwrOwnerChain(hop.family)
        for (const si of sis) {
            const online = isOnlineSi(si)
            if (!online) continue
            if (myCallsign && online.callsign.toUpperCase() === myCallsign.toUpperCase()) continue
            const xc = applyIdealXcDisplay(idealSi, online)
            return {
                ...online,
                hop,
                displayFrequency: xc.displayFrequency,
                displaySi: xc.displaySi,
                xc: xc.xc,
            }
        }
    }
    // CD→GND last resort: any online ESSA GND (prefer W, then N, then E)
    if (hops.some((h) => h.kind === "gnd")) {
        for (const si of ["AGW", "AGN", "AGE"] as const) {
            const online = isOnlineSi(si)
            if (!online) continue
            if (myCallsign && online.callsign.toUpperCase() === myCallsign.toUpperCase()) continue
            const fam = siToGndFamily(si) ?? "GW"
            return {
                ...online,
                hop: { kind: "gnd", family: fam },
                displayFrequency: online.frequency || getEsePositionBySi(online.si)?.frequency || 0,
                displaySi: online.si,
                xc: false,
            }
        }
    }
    return undefined
}

function hopToRole(hop: EssaHop): EssaPositionRole | undefined {
    if (hop.kind === "gnd") {
        if (hop.family === "GE") return "GND-E"
        if (hop.family === "GN") return "GND-N"
        return "GND-W"
    }
    if (hop.kind === "twr") {
        if (hop.family === "TE") return "TWR-E"
        if (hop.family === "TW") return "TWR-W"
        // TS pseudo → both physical for visibility
        return undefined
    }
    return undefined
}

function rolesFromHop(hop: EssaHop): EssaPositionRole[] {
    if (hop.kind === "twr" && hop.family === "TS") return [...ALL_TWR_POSITIONS]
    const r = hopToRole(hop)
    return r ? [r] : []
}

function familyToRole(fam: EssaGndFamily): EssaPositionRole {
    if (fam === "GE") return "GND-E"
    if (fam === "GN") return "GND-N"
    return "GND-W"
}

function ctrToRoles(fam: EssaCtrFamily): EssaPositionRole[] {
    if (fam === "TE") return ["TWR-E"]
    if (fam === "TW") return ["TWR-W"]
    return [...ALL_TWR_POSITIONS]
}

/** Physical TWR role(s) for hop/relevance fallback (by ARR RWY column). */
function twrRolesForArrivalFlight(flight: Flight): EssaPositionRole[] {
    const pt = resolveAircraftPoint(flight)
    const assigned = normalizeRwy(flight.arrRwy)
    if (assigned) {
        return ctrToRoles(twrFamilyForRunway(assigned, pt))
    }
    const activeArr = staticConfig.activeRunways?.["ESSA"]?.arr ?? []
    if (activeArr.length === 0) return [...ALL_TWR_POSITIONS]
    const roles = new Set<EssaPositionRole>()
    for (const a of activeArr) {
        for (const r of ctrToRoles(twrFamilyForRunway(a, pt))) roles.add(r)
    }
    return roles.size > 0 ? [...roles] : [...ALL_TWR_POSITIONS]
}

/**
 * True when our TWR login covers this arrival per RWY priority
 * (01L/19R: W→E→S, 08/26: E→S→W, 01R/19L: S→E→W).
 * Solo TWR → all ARR. When split, use login AOR columns even if the login
 * holds both physical EFS roles for bay visibility (TWR-S with E+W+S → TE only).
 */
function selectedTwrsCoverArrival(
    selectedRoles: EssaPositionRole[],
    flight: Flight | undefined
): boolean {
    const myTwrs = selectedRoles.filter((r) => ALL_TWR_POSITIONS.includes(r))
    if (myTwrs.length === 0) return false
    if (!flight) return true

    const myLogin = staticConfig.myCallsign
        ? parseEssaLoginId(staticConfig.myCallsign)
        : undefined
    const onlineCallsigns = staticConfig.onlineControllers
        ? [...staticConfig.onlineControllers.keys()]
        : []
    const onlineLogins = parseOnlineEssaLoginIds(onlineCallsigns)

    // Login AOR first — TWR-S may have both E+W roles for layout but only TE AOR.
    if (myLogin === "TWR-E" || myLogin === "TWR-W" || myLogin === "TWR-S") {
        const cols = aorColumnsForTwrLogin(myLogin, onlineLogins)
        if (cols.size >= 3) return true // solo / all columns
        const pt = resolveAircraftPoint(flight)
        const assigned = normalizeRwy(flight.arrRwy)
        if (assigned) {
            return cols.has(aorColumnForRunway(assigned, pt))
        }
        const activeArr = staticConfig.activeRunways?.["ESSA"]?.arr ?? []
        if (activeArr.length === 0) return true
        return activeArr.some((a) => cols.has(aorColumnForRunway(a, pt)))
    }

    // Top-down / no ESSA_*_TWR login with both physical roles → all ARR
    if (ALL_TWR_POSITIONS.every((r) => myTwrs.includes(r))) return true

    // Top-down TWR without ESSA_*_TWR login — fall back to physical role ∩ runway family
    const needed = twrRolesForArrivalFlight(flight)
    return needed.some((r) => myTwrs.includes(r))
}

// --- DEP tables ---

function depHopsFromParking(
    parking: EssaGndFamily,
    depRwy: string,
    callsign: string,
    pt: EseCoord | undefined
): EssaHop[] {
    const r = normalizeRwy(depRwy)
    const towardGndw = movingTowardSector(callsign, "ESSA GNDW")
    const towardGndn = movingTowardSector(callsign, "ESSA GNDN")
    const towardGndeTwyY = movingTowardSector(callsign, "ESSA GNDE TWY")

    if (parking === "GW") {
        if (r === "01R" || r === "19L") return [{ kind: "twr", family: twrFamilyForRunway(r, pt) }]
        if (r === "01L") return [{ kind: "gnd", family: "GW" }, { kind: "twr", family: twrFamilyForRunway(r, pt) }]
        if (r === "19R" || r === "08" || r === "26") {
            return [{ kind: "gnd", family: "GN" }, { kind: "twr", family: twrFamilyForRunway(r, pt) }]
        }
    }

    if (parking === "GN") {
        if (r === "19R" || r === "08" || r === "26") {
            return [{ kind: "twr", family: twrFamilyForRunway(r, pt) }]
        }
        if (r === "19L") {
            // Straight TWR unless CCW toward GNDW rather than GNDE TWY Y
            if (towardGndw && !towardGndeTwyY) {
                return [
                    { kind: "gnd", family: "GW" },
                    { kind: "gnd", family: "GE" },
                    { kind: "twr", family: twrFamilyForRunway(r, pt) },
                ]
            }
            return [{ kind: "twr", family: twrFamilyForRunway(r, pt) }]
        }
        if (r === "01R") {
            // Normal GE→TWR; if toward GND-W: GW→GE→TWR
            if (towardGndw) {
                return [
                    { kind: "gnd", family: "GW" },
                    { kind: "gnd", family: "GE" },
                    { kind: "twr", family: twrFamilyForRunway(r, pt) },
                ]
            }
            return [
                { kind: "gnd", family: "GE" },
                { kind: "twr", family: twrFamilyForRunway(r, pt) },
            ]
        }
    }

    if (parking === "GE") {
        if (r === "01R" || r === "19L") return [{ kind: "twr", family: twrFamilyForRunway(r, pt) }]
        if (r === "01L") {
            if (towardGndn && !towardGndw) {
                return [
                    { kind: "gnd", family: "GN" },
                    { kind: "gnd", family: "GW" },
                    { kind: "twr", family: twrFamilyForRunway(r, pt) },
                ]
            }
            return [
                { kind: "gnd", family: "GW" },
                { kind: "twr", family: twrFamilyForRunway(r, pt) },
            ]
        }
        if (r === "19R") {
            const via = towardGndn ? "GN" : "GW"
            return [
                { kind: "gnd", family: via },
                { kind: "twr", family: twrFamilyForRunway(r, pt) },
            ]
        }
        if (r === "08" || r === "26") {
            if (towardGndw) {
                return [
                    { kind: "gnd", family: "GW" },
                    { kind: "gnd", family: "GN" },
                    { kind: "twr", family: twrFamilyForRunway(r, pt) },
                ]
            }
            return [
                { kind: "gnd", family: "GN" },
                { kind: "twr", family: twrFamilyForRunway(r, pt) },
            ]
        }
    }

    return [{ kind: "twr", family: twrFamilyForRunway(r || "01R", pt) }]
}

function applyConfig6Dep(hops: EssaHop[]): EssaHop[] {
    if (!isConfig6()) return hops
    const lastGnd: EssaGndFamily = isSiOnline("AGE") ? "GE" : "GW"
    // Ensure last GND before TWR is GE (or GW)
    const out: EssaHop[] = []
    let sawTwr = false
    for (const h of hops) {
        if (h.kind === "twr") {
            if (!sawTwr) {
                out.push({ kind: "gnd", family: lastGnd })
                sawTwr = true
            }
            out.push(h)
        } else {
            out.push(h)
        }
    }
    if (!sawTwr) {
        out.push({ kind: "gnd", family: lastGnd })
        out.push({ kind: "twr", family: "TE" })
    }
    // Deduplicate consecutive identical gnd hops
    return dedupeHops(out)
}

function dedupeHops(hops: EssaHop[]): EssaHop[] {
    const out: EssaHop[] = []
    for (const h of hops) {
        const prev = out[out.length - 1]
        if (
            prev &&
            prev.kind === h.kind &&
            ((prev.kind === "gnd" && h.kind === "gnd" && prev.family === h.family) ||
                (prev.kind === "twr" && h.kind === "twr" && prev.family === h.family))
        ) {
            continue
        }
        out.push(h)
    }
    return out
}

// --- ARR tables ---

function arrHopsFromLanding(
    arrRwy: string,
    parking: EssaGndFamily,
    callsign: string,
    pt: EseCoord | undefined
): EssaHop[] {
    const r = normalizeRwy(arrRwy)
    const active = activeEssaRunways()
    const towardT2Gndw =
        movingTowardSector(callsign, "ESSA GNDE T2") || movingTowardSector(callsign, "ESSA GNDW")
    const towardGndeTwyW = movingTowardSector(callsign, "ESSA GNDE TWY W")
    const towardGndn = movingTowardSector(callsign, "ESSA GNDN")
    const towardGnde = movingTowardSector(callsign, "ESSA GNDE")
    const inGndn = pt ? insideSectorFamily(pt.lat, pt.lon, "GN", active) : false
    const inGndw = pt ? insideSectorFamily(pt.lat, pt.lon, "GW", active) : false
    const inGndw19r = pt ? insideNamedSector(pt.lat, pt.lon, "GNDW 19R", active) : false
    const skipGeGwGnDetour =
        inGndn && towardGndeTwyW && towardGnde && !towardT2Gndw

    // 19L vacates on the east side. TWR hands to GND E (121.980) even when
    // the stand is north; GND E passes them to GND N. Direct GN only once
    // the aircraft is already in the north and not detouring via the west.
    if (r === "19L") {
        if (parking === "GE") return [{ kind: "gnd", family: "GE" }]
        if (parking === "GN") {
            if (skipGeGwGnDetour) return [{ kind: "gnd", family: "GN" }]
            if (towardT2Gndw) {
                return [
                    { kind: "gnd", family: "GE" },
                    { kind: "gnd", family: "GW" },
                    { kind: "gnd", family: "GN" },
                ]
            }
            return [
                { kind: "gnd", family: "GE" },
                { kind: "gnd", family: "GN" },
            ]
        }
        if (parking === "GW") {
            if (inGndn && towardGndeTwyW && towardGndn) {
                return [
                    { kind: "gnd", family: "GN" },
                    { kind: "gnd", family: "GW" },
                ]
            }
            return [
                { kind: "gnd", family: "GE" },
                { kind: "gnd", family: "GW" },
            ]
        }
    }

    if (r === "01R") {
        if (parking === "GN") {
            if (!skipGeGwGnDetour && towardT2Gndw) {
                return [
                    { kind: "gnd", family: "GE" },
                    { kind: "gnd", family: "GW" },
                    { kind: "gnd", family: "GN" },
                ]
            }
            return [{ kind: "gnd", family: "GN" }]
        }
        if (parking === "GW") {
            if (towardGndeTwyW && towardGndn) {
                return [
                    { kind: "gnd", family: "GN" },
                    { kind: "gnd", family: "GW" },
                ]
            }
            return [
                { kind: "gnd", family: "GE" },
                { kind: "gnd", family: "GW" },
            ]
        }
        if (parking === "GE") return [{ kind: "gnd", family: "GE" }]
    }

    if (r === "08" || r === "26") {
        if (parking === "GN") return [{ kind: "gnd", family: "GN" }]
        if (parking === "GW") {
            if (towardGndeTwyW) {
                return [
                    { kind: "gnd", family: "GE" },
                    { kind: "gnd", family: "GN" },
                    { kind: "gnd", family: "GW" },
                ]
            }
            return [
                { kind: "gnd", family: "GN" },
                { kind: "gnd", family: "GW" },
            ]
        }
        if (parking === "GE") {
            if (movingTowardSector(callsign, "ESSA GNDW")) {
                return [
                    { kind: "gnd", family: "GN" },
                    { kind: "gnd", family: "GW" },
                    { kind: "gnd", family: "GE" },
                ]
            }
            return [
                { kind: "gnd", family: "GN" },
                { kind: "gnd", family: "GE" },
            ]
        }
    }

    if (r === "01L") {
        if (parking === "GN") return [{ kind: "gnd", family: "GN" }]
        if (parking === "GW") {
            if (inGndw && !inGndw19r) {
                return [{ kind: "gnd", family: "GW" }]
            }
            if (towardGndeTwyW) {
                return [
                    { kind: "gnd", family: "GN" },
                    { kind: "gnd", family: "GE" },
                    { kind: "gnd", family: "GW" },
                ]
            }
            return [
                { kind: "gnd", family: "GN" },
                { kind: "gnd", family: "GW" },
            ]
        }
        if (parking === "GE") {
            if (towardGndeTwyW || towardGnde) {
                return [
                    { kind: "gnd", family: "GN" },
                    { kind: "gnd", family: "GE" },
                ]
            }
            return [
                { kind: "gnd", family: "GN" },
                { kind: "gnd", family: "GW" },
                { kind: "gnd", family: "GE" },
            ]
        }
    }

    if (r === "19R") {
        if (parking === "GN") {
            if (towardGnde) {
                return [
                    { kind: "gnd", family: "GW" },
                    { kind: "gnd", family: "GN" },
                    { kind: "gnd", family: "GE" },
                ]
            }
            return [
                { kind: "gnd", family: "GW" },
                { kind: "gnd", family: "GN" },
            ]
        }
        if (parking === "GE") {
            const via = towardGndn ? "GN" : "GW"
            return [
                { kind: "gnd", family: via },
                { kind: "gnd", family: "GE" },
            ]
        }
        if (parking === "GW") {
            if (inGndn && !inGndw) return [{ kind: "gnd", family: "GN" }, { kind: "gnd", family: "GW" }]
            return [{ kind: "gnd", family: "GW" }]
        }
    }

    return [{ kind: "gnd", family: parking }]
}

function applyConfig6Arr(hops: EssaHop[], callsign: string, pt: EseCoord | undefined): EssaHop[] {
    if (!isConfig6()) return hops
    const active = activeEssaRunways()
    const inGndn = pt ? insideSectorFamily(pt.lat, pt.lon, "GN", active) : false
    const skip =
        inGndn &&
        movingTowardSector(callsign, "ESSA GNDE TWY W") &&
        movingTowardSector(callsign, "ESSA GNDE")
    if (skip) return hops
    // Prepend GN as first hop if not already starting with GN
    if (hops[0]?.kind === "gnd" && hops[0].family === "GN") return hops
    return dedupeHops([{ kind: "gnd", family: "GN" }, ...hops])
}

function myControllerRole(): ControllerRole | undefined {
    return staticConfig.myRole
}

function isCdPhase(flight: Flight, stripType: string): boolean {
    if (stripType !== "departure" && stripType !== "local") return false
    const gs = flight.groundstate ?? ""
    const taxiing = ["TAXI", "LINEUP", "DEPA", "PUSH", "STUP"].includes(gs)
    if (taxiing) return false
    if (flight.airborne) return false
    return true
}

/**
 * Resolve next SI / hop chain for an ESSA flight.
 */
export function resolveEssaNextSi(
    flight: Flight,
    strip: Pick<FlightStrip, "stripType" | "sectionId" | "transferPending">,
    options?: { rofFrom?: string }
): EssaNextSiResult {
    const empty: EssaNextSiResult = { hopChain: [], relevantRoles: [] }
    if (!isEssaRolesConfig(staticConfig) || !isEseAirspaceLoaded()) return empty

    // ROF override
    if (options?.rofFrom) {
        const si = getControllerPositionId(options.rofFrom) || getEsePositionByCallsign(options.rofFrom)?.si
        const freq = getFrequencyForCallsign(options.rofFrom)
        const roles = rolesFromCallsign(options.rofFrom)
        return {
            callsign: options.rofFrom,
            si,
            frequency: freq,
            displaySi: formatEssaDisplaySi(si) || si,
            hopChain: [],
            relevantRoles: roles,
        }
    }

    // Stand = parking destination; radar = where the aircraft is now (taxi sequence)
    const standPt = resolveStandPoint(flight)
    const aircraftPt = resolveAircraftPoint(flight)
    const pt = standPt ?? aircraftPt
    const parking = parkingGndFamily(flight)
    const myCs = staticConfig.myCallsign
    const role = myControllerRole()
    const essaRoles = staticConfig.essaRoles ?? []
    const coveringCd = role === "DEL" || essaRoles.includes("CD")
    const coveringGnd = role === "GND" || essaRoles.some((r) => r.startsWith("GND-"))
    const coveringTwr = role === "TWR" || essaRoles.some((r) => r.startsWith("TWR-"))
    const ageOnline = isSiOnline("AGE")

    let hops: EssaHop[] = []
    const relevant = new Set<EssaPositionRole>()

    // Current sector roles (prefer aircraft position while taxiing)
    const here = aircraftPt ?? standPt
    if (here) {
        const gnd = primaryGndFamilyAt(here.lat, here.lon, activeEssaRunways())
        if (gnd) relevant.add(familyToRole(gnd))
        const ctr = primaryCtrFamilyAt(here.lat, here.lon, activeEssaRunways())
        if (ctr) for (const r of ctrToRoles(ctr)) relevant.add(r)
    }
    if (parking) relevant.add(familyToRole(parking))

    const stripType = strip.stripType
    const depRwy = normalizeRwy(flight.depRwy)
    const arrRwy = normalizeRwy(flight.arrRwy)
    const cdPhase = isCdPhase(flight, stripType)
    const gndRoleForSkip: ControllerRole | undefined = coveringGnd ? "GND" : role

    // Missed approach / G/A → APP before arrival taxi hops (else GND/DEL wins)
    if (coveringTwr && flight.missedApproach) {
        const sector = resolveIdealAppDepSector(flight, true)
        hops = [{ kind: "app", sector }]
    } else if (coveringCd && cdPhase) {
        // Keep parking family (GE/GN/GW). Only AGW online still transfers to AGW
        // via OWNER, and AFV XC can show 121.980 / 121.930 instead of 121.705.
        const fam = cdIdealGndFamily(parking, ageOnline)
        hops = [{ kind: "gnd", family: fam }]
        relevant.add("CD")
        relevant.add(familyToRole(fam))
    } else if (
        (stripType === "departure" || stripType === "local") &&
        !flight.airborne &&
        !["ARR", "TXIN"].includes(flight.groundstate ?? "")
    ) {
        const park = parking ?? "GW"
        hops = depHopsFromParking(park, depRwy || "01R", flight.callsign, pt)
        hops = applyConfig6Dep(hops)
        hops = skipCurrentGnd(hops, park, gndRoleForSkip)
    } else if (stripType === "arrival" || stripType === "local") {
        const park = parking ?? "GN"
        const landed = arrRwy || depRwy || "01R"
        // Geo “toward / in sector” must use radar position, not stand (stand is the destination)
        hops = arrHopsFromLanding(landed, park, flight.callsign, aircraftPt ?? standPt)
        hops = applyConfig6Arr(hops, flight.callsign, aircraftPt ?? standPt)
        if (coveringGnd && !coveringTwr) {
            // Skip only *my* logged-in GND family — not where the aircraft is.
            // Geographic skip dropped GN once the a/c entered/stopped in GN → PARK instead of XFER.
            const myFam = myLoggedInGndFamily()
            if (myFam) hops = skipCurrentGnd(hops, myFam, "GND")
        }
        // Airborne ARR/local: TWR-relevant for the ARR runway's tower side only
        // (split TWR-E/W). Hop chain is GND taxi — without TWR roles, separate GND
        // online would hide INBOUND APP from TWR entirely.
        if (flight.airborne) {
            for (const r of twrRolesForArrivalFlight(flight)) relevant.add(r)
        }
    } else if (coveringTwr && flight.airborne && (stripType === "departure" || stripType === "local")) {
        const sector = resolveIdealAppDepSector(flight, false)
        hops = [{ kind: "app", sector }]
    }

    for (const h of hops) {
        for (const r of rolesFromHop(h)) relevant.add(r)
    }

    if (isCdPhase(flight, stripType)) relevant.add("CD")

    // Tracked by me → keep visible for my roles
    if (flight.controller === myCs) {
        for (const r of staticConfig.essaRoles ?? []) relevant.add(r)
    }

    let callsign: string | undefined
    let si: string | undefined
    let frequency: number | undefined

    const appHop = hops.find((h): h is Extract<EssaHop, { kind: "app" }> => h.kind === "app")
    if (appHop) {
        const resolved = resolveAppDepTransfer(appHop.sector ?? "DEP-W")
        if (resolved) {
            callsign = resolved.transferCallsign
            si = resolved.displaySi
            frequency = resolved.displayFrequency
        }
    } else {
        const hit = firstOnlineInChain(hops, myCs)
        if (hit) {
            callsign = hit.callsign
            // Keep transfer SI for handoff; display SI/freq may be ideal when XCed
            si = hit.displaySi
            frequency = hit.displayFrequency
            const hitFam = siToGndFamily(hit.si)
            if (hitFam) relevant.add(familyToRole(hitFam))
            for (const r of rolesFromHop(hit.hop)) relevant.add(r)
        }
    }

    return {
        callsign,
        si,
        frequency,
        displaySi: formatEssaDisplaySi(si) || si,
        hopChain: hops,
        relevantRoles: [...relevant],
    }
}

function flightIsSlowForApp(flight: Flight): boolean {
    if (!isEssaAutoSlowHours()) return false
    const wake = flight.wakeTurbulence ?? ""
    return isSlowAircraft(wake, flight.aircraftType ?? "", flight.engineType)
}

function resolveIdealAppDepSector(flight: Flight, missedApproach: boolean): AppDepSector {
    const configId = essaConfigId() ?? "1"
    return resolveAppDepNextSector({
        configId,
        route: flight.route,
        slow: flightIsSlowForApp(flight),
        missedApproach,
        arrRwy: flight.arrRwy,
        assignedHeading: flight.ahdg && flight.ahdg > 0 ? flight.ahdg : undefined,
    })
}

/**
 * Preferred ESSA APP/DEP sector for an ESSA-origin departure/local (Appendix A).
 * Used for SID black-box (DEP-E / ARR-E) and TWR→APP handoff cues.
 */
export function resolveFlightAppDepNextSector(flight: Flight): AppDepSector | undefined {
    const origin = (flight.origin || "").toUpperCase()
    if (origin !== "ESSA") return undefined
    return resolveIdealAppDepSector(flight, false)
}

/** Manual settings override: always show ideal APP/DEP freq (even without AFV XC). */
let forceIdealAppDepFrequency = false

export function setForceIdealAppDepFrequency(enabled: boolean): void {
    forceIdealAppDepFrequency = enabled
}

export function getForceIdealAppDepFrequency(): boolean {
    return forceIdealAppDepFrequency
}

/**
 * Walk ESE OWNER chain for ideal sector; prefer first online ESSA APP/DEP,
 * then fall through to later owners (e.g. CTR S9/AA) when APP/DEP are offline.
 * Display ideal SI/freq when covering controller monitors ideal freq on AFV (XC),
 * or when settings force ideal frequency.
 */
export function resolveAppDepTransfer(
    idealSector: AppDepSector,
    options?: { forceIdealFrequency?: boolean }
): {
    transferCallsign: string
    transferSi: string
    displaySi: string
    displayFrequency: number
    idealSi: string
    xc: boolean
} | undefined {
    const idealSi = appDepSectorToSi(idealSector)
    const chain = getAppDepOwnerChain(idealSi)

    let transfer: { callsign: string; frequency: number; si: string } | undefined
    // Prefer APP/DEP SIs so a covering APP still wins over CTR further down the chain
    for (const ownerSi of chain) {
        if (!APP_DEP_OWNER_SIS.has(ownerSi.toUpperCase())) continue
        const hit = isOnlineSi(ownerSi)
        if (hit) {
            transfer = hit
            break
        }
    }
    // No APP/DEP online — CTR (or other) owner later in the ESE chain covers
    if (!transfer) {
        for (const ownerSi of chain) {
            if (APP_DEP_OWNER_SIS.has(ownerSi.toUpperCase())) continue
            const hit = isOnlineSi(ownerSi)
            if (hit) {
                transfer = hit
                break
            }
        }
    }
    if (!transfer) return undefined

    const xc = applyIdealXcDisplay(idealSi, transfer, options)
    return {
        transferCallsign: transfer.callsign,
        transferSi: transfer.si,
        displaySi: xc.displaySi,
        displayFrequency: xc.displayFrequency,
        idealSi,
        xc: xc.xc,
    }
}

const APP_DEP_OWNER_SIS = new Set(["DW", "DE", "W", "E", "A", "AW"])

/** D-trans strip segment ids (catalog + drop targets). */
export type DtransTargetId =
    | "GND-E"
    | "GND-W"
    | "GND-N"
    | "TWR-E"
    | "TWR-W"
    | "CD"
    | "ARR-W"
    | "DEP-W"
    | "DEP-E"
    | "ARR-E"

const DTRANS_TARGET_IDS = new Set<string>([
    "GND-E",
    "GND-W",
    "GND-N",
    "TWR-E",
    "TWR-W",
    "CD",
    "ARR-W",
    "DEP-W",
    "DEP-E",
    "ARR-E",
])

export function isDtransTargetId(id: string): id is DtransTargetId {
    return DTRANS_TARGET_IDS.has(id.toUpperCase())
}

export type DtransTargetResolve = {
    id: DtransTargetId
    /** Covering login callsign when online */
    callsign: string | null
    /** Display frequency MHz (AFV XC / ideal SI when applicable) */
    frequency: string | null
    online: boolean
    xc: boolean
    displaySi: string | null
}

function formatMhz(freq: number | undefined): string | null {
    if (freq == null || !(freq > 0) || !(freq < 199)) return null
    return freq.toFixed(3)
}

/**
 * Resolve who covers a D-trans role/sector and which frequency to show
 * (same AFV XC / force-ideal rules as XFER and MAP/DEP info strips).
 */
export function resolveDtransTarget(rawId: string): DtransTargetResolve | undefined {
    const id = rawId.trim().toUpperCase()
    if (!isDtransTargetId(id)) return undefined

    // APP/DEP sectors
    if (id === "ARR-W" || id === "DEP-W" || id === "DEP-E" || id === "ARR-E") {
        const sector = id as AppDepSector
        const idealSi = appDepSectorToSi(sector)
        const transfer = resolveAppDepTransfer(sector)
        if (transfer && transfer.displayFrequency > 0) {
            return {
                id,
                callsign: transfer.transferCallsign,
                frequency: formatMhz(transfer.displayFrequency),
                online: true,
                xc: transfer.xc,
                displaySi: transfer.displaySi,
            }
        }
        const pub = getEsePositionBySi(idealSi)?.frequency
        return {
            id,
            callsign: null,
            frequency: formatMhz(pub),
            online: false,
            xc: false,
            displaySi: idealSi,
        }
    }

    // CD
    if (id === "CD") {
        const idealSi = "SAD"
        const online = isOnlineSi(idealSi)
        if (online) {
            const xc = applyIdealXcDisplay(idealSi, online)
            return {
                id,
                callsign: online.callsign,
                frequency: formatMhz(xc.displayFrequency),
                online: true,
                xc: xc.xc,
                displaySi: xc.displaySi,
            }
        }
        return {
            id,
            callsign: null,
            frequency: formatMhz(getEsePositionBySi(idealSi)?.frequency),
            online: false,
            xc: false,
            displaySi: idealSi,
        }
    }

    // GND / TWR — walk ESE OWNER chain for that family
    let family: EssaGndFamily | EssaCtrFamily
    let kind: "gnd" | "twr"
    if (id === "GND-E") {
        family = "GE"
        kind = "gnd"
    } else if (id === "GND-W") {
        family = "GW"
        kind = "gnd"
    } else if (id === "GND-N") {
        family = "GN"
        kind = "gnd"
    } else if (id === "TWR-E") {
        family = "TE"
        kind = "twr"
    } else {
        family = "TW"
        kind = "twr"
    }

    const idealSi =
        kind === "gnd"
            ? gndFamilyPrimarySi(family as EssaGndFamily)
            : twFamilyPrimarySi(family as EssaCtrFamily)
    const sis =
        kind === "gnd"
            ? getGndOwnerChain(family as EssaGndFamily)
            : getTwrOwnerChain(family as EssaCtrFamily)

    for (const si of sis) {
        const online = isOnlineSi(si)
        if (!online) continue
        const xc = applyIdealXcDisplay(idealSi, online)
        return {
            id,
            callsign: online.callsign,
            frequency: formatMhz(xc.displayFrequency),
            online: true,
            xc: xc.xc,
            displaySi: xc.displaySi,
        }
    }

    return {
        id,
        callsign: null,
        frequency: formatMhz(getEsePositionBySi(idealSi)?.frequency),
        online: false,
        xc: false,
        displaySi: idealSi,
    }
}

function skipCurrentGnd(hops: EssaHop[], current: EssaGndFamily, role: ControllerRole | undefined): EssaHop[] {
    if (role !== "GND") return hops
    // Drop leading hops that are our current family until we find a different next
    let i = 0
    while (i < hops.length) {
        const h = hops[i]!
        if (h.kind === "gnd" && h.family === current) {
            i++
            continue
        }
        break
    }
    if (i === 0) return hops
    return hops.slice(i)
}

function findOnlineByRole(role: ControllerRole): string | undefined {
    if (!staticConfig.onlineControllers) return undefined
    for (const c of staticConfig.onlineControllers.values()) {
        if (c.role === role) return c.callsign
    }
    return undefined
}

function rolesFromCallsign(callsign: string): EssaPositionRole[] {
    const id = parseEssaLoginId(callsign)
    if (!id) return []
    if (id === "TWR-S") return [...ALL_TWR_POSITIONS]
    if (id === "CD" || id.startsWith("GND-") || id.startsWith("TWR-")) return [id]
    return []
}

/** True when aircraft radar position is inside a GND family we currently cover. */
export function isInSelectedGndAor(
    flight: Flight | undefined,
    selectedRoles: EssaPositionRole[]
): boolean {
    if (!flight) return false
    const pt = resolveAircraftPoint(flight)
    if (!pt) return false
    const fam = primaryGndFamilyAt(pt.lat, pt.lon, activeEssaRunways())
    if (!fam) return false
    return selectedRoles.includes(familyToRole(fam))
}

function movingTowardGndFamily(callsign: string, family: EssaGndFamily): boolean {
    if (family === "GN") return movingTowardSector(callsign, "ESSA GNDN")
    if (family === "GE") {
        return (
            movingTowardSector(callsign, "ESSA GNDE") ||
            movingTowardSector(callsign, "ESSA GNDE TWY") ||
            movingTowardSector(callsign, "ESSA GNDE TWY W") ||
            movingTowardSector(callsign, "ESSA GNDE T2")
        )
    }
    if (family === "GW") return movingTowardSector(callsign, "ESSA GNDW")
    return false
}

/**
 * GND→GND XFER: only when aircraft has left our AoR, or is moving toward the next GND.
 * Sitting still inside our AoR → no XFER (caller falls back to TXI/PARK by groundstate).
 */
export function shouldOfferGndSequenceXfer(
    flight: Flight,
    selectedRoles: EssaPositionRole[],
    next: EssaNextSiResult
): boolean {
    if (!next.callsign) return false
    if (!isInSelectedGndAor(flight, selectedRoles)) return true

    let nextFam: EssaGndFamily | undefined
    for (const h of next.hopChain) {
        if (h.kind === "gnd" && !selectedRoles.includes(familyToRole(h.family))) {
            nextFam = h.family
            break
        }
    }
    if (!nextFam && next.si) nextFam = siToGndFamily(next.si)
    if (!nextFam) return false
    return movingTowardGndFamily(flight.callsign, nextFam)
}

/**
 * Whether a strip should be shown for the selected ESSA roles.
 */
export function isEssaStripVisibleForRoles(
    flight: Flight | undefined,
    strip: FlightStrip,
    selectedRoles: EssaPositionRole[],
    next: EssaNextSiResult | undefined
): boolean {
    if (!isEssaRolesConfig(staticConfig)) return true
    // Local-only strips — always visible when created.
    // VFR CRS (cross) is manual-only: crossings are not auto-eligible, and a
    // flight outside the selected GND/TWR sectors (e.g. ESOW→ESSN) has no
    // overlapping next-SI role, so the filter would hide the strip the
    // controller just added.
    if (
        strip.stripType === "note" ||
        strip.stripType === "vehicle" ||
        strip.stripType === "cross"
    ) {
        return true
    }
    if (selectedRoles.length === 0) return true

    // Overrides
    if (strip.transferPending === "in") return true
    if (strip.rofRequestCallsign && flight?.controller === staticConfig.myCallsign) return true
    if (strip.isAssumed) return true
    // After handoff (e.g. GW→GN): keep strip until aircraft leaves our geographic AoR
    if (isInSelectedGndAor(flight, selectedRoles)) return true

    // GND-only: show tower-bound arrivals under INBOUND TWR (CTR ARR / RWY / inbound
    // after APP→TWR transfer). Do not require GND in the next-SI chain.
    if (isEssaGndOnly(selectedRoles)) {
        if (strip.sectionId === "inbound" || isGndOnlyInboundSection(strip.sectionId)) {
            if (
                strip.stripType === "departure" &&
                (strip.sectionId === "dep_runway" || isEssaDynamicRunwaySectionId(strip.sectionId))
            ) {
                // Dep runway: leave to next-SI filter below
            } else {
                return true
            }
        }
    }

    // TWR-only: taxi-out from ground sits in INBOUND GND-* above TAXIWAY DEP.
    // Show it even when the next-SI chain is still a GND sector.
    if (isEssaTwrOnly(selectedRoles) && strip.sectionId === "inbound_gnd") {
        return true
    }

    // TWR: arrival INBOUND APP / CTR ARR / RWY is independent of GND next-SI roles,
    // but when split TWR only show ARR RWYs covered by our physical role(s).
    if (selectedRoles.some((r) => ALL_TWR_POSITIONS.includes(r))) {
        if (
            (strip.stripType === "arrival" || strip.stripType === "local") &&
            (strip.sectionId === "inbound" ||
                strip.sectionId === "ctr_arr" ||
                strip.sectionId === "arr_runway" ||
                strip.sectionId === "dep_runway" ||
                isEssaDynamicRunwaySectionId(strip.sectionId))
        ) {
            return selectedTwrsCoverArrival(selectedRoles, flight)
        }
    }

    const hasCd = selectedRoles.includes("CD")
    const hasGnd = selectedRoles.some((r) => ALL_GND_POSITIONS.includes(r))

    // TSAT: GND (without CD) only sees strips where we are next in the CD→GND sequence
    if (strip.sectionId === "cleared" && hasGnd && !hasCd) {
        if (!flight) return false
        const park = parkingGndFamily(flight)
        const fam = delTargetGndFamily(park, isSiOnline("AGE"))
        return isNextOnlineForGndFamily(fam, staticConfig.myCallsign)
    }

    const relevant = new Set(next?.relevantRoles ?? [])
    // Also include next hop role from resolved callsign
    if (next?.callsign) {
        for (const r of rolesFromCallsign(next.callsign)) relevant.add(r)
    }
    if (isCdPhase(flight ?? { callsign: strip.callsign }, strip.stripType)) {
        relevant.add("CD")
    }

    return selectedRoles.some((r) => relevant.has(r))
}

/** Convenience for server resolveXferTarget */
export function resolveEssaXferCallsign(
    flight: Flight,
    strip: FlightStrip,
    rofFrom?: string
): string | undefined {
    const result = resolveEssaNextSi(flight, strip, { rofFrom })
    return result.callsign
}

/** Export helpers for unit tests */
export const __test = {
    depHopsFromParking,
    arrHopsFromLanding,
    applyConfig6Dep,
    applyConfig6Arr,
    delTargetGndFamily,
    cdIdealGndFamily,
    twrFamilyForRunway,
    dedupeHops,
    normalizeRwy,
    firstOnlineInChain,
    aorRowForOnlineTwrs,
    aorColumnsForTwrLogin,
    selectedTwrsCoverArrival,
}

import type { FlightStrip, StripType, WakeCategory, FlightRules, Section, PendingPrintFlightInfo, StripPrintMode } from "@vatefs/common"
import {
    lookupVatsimPilot,
    normalizeVatsimDeptime,
    parseVatsimAltitude,
    type VatsimPilot,
} from "./vatsim-flights.js"
import type {
    Flight,
    PluginMessage,
    FlightPlanDataUpdateMessage,
    ControllerAssignedDataUpdateMessage,
    RadarTargetPositionUpdateMessage,
    OwnershipUpdateMessage,
    FlightStripPushedMessage,
    GroundState
} from "./types.js"
import { flightHasRequiredData } from "./types.js"
import {
    staticConfig,
    determineSectionForFlight,
    determineActionForFlight,
    setMyCallsign,
    shouldDeleteFlight,
    getFieldElevationForFlight,
    getControllerFrequency,
    getControllerPositionId,
    getFrequencyForCallsign,
    getControllerCallsign,
    getCallsignForPositionId,
    parseControllerRole,
} from "./config.js"
import {
    formatEsggAppSi,
    resolveEsggDepApp,
    resolveEsggMisapApp,
} from "./esgg-app.js"
import { exclusiveCustomSiAirportFromConfig, formatCustomDisplaySi } from "./display-si.js"
import type { EfsStaticConfig } from "./config.js"
import { isEssaRolesConfig, ALL_GND_POSITIONS } from "./essa-roles.js"
import {
    resolveEssaNextSi,
    resolveFlightAppDepNextSector,
    recordFlightMovement,
    isInSelectedGndAor,
    shouldOfferGndSequenceXfer,
} from "./essa-next-si.js"
import { getAirportCoords } from "./airport-data.js"
import { isWithinRangeOfAnyAirport, isWithinStripVisibilityRange, findNearestAirport } from "./geo-utils.js"
import { findStandForPosition, hasStandData } from "./stand-data.js"
import { isOnAnyRunway } from "./runway-detection.js"
import { isWithinCtr } from "./ctr-data.js"
import { isSlowAircraft, isEssaAutoSlowHours } from "./slow-aircraft.js"
import { remapPushActionForStand } from "./essa-push-stands.js"
import { isDepBayFlowStickyInvalid as depBayFlowStickyInvalid } from "./dep-bay-sticky.js"
import {
    extractTmaExitPoint,
    FAA_TO_ICAO,
    formatCflMenuLabel,
    formatFaaEquipDisplay,
    essaPhysicalPairForRunway,
    hasForcedSidInRoute,
    hasSlowRemark,
    isIfrSidEligible,
    isRunwayOrderSectionId,
    isTrackSidName,
    isVectorSidName,
    resolveDisplayFlightRules,
    isLopFprDepAirport,
    fprDepDisplayFix,
    parsePobFromRemarks,
} from "@vatefs/common"
import { getTransitionAltitudeFt } from "./topsky-airspace.js"
import { getRtfCallsign } from "./icao-airlines.js"
import { getIcaoAirportName } from "./icao-airports.js"
import { hasSidInEse, getSidInfo, getSidsForRunway, pickEseSidForRouteExit } from "./sid-data.js"
import {
    parseCombinedScratch,
    buildCombinedScratch,
    isProtocolScratch,
    isHandoverAssistantScratch,
    shouldClearHandoverScratch,
    standFromGrpScratch,
} from "./scratchpad.js"
import { resolveIncomingGroundstate } from "./groundstate.js"
import {
    getRelevantActiveAirports,
    isMultiAirportConfig,
    parseStripAirportId,
    stripIdForAirport,
    isAnonymousSpecialStripId,
    newAnonymousSpecialStripId,
    withAirportScope,
    logicalSectionId,
    prefixedSectionId,
    resolveBayForAirport,
    IDLE_BAY_ID
} from "./multi-airport.js"
import moment from "moment"
import { eobtInsertIndexAmong, utcNowMinutes } from "./hhmm-utils.js"
import { isOfflineVatsimRealm } from "./vatefs-sync.js"

/**
 * Normalize controller-assigned SSR from EuroScope/TopSky.
 * - valid octal → code
 * - empty / 0000 / ---- → "" (clear)
 * - non-octal junk (e.g. "9875") → undefined (ignore, do not display)
 */
export function normalizeAssignedSquawk(raw: string | undefined | null): string | undefined {
    if (raw == null) return undefined
    const s = String(raw).trim()
    if (!s || s === "0000" || s === "----") return ""
    if (!/^[0-7]{4}$/.test(s)) {
        console.log(`[SQUAWK] ignoring invalid assigned code "${s}"`)
        return undefined
    }
    return s
}

/** True when EFS already holds a real assigned ASSR (not empty / 0000 / junk). */
export function hasValidAssignedSquawk(raw: string | undefined | null): boolean {
    const next = normalizeAssignedSquawk(raw)
    return typeof next === "string" && next.length === 4
}

/** FPL identity used to detect same-CS turnaround after delete_parked. */
export function flightPlanFingerprint(
    flight: Pick<Flight, "origin" | "destination" | "eobt" | "route">,
): string {
    return [
        (flight.origin || "").toUpperCase(),
        (flight.destination || "").toUpperCase(),
        (flight.eobt || "").trim(),
        (flight.route || "").trim().toUpperCase(),
    ].join("|")
}

export function isParkTrashDeleteRule(ruleId: string | undefined): boolean {
    return ruleId === "delete_parked" || ruleId === "delete_parked_local"
}

/**
 * Park-trash turnaround: a new outbound FPL (same callsign, origin at our airport)
 * should start a fresh departure cycle (CD ALL / pending_dep).
 * Groundstate-only changes (e.g. TAXI) do not revive.
 */
export function shouldAutoReviveParkTrash(
    flight: Pick<
        Flight,
        | "deleted"
        | "manuallyDeleted"
        | "lastDeleteRule"
        | "parkTrashFplKey"
        | "origin"
        | "destination"
        | "eobt"
        | "route"
    >,
    myAirports: readonly string[],
): boolean {
    if (!flight.deleted || flight.manuallyDeleted) return false
    if (!isParkTrashDeleteRule(flight.lastDeleteRule)) return false
    const origin = (flight.origin || "").toUpperCase()
    if (!origin || !myAirports.some((a) => a.toUpperCase() === origin)) return false
    const key = flightPlanFingerprint(flight)
    if (!flight.parkTrashFplKey) return false
    return key !== flight.parkTrashFplKey
}

/**
 * Reset arrival/park leftovers so rules place a fresh uncleared departure
 * (pending_dep / CD ALL / KLARERING — any airport layout).
 */
export function beginNewDepartureCycleAfterPark(flight: Flight): void {
    flight.deleted = false
    flight.deletedByBeyondRange = false
    flight.lastDeleteRule = undefined
    flight.noSectionFound = false
    flight.parkTrashFplKey = undefined
    flight.suppressParkDelete = true
    flight.clearance = false
    flight.clearedToLand = false
    flight.airborne = false
    flight.atd = undefined
    flight.ata = undefined
    flight.missedApproach = false
    flight.efsGoAround = false
    const gs = (flight.groundstate || "").toUpperCase()
    // Arrival/park leftovers block pending_dep; keep ONFREQ/STUP/PUSH/TAXI for live dep flow
    if (gs === "PARK" || gs === "ARR" || gs === "TXIN" || gs === "DEPA") {
        flight.groundstate = ""
        flight.groundstateClearedUntil = Date.now() + 15_000
    }
}

/**
 * High-speed vacate (GS still above the airborne cutoff) after the aircraft has
 * been on the runway. Short final is also off the polygon and already groundstate
 * ARR — that is not a vacate until a radar hit has been inside the runway.
 */
export function hasVacatedRunwayAfterLanding(opts: {
    positionKnown: boolean
    onRunway: boolean
    touchedRunway: boolean
    groundstate: string | undefined
    groundSpeed: number | undefined
}): boolean {
    if (!opts.positionKnown || opts.onRunway || !opts.touchedRunway) return false
    const gsState = (opts.groundstate ?? "").toUpperCase()
    const gsKnown = opts.groundSpeed !== undefined && Number.isFinite(opts.groundSpeed)
    return (
        gsState === "ARR" ||
        gsState === "TXIN" ||
        (gsKnown && (opts.groundSpeed as number) <= 80)
    )
}

/**
 * True when FPL flipped arrival → outbound dep/local at our airport (same-CS turnaround).
 * Airport-agnostic — uses myAirports, not ESSA-only.
 */
export function isArrivalToOutboundTurnaroundFpl(
    prev: Pick<Flight, "origin" | "destination">,
    next: Pick<Flight, "origin" | "destination">,
    myAirports: readonly string[],
): boolean {
    const ours = (icao: string | undefined) =>
        !!icao && myAirports.some((a) => a.toUpperCase() === icao.toUpperCase())
    const wasArrival = ours(prev.destination) && !ours(prev.origin)
    const nowOutbound = ours(next.origin) // departure or local
    return wasArrival && nowOutbound
}

/**
 * Result of processing a plugin message
 */
/** Dev spoof payload — `""` / null clears; omit leaves unchanged. */
export interface DevSpoofFields {
    clearAll?: boolean
    tobt?: string | null
    tsat?: string | null
    ttot?: string | null
    ctot?: string | null
    ctotReason?: string | null
    asrt?: string | null
    tsac?: string | null
    ctoc?: string | null
    tobtSetBy?: 'P' | 'A' | '' | null
    cdmSts?: string | null
}

export interface DevSpoofSnapshot {
    callsign: string
    origin?: string
    destination?: string
    flightRules?: string
    groundstate?: string
    tobt?: string
    tsat?: string
    ttot?: string
    ctot?: string
    ctotReason?: string
    ctotCancelled?: boolean
    cdmSts?: string
    asrt?: string
    tsac?: string
    ctoc?: string
    tobtSetBy?: string
    localCdmAt?: number
}

export interface ProcessMessageResult {
    /** The updated or created flight (if any) */
    flight?: Flight

    /** Strip to create or update (if flight has required data) */
    strip?: FlightStrip

    /** Multiple strips to update (CDM local poll / multi-airport mode) */
    strips?: FlightStrip[]

    /** Strip ID to delete (if flight disconnected) */
    deleteStripId?: string

    /** Multiple strip IDs to delete (multi-airport mode) */
    deletedStripIds?: string[]

    /** Whether the strip section changed (needs move) */
    sectionChanged?: boolean

    /** Previous section info if section changed */
    previousSection?: { bayId: string; sectionId: string }

    /** Whether the strip should be soft-deleted (hidden from user) */
    softDeleted?: boolean

    /** Whether the strip was un-deleted (restored from soft-delete) */
    restored?: boolean

    /** Callsigns/strip IDs of strips whose positions were shifted (for add-from-top) */
    shiftedCallsigns?: string[]

    /**
     * Same bay/section but appearance position must change (e.g. APP transfer
     * sticky-top bump). Without this, store pins the old same-slot position.
     */
    allowPositionChange?: boolean

    /** Scratchpad value to push to EuroScope (e.g. auto-SLOW remark) */
    setScratchValue?: string

    /** Clear VCH hold-short (annotation 4) in EuroScope */
    clearHs?: boolean

    /** Clear EuroScope scratchpad for this callsign (e.g. after consuming TopSky ROF) */
    clearScratchpadCallsign?: string

    /** Delay before clearScratchpadCallsign (ms); lets TopSky / peers read outbound ROF first */
    clearScratchpadDelayMs?: number

    /**
     * Extra callsigns to re-evaluate after this message (e.g. EFS ROF written on a
     * scratch vehicle must refresh the TARGET strip).
     */
    refreshCallsigns?: string[]

    /** Transfer sound to play (handoff request / accept / refuse) */
    transferSound?: 'request' | 'accept' | 'refuse'

    /**
     * Handover Assistant: auto-ASSUME these callsigns (inbound HA transfers).
     * May include the primary flight plus any deferred when EFSHO arrived after handoff.
     */
    autoAssumeCallsigns?: string[]

    /** Clear EFS soft G/A annotation (ann 5) in EuroScope */
    unsetEfsGoAround?: boolean

    /** Clear VCH CTL in EuroScope */
    unsetClearedToLand?: boolean

    /**
     * Clean reprint after APP assumed G/A: frontend clears scribbles + print anim;
     * strip deletes in the same result should not fly to trash.
     */
    cleanReprint?: boolean

    /**
     * Print / FSP re-print of an already-present strip: trash old bay strip and
     * place a fresh one (no paper flags / sticky placement).
     */
    freshReprint?: boolean

    /** Per-strip update details in multi-airport mode */
    multiUpdates?: Array<{
        strip?: FlightStrip
        deleteStripId?: string
        sectionChanged?: boolean
        previousSection?: { bayId: string; sectionId: string }
        softDeleted?: boolean
        restored?: boolean
        shiftedCallsigns?: string[]
        isNew?: boolean
        allowPositionChange?: boolean
    }>
}

/**
 * Detect transfer sound events from controller/handoff transitions.
 */
function detectTransferSound(
    prevController: string | undefined,
    prevHandoff: string | undefined,
    nextController: string | undefined,
    nextHandoff: string | undefined,
    myCallsign: string | undefined
): 'request' | 'accept' | 'refuse' | undefined {
    if (!myCallsign) return undefined

    const prevCtrl = prevController || ''
    const nextCtrl = nextController || ''
    const prevHo = prevHandoff || ''
    const nextHo = nextHandoff || ''

    // Inbound handoff request to me
    if (nextHo === myCallsign && prevHo !== myCallsign) {
        return 'request'
    }

    const hadOutbound = prevCtrl === myCallsign && prevHo !== '' && prevHo !== myCallsign
    if (!hadOutbound) return undefined

    // Other controller assumed our outbound transfer (controller may briefly be empty)
    if (nextCtrl !== myCallsign) {
        return 'accept'
    }

    // Outbound cancelled / refused while we still track
    if (nextHo === '') {
        return 'refuse'
    }

    return undefined
}

/**
 * ICAO FPL speed/level group (Doc 4444), e.g. N0450F350, N0450A050, M078F350, K0800S1130.
 * Not a navigational fix — must not appear as the strip "SID"/first-point display.
 */
function isIcaoSpeedLevelGroup(token: string): boolean {
    return /^[NKM]\d{3,4}[FASM]\d{3,4}$/i.test(token)
}

/**
 * Filed TAS from ICAO speed/level group in route, e.g. N0450F350 → N0450.
 * Also matches mid-route forms like MAG/N0446F390.
 */
function extractFiledTasFromRoute(route: string | undefined): string | undefined {
    if (!route) return undefined
    const m = route.toUpperCase().match(/(?:^|[\s/])([NKM]\d{3,4})[FASM]\d{3,4}\b/)
    return m?.[1]
}

/** Format EuroScope GetTrueAirspeed (knots) as N0430 */
function formatTasKnots(knots: number | undefined): string | undefined {
    if (knots === undefined || !Number.isFinite(knots) || knots <= 0 || knots >= 1000) {
        return undefined
    }
    return `N${String(Math.round(knots)).padStart(4, "0")}`
}

/** Normalize VATSIM cruise_tas ("448", "N448", "N0448") → N0448 / M078 */
function normalizeCruiseTas(raw: string | undefined): string | undefined {
    if (!raw) return undefined
    const s = String(raw).trim().toUpperCase()
    if (!s) return undefined
    if (/^[NKM]\d{3,4}$/.test(s)) {
        const letter = s[0]!
        const digits = s.slice(1).padStart(letter === "M" ? 3 : 4, "0")
        return `${letter}${digits}`
    }
    if (/^\d{2,4}$/.test(s)) {
        return `N${s.padStart(4, "0")}`
    }
    // Full speed/level group
    if (isIcaoSpeedLevelGroup(s)) {
        return extractFiledTasFromRoute(s)
    }
    return undefined
}

/**
 * First significant FPL route fix for display when no ESE SID applies.
 * Skips DCT, airport/runway tokens (e.g. ESGJ/01), and initial speed/level groups
 * (e.g. N0450F100); returns the next fix (RESNA).
 */
function firstSignificantRouteFix(route: string): string | undefined {
    for (const raw of route.split(/\s+/)) {
        if (!raw) continue
        const upper = raw.toUpperCase()
        if (upper === "DCT") continue
        // ICAO/rwy or SID/rwy style — skip airport/rwy; keep special SIDs handled elsewhere
        const slashIdx = upper.indexOf("/")
        const token = slashIdx >= 0 ? upper.substring(0, slashIdx) : upper
        if (!token) continue
        // Pure runway-like (digits optional L/R/C)
        if (/^\d{1,2}[LRC]?$/i.test(token)) continue
        // Airport/rwy prefix (4-letter ICAO)
        if (slashIdx >= 0 && /^[A-Z]{4}$/.test(token)) continue
        // Initial cruise speed/level (often first token after ADEP/rwy)
        if (isIcaoSpeedLevelGroup(token)) continue
        return token
    }
    return undefined
}

/**
 * Departure runway for strip display:
 * 1. ES/FPL depRwy
 * 2. /rwy suffix on the first route term (e.g. ESSA/19R or TOVRI1A/19R)
 * 3. Active ES departure runway for the origin (when FPL has none selected)
 */
function extractDisplayDepRunway(
    flight: Flight,
    activeDepRunways?: string[]
): string | undefined {
    if (flight.depRwy) return flight.depRwy
    if (flight.route) {
        const firstTerm = flight.route.split(/\s+/)[0]!
        const slashIdx = firstTerm.indexOf("/")
        if (slashIdx >= 0) {
            const rwy = firstTerm.substring(slashIdx + 1).toUpperCase()
            if (/^\d{1,2}[LRC]?$/.test(rwy)) return rwy
        }
    }
    if (activeDepRunways?.length) return activeDepRunways[0]
    return undefined
}

/** True when both names are SLOW track SIDs ending with the same exit fix. */
function sameTrackSidExit(a: string, b: string): boolean {
    if (!isTrackSidName(a) || !isTrackSidName(b)) return false
    const sep = /[·•*]/
    const exitA = a.toUpperCase().split(sep).filter(Boolean).pop()
    const exitB = b.toUpperCase().split(sep).filter(Boolean).pop()
    return !!exitA && exitA === exitB
}

/** True when both are radar-vector SIDs (ARS6E·KOGAV) with the same exit. */
function sameVectorSidExit(a: string, b: string): boolean {
    if (!isVectorSidName(a) || !isVectorSidName(b)) return false
    const sep = /[·•*]/
    const exitA = a.toUpperCase().split(sep).filter(Boolean).pop()
    const exitB = b.toUpperCase().split(sep).filter(Boolean).pop()
    return !!exitA && exitA === exitB
}

function normSidKey(s: string): string {
    return s.toUpperCase().replace(/\s+/g, "").replace(/[•*]/g, "·")
}

/** SID/rwy prefix when FPL forces a SID (not bare ADEP/rwy). */
function routeForcedSidPrefix(route: string | undefined): string | undefined {
    if (!route || !hasForcedSidInRoute(route)) return undefined
    const first = route.trim().split(/\s+/)[0] || ""
    const slash = first.indexOf("/")
    if (slash <= 0) return undefined
    return first.slice(0, slash)
}

function sidMatchesRoutePrefix(sid: string, prefix: string): boolean {
    if (normSidKey(sid) === normSidKey(prefix)) return true
    return sameTrackSidExit(sid, prefix) || sameVectorSidExit(sid, prefix)
}

/**
 * Extract display SID from a flight.
 * - Controller SID override only while FPL still forces that SID (or optimistic pre-amend)
 * - Forced SID/rwy in route wins
 * - Track/SLOW GetSid is never sticky once FPL no longer forces a SID (ESE preferred fills strip)
 * - Else first significant FPL fix / ESE-matched GetSid for RNAV
 */
/** Runway for ESE SID pick: ES depRwy, else /rwy on first route term. */
function runwayForSidPick(flight: Flight): string | undefined {
    return extractDisplayDepRunway(flight)
}

function extractDisplaySid(
    flight: Flight,
    activeDepRunways?: string[],
): string | undefined {
    const forcedPrefix = routeForcedSidPrefix(flight.route)
    const depRwy = runwayForSidPick(flight)

    if (flight.sidDisplayOverride) {
        if (forcedPrefix && sidMatchesRoutePrefix(flight.sidDisplayOverride, forcedPrefix)) {
            return flight.sidDisplayOverride
        }
        // Display-only restore (DCT clear) or optimistic assign before AmendFlightPlan
        if (!forcedPrefix) {
            return flight.sidDisplayOverride
        }
    }

    if (forcedPrefix) {
        // Track / vector SIDs: prefer GetSid()/assigned when same exit as route form
        if (
            flight.sid &&
            (sameTrackSidExit(flight.sid, forcedPrefix) || sameVectorSidExit(flight.sid, forcedPrefix))
        ) {
            return flight.sid
        }
        return forcedPrefix
    }

    // FPR airports (LOP via flight planned route): show first FPL fix when DEP RWY
    // is available — same sources as strip.runway (ES GetDepartureRwy, FPL ADEP/rwy,
    // or ES-active DEP for origin). No DCT assign needed (FLEG already to that point).
    // VFR/Z: no auto FPR preview — only an explicitly entered SID (e.g. VFR·NORTH).
    if (isLopFprDepAirport(flight.origin)) {
        if (flight.flightRules === "V" || flight.flightRules === "Z") {
            return flight.sid || undefined
        }
        const rwyForFpr = extractDisplayDepRunway(flight, activeDepRunways)
        return fprDepDisplayFix(flight.origin, flight.route, rwyForFpr, flight.flightRules)
    }

    // No SID/rwy in FPL — never keep a track/SLOW GetSid (cleared in ES or EFS).
    // Radar-vector SIDs (ARS6E·KOGAV) are normal RNAV — keep them.
    if (flight.sid && isTrackSidName(flight.sid)) {
        return undefined
    }

    const firstFix = flight.route ? firstSignificantRouteFix(flight.route) : undefined
    const sidInfo =
        flight.sid && flight.origin
            ? getSidInfo(flight.origin, flight.sid, depRwy)
            : undefined

    // Valid ESE GetSid / restored preferred for this runway (non-track) — show in EFS
    // even when the route exit does not match SID waypoints (after DCT clear, etc.)
    if (sidInfo && flight.sid && !isTrackSidName(flight.sid)) {
        return flight.sid
    }

    if (firstFix) {
        if (
            flight.sid &&
            flight.origin &&
            hasSidInEse(flight.origin, firstFix, depRwy) &&
            (firstFix === flight.sid || flight.sid.startsWith(firstFix))
        ) {
            return flight.sid
        }
        if (sidInfo && !sidInfo.waypoints.includes(firstFix) && firstFix !== flight.sid) {
            return firstFix
        }
        if (!flight.sid && !sidInfo) {
            // No GetSid — if ESE has a SID for this runway+exit (ES prio), show it
            // (e.g. ESNU/32 + DEDIT → DEDIT2L). Otherwise bare fix when no ESE SIDs.
            const eseSid = flight.origin
                ? pickEseSidForRouteExit(flight.origin, depRwy, firstFix)
                : undefined
            if (eseSid) return eseSid
            const eseCount =
                flight.origin && depRwy
                    ? getSidsForRunway(flight.origin, depRwy).length
                    : 0
            if (eseCount === 0) return firstFix
            return undefined
        }
    }

    if (sidInfo) return flight.sid
    return flight.sid || undefined
}

/**
 * EuroScope-style communication suffix after callsign (#15).
 * Voice (/v) omitted; only non-voice /t (text) and /r (receive-only).
 */
function formatCommunicationSuffix(communicationType: string | undefined): string | undefined {
    if (!communicationType) return undefined
    const c = communicationType.trim().toUpperCase()
    if (c === 'T') return '/t'
    if (c === 'R') return '/r'
    return undefined
}

/** Letters that are FAA capability codes in TopSky's conversion table. */
const FAA_CAP_LETTERS = new Set(Object.keys(FAA_TO_ICAO))

export type ParsedAircraftInfo = {
    equipment?: string
    surveillance?: string
    /**
     * Full EQUIP field when FAA-sourced — TopSky form `G (SDFGRY/H)`.
     * Edit UI uses the single FAA letter only; conversion is display-only.
     */
    equipmentDisplay?: string
    /** FAA letter when format is faa (e.g. G) — for editing */
    faaEquipment?: string
    format?: 'icao' | 'faa'
}

function applyRvsm(equip: string, rvsm?: boolean): string {
    if (!rvsm || equip.includes('W')) return equip
    return equip + 'W'
}

function fromFaaLetter(faa: string, _rvsm?: boolean): ParsedAircraftInfo {
    const code = faa.toUpperCase()
    const icaoPart = FAA_TO_ICAO[code]
    if (icaoPart == null) return { format: 'faa', faaEquipment: code }
    // "SF/X" → equip SF, sur X; "/H" → equip empty, sur H
    const slash = icaoPart.lastIndexOf('/')
    const equip = slash >= 0 ? icaoPart.slice(0, slash) : icaoPart
    const sur = slash >= 0 ? icaoPart.slice(slash + 1) : ''
    return {
        format: 'faa',
        faaEquipment: code,
        equipment: equip || undefined,
        surveillance: sur || undefined,
        equipmentDisplay: formatFaaEquipDisplay(code),
    }
}

/**
 * Parse EuroScope GetAircraftInfo / VATSIM aircraft string —
 * ICAO (A20N/M-VW/C, or bare VW/C) or FAA (PC24/G).
 * Falls back to GetCapibilities letter when info is missing or WTC-only.
 */
export function parseAircraftInfo(
    info: string | undefined,
    capabilities?: string,
    rvsm?: boolean
): ParsedAircraftInfo {
    // Strip leading slash some VATSIM aircraft strings use
    const raw = (info || '').trim().replace(/^\//, '')

    // ICAO: TYPE/WTC-EQUIP/SUR  (e.g. B738/M-VW/C)
    const icao = raw.match(/^[^/\s]+\/[A-Z?]-(.+)\/([^/\s]+)$/i)
    if (icao) {
        let equipment = icao[1].replace(/\s+/g, '').toUpperCase()
        const surveillance = icao[2].replace(/\s+/g, '').toUpperCase()
        equipment = applyRvsm(equipment, rvsm)
        return {
            format: 'icao',
            equipment: equipment || undefined,
            surveillance: surveillance || undefined,
        }
    }

    // ICAO bare field 10: EQUIP/SUR (e.g. VW/C) — first token letters-only, length ≥ 1
    const bare = raw.match(/^([A-Z][A-Z0-9]*)\/([A-Z0-9]{1,5})$/i)
    if (bare && !/\d/.test(bare[1])) {
        let equipment = bare[1].replace(/\s+/g, '').toUpperCase()
        const surveillance = bare[2].replace(/\s+/g, '').toUpperCase()
        // Single-letter first token is FAA TYPE/G, not bare EQUIP
        if (equipment.length >= 2) {
            equipment = applyRvsm(equipment, rvsm)
            return {
                format: 'icao',
                equipment: equipment || undefined,
                surveillance: surveillance || undefined,
            }
        }
    }

    // FAA / short: TYPE/G (TopSky ATYP/X capability letter)
    const faaSlash = raw.match(/^[^/\s]+\/([A-Z?])$/i)
    if (faaSlash) {
        const letter = faaSlash[1].toUpperCase()
        // Bare WTC-only J/? (not in TopSky FAA table) — try capabilities
        if (letter === 'J' || letter === '?') {
            // fall through
        } else if (FAA_CAP_LETTERS.has(letter)) {
            // M is both WTC Medium and FAA — prefer GetCapibilities when it differs
            if (
                letter === 'M' &&
                capabilities &&
                /^[A-Z]$/i.test(capabilities) &&
                capabilities.toUpperCase() !== 'M' &&
                FAA_CAP_LETTERS.has(capabilities.toUpperCase())
            ) {
                return fromFaaLetter(capabilities, rvsm)
            }
            return fromFaaLetter(letter, rvsm)
        }
    }

    // Fallback: GetCapibilities letter
    const cap = (capabilities || '').trim().toUpperCase()
    if (cap && cap !== '?' && FAA_CAP_LETTERS.has(cap)) {
        return fromFaaLetter(cap, rvsm)
    }

    return {}
}

/** Apply parsed equipment onto a Flight (does not clear existing richer ICAO data). */
export function applyParsedEquipment(flight: Flight, parsed: ParsedAircraftInfo, rawInfo?: string): void {
    if (rawInfo && !flight.aircraftInfo) flight.aircraftInfo = rawInfo
    if (parsed.format === 'icao') {
        if (parsed.equipment) flight.equipment = parsed.equipment
        if (parsed.surveillance) flight.surveillance = parsed.surveillance
        flight.equipmentDisplay = undefined
        flight.faaEquipment = undefined
        return
    }
    if (parsed.format === 'faa') {
        if (parsed.faaEquipment) flight.faaEquipment = parsed.faaEquipment
        if (parsed.equipmentDisplay) flight.equipmentDisplay = parsed.equipmentDisplay
        if (parsed.equipment) flight.equipment = parsed.equipment
        if (parsed.surveillance) flight.surveillance = parsed.surveillance
    }
}

/** TopSky EQCST letters: EQ / NO / UN for W Y U R P S. */
export function deriveEqcst(equipment: string | undefined): string {
    if (!equipment) return ''
    const eq = equipment.toUpperCase()
    return (['W', 'Y', 'U', 'R', 'P', 'S'] as const)
        .map((c) => `${c}/${eq.includes(c) ? 'EQ' : 'NO'}`)
        .join(' ')
}

function parseDofFromRemarks(remarks: string | undefined): string | undefined {
    if (!remarks) return undefined
    const m = remarks.match(/\bDOF\/(\d{6})\b/i)
    return m?.[1]
}

/** Second alternate from item 18 RALT/ or ALTN/ when different from primary. */
export function parseAltn2FromRemarks(remarks: string | undefined, altn1?: string): string | undefined {
    if (!remarks) return undefined
    const m = remarks.match(/\b(?:RALT|ALTN)\/([A-Z0-9]{3,4})\b/i)
    if (!m?.[1]) return undefined
    const icao = m[1].toUpperCase()
    if (altn1 && icao === altn1.toUpperCase()) return undefined
    return icao
}

/**
 * SUP line (TopSky): endurance E/HHmm + pilot C/name (ICAO item 19).
 * Prefer structured fields from EuroScope; fall back to item 18/19 tokens in remarks.
 */
export function formatSupl(
    endurance?: string,
    pilotName?: string,
    remarks?: string
): string {
    const parts: string[] = []
    if (endurance) {
        parts.push(`E/${endurance}`)
    } else if (remarks) {
        const em = remarks.match(/\bE\/(\d{4})\b/i)
        if (em) parts.push(`E/${em[1]}`)
    }
    const pic =
        (pilotName && pilotName.trim()) ||
        remarks?.match(/\bC\/([^\n/]+?)(?=\s+[A-Z]\/|$)/i)?.[1]?.trim() ||
        undefined
    if (pic) parts.push(`C/${pic}`)
    return parts.join(' ')
}

/**
 * Store for managing Flight objects built from EuroScope plugin messages
 */
/** Outbound ROF: pink ROF key duration (re-press resets); button stays pressable */
const ROF_COOLDOWN_MS = 120_000
/** Inbound ROF SI/XFER flash duration; pending request stays until transfer */
const ROF_FLASH_MS = 60_000
/** Must stay stationary at a stand this long before Auto PARK fires */
const AUTO_PARK_DWELL_MS = 3_000

class FlightStore {
    private flights: Map<string, Flight> = new Map()
    private config: EfsStaticConfig

    /** Map of callsign to current strip section assignment */
    private stripAssignments: Map<string, { bayId: string; sectionId: string; position: number; bottom: boolean }> = new Map()

    /** Counter for generating strip positions */
    private positionCounters: Map<string, number> = new Map() // key: bayId:sectionId

    /** Outbound ROF pink window per callsign (2 min; re-press resets) */
    private rofCooldownUntil: Map<string, number> = new Map()
    private rofCooldownTimers: Map<string, ReturnType<typeof setTimeout>> = new Map()

    /** Inbound ROF flash-end timers (regenerate strip when alternate stops; request kept) */
    private rofFlashTimers: Map<string, ReturnType<typeof setTimeout>> = new Map()
    private rofFlashEndHandler?: (callsign: string) => void

    /** User setting: Auto PARK for assumed arrivals at stands (default on). */
    private getAutoParkEnabled: () => boolean = () => true

    /** Handover Assistant: auto-ASSUME inbound HA-marked transfers (default on). */
    private getHandoverAssistantAutoAssume: () => boolean = () => true

    /** Paper-look print mode (auto default). Only gates when config.look === 'paper'. */
    private getStripPrintMode: () => StripPrintMode = () => 'auto'

    /** Callsigns explicitly printed (or auto-printed); required before strip create in manual mode. */
    private printedCallsigns: Set<string> = new Set()

    /**
     * Airborne arrivals that have had a radar hit inside a runway polygon since
     * descending through the airborne threshold. Cleared on the next climb-out.
     * Stops short final (ARR, still fast, not yet at the threshold) from being
     * treated as a vacate.
     */
    private landingRunwayTouched: Set<string> = new Set()

    /**
     * Callsigns that need one EuroScope airway expansion. Filled when a strip
     * is spawned, or when the filed route changes on a strip that already exists.
     */
    private pendingRouteExpand: string[] = []

    /**
     * ESGG paper: active APP→me inbound transfer pin session (in or leaving pin tray).
     * Cleared when the handoff ends.
     */
    private appTransferPinSession: Set<string> = new Set()

    /**
     * User dragged out of the pin tray during the current handoff (assume/refuse path).
     * Cleared when the handoff ends so a later transfer can pin again.
     */
    private appTransferDragReleased: Set<string> = new Set()

    /**
     * ESGG paper: TWR→GND inbound taxi transfer pin session (PÅ TAXI stick-top).
     * Cleared when the handoff ends or the strip leaves taxi.
     */
    private gndTaxiPinSession: Set<string> = new Set()

    /** User dragged out of the PÅ TAXI pin tray during the current GND handoff. */
    private gndTaxiDragReleased: Set<string> = new Set()

    /**
     * ESGG paper: UTFLYGNING (ctr_dep) pin session — G/A or DEP airborne APP handoff.
     * Cleared when handoff ends or strip leaves UTFLYGNING.
     */
    private utflygningPinSession: Set<string> = new Set()

    /** User dragged out of the UTFLYGNING pin tray during the current APP handoff. */
    private utflygningDragReleased: Set<string> = new Set()

    /**
     * ESGG paper: above START-UP/PUSH pin session — CD→GND READY handoff.
     * Cleared when handoff ends or strip leaves above_push.
     */
    private abovePushPinSession: Set<string> = new Set()

    /** User dragged out of the above-push pin tray during the current CD→GND handoff. */
    private abovePushDragReleased: Set<string> = new Set()

    /** Notify host to send PARK (+ release) to EuroScope when Auto PARK fires. */
    private autoParkCommandHandler?: (callsign: string) => void

    /** Epoch ms when callsign first met Auto PARK stationary-at-stand conditions */
    private autoParkStationarySince: Map<string, number> = new Map()

    constructor(config: EfsStaticConfig) {
        this.config = config
    }

    setAutoParkEnabledGetter(getter: () => boolean): void {
        this.getAutoParkEnabled = getter
    }

    setHandoverAssistantAutoAssumeGetter(getter: () => boolean): void {
        this.getHandoverAssistantAutoAssume = getter
    }

    setStripPrintModeGetter(getter: () => StripPrintMode): void {
        this.getStripPrintMode = getter
    }

    setAutoParkCommandHandler(handler: (callsign: string) => void): void {
        this.autoParkCommandHandler = handler
    }

    /** True when paper look + manual print — new strips must be printed explicitly. */
    isManualPaperPrint(): boolean {
        return this.config.look === 'paper' && this.getStripPrintMode() === 'manual'
    }

    markStripPrinted(callsign: string): void {
        this.printedCallsigns.add(callsign.toUpperCase())
    }

    clearStripPrinted(callsign: string): void {
        this.printedCallsigns.delete(callsign.toUpperCase())
    }

    /**
     * Gate auto-creation of a brand-new strip placement.
     * Existing assignments always continue to update.
     */
    private shouldGateNewStrip(callsign: string): boolean {
        if (!this.isManualPaperPrint()) return false
        return !this.printedCallsigns.has(callsign.toUpperCase())
    }

    setRofRequestExpireHandler(handler: (callsign: string) => void): void {
        // Kept name for server.ts — fires when inbound flash ends (not when request clears)
        this.rofFlashEndHandler = handler
    }

    isRofCoolingDown(callsign: string): boolean {
        const until = this.rofCooldownUntil.get(callsign.toUpperCase())
        return until !== undefined && Date.now() < until
    }

    /** Epoch ms when outbound ROF pink window ends (undefined if not active) */
    getRofCooldownUntil(callsign: string): number | undefined {
        const until = this.rofCooldownUntil.get(callsign.toUpperCase())
        if (until === undefined || Date.now() >= until) return undefined
        return until
    }

    /**
     * Start/reset 2-minute outbound ROF pink window. Button stays shown; onExpire clears pink.
     */
    startRofCooldown(callsign: string, onExpire?: () => void): void {
        const key = callsign.toUpperCase()
        this.rofCooldownUntil.set(key, Date.now() + ROF_COOLDOWN_MS)
        const existing = this.rofCooldownTimers.get(key)
        if (existing) clearTimeout(existing)
        const timer = setTimeout(() => {
            this.rofCooldownUntil.delete(key)
            this.rofCooldownTimers.delete(key)
            onExpire?.()
        }, ROF_COOLDOWN_MS)
        this.rofCooldownTimers.set(key, timer)
    }

    /** Clear outbound ROF cooldown (e.g. plugin reported send failure) */
    clearRofCooldown(callsign: string): void {
        const key = callsign.toUpperCase()
        this.rofCooldownUntil.delete(key)
        const existing = this.rofCooldownTimers.get(key)
        if (existing) {
            clearTimeout(existing)
            this.rofCooldownTimers.delete(key)
        }
    }

    /** Active incoming ROF requester callsign (until XFER / clear) */
    getPendingRofRequest(flight: Flight): string | undefined {
        return flight.rofRequestFrom || undefined
    }

    clearRofRequest(flight: Flight): void {
        flight.rofRequestFrom = undefined
        flight.rofFlashUntil = undefined
        const key = flight.callsign.toUpperCase()
        const timer = this.rofFlashTimers.get(key)
        if (timer) {
            clearTimeout(timer)
            this.rofFlashTimers.delete(key)
        }
    }

    /**
     * Persist an incoming ROF requester (TopSky /LAM/ROF/… or EFS /EFSROF/…/…).
     * Caller should clear the scratchpad after this when needed.
     * Flash for 1 minute; request itself stays until transfer.
     */
    setRofRequest(flight: Flight, requester: string): void {
        const from = requester.trim().toUpperCase()
        if (!from) return
        flight.rofRequestFrom = from
        flight.rofFlashUntil = Date.now() + ROF_FLASH_MS
        const key = flight.callsign.toUpperCase()
        const existing = this.rofFlashTimers.get(key)
        if (existing) clearTimeout(existing)
        const timer = setTimeout(() => {
            this.rofFlashTimers.delete(key)
            if (flight.rofRequestFrom === from) {
                // Flash window ended — refresh strip UI; keep pending ROF
                this.rofFlashEndHandler?.(flight.callsign)
            }
        }, ROF_FLASH_MS)
        this.rofFlashTimers.set(key, timer)
        console.log(`[ROF] ${flight.callsign} request from ${from}`)
    }

    /**
     * Get all flights
     */
    getAllFlights(): Flight[] {
        return Array.from(this.flights.values())
    }

    /**
     * ESSA arr/dep runway ends that should open an extra RWY header beyond active
     * EuroScope rwyconfig. Any strip with a forced/selected runway whose physical
     * pair is not already covered by the active ARR/DEP config adds that header
     * (e.g. DEP 08 while config is 01L). Runways already present (01L while
     * config is 01L/01L) do not open a second bay.
     */
    getEssaAssignedRunways(): { arr: string[]; dep: string[] } {
        const activePairs = new Set<string>()
        const essaActive = this.config.activeRunways?.['ESSA']
        if (essaActive) {
            for (const r of [...essaActive.arr, ...essaActive.dep]) {
                const pair = essaPhysicalPairForRunway(r)
                if (pair) activePairs.add(pair.id)
            }
        }

        const arr = new Set<string>()
        const dep = new Set<string>()
        const consider = (rwy: string | undefined, into: Set<string>) => {
            if (!rwy) return
            const pair = essaPhysicalPairForRunway(rwy)
            if (!pair || activePairs.has(pair.id)) return
            into.add(rwy.toUpperCase())
        }

        for (const flight of this.flights.values()) {
            if (flight.deleted || flight.manuallyDeleted) continue
            if (!this.stripAssignments.has(flight.callsign)) continue
            const originIsEssa = flight.origin === 'ESSA'
            const destIsEssa = flight.destination === 'ESSA'
            if (destIsEssa) consider(flight.arrRwy, arr)
            if (originIsEssa) consider(flight.depRwy, dep)
        }
        return {
            arr: [...arr].sort(),
            dep: [...dep].sort(),
        }
    }

    /**
     * Get a flight by callsign
     */
    getFlight(callsign: string): Flight | undefined {
        return this.flights.get(callsign)
    }

    /**
     * Get current strip assignment for a callsign
     */
    getStripAssignment(callsign: string) {
        return this.stripAssignments.get(callsign)
    }

    /**
     * ES-facing state that should release a manual/sync bay sticky when it changes.
     */
    placementStickyFingerprint(flight: Flight): string {
        return [
            flight.groundstate ?? '',
            flight.controller ?? '',
            flight.controllerId ?? '',
            flight.handoffTargetController ?? '',
            flight.airborne ? '1' : '0',
            flight.clearance ? '1' : '0',
            flight.clearedToLand ? '1' : '0',
            flight.clearedForTakeoff ? '1' : '0',
            flight.missedApproach ? '1' : '0',
            flight.efsGoAround ? '1' : '0',
        ].join('|')
    }

    markManualPlacement(stripId: string, flight?: Flight) {
        const f =
            flight ??
            this.flights.get(stripId) ??
            this.flights.get(stripId.split('@')[0] ?? '')
        if (!f) return
        f.lastSectionRule = 'manual'
        f.placementStickyKey = this.placementStickyFingerprint(f)
    }

    /**
     * CD ALL → TSAT → PUSH → TAXI: sticky drag/sync must not fight CLR / groundstate.
     * Examples: ACK CLR stuck in CD ALL (no PUSH key); PUSH GS stuck in TSAT.
     */
    isDepBayFlowStickyInvalid(flight: Flight, sectionId: string): boolean {
        return depBayFlowStickyInvalid(flight, sectionId, this.config.look)
    }

    /**
     * Update strip assignment.
     * - 5-arg form: manual drag (also marks lastSectionRule = 'manual' when a flight exists)
     * - 2-arg form: position sync / restore without changing rule provenance
     */
    setStripAssignment(
        stripId: string,
        bayIdOrAssignment: string | { bayId: string; sectionId: string; position: number; bottom: boolean },
        sectionId?: string,
        position?: number,
        bottom?: boolean
    ) {
        if (typeof bayIdOrAssignment === 'object') {
            this.stripAssignments.set(stripId, bayIdOrAssignment)
            return
        }
        const assignment = {
            bayId: bayIdOrAssignment,
            sectionId: sectionId!,
            position: position!,
            bottom: bottom!,
        }
        this.stripAssignments.set(stripId, assignment)
        this.markManualPlacement(stripId)
    }

    /**
     * Apply groundstate from EFS (button / drag) and hold against stale ES echoes
     * (e.g. ARR while still on runway after TXI).
     */
    applyOptimisticGroundstate(callsign: string, state: string): void {
        const flight = this.flights.get(callsign)
        if (!flight) return
        flight.groundstate = state
        if (state === 'PARK') flight.airborne = false
        if (!state) {
            flight.groundstateClearedUntil = Date.now() + 3000
            flight.groundstateHoldUntil = undefined
        } else {
            flight.groundstateClearedUntil = undefined
            flight.groundstateHoldUntil = Date.now() + 12000
        }
        flight.lastUpdate = Date.now()
    }

    /**
     * Apply clearance from EFS (CLR correct / voice CLR / drag) and hold against
     * stale CAD echoes that would briefly flip the flag back.
     * Clearing CLR correct also clears CLR read (drag / voice / paper col 5).
     */
    applyOptimisticClearance(callsign: string, desired: boolean): void {
        const flight = this.flights.get(callsign)
        if (!flight) return
        flight.clearance = desired
        flight.clearanceReadback = desired
        if (desired) {
            flight.clearanceRead = true
        } else {
            flight.clearanceRead = false
        }
        flight.clearanceHoldUntil = Date.now() + 12000
        flight.lastUpdate = Date.now()
    }

    /**
     * ESGG paper soft go-around: local optimistic state (UDP setEfsGoAround syncs via ann 5).
     * Does not set TopSky MISAP_. Keeps CTL + ATA until APP assumes the G/A XFER.
     */
    applySoftMissedApproach(callsign: string): void {
        const flight = this.flights.get(callsign)
        if (!flight) return
        flight.efsGoAround = true
        flight.missedApproach = true
        flight.missedApproachHoldUntil = Date.now() + 12000
        flight.lastUpdate = Date.now()
    }

    /** Clear EFS soft G/A optimistic state (pair with UDP unsetEfsGoAround). */
    clearSoftMissedApproach(callsign: string): void {
        const flight = this.flights.get(callsign)
        if (!flight) return
        flight.efsGoAround = false
        flight.missedApproachHoldUntil = undefined
        // Optimistic clear; TopSky MISAP_ CAD will restore missedApproach if still set
        flight.missedApproach = false
        flight.lastUpdate = Date.now()
    }

    /**
     * Try to auto-detect stand from the aircraft's position.
     * Only sets stand if:
     * - flight.stand is not already set
     * - flight has a radar position
     * - aircraft is in a pre-movement ground state
     */
    private trySetStandFromPosition(flight: Flight) {
        if (flight.stand && flight.stand !== '') return
        if (flight.latitude === undefined || flight.longitude === undefined) return

        // Only look up stand for aircraft in pre-movement states
        const preMovementStates: (GroundState | undefined)[] = ['', 'NSTS', 'ONFREQ', 'DE-ICE', 'STUP', 'PARK', undefined]
        if (!preMovementStates.includes(flight.groundstate)) return

        const nearestAirport = findNearestAirport(
            flight.latitude,
            flight.longitude,
            this.config.myAirports,
            getAirportCoords
        )
        if (!nearestAirport) return

        const stand = findStandForPosition(nearestAirport, flight.latitude, flight.longitude)
        if (stand) {
            flight.stand = stand
            console.log(`Stand ${stand} detected for ${flight.callsign}`)
        }
    }

    /**
     * Auto-set groundstate to PARK for assumed arrivals that are
     * stationary at a stand for AUTO_PARK_DWELL_MS. Sends PARK + release
     * to EuroScope via handler.
     *
     * Never applies to pure departures (they often sit at a stand with
     * empty/NSTS — that must not trigger PARK / delete_parked).
     *
     * Stand detection matches the yellow PARK highlight: live position in a
     * GRP stand polygon (does not rely on flight.stand from pre-movement only).
     */
    private tryAutoSetParked(flight: Flight) {
        const key = flight.callsign.toUpperCase()
        const clearDwell = () => {
            this.autoParkStationarySince.delete(key)
        }

        if (!this.getAutoParkEnabled()) {
            clearDwell()
            return
        }

        // Trash-restored early TERM: do not Auto PARK again until explicit TERM
        if (flight.suppressParkDelete) {
            clearDwell()
            return
        }

        // Destination must be our airport (arrival or local). Pure departures
        // (origin only) must never Auto PARK — they sit at stands with empty/NSTS.
        const originIsOurs =
            !!flight.origin && this.config.myAirports.includes(flight.origin)
        const destIsOurs =
            !!flight.destination && this.config.myAirports.includes(flight.destination)
        if (!destIsOurs) {
            clearDwell()
            return
        }
        const standAirport = flight.destination!
        if (!hasStandData(standAirport)) {
            clearDwell()
            return
        }

        // Must be assumed by me
        const myCallsign = this.config.myCallsign
        if (!myCallsign || flight.controller !== myCallsign) {
            clearDwell()
            return
        }

        // Must be stationary (allow slight radar jitter above 0)
        if (flight.groundSpeed === undefined || flight.groundSpeed > 5) {
            clearDwell()
            return
        }

        // Groundstate: arrivals may briefly have empty/NSTS after landing;
        // locals only after landing (ARR/TXIN) — not while still at the gate pre-dep.
        const gs = flight.groundstate ?? ''
        const isLocal = originIsOurs && destIsOurs
        if (isLocal) {
            if (gs !== 'ARR' && gs !== 'TXIN') {
                clearDwell()
                return
            }
        } else if (gs !== '' && gs !== 'NSTS' && gs !== 'ARR' && gs !== 'TXIN') {
            clearDwell()
            return
        }

        if (flight.latitude === undefined || flight.longitude === undefined) {
            clearDwell()
            return
        }

        // Same stand check as yellow PARK highlight
        const nearestAirport = findNearestAirport(
            flight.latitude,
            flight.longitude,
            this.config.myAirports,
            getAirportCoords
        )
        if (!nearestAirport || !hasStandData(nearestAirport)) {
            clearDwell()
            return
        }
        const standAtPos = findStandForPosition(nearestAirport, flight.latitude, flight.longitude)
        if (!standAtPos) {
            clearDwell()
            return
        }

        const now = Date.now()
        let since = this.autoParkStationarySince.get(key)
        if (since === undefined) {
            this.autoParkStationarySince.set(key, now)
            return
        }
        if (now - since < AUTO_PARK_DWELL_MS) return

        this.autoParkStationarySince.delete(key)
        if (!flight.stand) flight.stand = standAtPos

        flight.groundstate = 'PARK'
        flight.airborne = false
        console.log(
            `Auto-PARK: ${flight.callsign} assumed, stationary ${AUTO_PARK_DWELL_MS}ms at stand ${standAtPos}`
        )
        this.autoParkCommandHandler?.(flight.callsign)
    }

    /**
     * Re-run Auto PARK checks on all flights (e.g. after enabling the setting).
     * Returns callsigns that newly received PARK.
     */
    applyAutoParkToEligibleFlights(): string[] {
        const changed: string[] = []
        for (const flight of this.flights.values()) {
            const before = flight.groundstate
            this.tryAutoSetParked(flight)
            if (before !== 'PARK' && flight.groundstate === 'PARK') {
                changed.push(flight.callsign)
            }
        }
        return changed
    }

    /**
     * Check if a flight is eligible to have a strip created.
     * Requirements:
     * 1. Flight has a radar position (lat/lon)
     * 2. Flight's origin, destination, or alternate is in myAirports
     * 3. Within radarRangeNm, OR (arrival to my airport AND (within arrivalRangeNm OR ETE ≤ arrivalEtaMinutes))
     */
    isEligibleForStrip(flight: Flight, config: EfsStaticConfig = this.config): boolean {
        // Must have radar position
        if (flight.latitude === undefined || flight.longitude === undefined) {
            return false
        }

        // Must have origin, destination, or alternate at one of our airports
        const myAirports = config.myAirports
        const hasRelevantAirport =
            (flight.origin !== undefined && myAirports.includes(flight.origin)) ||
            (flight.destination !== undefined && myAirports.includes(flight.destination)) ||
            (flight.alternate !== undefined && myAirports.includes(flight.alternate))

        if (!hasRelevantAirport) {
            return false
        }

        // ESSA→ESSB (etc.): once landed at a non-myAirport destination, do not recreate strips
        const dest = (flight.destination || '').toUpperCase()
        if (
            dest &&
            dest !== 'ZZZZ' &&
            !myAirports.some((a) => a.toUpperCase() === dest) &&
            flight.airborne === false &&
            (!!flight.ata || flight.groundstate === 'PARK' || flight.groundstate === 'TXIN')
        ) {
            return false
        }

        return isWithinStripVisibilityRange(
            flight,
            myAirports,
            {
                radarRangeNm: config.radarRangeNm,
                arrivalRangeNm: config.arrivalRangeNm,
                arrivalEtaMinutes: config.arrivalEtaMinutes,
            },
            getAirportCoords
        )
    }

    /**
     * After flight data is updated, create/update/delete strip(s).
     * In multiAirport mode, one strip instance per relevant active airport.
     */
    private withTransferSound(
        result: ProcessMessageResult,
        prevController: string | undefined,
        prevHandoff: string | undefined,
        flight: Flight
    ): ProcessMessageResult {
        const sound = detectTransferSound(
            prevController,
            prevHandoff,
            flight.controller,
            flight.handoffTargetController,
            this.config.myCallsign
        )
        if (sound) result.transferSound = sound

        // Handover Assistant: auto-ASSUME inbound HA-marked handoffs when setting is on
        if (
            sound === 'request' &&
            flight.handoverAssistantInbound &&
            this.shouldAutoAssumeHandover(flight)
        ) {
            this.queueAutoAssume(result, flight)
        }

        // ESGG paper: APP assumed our outbound G/A XFER → retire strip, reprint clean ARR in INBOUND
        if (
            sound === 'accept' &&
            this.config.look === 'paper' &&
            (flight.efsGoAround || flight.missedApproach)
        ) {
            return this.reprintCleanArrivalAfterGoAroundAssume(flight, sound)
        }
        return result
    }

    /**
     * After APP assumes a G/A handoff: clear CTL/ATA/G/A flags, remove the old strip,
     * and print a clean ARR strip in pending ARR (INBOUND).
     */
    private reprintCleanArrivalAfterGoAroundAssume(
        flight: Flight,
        transferSound: 'accept',
    ): ProcessMessageResult {
        const callsign = flight.callsign
        const prevAssignment = this.stripAssignments.get(callsign)
        const hadTopSkyMisap = !!flight.missedApproach && !flight.efsGoAround
        const hadEfsGa = !!flight.efsGoAround
        const hadCtl = !!flight.clearedToLand

        flight.efsGoAround = false
        flight.missedApproach = false
        flight.missedApproachHoldUntil = undefined
        flight.clearedToLand = false
        flight.ata = undefined
        flight.lastUpdate = Date.now()

        this.clearUtflygningPinned(callsign)
        this.stripAssignments.delete(callsign)
        this.markStripPrinted(callsign)
        // Soft-delete reason for trash (old G/A strip kept for recovery)
        flight.lastDeleteRule = 'goa_app_assume'

        const inboundBayId = this.config.sectionToBay.get('inbound')
        let strip: FlightStrip | undefined
        let shiftedCallsigns: string[] | undefined

        if (inboundBayId) {
            const position = this.getNewStripPosition(inboundBayId, 'inbound', flight)
            this.stripAssignments.set(callsign, {
                bayId: inboundBayId,
                sectionId: 'inbound',
                position,
                bottom: false,
            })
            flight.lastSectionRule = 'goa_reprint_inbound'
            flight.deleted = false
            flight.noSectionFound = false
            strip = this.createStrip(flight, inboundBayId, 'inbound', position, false)
            const shifted = this.getLastShiftedCallsigns()
            shiftedCallsigns = shifted.length > 0 ? shifted : undefined
            console.log(
                `[G/A] ${callsign}: APP assumed → trash G/A strip, clean reprint in INBOUND (was ${prevAssignment?.sectionId ?? 'none'})`,
            )
        } else {
            const created = this.finalizeFlightStrips(callsign, flight, true)
            strip = created.strip
            shiftedCallsigns = created.shiftedCallsigns
            console.log(`[G/A] ${callsign}: APP assumed → trash G/A strip, clean reprint (no inbound section)`)
        }

        if (!strip) {
            return {
                flight,
                deleteStripId: callsign,
                softDeleted: true,
                transferSound,
                cleanReprint: true,
                unsetEfsGoAround: hadEfsGa,
                unsetClearedToLand: hadCtl,
                clearScratchpadCallsign: hadTopSkyMisap ? callsign : undefined,
            }
        }

        return {
            flight,
            transferSound,
            cleanReprint: true,
            unsetEfsGoAround: hadEfsGa,
            unsetClearedToLand: hadCtl,
            clearScratchpadCallsign: hadTopSkyMisap ? callsign : undefined,
            multiUpdates: [
                // Soft-delete so the G/A strip lands in the trashcan (snapshot before reprint)
                { deleteStripId: callsign, softDeleted: true },
                {
                    strip,
                    isNew: true,
                    sectionChanged: true,
                    previousSection: prevAssignment
                        ? { bayId: prevAssignment.bayId, sectionId: prevAssignment.sectionId }
                        : undefined,
                    shiftedCallsigns,
                    allowPositionChange: true,
                },
            ],
        }
    }

    private queueRouteExpand(callsign: string): void {
        if (!callsign || this.pendingRouteExpand.includes(callsign)) return
        this.pendingRouteExpand.push(callsign)
    }

    /** Re-expand after a filed-route edit on a strip that is already on the bay. */
    private queueRouteExpandIfPresent(
        callsign: string,
        flight: Flight,
        result: ProcessMessageResult,
        routeChanged: boolean,
    ): void {
        if (!routeChanged || flight.synthetic || flight.extractedRoute) return
        if (!result.strip && !(result.strips && result.strips.length > 0)) return
        this.queueRouteExpand(callsign)
    }

    /** Callsigns requested since the last take. Plugin expands one per timer tick. */
    takePendingRouteExpands(): string[] {
        const queued = this.pendingRouteExpand
        this.pendingRouteExpand = []
        return queued
    }

    private finalizeFlightStrips(
        callsign: string,
        flight: Flight,
        preferNew: boolean,
        restoredHint?: boolean
    ): ProcessMessageResult {
        if (isMultiAirportConfig(this.config)) {
            return this.resolveMultiAirportStrips(callsign, flight)
        }

        const deleteState = this.applyDeleteRules(callsign, flight)
        if (deleteState.shortCircuit) {
            return deleteState.shortCircuit
        }
        if (deleteState.parkTurnaroundRevive) {
            // ARR stays in trash; print a clean DEP (do not set restored — that wipes trash)
            return this.reprintCleanDepartureAfterTurnaround(flight)
        }

        const hasRequiredData = flightHasRequiredData(flight)
        if (!hasRequiredData || flight.deleted) {
            return { flight, softDeleted: flight.deleted }
        }

        if (!this.isEligibleForStrip(flight) && !this.stripAssignments.has(callsign)) {
            return { flight }
        }

        return this.resolveStripResult(
            callsign,
            flight,
            preferNew,
            !deleteState.deleteResult.shouldDelete && deleteState.wasDeleted ? true : restoredHint
        )
    }

    /**
     * Multi-airport: evaluate eligibility/section/delete per active airport with scoped config.
     */
    private resolveMultiAirportStrips(callsign: string, flight: Flight): ProcessMessageResult {
        const active = this.config.activeAirports ?? this.config.myAirports
        const relevant = getRelevantActiveAirports(flight, active)
        const multiUpdates: NonNullable<ProcessMessageResult['multiUpdates']> = []
        const strips: FlightStrip[] = []
        const deletedStripIds: string[] = []
        let setScratchValue: string | undefined

        // Remove strip instances for airports no longer relevant
        for (const stripId of [...this.stripAssignments.keys()]) {
            const parsed = parseStripAirportId(stripId)
            if (parsed?.callsign === callsign && !relevant.includes(parsed.airport)) {
                this.stripAssignments.delete(stripId)
                deletedStripIds.push(stripId)
                flight.lastDeleteRule = 'airport_irrelevant'
                multiUpdates.push({ deleteStripId: stripId, softDeleted: true })
            }
        }

        if (!flightHasRequiredData(flight) || flight.manuallyDeleted) {
            if (!flight.manuallyDeleted) {
                flight.lastDeleteRule = 'flight_data_lost'
            }
            // Soft-delete remaining instances
            for (const airport of relevant) {
                const stripId = stripIdForAirport(callsign, airport)
                if (this.stripAssignments.has(stripId)) {
                    this.stripAssignments.delete(stripId)
                    deletedStripIds.push(stripId)
                    multiUpdates.push({ deleteStripId: stripId, softDeleted: true })
                }
            }
            return {
                flight,
                deletedStripIds: deletedStripIds.length ? deletedStripIds : undefined,
                softDeleted: deletedStripIds.length > 0,
                multiUpdates: multiUpdates.length ? multiUpdates : undefined
            }
        }

        for (const airport of relevant) {
            const scoped = withAirportScope(this.config, airport)
            const stripId = stripIdForAirport(callsign, airport)
            const hadAssignment = this.stripAssignments.has(stripId)

            if (!this.isEligibleForStrip(flight, scoped) && !hadAssignment) {
                continue
            }

            const deleteResult = shouldDeleteFlight(flight, scoped)
            if (deleteResult.shouldDelete) {
                if (hadAssignment) {
                    flight.lastDeleteRule = deleteResult.ruleId
                    if (deleteResult.ruleId === 'delete_beyond_range') {
                        flight.deletedByBeyondRange = true
                    }
                    if (isParkTrashDeleteRule(deleteResult.ruleId)) {
                        flight.parkTrashFplKey = flightPlanFingerprint(flight)
                    }
                    this.stripAssignments.delete(stripId)
                    deletedStripIds.push(stripId)
                    multiUpdates.push({ deleteStripId: stripId, softDeleted: true })
                }
                continue
            }

            // Same-CS turnaround: new outbound FPL after delete_parked → fresh dep strip
            if (
                !hadAssignment &&
                flight.deleted &&
                shouldAutoReviveParkTrash(flight, scoped.myAirports)
            ) {
                beginNewDepartureCycleAfterPark(flight)
                console.log(
                    `Flight ${callsign} restored from park trash — new departure FPL (${airport})`,
                )
            }

            const targetSection = determineSectionForFlight(flight, scoped, airport)
            if (!targetSection) {
                if (hadAssignment) {
                    flight.lastDeleteRule = 'no_section'
                    this.stripAssignments.delete(stripId)
                    deletedStripIds.push(stripId)
                    multiUpdates.push({ deleteStripId: stripId, softDeleted: true })
                }
                continue
            }

            const currentAssignment = this.stripAssignments.get(stripId)
            const isNewStrip = !currentAssignment
            if (isNewStrip && this.shouldGateNewStrip(flight.callsign)) {
                continue
            }
            const ruleWantsDifferentSection = !!(
                currentAssignment &&
                (currentAssignment.bayId !== targetSection.bayId ||
                    currentAssignment.sectionId !== targetSection.sectionId)
            )
            const holdRwySequence =
                !!currentAssignment &&
                ruleWantsDifferentSection &&
                this.shouldHoldInRwySequenceBay(flight, currentAssignment)
            const holdLandedArrOnRunway =
                !!currentAssignment &&
                ruleWantsDifferentSection &&
                this.shouldHoldLandedArrOnRunway(flight, currentAssignment)
            const holdUtflygning =
                !!currentAssignment &&
                ruleWantsDifferentSection &&
                this.shouldHoldInUtflygning(flight, currentAssignment)
            const holdAbovePush =
                !!currentAssignment &&
                ruleWantsDifferentSection &&
                this.shouldHoldInAbovePush(flight, currentAssignment)
            const holdVfrAirborne =
                !!currentAssignment &&
                ruleWantsDifferentSection &&
                this.shouldHoldVfrAirbornePlacement(
                    flight,
                    currentAssignment,
                    targetSection.sectionId,
                )
            const holdSection =
                holdRwySequence ||
                holdLandedArrOnRunway ||
                holdUtflygning ||
                holdAbovePush ||
                holdVfrAirborne
            const sectionChanged = ruleWantsDifferentSection && !holdSection

            let position: number
            let bottom: boolean
            let previousSection: { bayId: string; sectionId: string } | undefined

            if (isNewStrip) {
                this.markStripPrinted(flight.callsign)
                position = this.getNewStripPosition(targetSection.bayId, targetSection.sectionId, flight)
                bottom = false
                this.stripAssignments.set(stripId, {
                    bayId: targetSection.bayId,
                    sectionId: targetSection.sectionId,
                    position,
                    bottom
                })
                console.log(`[RULE] ${stripId} -> ${targetSection.sectionId} (rule: ${targetSection.ruleId ?? 'default'}, new)`)
            } else if (holdSection && currentAssignment) {
                position = currentAssignment.position
                bottom = currentAssignment.bottom
            } else if (sectionChanged && currentAssignment) {
                previousSection = {
                    bayId: currentAssignment.bayId,
                    sectionId: currentAssignment.sectionId
                }
                position = this.getNewStripPosition(targetSection.bayId, targetSection.sectionId, flight)
                bottom = false
                this.stripAssignments.set(stripId, {
                    bayId: targetSection.bayId,
                    sectionId: targetSection.sectionId,
                    position,
                    bottom
                })
                console.log(`[RULE] ${stripId} ${previousSection.sectionId} -> ${targetSection.sectionId}`)
            } else if (currentAssignment) {
                position = currentAssignment.position
                bottom = currentAssignment.bottom
            } else {
                position = this.getNewStripPosition(targetSection.bayId, targetSection.sectionId, flight)
                bottom = false
                this.stripAssignments.set(stripId, {
                    bayId: targetSection.bayId,
                    sectionId: targetSection.sectionId,
                    position,
                    bottom
                })
            }

            const placeBayId =
                holdSection && currentAssignment ? currentAssignment.bayId : targetSection.bayId
            const placeSectionId =
                holdSection && currentAssignment
                    ? currentAssignment.sectionId
                    : targetSection.sectionId
            const appTransferTop = this.applyAppTransferCtrArrTop(
                stripId,
                flight,
                placeBayId,
                placeSectionId,
                position,
                bottom,
            )
            position = appTransferTop.position
            bottom = appTransferTop.bottom
            const gndTaxiPin = this.applyGndTaxiPin(
                stripId,
                flight,
                placeBayId,
                placeSectionId,
                position,
                bottom,
            )
            position = gndTaxiPin.position
            bottom = gndTaxiPin.bottom
            const utflygningPin = this.applyUtflygningPin(
                stripId,
                flight,
                placeBayId,
                placeSectionId,
                position,
                bottom,
            )
            position = utflygningPin.position
            bottom = utflygningPin.bottom
            const abovePushPin = this.applyAbovePushPin(
                stripId,
                flight,
                placeBayId,
                placeSectionId,
                position,
                bottom,
            )
            position = abovePushPin.position
            bottom = abovePushPin.bottom

            // ATYP/WTC changes: clear SLOW if no longer slow, else auto-add when eligible
            if (!setScratchValue && this.tryClearAutoSlowRemark(flight)) {
                setScratchValue = buildCombinedScratch(flight.remarks, flight.hp)
                this.holdScratchFields(flight)
            } else if (!setScratchValue && this.tryAutoSlowRemark(flight)) {
                setScratchValue = buildCombinedScratch(flight.remarks, flight.hp)
                this.holdScratchFields(flight)
            }

            const strip = this.createStrip(
                flight,
                placeBayId,
                placeSectionId,
                position,
                bottom,
                airport,
                scoped
            )
            const shiftedCallsigns = this.getLastShiftedCallsigns()
            if (isNewStrip && !flight.synthetic && !flight.extractedRoute) {
                this.queueRouteExpand(callsign)
            }
            strips.push(strip)
            multiUpdates.push({
                strip,
                isNew: isNewStrip,
                sectionChanged,
                previousSection,
                shiftedCallsigns: shiftedCallsigns.length > 0 ? shiftedCallsigns : undefined,
                allowPositionChange:
                    appTransferTop.bumped ||
                    gndTaxiPin.bumped ||
                    utflygningPin.bumped ||
                    abovePushPin.bumped ||
                    undefined,
            })
        }

        return {
            flight,
            strip: strips[0],
            strips: strips.length ? strips : undefined,
            deletedStripIds: deletedStripIds.length ? deletedStripIds : undefined,
            softDeleted: deletedStripIds.length > 0 && strips.length === 0,
            setScratchValue,
            multiUpdates: multiUpdates.length ? multiUpdates : undefined
        }
    }

    /**
     * Remap all multi-airport strip bay/section placements after columnAirports change.
     * Does not re-run eligibility — only moves instances between visible/idle bays.
     */
    remapMultiAirportPlacements(): FlightStrip[] {
        if (!isMultiAirportConfig(this.config)) return []

        const updated: FlightStrip[] = []
        for (const [stripId, assignment] of this.stripAssignments) {
            const parsed = parseStripAirportId(stripId)
            if (!parsed) continue

            const flight = this.flights.get(parsed.callsign)
            if (!flight) continue

            const logical = logicalSectionId(assignment.sectionId)
            const bayId = resolveBayForAirport(parsed.airport, this.config.columnAirports)
            const sectionId = prefixedSectionId(bayId, logical)

            if (bayId === assignment.bayId && sectionId === assignment.sectionId) continue

            const position = this.getNewStripPosition(bayId, sectionId, flight)
            const bottom = assignment.bottom
            this.stripAssignments.set(stripId, { bayId, sectionId, position, bottom })

            const scoped = withAirportScope(this.config, parsed.airport)
            const strip = this.createStrip(flight, bayId, sectionId, position, bottom, parsed.airport, scoped)
            updated.push(strip)
        }
        return updated
    }

    /**
     * Handle case where no section rule matches a flight.
     * Logs once per flight and marks it as soft-deleted.
     */
    private handleNoSectionFound(flight: Flight): ProcessMessageResult {
        // Only log if we haven't already logged for this flight
        if (!flight.noSectionFound) {
            console.log(`No section found for flight ${flight.callsign}`)
            flight.noSectionFound = true
            flight.deleted = true
            flight.lastDeleteRule = 'no_section'
        }
        return { flight, softDeleted: true }
    }

    /**
     * Get an existing flight or create a partial record.
     */
    private getOrCreateFlight(callsign: string): Flight {
        let flight = this.flights.get(callsign)
        if (!flight) {
            flight = {
                callsign,
                firstSeen: Date.now()
            }
            this.flights.set(callsign, flight)
        }
        return flight
    }

    /**
     * Apply delete/restore rules and return whether processing should stop early.
     */
    private applyDeleteRules(callsign: string, flight: Flight): {
        deleteResult: ReturnType<typeof shouldDeleteFlight>
        wasDeleted: boolean
        shortCircuit?: ProcessMessageResult
        /** New outbound FPL after delete_parked — clean DEP reprint, keep ARR in trash */
        parkTurnaroundRevive?: boolean
    } {
        const wasDeleted = flight.deleted ?? false
        const deleteResult = shouldDeleteFlight(flight, this.config)

        if (deleteResult.shouldDelete && !wasDeleted) {
            // Trash restore of early TERM: keep strip until explicit TERM / disconnect
            if (
                flight.suppressParkDelete &&
                (deleteResult.ruleId === 'delete_parked' || deleteResult.ruleId === 'delete_parked_local')
            ) {
                return {
                    deleteResult: { shouldDelete: false },
                    wasDeleted,
                }
            }
            flight.deleted = true
            flight.lastDeleteRule = deleteResult.ruleId
            if (deleteResult.ruleId === 'delete_beyond_range') {
                flight.deletedByBeyondRange = true
            }
            if (isParkTrashDeleteRule(deleteResult.ruleId)) {
                flight.parkTrashFplKey = flightPlanFingerprint(flight)
            }
            console.log(`Flight ${callsign} soft-deleted by rule: ${deleteResult.ruleId}`)
            return {
                deleteResult,
                wasDeleted,
                shortCircuit: { flight, softDeleted: true }
            }
        }

        if (!deleteResult.shouldDelete && wasDeleted && !flight.manuallyDeleted) {
            // PARK/TERM soft-deletes stay in trash until manual restore, pilot disconnect,
            // or a new outbound FPL (same CS turnaround). Do not revive on GS-only changes.
            const parkTrash = isParkTrashDeleteRule(flight.lastDeleteRule)
            if (parkTrash) {
                if (shouldAutoReviveParkTrash(flight, this.config.myAirports)) {
                    beginNewDepartureCycleAfterPark(flight)
                    console.log(
                        `Flight ${callsign} park-trash turnaround — new departure FPL (clean DEP reprint)`,
                    )
                    return { deleteResult, wasDeleted, parkTurnaroundRevive: true }
                }
                // else keep deleted
            } else if (flight.noSectionFound) {
                const targetSection = determineSectionForFlight(flight, this.config)
                if (targetSection) {
                    flight.noSectionFound = false
                    flight.deleted = false
                    flight.lastDeleteRule = undefined
                    console.log(`Flight ${callsign} restored - section now found: ${targetSection.sectionId}`)
                }
            } else {
                flight.deleted = false
                flight.deletedByBeyondRange = false
                flight.lastDeleteRule = undefined
                console.log(`Flight ${callsign} restored from soft-delete`)
            }
        } else if (wasDeleted && flight.deletedByBeyondRange && !flight.manuallyDeleted) {
            const isArrival = flight.destination !== undefined && this.config.myAirports.includes(flight.destination)
            if (isArrival && this.isEligibleForStrip(flight)) {
                flight.deleted = false
                flight.deletedByBeyondRange = false
                flight.lastDeleteRule = undefined
                console.log(`Flight ${callsign} (arrival) restored - now within range`)
            }
        }

        return { deleteResult, wasDeleted }
    }

    /**
     * Same-CS turnaround: trash the ARR strip (if still on the bay) and print a
     * clean DEP strip. Keeps an already-parked ARR snapshot in trash (do not
     * send softDelete when nothing is active — that would wipe trash by id).
     * Works for every airport / look; paper clients get cleanReprint print anim.
     */
    private reprintCleanDepartureAfterTurnaround(flight: Flight): ProcessMessageResult {
        const callsign = flight.callsign
        const prevAssignment = this.stripAssignments.get(callsign)
        const hadActive = !!prevAssignment

        beginNewDepartureCycleAfterPark(flight)
        this.resetFlightForFreshPrint(flight)
        this.stripAssignments.delete(callsign)
        this.markStripPrinted(callsign)

        // Trash meta for the ARR bay strip (store reads flight.lastDeleteRule on stash)
        if (hadActive) flight.lastDeleteRule = 'turnaround_fpl'

        const created = this.resolveStripResult(callsign, flight, true, false)
        if (!created.strip) {
            return {
                flight,
                ...(hadActive
                    ? { deleteStripId: callsign, softDeleted: true, deletedStripIds: [callsign] }
                    : {}),
                cleanReprint: true,
                freshReprint: true,
            }
        }

        const multiUpdates: NonNullable<ProcessMessageResult['multiUpdates']> = []
        if (hadActive) {
            multiUpdates.push({ deleteStripId: callsign, softDeleted: true })
        }
        multiUpdates.push({
            strip: created.strip,
            isNew: true,
            sectionChanged: true,
            previousSection: prevAssignment
                ? { bayId: prevAssignment.bayId, sectionId: prevAssignment.sectionId }
                : undefined,
            shiftedCallsigns: created.shiftedCallsigns,
            allowPositionChange: true,
        })

        console.log(
            `[TURNAROUND] ${callsign}: ${hadActive ? 'trash ARR + ' : ''}clean DEP reprint → ${created.strip.sectionId}`,
        )

        return {
            flight,
            cleanReprint: true,
            freshReprint: true,
            multiUpdates,
            strip: created.strip,
            shiftedCallsigns: created.shiftedCallsigns,
        }
    }

    /**
     * Resolve strip assignment and build a strip result from the current flight state.
     */
    private resolveStripResult(
        callsign: string,
        flight: Flight,
        isNewStrip: boolean,
        restored?: boolean
    ): ProcessMessageResult {
        const targetSection = determineSectionForFlight(flight, this.config)
        const currentAssignment = this.stripAssignments.get(callsign)

        if (!targetSection) {
            // If the strip already has a placement (e.g. manually-created VFR strip),
            // keep it in place rather than soft-deleting it.
            if (currentAssignment) {
                const strip = this.createStrip(flight, currentAssignment.bayId, currentAssignment.sectionId, currentAssignment.position, currentAssignment.bottom)
                return { flight, strip }
            }
            return this.handleNoSectionFound(flight)
        }

        // Manual paper print: do not place a new strip until explicitly printed
        if (!currentAssignment && this.shouldGateNewStrip(callsign)) {
            return { flight }
        }

        if (flight.noSectionFound) {
            flight.noSectionFound = false
            flight.deleted = false
        }

        const ruleWantsDifferentSection = !!(
            currentAssignment &&
            (currentAssignment.bayId !== targetSection.bayId ||
                currentAssignment.sectionId !== targetSection.sectionId)
        )
        const holdRwySequence =
            !!currentAssignment &&
            ruleWantsDifferentSection &&
            this.shouldHoldInRwySequenceBay(flight, currentAssignment)
        const holdLandedArrOnRunway =
            !!currentAssignment &&
            ruleWantsDifferentSection &&
            this.shouldHoldLandedArrOnRunway(flight, currentAssignment)
        const holdUtflygning =
            !!currentAssignment &&
            ruleWantsDifferentSection &&
            this.shouldHoldInUtflygning(flight, currentAssignment)
        const holdAbovePush =
            !!currentAssignment &&
            ruleWantsDifferentSection &&
            this.shouldHoldInAbovePush(flight, currentAssignment)
        const holdVfrAirborne =
            !!currentAssignment &&
            ruleWantsDifferentSection &&
            this.shouldHoldVfrAirbornePlacement(
                flight,
                currentAssignment,
                targetSection.sectionId,
            )
        // Manual / peer-synced bay: hold until groundstate / ownership / airborne / CLR changes
        let holdManualSynced =
            !!currentAssignment &&
            ruleWantsDifferentSection &&
            flight.lastSectionRule === 'manual' &&
            !!flight.placementStickyKey &&
            flight.placementStickyKey === this.placementStickyFingerprint(flight)
        if (
            flight.lastSectionRule === 'manual' &&
            flight.placementStickyKey &&
            flight.placementStickyKey !== this.placementStickyFingerprint(flight)
        ) {
            // ES state moved on — allow rules again
            flight.placementStickyKey = undefined
            holdManualSynced = false
        }
        // CD ALL → TSAT → PUSH → TAXI: CLR / GS always win over sticky drag/sync.
        if (
            holdManualSynced &&
            currentAssignment &&
            this.isDepBayFlowStickyInvalid(flight, currentAssignment.sectionId)
        ) {
            console.log(
                `[RULE] ${callsign}: release sticky ${currentAssignment.sectionId} (clr=${!!flight.clearance} gs=${flight.groundstate || ""}) → ${targetSection.sectionId}`,
            )
            flight.placementStickyKey = undefined
            holdManualSynced = false
        }
        const holdSection =
            holdRwySequence ||
            holdLandedArrOnRunway ||
            holdUtflygning ||
            holdAbovePush ||
            holdVfrAirborne ||
            holdManualSynced
        const sectionChanged = ruleWantsDifferentSection && !holdSection

        let position: number
        let bottom: boolean
        let previousSection: { bayId: string; sectionId: string } | undefined

        const ruleSource = targetSection.ruleId ?? 'default'
        let setScratchValue: string | undefined

        if (isNewStrip || !currentAssignment) {
            this.markStripPrinted(callsign)
        }

        if (isNewStrip) {
            position = this.getNewStripPosition(targetSection.bayId, targetSection.sectionId, flight)
            bottom = false
            this.stripAssignments.set(callsign, {
                bayId: targetSection.bayId,
                sectionId: targetSection.sectionId,
                position,
                bottom
            })
            flight.lastSectionRule = ruleSource
            console.log(`[RULE] ${callsign} -> ${targetSection.sectionId} (rule: ${ruleSource}, new strip)`)
            if (!flight.synthetic && !flight.extractedRoute) {
                this.queueRouteExpand(callsign)
            }
        } else if (holdSection && currentAssignment) {
            // Manual RWY sequence bay, or landed ARR held on PÅ BANAN until drag to taxi
            position = currentAssignment.position
            bottom = currentAssignment.bottom
        } else if (sectionChanged && currentAssignment) {
            previousSection = {
                bayId: currentAssignment.bayId,
                sectionId: currentAssignment.sectionId
            }
            position = this.getNewStripPosition(targetSection.bayId, targetSection.sectionId, flight)
            bottom = false
            this.stripAssignments.set(callsign, {
                bayId: targetSection.bayId,
                sectionId: targetSection.sectionId,
                position,
                bottom
            })
            const previousRule = flight.lastSectionRule ?? 'unknown'
            flight.lastSectionRule = ruleSource
            console.log(`[RULE] ${callsign} ${previousSection.sectionId} -> ${targetSection.sectionId} (rule: ${ruleSource}, was: ${previousRule})`)
        } else if (currentAssignment) {
            position = currentAssignment.position
            bottom = currentAssignment.bottom
        } else {
            position = this.getNewStripPosition(targetSection.bayId, targetSection.sectionId, flight)
            bottom = false
            this.stripAssignments.set(callsign, {
                bayId: targetSection.bayId,
                sectionId: targetSection.sectionId,
                position,
                bottom
            })
            flight.lastSectionRule = ruleSource
            console.log(`[RULE] ${callsign} -> ${targetSection.sectionId} (rule: ${ruleSource}, recovered assignment)`)
        }

        const placeBayId =
            holdSection && currentAssignment ? currentAssignment.bayId : targetSection.bayId
        const placeSectionId =
            holdSection && currentAssignment
                ? currentAssignment.sectionId
                : targetSection.sectionId
        const appTransferTop = this.applyAppTransferCtrArrTop(
            callsign,
            flight,
            placeBayId,
            placeSectionId,
            position,
            bottom,
        )
        position = appTransferTop.position
        bottom = appTransferTop.bottom
        const gndTaxiPin = this.applyGndTaxiPin(
            callsign,
            flight,
            placeBayId,
            placeSectionId,
            position,
            bottom,
        )
        position = gndTaxiPin.position
        bottom = gndTaxiPin.bottom
        const utflygningPin = this.applyUtflygningPin(
            callsign,
            flight,
            placeBayId,
            placeSectionId,
            position,
            bottom,
        )
        position = utflygningPin.position
        bottom = utflygningPin.bottom
        const abovePushPin = this.applyAbovePushPin(
            callsign,
            flight,
            placeBayId,
            placeSectionId,
            position,
            bottom,
        )
        position = abovePushPin.position
        bottom = abovePushPin.bottom

        // ATYP/WTC changes: clear SLOW if no longer slow, else auto-add when eligible
        if (this.tryClearAutoSlowRemark(flight)) {
            setScratchValue = buildCombinedScratch(flight.remarks, flight.hp)
            this.holdScratchFields(flight)
        } else if (this.tryAutoSlowRemark(flight)) {
            setScratchValue = buildCombinedScratch(flight.remarks, flight.hp)
            this.holdScratchFields(flight)
        }

        const strip = this.createStrip(flight, placeBayId, placeSectionId, position, bottom)
        const shiftedCallsigns = this.getLastShiftedCallsigns()

        return {
            flight,
            strip,
            sectionChanged: sectionChanged ?? false,
            previousSection,
            restored,
            setScratchValue,
            shiftedCallsigns: shiftedCallsigns.length > 0 ? shiftedCallsigns : undefined,
            allowPositionChange:
                appTransferTop.bumped ||
                gndTaxiPin.bumped ||
                utflygningPin.bumped ||
                abovePushPin.bumped ||
                undefined,
        }
    }

    /**
     * Auto-add SLOW remark for ESSA IFR departure strips.
     * Arrivals/locals ignored; not re-added after manual clear; only 06:00–22:00 LT.
     */
    private tryAutoSlowRemark(flight: Flight): boolean {
        // ESSA IFR DEP only — not ARR, not ESSA–ESSA local
        if (flight.origin !== 'ESSA') return false
        if (!flight.destination || flight.destination === 'ESSA') return false
        if (!isIfrSidEligible(flight.flightRules)) return false
        if (flight.remarks) return false
        if (flight.autoSlowDismissed) return false
        if (!isEssaAutoSlowHours()) return false

        const wakeTurbulence = this.parseWakeCategory(flight.aircraftType, flight.wakeTurbulence)
        if (!isSlowAircraft(wakeTurbulence ?? '', flight.aircraftType ?? '', flight.engineType)) return false

        flight.remarks = 'SLOW'
        flight.autoSlowApplied = true
        console.log(`[REMARKS] ${flight.callsign}: - -> SLOW (auto)`)
        return true
    }

    /**
     * Remove auto-SLOW when ATYP/WTC is no longer a slow type.
     * Never clears controller-set SLOW (chip / track SID / typed remarks).
     */
    private tryClearAutoSlowRemark(flight: Flight): boolean {
        if (!flight.autoSlowApplied) return false
        if (flight.remarks !== 'SLOW') {
            flight.autoSlowApplied = false
            return false
        }

        const wakeTurbulence = this.parseWakeCategory(flight.aircraftType, flight.wakeTurbulence)
        if (isSlowAircraft(wakeTurbulence ?? '', flight.aircraftType ?? '', flight.engineType)) return false

        flight.remarks = undefined
        flight.autoSlowApplied = false
        console.log(`[REMARKS] ${flight.callsign}: SLOW -> - (auto, not slow)`)
        return true
    }

    /**
     * Remember that the controller cleared SLOW so we do not auto-add it again.
     * Skips dismissal when the aircraft is no longer slow (auto-removal from ATYP change).
     * Only call from intentional controller edits (updateRemarks) — not from ES scratch CAD.
     */
    markAutoSlowDismissed(flight: Flight, previousRemarks: string | undefined, nextRemarks: string | undefined) {
        // Controller-owned remarks — never treat as auto-SLOW
        if (hasSlowRemark(nextRemarks)) {
            flight.autoSlowApplied = false
        }
        if (!hasSlowRemark(previousRemarks) || hasSlowRemark(nextRemarks)) return

        flight.autoSlowApplied = false
        const wakeTurbulence = this.parseWakeCategory(flight.aircraftType, flight.wakeTurbulence)
        if (!isSlowAircraft(wakeTurbulence ?? '', flight.aircraftType ?? '', flight.engineType)) return

        flight.autoSlowDismissed = true
        console.log(`[REMARKS] ${flight.callsign}: auto-SLOW dismissed`)
    }

    /** Controller / track-SID set SLOW — must not be wiped by tryClearAutoSlowRemark */
    markSlowRemarkManual(flight: Flight): void {
        flight.autoSlowApplied = false
        if (hasSlowRemark(flight.remarks)) {
            flight.autoSlowDismissed = false
        }
    }

    /**
     * Prefer EFS-owned remarks/HP over incoming scratch for a short window
     * (AmendFlightPlan empty wipe, AHD/VECT clear race with stale ES echo).
     */
    holdScratchFields(flight: Flight, ms = 2500): void {
        const until = Date.now() + ms
        if ((flight.scratchFieldsHoldUntil ?? 0) < until) {
            flight.scratchFieldsHoldUntil = until
        }
    }

    /**
     * Process an incoming plugin message and return the result
     */
    processMessage(message: PluginMessage): ProcessMessageResult {
        switch (message.type) {
            case 'flightPlanDataUpdate':
                return this.handleFlightPlanDataUpdate(message)

            case 'controllerAssignedDataUpdate':
                return this.handleControllerAssignedDataUpdate(message)

            case 'flightPlanDisconnect':
                return this.handleFlightPlanDisconnect(message)

            case 'radarTargetPositionUpdate':
                return this.handleRadarTargetPositionUpdate(message)

            case 'ownershipUpdate':
                return this.handleOwnershipUpdate(message)

            case 'flightPlanFlightStripPushed':
                return this.handleFlightStripPushed(message)

            case 'cdmLocalUpdate':
                return this.handleCdmLocalUpdate(message)

            case 'cdmLocalHeartbeat':
                return this.handleCdmLocalHeartbeat()

            case 'controllerPositionUpdate':
            case 'controllerDisconnect':
            case 'myselfUpdate':
                // These don't affect flight data directly
                return {}

            default:
                return {}
        }
    }

    /** Accept only valid HHMM times from CDM_data (reject torn/mid-write garbage). */
    private normalizeCdmHhmm(raw: string | undefined): string | undefined {
        if (!raw) return undefined
        const digits = raw.replace(/\D/g, '')
        if (digits.length !== 3 && digits.length !== 4 && digits.length !== 6) return undefined
        const normalized = digits.length === 3
            ? digits.padStart(4, '0')
            : digits.slice(0, 4)
        const h = Number(normalized.slice(0, 2))
        const m = Number(normalized.slice(2, 4))
        if (h > 23 || m > 59) return undefined
        return normalized
    }

    /** Refresh local-CDM prefer TTL without changing times. */
    private handleCdmLocalHeartbeat(): ProcessMessageResult {
        const now = Date.now()
        for (const flight of this.flights.values()) {
            if (flight.localCdmAt != null) {
                flight.localCdmAt = now
            }
        }
        return {}
    }

    /**
     * CDM TOBT/TSAT only apply to ESSA IFR (I/Y) departures — not VFR/local.
     */
    private isCdmEligibleFlight(flight: Flight): boolean {
        if (flight.flightRules !== 'I' && flight.flightRules !== 'Y') return false
        if (flight.origin !== 'ESSA') return false
        // Local (both ends at our airports) uses stripType local — no CDM UI
        if (
            flight.destination &&
            this.config.myAirports.includes(flight.origin) &&
            this.config.myAirports.includes(flight.destination)
        ) {
            return false
        }
        return true
    }

    private clearCdmFields(flight: Flight): boolean {
        let changed = false
        if (flight.tobt !== undefined) { flight.tobt = undefined; changed = true }
        if (flight.tsat !== undefined) { flight.tsat = undefined; changed = true }
        if (flight.ttot !== undefined) { flight.ttot = undefined; changed = true }
        if (flight.tobtSetBy !== undefined) { flight.tobtSetBy = undefined; changed = true }
        if (flight.tobtSetByAt !== undefined) { flight.tobtSetByAt = undefined; changed = true }
        if (flight.asrt !== undefined) { flight.asrt = undefined; changed = true }
        if (flight.tsac !== undefined) { flight.tsac = undefined; changed = true }
        if (flight.ctoc !== undefined) { flight.ctoc = undefined; changed = true }
        if (flight.cdmSts !== undefined) { flight.cdmSts = undefined; changed = true }
        if (flight.localCdmTobt !== undefined) { flight.localCdmTobt = undefined; changed = true }
        if (flight.localCdmTsat !== undefined) { flight.localCdmTsat = undefined; changed = true }
        if (flight.localCdmTtot !== undefined) { flight.localCdmTtot = undefined; changed = true }
        if (flight.localCdmAt !== undefined) { flight.localCdmAt = undefined; changed = true }
        return changed
    }

    /**
     * Apply TOBT/TSAT/CTOT from local CDM_data_*.txt (via EuroScope plugin).
     * Faster than HTTP poll; does not clear fields when absent in the file.
     */
    private handleCdmLocalUpdate(message: import('./types.js').CdmLocalUpdateMessage): ProcessMessageResult {
        const strips: FlightStrip[] = []
        const now = Date.now()
        const entries = message.flights ?? []

        // Detect likely torn-file swaps: two callsigns exchanging TOBT in one batch
        const tobtByCs = new Map<string, string>()
        for (const entry of entries) {
            const cs = entry.callsign?.toUpperCase()
            const tobt = this.normalizeCdmHhmm(entry.tobt)
            if (cs && tobt) tobtByCs.set(cs, tobt)
        }
        const rejected = new Set<string>()
        for (const [csA, tobtA] of tobtByCs) {
            const flightA = this.flights.get(csA)
            if (!flightA?.tobt || flightA.tobt === tobtA) continue
            for (const [csB, tobtB] of tobtByCs) {
                if (csA >= csB) continue
                const flightB = this.flights.get(csB)
                if (!flightB?.tobt || flightB.tobt === tobtB) continue
                if (tobtA === flightB.tobt && tobtB === flightA.tobt) {
                    rejected.add(csA)
                    rejected.add(csB)
                    console.warn(`[CDM] Ignoring swapped TOBT batch for ${csA}/${csB}`)
                }
            }
        }

        for (const entry of entries) {
            const callsign = entry.callsign?.toUpperCase()
            if (!callsign || rejected.has(callsign)) continue
            const flight = this.flights.get(callsign)
            if (!flight) continue

            if (!this.isCdmEligibleFlight(flight)) {
                if (this.clearCdmFields(flight)) {
                    const strip = this.regenerateStrip(callsign)
                    if (strip) strips.push(strip)
                }
                continue
            }

            let changed = false
            // Pin local ES CDM_data values so the slower HTTP poll cannot overwrite them
            if (entry.tobt !== undefined) {
                const tobt = this.normalizeCdmHhmm(entry.tobt)
                if (tobt) {
                    flight.localCdmTobt = tobt
                    flight.localCdmAt = now
                    if (tobt !== flight.tobt) {
                        flight.tobt = tobt
                        changed = true
                    }
                }
            }
            // CDM TOBT-SET-BY from ES strip annotation (plugin reads CDM field 9).
            // vIFF depAirport does not expose setBy — ES annotation is the source of truth.
            if (entry.tobtSetBy === 'P' || entry.tobtSetBy === 'A') {
                if (flight.tobtSetBy !== entry.tobtSetBy) {
                    flight.tobtSetBy = entry.tobtSetBy
                    flight.tobtSetByAt = entry.tobtSetBy === 'A' ? now : undefined
                    changed = true
                }
            } else if (
                // Only clear when CDM says blank AND TOBT==EOBT (or TOBT cleared).
                // Empty setBy alone must not wipe A — annotation can lag CDM_data by a poll.
                entry.tobtSetBy === '' &&
                flight.tobtSetBy !== undefined &&
                (!flight.tobt || !flight.eobt || flight.tobt === flight.eobt)
            ) {
                flight.tobtSetBy = undefined
                flight.tobtSetByAt = undefined
                changed = true
            } else if (
                entry.tobt !== undefined &&
                flight.tobt &&
                flight.eobt &&
                flight.tobt === flight.eobt &&
                flight.tobtSetBy !== undefined
            ) {
                flight.tobtSetBy = undefined
                flight.tobtSetByAt = undefined
                changed = true
            }
            if (entry.tsat !== undefined) {
                const tsat = this.normalizeCdmHhmm(entry.tsat)
                if (tsat) {
                    flight.localCdmTsat = tsat
                    flight.localCdmAt = now
                    if (tsat !== flight.tsat) {
                        flight.tsat = tsat
                        changed = true
                    }
                }
            }
            if (entry.ttot !== undefined) {
                const ttot = this.normalizeCdmHhmm(entry.ttot)
                if (ttot) {
                    flight.localCdmTtot = ttot
                    flight.localCdmAt = now
                    if (ttot !== flight.ttot) {
                        flight.ttot = ttot
                        changed = true
                    }
                }
            }
            // ASRT (Ready Startup) from CDM strip annotation field 0
            if (entry.asrt !== undefined) {
                const asrt = entry.asrt === '' ? undefined : this.normalizeCdmHhmm(entry.asrt)
                if (asrt !== flight.asrt) {
                    flight.asrt = asrt
                    changed = true
                }
            }
            // TSAC (communicated TSAT) — annotation field 1
            if (entry.tsac !== undefined) {
                const tsac = entry.tsac === '' ? undefined : this.normalizeCdmHhmm(entry.tsac)
                if (tsac !== flight.tsac) {
                    flight.tsac = tsac
                    changed = true
                }
            }
            // CTOC (communicated CTOT) — annotation field 8
            if (entry.ctoc !== undefined) {
                const ctoc = entry.ctoc === '' ? undefined : this.normalizeCdmHhmm(entry.ctoc)
                if (ctoc !== flight.ctoc) {
                    flight.ctoc = ctoc
                    changed = true
                }
            }
            // CTOT: non-empty applies (+ pins against HTTP wipe); explicit '' clears local CTOT.
            // Omitted/undefined leaves CTOT unchanged (torn ES file must not wipe HTTP CTOT).
            if (entry.ctot !== undefined) {
                const ctot = entry.ctot === '' ? undefined : this.normalizeCdmHhmm(entry.ctot)
                if (ctot) {
                    flight.localCdmAt = now
                    if (ctot !== flight.ctot || flight.ctotCancelled || flight.ctotClearedAt) {
                        flight.ctot = ctot
                        flight.ctotCancelled = undefined
                        flight.ctotClearedAt = undefined
                        changed = true
                    }
                } else if (flight.ctot || flight.ctotCancelled || flight.ctotClearedAt || flight.ctotReason) {
                    flight.ctot = undefined
                    flight.ctotCancelled = undefined
                    flight.ctotClearedAt = undefined
                    flight.ctotReason = undefined
                    changed = true
                }
            }
            if (entry.ctotReason !== undefined && entry.ctotReason !== flight.ctotReason) {
                flight.ctotReason = entry.ctotReason || undefined
                changed = true
            }
            if (!changed) {
                // Still refresh pin TTL when we saw a valid local row for this flight
                if (flight.localCdmAt != null) flight.localCdmAt = now
                continue
            }

            flight.lastUpdate = now
            const strip = this.regenerateStrip(callsign)
            if (strip) strips.push(strip)
        }
        return strips.length > 0 ? { strips } : {}
    }

    /**
     * Dev/test: set or clear CDM times on any known flight (no ESSA eligibility gate).
     * Pins localCdmAt so the HTTP CDM poll does not wipe values for ~2 min.
     * Pass `""` / null to clear a field; omit to leave unchanged.
     */
    applyDevSpoof(callsign: string, fields: DevSpoofFields): FlightStrip | undefined {
        const key = callsign.trim().toUpperCase()
        const flight = this.flights.get(key)
        if (!flight) return undefined

        const now = Date.now()
        let changed = false
        let pin = false

        const applyHhmm = (
            raw: string | null | undefined,
            getter: () => string | undefined,
            setter: (v: string | undefined) => void,
            alsoPinLocal?: (v: string) => void,
        ) => {
            if (raw === undefined) return
            if (raw === null || raw === '') {
                if (getter() !== undefined) {
                    setter(undefined)
                    changed = true
                }
                return
            }
            const hhmm = this.normalizeCdmHhmm(raw)
            if (!hhmm) return
            pin = true
            alsoPinLocal?.(hhmm)
            if (getter() !== hhmm) {
                setter(hhmm)
                changed = true
            }
        }

        applyHhmm(
            fields.tobt,
            () => flight.tobt,
            (v) => { flight.tobt = v },
            (v) => { flight.localCdmTobt = v },
        )
        applyHhmm(
            fields.tsat,
            () => flight.tsat,
            (v) => { flight.tsat = v },
            (v) => { flight.localCdmTsat = v },
        )
        applyHhmm(
            fields.ttot,
            () => flight.ttot,
            (v) => { flight.ttot = v },
            (v) => { flight.localCdmTtot = v },
        )
        applyHhmm(
            fields.ctot,
            () => flight.ctot,
            (v) => {
                flight.ctot = v
                flight.ctotCancelled = undefined
                flight.ctotClearedAt = undefined
                // Clearing CTOT also drops reason unless explicitly re-set below
                if (!v && fields.ctotReason === undefined) {
                    flight.ctotReason = undefined
                }
            },
        )
        applyHhmm(fields.asrt, () => flight.asrt, (v) => { flight.asrt = v })
        applyHhmm(fields.tsac, () => flight.tsac, (v) => { flight.tsac = v })
        applyHhmm(fields.ctoc, () => flight.ctoc, (v) => { flight.ctoc = v })

        if (fields.ctotReason !== undefined) {
            const reason = fields.ctotReason === null || fields.ctotReason === ''
                ? undefined
                : fields.ctotReason
            if (flight.ctotReason !== reason) {
                flight.ctotReason = reason
                changed = true
            }
        }
        if (fields.tobtSetBy !== undefined) {
            const setBy = fields.tobtSetBy === null || fields.tobtSetBy === ''
                ? undefined
                : fields.tobtSetBy === 'P' || fields.tobtSetBy === 'A'
                    ? fields.tobtSetBy
                    : undefined
            if (flight.tobtSetBy !== setBy) {
                flight.tobtSetBy = setBy
                flight.tobtSetByAt = setBy === 'A' ? now : undefined
                changed = true
            }
        }
        if (fields.cdmSts !== undefined) {
            const sts = fields.cdmSts === null || fields.cdmSts === ''
                ? undefined
                : fields.cdmSts
            if (flight.cdmSts !== sts) {
                flight.cdmSts = sts
                changed = true
            }
            // Pin so HTTP CDM poll cannot wipe spoofed SRM/SLC/FLS
            if (sts) pin = true
        }

        if (fields.clearAll) {
            if (this.clearCdmFields(flight)) changed = true
            if (flight.ctot !== undefined) { flight.ctot = undefined; changed = true }
            if (flight.ctotCancelled) { flight.ctotCancelled = undefined; changed = true }
            if (flight.ctotClearedAt !== undefined) { flight.ctotClearedAt = undefined; changed = true }
            if (flight.ctotReason !== undefined) { flight.ctotReason = undefined; changed = true }
        }

        if (pin || changed) flight.localCdmAt = now
        if (!changed && !pin) return this.regenerateStrip(key)

        flight.lastUpdate = now
        return this.regenerateStrip(key)
    }

    /** Snapshot of CDM-related fields for the spoof REPL / API. */
    getDevSpoofSnapshot(callsign: string): DevSpoofSnapshot | undefined {
        const flight = this.flights.get(callsign.trim().toUpperCase())
        if (!flight) return undefined
        return {
            callsign: flight.callsign,
            origin: flight.origin,
            destination: flight.destination,
            flightRules: flight.flightRules,
            groundstate: flight.groundstate,
            tobt: flight.tobt,
            tsat: flight.tsat,
            ttot: flight.ttot,
            ctot: flight.ctot,
            ctotReason: flight.ctotReason,
            ctotCancelled: flight.ctotCancelled,
            cdmSts: flight.cdmSts,
            asrt: flight.asrt,
            tsac: flight.tsac,
            ctoc: flight.ctoc,
            tobtSetBy: flight.tobtSetBy,
            localCdmAt: flight.localCdmAt,
        }
    }

    /**
     * Apply tracking/handoff fields from plugin. Protects EFS-optimistic outbound handoff
     * from being cleared by a premature empty dump right after InitiateHandoff.
     */
    private applyOwnershipFromPlugin(
        flight: Flight,
        message: {
            controller?: string
            controllerId?: string
            handoffTargetController?: string
            handoffTargetControllerId?: string
        },
        logTag: string
    ) {
        const callsign = flight.callsign
        if (message.controller !== undefined && message.controller !== flight.controller)
            console.log(`[${logTag}] ${callsign} controller: ${flight.controller ?? '-'} -> ${message.controller || '(cleared)'}`)
        if (message.handoffTargetController !== undefined && message.handoffTargetController !== flight.handoffTargetController)
            console.log(`[${logTag}] ${callsign} handoff: ${flight.handoffTargetController ?? '-'} -> ${message.handoffTargetController || '(cleared)'}`)

        const myCs = (this.config.myCallsign || '').toUpperCase()
        const mySi = (this.config.myPositionId || '').toUpperCase()
        // Protect EFS ASSUME from brief empty ES echoes after StartTracking
        const ownershipOptimistic =
            flight.ownershipOptimisticUntil !== undefined &&
            Date.now() < flight.ownershipOptimisticUntil

        if (message.controller !== undefined) {
            const incoming = (message.controller || '').toUpperCase()
            const isMe = !!myCs && incoming === myCs
            const clearing = !incoming
            if (ownershipOptimistic && !isMe) {
                // Keep EFS owner through empty clears during optimistic window
            } else {
                flight.controller = message.controller
                if (isMe) {
                    flight.ownershipOptimisticUntil = undefined
                } else if (clearing || (incoming && incoming !== myCs)) {
                    flight.handoffOptimisticUntil = undefined
                    flight.ownershipOptimisticUntil = undefined
                    if (flight.rofRequestFrom) this.clearRofRequest(flight)
                }
            }
        }
        // Apply SI even when callsign is empty (ES often omits tracking callsign at TWR).
        if (message.controllerId !== undefined) {
            const incomingSi = (message.controllerId || '').toUpperCase()
            const siIsMe = !!mySi && incomingSi === mySi
            if (ownershipOptimistic && !siIsMe && !incomingSi) {
                // keep optimistic SI through empty echo
            } else if (ownershipOptimistic && incomingSi && !siIsMe) {
                // Other SI = StartTracking did not take the track; adopt ES ownership
                flight.controllerId = message.controllerId || undefined
                if (message.controller !== undefined) flight.controller = message.controller
                else if (myCs && (flight.controller || '').toUpperCase() === myCs) flight.controller = ''
                flight.ownershipOptimisticUntil = undefined
            } else {
                flight.controllerId = message.controllerId || undefined
                if (siIsMe) flight.ownershipOptimisticUntil = undefined
            }
        } else if (
            message.controller !== undefined &&
            !message.controller &&
            !ownershipOptimistic
        ) {
            flight.controllerId = undefined
        }
        if (message.handoffTargetController !== undefined) {
            const clearing = !message.handoffTargetController
            const protectOptimistic =
                clearing &&
                !!flight.handoffTargetController &&
                flight.handoffOptimisticUntil !== undefined &&
                Date.now() < flight.handoffOptimisticUntil &&
                (flight.controller === this.config.myCallsign || flight.controller === undefined)
            if (!protectOptimistic) {
                flight.handoffTargetController = message.handoffTargetController
                if (!message.handoffTargetController) flight.handoffTargetControllerId = undefined
                if (message.handoffTargetController) flight.handoffOptimisticUntil = undefined
            }
        }
        if (message.handoffTargetControllerId !== undefined) {
            // Don't clobber SI while optimistic handoff is protected
            if (!flight.handoffOptimisticUntil || message.handoffTargetController) {
                flight.handoffTargetControllerId = message.handoffTargetControllerId || undefined
            }
        }
    }

    /**
     * Coordination pending flags from plugin (exit COPX/XFL and/or entry COPN/PEL):
     * - exitCoordPending = REQUESTED_BY_OTHER (inbound ACC proposal)
     * - exitCoordOutbound = REQUESTED_BY_ME (our DEP COORD / XFL request)
     * Plugin always sends both booleans so we can clear sticky state.
     * Returns 'request' on rising edge (inbound proposal), 'accept' when
     * plugin flags exitCoordAccepted (explicit ACCEPTED/MANUAL_ACCEPTED → auto-DepC),
     * 'refuse' on rising edge of exitCoordRefused (explicit COORDINATION_STATE_REFUSED).
     */
    private applyExitCoordProposal(
        flight: Flight,
        message: {
            exitCoordPending?: boolean
            exitCoordOutbound?: boolean
            exitCoordRefused?: boolean
            exitCoordPoint?: string
            exitCoordAltitude?: number
            exitCoordAccepted?: boolean
            coo?: boolean
        },
    ): 'request' | 'accept' | 'refuse' | undefined {
        let sound: 'request' | 'accept' | 'refuse' | undefined
        // Sticky outbound before this packet (refuse sound needs it when packet clears outbound).
        const wasOutbound = !!flight.exitCoordOutbound
        // Apply outbound first; accept/refuse below always win so a same-packet
        // exitCoordOutbound:true (AppendXfl sticky REQUESTED_BY_ME) cannot re-pink.
        if (message.exitCoordOutbound !== undefined) {
            // Explicit false clears sticky true (cycle closed / cancel / accept / refuse).
            const outbound = !!message.exitCoordOutbound
            flight.exitCoordOutbound = outbound ? true : undefined
            // New outbound REQUESTED_BY_ME clears sticky refuse highlight
            if (outbound) flight.exitCoordRefused = undefined
        }
        if (message.exitCoordAccepted) {
            sound = 'accept'
            flight.exitCoordRefused = undefined
            flight.exitCoordOutbound = undefined
        }
        if (message.exitCoordRefused === true) {
            // Rising edge + had outbound REQUESTED_BY_ME → ACC refused our request.
            // Skip when we refuse inbound OTHER (UI already plays refuse; outbound was false).
            if (!flight.exitCoordRefused && wasOutbound && sound !== 'accept') {
                sound = 'refuse'
            }
            flight.exitCoordRefused = true
            flight.exitCoordOutbound = undefined
        } else if (message.exitCoordRefused === false) {
            flight.exitCoordRefused = undefined
        }
        // DepC checkmark clears amber refuse highlight
        if (message.coo === true) {
            flight.exitCoordRefused = undefined
        }
        if (message.exitCoordPending === undefined) return sound
        if (!message.exitCoordPending) {
            flight.exitCoordPending = undefined
            flight.exitCoordPoint = undefined
            flight.exitCoordAltitude = undefined
            return sound
        }
        const wasPending = !!flight.exitCoordPending
        flight.exitCoordPending = true
        // ACC counter-proposal (REQUESTED_BY_OTHER) supersedes amber refuse —
        // e.g. ESMS 1000→4000 handshake must show pink Accept, not sticky refuse.
        flight.exitCoordRefused = undefined
        const point = (message.exitCoordPoint || "").trim().toUpperCase()
        flight.exitCoordPoint = point || undefined
        flight.exitCoordAltitude =
            typeof message.exitCoordAltitude === "number" && message.exitCoordAltitude > 0
                ? message.exitCoordAltitude
                : undefined
        if (!wasPending && !sound) sound = 'request'
        return sound
    }

    /**
     * Handle flightPlanDataUpdate message
     */
    private handleFlightPlanDataUpdate(message: FlightPlanDataUpdateMessage): ProcessMessageResult {
        const callsign = message.callsign
        const flight = this.getOrCreateFlight(callsign)
        const hadRequiredData = flightHasRequiredData(flight)
        const prevController = flight.controller
        const prevHandoff = flight.handoffTargetController
        const prevFpl = {
            origin: flight.origin,
            destination: flight.destination,
            eobt: flight.eobt,
            route: flight.route,
        }
        const prevFingerprint = flightPlanFingerprint(prevFpl)
        const hadActiveStrip = this.stripAssignments.has(callsign)

        // Update flight data
        if (message.origin !== undefined) flight.origin = message.origin
        if (message.destination !== undefined) flight.destination = message.destination
        if (message.alternate !== undefined) flight.alternate = message.alternate
        if (message.aircraftType !== undefined) flight.aircraftType = message.aircraftType
        if (message.wakeTurbulence !== undefined) flight.wakeTurbulence = message.wakeTurbulence
        if (message.engineType !== undefined) flight.engineType = message.engineType || undefined
        if (message.capabilities !== undefined) {
            flight.capabilities = message.capabilities || undefined
        }
        if (message.rvsm !== undefined) {
            flight.rvsm = message.rvsm
        }
        if (
            message.aircraftInfo !== undefined ||
            message.capabilities !== undefined ||
            message.rvsm !== undefined
        ) {
            if (message.aircraftInfo !== undefined) {
                flight.aircraftInfo = message.aircraftInfo || undefined
            }
            const parsed = parseAircraftInfo(flight.aircraftInfo, flight.capabilities, flight.rvsm)
            // ES ICAO info wins over any prior FAA conversion
            if (parsed.equipment || parsed.surveillance || parsed.faaEquipment) {
                applyParsedEquipment(flight, parsed, flight.aircraftInfo)
            }
        }
        if (message.flightRules !== undefined) flight.flightRules = message.flightRules
        if (message.communicationType !== undefined) {
            flight.communicationType = message.communicationType || undefined
        }
        const prevRoute = flight.route
        const prevSid = flight.sid
        if (message.route !== undefined) flight.route = message.route
        const routeChanged = message.route !== undefined && message.route !== prevRoute
        // Filed route moved — drop the old expansion so DCT falls back to the
        // filed route until the one-shot spawn/amend expansion arrives.
        if (routeChanged && message.extractedRoute === undefined) {
            flight.extractedRoute = undefined
        }
        if (message.extractedRoute !== undefined) {
            const er = message.extractedRoute.trim()
            flight.extractedRoute = er || undefined
        }
        if (message.tas !== undefined) {
            // Plugin sends knots (number); VATSIM/tests may send "N0430"
            if (typeof message.tas === "number") {
                flight.tas = formatTasKnots(message.tas)
            } else {
                flight.tas = normalizeCruiseTas(message.tas) || undefined
            }
        }
        if (message.eobt !== undefined) flight.eobt = message.eobt
        if (message.filedEet !== undefined) flight.filedEet = message.filedEet || undefined
        if (message.endurance !== undefined) flight.endurance = message.endurance || undefined
        if (message.pilotName !== undefined) flight.pilotName = message.pilotName || undefined
        if (message.ete !== undefined) flight.ete = message.ete
        // Filed FPL cruise altitude → RFL; explicit positive RFL (CAD) wins if present
        if (message.altitude !== undefined && message.altitude > 0) {
            flight.rfl = message.altitude
        }
        if (message.rfl !== undefined && message.rfl > 0) {
            flight.rfl = message.rfl
        }
        if (message.xfl !== undefined) {
            flight.xfl = message.xfl > 0 ? message.xfl : undefined
        }
        const exitCoordSound = this.applyExitCoordProposal(flight, message)
        if (message.fplRemarks !== undefined) {
            flight.fplRemarks = message.fplRemarks || undefined
            const dof = parseDofFromRemarks(flight.fplRemarks)
            if (dof) flight.eobd = dof
        }
        if (message.arrRwy !== undefined) flight.arrRwy = message.arrRwy
        if (message.star !== undefined) flight.star = message.star
        // Always-sent from plugin ("" when cleared) — keep FPR gate in sync with ES
        if (message.depRwy !== undefined) flight.depRwy = message.depRwy || undefined
        if (message.sid !== undefined) flight.sid = message.sid || undefined
        // FPL/SID edit in ES: drop sticky override when FPL no longer forces that SID
        const sidChanged =
            message.sid !== undefined && (message.sid || undefined) !== prevSid
        if (flight.sidDisplayOverride && (routeChanged || sidChanged)) {
            const forcedPrefix = routeForcedSidPrefix(flight.route)
            if (!forcedPrefix || !sidMatchesRoutePrefix(flight.sidDisplayOverride, forcedPrefix)) {
                flight.sidDisplayOverride = undefined
            }
        }
        // Route lost forced SID — drop stale track GetSid so strip can show ESE preferred
        if (routeChanged && !hasForcedSidInRoute(flight.route)) {
            if (flight.sid && isTrackSidName(flight.sid)) {
                flight.sid = undefined
            }
            flight.sidDisplayOverride = undefined
        }
        // Route changed but plugin omitted sid (older builds): don't keep a stale GetSid()
        if (routeChanged && message.sid === undefined && flight.sid && flight.sid === prevSid) {
            const first = firstSignificantRouteFix(flight.route || "")
            const special = flight.route?.split(/\s+/)[0] ?? ""
            const specialPrefix = special.includes("/") ? special.split("/")[0] : ""
            const stillInRoute =
                (first && (first === flight.sid || flight.sid.startsWith(first))) ||
                (specialPrefix && (specialPrefix === flight.sid || sameTrackSidExit(flight.sid, specialPrefix)))
            if (!stillInRoute) {
                flight.sid = undefined
                flight.sidDisplayOverride = undefined
            }
        }
        this.applyOwnershipFromPlugin(flight, message, 'DATA')
        if (message.nextController !== undefined) flight.nextController = message.nextController
        if (message.nextControllerFrequency !== undefined) flight.nextControllerFrequency = message.nextControllerFrequency
        // ESSA heavy DEP RWY (01L/19R) is applied in auto-LOP prep (server autoAssignCflAndSquawk)
        flight.lastUpdate = Date.now()

        // Active ARR strip + new outbound FPL (turnaround before PARK): trash ARR, clean DEP print.
        // Park-trash path is handled inside finalizeFlightStrips / applyDeleteRules.
        const fplChanged = flightPlanFingerprint(flight) !== prevFingerprint
        if (
            hadActiveStrip &&
            !flight.deleted &&
            !flight.manuallyDeleted &&
            fplChanged &&
            isArrivalToOutboundTurnaroundFpl(prevFpl, flight, this.config.myAirports)
        ) {
            console.log(
                `Flight ${callsign} turnaround FPL while ARR on bay — trash ARR, clean DEP reprint`,
            )
            const result = this.withTransferSound(
                this.reprintCleanDepartureAfterTurnaround(flight),
                prevController,
                prevHandoff,
                flight,
            )
            if (exitCoordSound && !result.transferSound) result.transferSound = exitCoordSound
            this.queueRouteExpandIfPresent(callsign, flight, result, routeChanged)
            return result
        }

        const result = this.withTransferSound(
            this.finalizeFlightStrips(
                callsign,
                flight,
                !hadRequiredData || !this.stripAssignments.get(callsign)
            ),
            prevController,
            prevHandoff,
            flight
        )
        if (exitCoordSound && !result.transferSound) result.transferSound = exitCoordSound
        this.queueRouteExpandIfPresent(callsign, flight, result, routeChanged)
        return result
    }

    /**
     * Handle lightweight ownership poll (transfer assume/accept/refuse).
     */
    private handleOwnershipUpdate(message: OwnershipUpdateMessage): ProcessMessageResult {
        const callsign = message.callsign
        const flight = this.flights.get(callsign)
        if (!flight) return {}

        const prevController = flight.controller
        const prevHandoff = flight.handoffTargetController
        this.applyOwnershipFromPlugin(flight, message, 'OWN')

        // trackedByMe=false is authoritative when callsign fields lag after a remote accept.
        // Skip during ASSUME optimistic window (StartTracking echo may lag a tick).
        const ownershipOptimistic =
            flight.ownershipOptimisticUntil !== undefined &&
            Date.now() < flight.ownershipOptimisticUntil
        if (
            message.trackedByMe === false &&
            !ownershipOptimistic &&
            !!this.config.myCallsign &&
            (flight.controller || '').toUpperCase() === this.config.myCallsign.toUpperCase()
        ) {
            console.log(`[OWN] ${callsign} trackedByMe=false while controller still me — clearing ownership (remote accept)`)
            flight.controller = ''
            flight.controllerId = undefined
            flight.handoffTargetController = ''
            flight.handoffTargetControllerId = undefined
            flight.handoffOptimisticUntil = undefined
            flight.ownershipOptimisticUntil = undefined
        }

        flight.lastUpdate = Date.now()

        const result = this.withTransferSound(
            this.finalizeFlightStrips(callsign, flight, !this.stripAssignments.get(callsign)),
            prevController,
            prevHandoff,
            flight
        )
        // Assume may have landed after the first scratch clear (written before we tracked).
        this.maybeRestoreEfshoScratch(result, flight)
        return result
    }

    /**
     * Handle controllerAssignedDataUpdate message
     */
    private handleControllerAssignedDataUpdate(message: ControllerAssignedDataUpdateMessage): ProcessMessageResult {
        const callsign = message.callsign
        const flight = this.getOrCreateFlight(callsign)
        const hadRequiredData = flightHasRequiredData(flight)
        const prevController = flight.controller
        const prevHandoff = flight.handoffTargetController

        if (message.groundstate !== undefined && message.groundstate !== flight.groundstate
                && (message.groundstate !== '' || (flight.groundstate ?? '') !== ''))
            console.log(`[ASSIGN] ${callsign} groundstate: ${flight.groundstate ?? '-'} -> ${message.groundstate}`)
        if (message.clearedToLand !== undefined && message.clearedToLand !== flight.clearedToLand)
            console.log(`[ASSIGN] ${callsign} clearedToLand: ${message.clearedToLand}`)
        if (message.scratch === 'MISAP_' && !flight.missedApproach)
            console.log(`[ASSIGN] ${callsign} missedApproach`)
        else if (message.scratch === '' && flight.missedApproach)
            console.log(`[ASSIGN] ${callsign} missedApproach cleared`)
        if (message.scratch === 'WX_' && !flight.weatherGiven)
            console.log(`[ASSIGN] ${callsign} weatherGiven (WX_)`)

        // Update flight data
        this.applyOwnershipFromPlugin(flight, message, 'ASSIGN')
        // CAD can arrive before FPL (plugin EnsureFlightPlanPushed / AppendBasicFlightPlanFields).
        // Apply ADEP/ADES so strips become eligible without waiting for a separate FPL packet.
        if (message.origin !== undefined && message.origin) flight.origin = message.origin
        if (message.destination !== undefined && message.destination) {
            flight.destination = message.destination
        }
        if (message.alternate !== undefined && message.alternate) flight.alternate = message.alternate
        if (message.aircraftType !== undefined && message.aircraftType) {
            flight.aircraftType = message.aircraftType
        }
        // Any CAD means ES has reported assigned data for this FP (Refresh always sends CAD).
        // Critical for deferring TopSky SSR allocate until existing ASSR can land.
        flight.controllerAssignedSeen = true
        if (message.squawk !== undefined) {
            // ASSR must be ICAO octal (0–7). Ignore junk like "9875" from interim ES updates.
            const next = normalizeAssignedSquawk(message.squawk)
            if (next !== undefined) {
                const prev = flight.squawk
                if (prev && next && prev !== next) {
                    flight.previousSquawk = prev
                }
                flight.squawk = next || undefined
            }
        }
        // Ignore CAD final=0 (unset override) so FPL altitude RFL is not wiped
        if (message.rfl !== undefined && message.rfl > 0) flight.rfl = message.rfl
        if (message.cfl !== undefined) {
            flight.cfl = message.cfl
            // Real altitude clears approach-type label
            if (message.cfl === 0 || message.cfl > 2) flight.approachType = undefined
        }
        if (message.xfl !== undefined) {
            flight.xfl = message.xfl > 0 ? message.xfl : undefined
        }
        const exitCoordSound = this.applyExitCoordProposal(flight, message)
        // Ground state — GRP xLU often only in scratch while GetGroundState()
        // stays coarse "TAXI" (SDK). Precise scratch/ES tokens win; never let
        // coarse TAXI wipe LINEUP on reload.
        const incomingGs = resolveIncomingGroundstate({
            scratch: message.scratch,
            groundstate: message.groundstate,
            current: flight.groundstate,
        })
        if (incomingGs === '') {
            // Don't let empty wipe an EFS-held TXIN/TAXI (runway ARR echo often clears first)
            const holdingEfsGs =
                flight.groundstateHoldUntil !== undefined &&
                Date.now() < flight.groundstateHoldUntil &&
                !!flight.groundstate
            if (!holdingEfsGs) {
                flight.groundstate = ''
                flight.groundstateClearedUntil = Date.now() + 3000
                flight.groundstateHoldUntil = undefined
            }
        } else if (incomingGs !== undefined && incomingGs !== '') {
            const holdingClear =
                flight.groundstateClearedUntil !== undefined &&
                Date.now() < flight.groundstateClearedUntil
            // EFS just set TXIN/TAXI/… — ignore ES still reporting ARR (common on runway)
            const holdingEfsGs =
                flight.groundstateHoldUntil !== undefined &&
                Date.now() < flight.groundstateHoldUntil &&
                incomingGs !== flight.groundstate
            if (holdingClear) {
                // keep cleared
            } else if (holdingEfsGs) {
                // keep EFS-set groundstate
            } else {
                flight.groundstate = incomingGs
                if (incomingGs === 'PARK') flight.airborne = false
                flight.groundstateClearedUntil = undefined
                flight.groundstateHoldUntil = undefined
            }
        }
        if (message.clearance !== undefined) {
            const holdingClr =
                flight.clearanceHoldUntil !== undefined &&
                Date.now() < flight.clearanceHoldUntil &&
                !!flight.clearance !== !!message.clearance
            if (holdingClr) {
                // Keep EFS-set CLR until EuroScope catches up
            } else {
                if (
                    flight.clearanceHoldUntil !== undefined &&
                    !!flight.clearance === !!message.clearance
                ) {
                    flight.clearanceHoldUntil = undefined
                }
                flight.clearance = message.clearance
                // Keep paper col 4/5 in lockstep with ES CLR.
                // A confirmed DCL (WILCO/ROGER) keeps the right-box check if ES never latches CLR.
                const dclConfirmed =
                    flight.dclStatus === "DONE" || flight.dclStatus === "WILCO"
                const keepPaperDclReadback =
                    this.config.look === "paper" &&
                    dclConfirmed &&
                    !!flight.clearanceReadback &&
                    !message.clearance
                if (message.clearance) {
                    flight.clearanceRead = true
                    flight.clearanceReadback = true
                } else if (keepPaperDclReadback) {
                    // leave clearanceRead / clearanceReadback (right box stays checked)
                } else {
                    flight.clearanceRead = false
                    flight.clearanceReadback = false
                }
            }
        }
        // Soft G/A must not wipe CTL that was already set before/when G/A was applied.
        // Paper: once CTL is on the strip, ignore VCH clearing it (landing / ATA / list).
        // Explicit EFS unsetCTL / move rules set flight.clearedToLand = false locally first.
        if (message.clearedToLand !== undefined) {
            const softGaKeepCtl =
                message.clearedToLand === false &&
                !!flight.clearedToLand &&
                (message.efsGoAround === true || !!flight.efsGoAround)
            const paperKeepCtl =
                message.clearedToLand === false &&
                !!flight.clearedToLand &&
                this.config.look === 'paper'
            if (!softGaKeepCtl && !paperKeepCtl) {
                flight.clearedToLand = message.clearedToLand
            }
        }
        if (message.communicationType !== undefined) {
            flight.communicationType = message.communicationType || undefined
        }
        // EFS soft G/A (annotation 5) — syncs across EFS users; not TopSky MISAP_
        if (message.efsGoAround !== undefined) {
            flight.efsGoAround = message.efsGoAround
        }
        // TopSky G/A: scratch MISAP_
        if (message.scratch === 'MISAP_') {
            flight.missedApproach = true
            flight.clearedToLand = false
            flight.missedApproachHoldUntil = undefined
            flight.ata = undefined
        } else if (message.scratch === '') {
            const holdingSoftMa =
                flight.missedApproachHoldUntil !== undefined &&
                Date.now() < flight.missedApproachHoldUntil
            // Empty scratch drops TopSky MA; EFSGA may still keep MA below
            if (!holdingSoftMa && !flight.efsGoAround) {
                flight.missedApproach = false
                flight.missedApproachHoldUntil = undefined
            }
        }
        // TopSky WEATHER manual alert (WX_) — UI state survives scratch consume/clear
        if (message.scratch === 'WX_') {
            const holdingOff =
                flight.weatherGivenHoldOffUntil !== undefined &&
                Date.now() < flight.weatherGivenHoldOffUntil
            if (!holdingOff) {
                flight.weatherGiven = true
                flight.weatherGivenHoldOffUntil = undefined
            }
        }
        // Handover Assistant mark (relieving side detects via ES scratch).
        // efshoSetByMe is set only by the controller who sent the token. Everyone
        // else clears it from the label once they are the tracking controller.
        if (message.scratch !== undefined) {
            if (isHandoverAssistantScratch(message.scratch)) {
                flight.efshoOnScratch = true
                flight.handoverAssistantInbound = true
            } else {
                flight.efshoOnScratch = false
                flight.efshoClearAt = undefined
            }
        }
        // Empty scratch must NOT clear weatherGiven (TopSky often pulses WX_ then clears)
        // Combine EFS soft G/A + TopSky: EFSGA on ⇒ MA (keep CTL if already set)
        if (flight.efsGoAround) {
            flight.missedApproach = true
            if (message.efsGoAround === true) {
                flight.missedApproachHoldUntil = undefined
            }
        } else if (message.efsGoAround === false && message.scratch !== 'MISAP_') {
            const holdingSoftMa =
                flight.missedApproachHoldUntil !== undefined &&
                Date.now() < flight.missedApproachHoldUntil
            if (!holdingSoftMa) {
                flight.missedApproach = false
                flight.missedApproachHoldUntil = undefined
            }
        }
        // ROF: TopSky /LAM/ROF/… or /ROF/…; EFS ground /EFSROF/TARGET/REQUESTER
        let clearScratchpadCallsign: string | undefined
        let clearScratchpadDelayMs: number | undefined
        let refreshCallsigns: string[] | undefined
        if (message.scratch !== undefined) {
            const scratch = message.scratch
            const lamRof = scratch.match(/^\/LAM\/ROF\/([^/]+)/i)
            const efsRof = scratch.match(/^\/EFSROF\/([^/]+)\/([^/]+)/i)
            if (lamRof?.[1]) {
                this.setRofRequest(flight, lamRof[1])
                clearScratchpadCallsign = callsign
                clearScratchpadDelayMs = 100
            } else if (efsRof?.[1] && efsRof?.[2]) {
                // Custom EFS ROF (ESSA ground) — apply to TARGET; sender clears vehicle
                const targetCs = efsRof[1].toUpperCase()
                const requester = efsRof[2].toUpperCase()
                const targetFlight =
                    targetCs === callsign.toUpperCase() ? flight : this.flights.get(targetCs)
                if (targetFlight) {
                    this.setRofRequest(targetFlight, requester)
                    if (targetCs !== callsign.toUpperCase()) {
                        refreshCallsigns = [targetCs]
                    }
                }
                console.log(
                    `[ROF] EFS /EFSROF/ for ${targetCs} from ${requester} (via ${callsign})`,
                )
            } else if (/^\/ROF\//i.test(scratch)) {
                // Outbound TopSky ROF on a scratch vehicle — give TopSky time to read, then wipe
                clearScratchpadCallsign = callsign
                clearScratchpadDelayMs = 800
            }
            // TopSky approach type: /APPTYPE/CAT3/ or shorthand /CAT3/
            const appType =
                scratch.match(/^\/APPTYPE\/([A-Z0-9]{1,4})\/?$/i)?.[1] ||
                scratch.match(/^\/(CAT\d|OS)\/?$/i)?.[1]
            if (appType) {
                flight.approachType = appType.toUpperCase()
                if (flight.approachType === 'OS') flight.cfl = 2
                else if (flight.cfl !== 1 && flight.cfl !== 2) flight.cfl = 1
            }
            // TopSky AHD special: /LLZ/ (localizer) — show LLZ in AHD cell
            if (/^\/LLZ\/?$/i.test(scratch)) {
                flight.llz = true
                flight.ahdg = 0
            }
            // Protocol scratch we will wipe — do not let the ensuing empty clear wipe remarks/HP
            if (isProtocolScratch(scratch)) {
                flight.scratchFieldsHoldUntil = Date.now() + 2500
            }
        }
        // Scratchpad → remarks + HP (".URNAV /Y2"); HS is VCH ann 4; DepC/coo is ann 6
        // During hold: keep EFS remarks/HP (empty AmendFlightPlan wipe OR stale echo that
        // would re-apply VECT after AHD clear). Push desired scratch back to ES when needed.
        let restoreScratchValue: string | undefined
        if (message.scratch !== undefined) {
            const scratch = message.scratch
            const holdingScratchFields =
                flight.scratchFieldsHoldUntil !== undefined &&
                Date.now() < flight.scratchFieldsHoldUntil
            if (holdingScratchFields && !isProtocolScratch(scratch)) {
                const desired = buildCombinedScratch(flight.remarks, flight.hp)
                // Normalize for compare: ES may echo "VECT" while we store ".VECT"
                if (scratch !== desired) {
                    restoreScratchValue = desired
                    console.log(
                        `[SCRATCH] ${callsign}: hold keep "${desired || '(empty)'}" (ignore echo "${scratch || '(empty)'}")`,
                    )
                }
            } else {
                const { remarks: nextRemarks, hp: nextHp } = parseCombinedScratch(scratch)
                if (nextRemarks !== null && nextRemarks !== flight.remarks) {
                    console.log(`[REMARKS] ${callsign}: ${flight.remarks ?? '-'} -> ${nextRemarks ?? '-'}`)
                    flight.remarks = nextRemarks
                    // Scratch-sourced SLOW is controller/TopSky owned — never auto-clear
                    if (hasSlowRemark(nextRemarks)) this.markSlowRemarkManual(flight)
                }
                if (nextHp !== null && nextHp !== flight.hp) {
                    console.log(`[HP] ${callsign}: ${flight.hp ?? '-'} -> ${nextHp ?? '-'} (scratch /)`)
                    flight.hp = nextHp
                }
            }
        }
        if (message.scratch !== undefined) {
            const grpStand = standFromGrpScratch(message.scratch)
            if (grpStand && grpStand !== flight.stand) {
                console.log(`[STAND] ${callsign}: ${flight.stand ?? '-'} -> ${grpStand} (GRP/S)`)
                flight.stand = grpStand
            }
        }
        // GRP arrival-list stand (already assigned). Do not apply to pure departures.
        if (message.arrivalStand) {
            const dest = flight.destination?.toUpperCase()
            const destMine = !!dest && this.config.myAirports.some((a) => a.toUpperCase() === dest)
            if (destMine && message.arrivalStand !== flight.stand) {
                console.log(`[STAND] ${callsign}: ${flight.stand ?? '-'} -> ${message.arrivalStand} (GRP list)`)
                flight.stand = message.arrivalStand
            }
        }
        if (message.hs !== undefined) {
            const nextHs = message.hs.trim().toUpperCase().slice(0, 5) || undefined
            if (nextHs !== flight.hs) {
                console.log(`[HS] ${callsign}: ${flight.hs ?? '-'} -> ${nextHs ?? '-'} (VCH)`)
                flight.hs = nextHs
            }
        }
        // Departure Coordination — strip annotation 6 ("DepC" / empty; legacy "EST")
        if (message.coo !== undefined) {
            const nextCoo = message.coo ? true : undefined
            if (nextCoo !== flight.coo) {
                console.log(`[DepC] ${callsign}: ${flight.coo ? 'on' : 'off'} -> ${nextCoo ? 'on' : 'off'} (ann 6)`)
                flight.coo = nextCoo
            }
        }
        if (message.stand !== undefined) flight.stand = message.stand
        if (message.asp !== undefined) flight.asp = message.asp
        if (message.mach !== undefined) flight.mach = message.mach
        if (message.arc !== undefined) flight.arc = message.arc
        if (message.ahdg !== undefined) {
            flight.ahdg = message.ahdg
            if (message.ahdg > 0) flight.llz = false
        }
        if (message.direct !== undefined) flight.direct = message.direct || undefined
        flight.lastUpdate = Date.now()

        // Auto-detect stand from position if not already set
        this.trySetStandFromPosition(flight)

        const result = this.withTransferSound(
            this.finalizeFlightStrips(
                callsign,
                flight,
                !hadRequiredData || !this.stripAssignments.get(callsign)
            ),
            prevController,
            prevHandoff,
            flight
        )
        // EFSHO may arrive after handoff target — catch deferred auto-assume
        if (this.shouldAutoAssumeHandover(flight)) {
            this.queueAutoAssume(result, flight)
        }
        if (exitCoordSound && !result.transferSound) result.transferSound = exitCoordSound
        if (clearScratchpadCallsign) {
            result.clearScratchpadCallsign = clearScratchpadCallsign
            result.clearScratchpadDelayMs = clearScratchpadDelayMs
        }
        if (refreshCallsigns?.length) {
            result.refreshCallsigns = refreshCallsigns
        }
        if (restoreScratchValue !== undefined) {
            result.setScratchValue = restoreScratchValue
        }
        // After HA auto-assume, restore remarks/HP scratch (EFSHO is protocol-only)
        if (result.autoAssumeCallsigns?.includes(callsign) && result.setScratchValue === undefined) {
            result.setScratchValue = buildCombinedScratch(flight.remarks, flight.hp)
        }
        this.maybeRestoreEfshoScratch(result, flight)
        return result
    }

    /**
     * Drop EFSHO from the radar label once the relieving controller tracks the flight.
     * The write that rides along with ASSUME often fails — EuroScope rejects scratch
     * changes until AcceptHandoff has actually made us the tracker.
     */
    private maybeRestoreEfshoScratch(result: ProcessMessageResult, flight: Flight): void {
        if (
            !shouldClearHandoverScratch({
                efshoOnScratch: !!flight.efshoOnScratch,
                efshoSetByMe: !!flight.efshoSetByMe,
                trackedByMe: this.isControlledByMe(flight),
            })
        ) {
            return
        }
        if (result.setScratchValue !== undefined) return
        const now = Date.now()
        if (flight.efshoClearAt !== undefined && now - flight.efshoClearAt < 1000) return
        flight.efshoClearAt = now
        result.setScratchValue = buildCombinedScratch(flight.remarks, flight.hp)
        console.log(`[Handover Assistant] ${flight.callsign}: clear EFSHO from label`)
    }

    /**
     * Handle flightPlanDisconnect message.
     * Soft-deletes into trash (with pilot_disconnect meta) instead of hard-removing.
     */
    private handleFlightPlanDisconnect(message: { callsign: string }): ProcessMessageResult {
        const callsign = message.callsign
        const flight = this.flights.get(callsign)
        console.log(`[DISCONNECT] ${callsign}`)

        if (flight) {
            flight.lastDeleteRule = 'pilot_disconnect'
            flight.deleted = true
        }

        this.flights.delete(callsign)
        this.landingRunwayTouched.delete(callsign)
        this.clearStripPrinted(callsign)

        if (isMultiAirportConfig(this.config)) {
            const deletedStripIds: string[] = []
            for (const stripId of [...this.stripAssignments.keys()]) {
                const parsed = parseStripAirportId(stripId)
                if (parsed?.callsign === callsign || stripId === callsign) {
                    this.stripAssignments.delete(stripId)
                    deletedStripIds.push(stripId)
                }
            }
            return {
                flight,
                deleteStripId: deletedStripIds[0],
                deletedStripIds: deletedStripIds.length ? deletedStripIds : undefined,
                softDeleted: deletedStripIds.length > 0,
            }
        }

        this.stripAssignments.delete(callsign)

        return {
            flight,
            deleteStripId: callsign,
            softDeleted: true,
        }
    }

    /**
     * Handle flightPlanFlightStripPushed message
     * Sets handoffTargetController so transfers show up immediately without waiting for the next data update
     */
    private handleFlightStripPushed(message: FlightStripPushedMessage): ProcessMessageResult {
        // This gets sent repeatedly from GND -> TWR... not sure when this is supposed to happen,
        // but it isn't just on transfer... added a flight plan data update in the plugin instead.
        // TODO maybe remove this dead code?
        // const flight = this.flights.get(message.callsign)
        // if (!flight) {
        //     console.log(`[PUSH] ${message.callsign} -> ${message.target ?? '(no target)'} (unknown flight, ignored)`)
        //     return {}
        // }

        // if (message.target !== undefined) {
        //     console.log(`[PUSH] ${message.callsign} -> ${message.target} (from ${message.sender ?? '?'})`)
        //     console.log(`  hmm controller ${flight.controller} handoff ${flight.handoffTargetController}`)
        //     console.log(`  next ${flight.nextController} frequency ${flight.nextControllerFrequency}`)
        //     // flight.handoffTargetController = message.target
        //     // flight.lastUpdate = Date.now()
        // } else {
        //     console.log(`[PUSH] ${message.callsign} (from ${message.sender ?? '?'}, no target)`)
        // }
        // return { flight }
        return {}
    }

    /**
     * Handle radarTargetPositionUpdate message
     * Updates altitude/position and checks for airborne status / delete conditions
     */
    private handleRadarTargetPositionUpdate(message: RadarTargetPositionUpdateMessage): ProcessMessageResult {
        const callsign = message.callsign
        const flight = this.flights.get(callsign)

        if (!flight) {
            // Flight not tracked yet, ignore radar update
            return {}
        }

        // Update radar data (ownership intentionally ignored — polled via ownershipUpdate)
        flight.currentAltitude = message.altitude
        if (message.ete !== undefined) flight.ete = message.ete
        if (message.nextController !== undefined) flight.nextController = message.nextController
        if (message.nextControllerFrequency !== undefined) flight.nextControllerFrequency = message.nextControllerFrequency
        if (message.latitude !== undefined) flight.latitude = message.latitude
        if (message.longitude !== undefined) flight.longitude = message.longitude
        if (message.groundSpeed !== undefined) flight.groundSpeed = message.groundSpeed
        // radar target squawk is not the same as the assigned squawk
        //if (message.squawk !== undefined) flight.squawk = message.squawk
        flight.lastUpdate = Date.now()

        if (flight.latitude !== undefined && flight.longitude !== undefined) {
            recordFlightMovement(callsign, flight.latitude, flight.longitude, flight.groundSpeed)
        }

        // Auto-detect stand from position if not already set
        this.trySetStandFromPosition(flight)

        // Auto-set PARK for assumed arrivals stationary at a stand
        this.tryAutoSetParked(flight)

        const wasAirborne = flight.airborne ?? false
        const fieldElevation = getFieldElevationForFlight(flight, this.config)
        const airborneThreshold = fieldElevation + 200
        const defNotAirborneThreshold = fieldElevation + 30
        const groundSpeedThreshold = 55
        /** Strip TV / GRP Departure Timer: latch ATD at GS > 40 with CFTO (or no GS at all). */
        const atdGroundSpeedKt = 40

        // Set airborne flag for both departures and arrivals; stamp ATA once.
        // ATD is latched on roll (below), not at airborne — matches IRIS Strip TV.
        const myAirports = this.config.myAirports.map((a) => a.toUpperCase())
        const originMine = !!flight.origin && myAirports.includes(flight.origin.toUpperCase())
        const destMine = !!flight.destination && myAirports.includes(flight.destination.toUpperCase())
        const utcHhmm = () => {
            const d = new Date()
            return `${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}`
        }
        let clearAirborneScratch: string | undefined
        let clearAirborneHs = false
        const gsRaw = message.groundSpeed ?? flight.groundSpeed
        const gsKnown = gsRaw !== undefined && Number.isFinite(gsRaw)
        const gs = gsKnown ? (gsRaw as number) : undefined
        const preDepGs = ['', 'NSTS', 'ONFREQ', 'DE-ICE', 'STUP', 'PUSH', 'TAXI', 'PARK']
        // PARK always; or known-slow + still in gate/pre-push GS (baro alone often > field+200 on stand)
        const gateLike =
            flight.groundstate === 'PARK' ||
            (gsKnown &&
                gs! <= groundSpeedThreshold &&
                preDepGs.includes(flight.groundstate ?? ''))

        // ATD: CFTO (DEPA) + GS > 40; or no groundstate + GS > 40. Never CFTO alone / never airborne-only.
        if (!flight.atd && originMine && gsKnown && gs! > atdGroundSpeedKt) {
            const gsState = flight.groundstate ?? ''
            const cfto = gsState === 'DEPA'
            const noGroundState = gsState === ''
            if (cfto || noGroundState) {
                flight.atd = utcHhmm()
            }
        }

        const positionKnown =
            message.latitude !== undefined && message.longitude !== undefined
        const onRunwayNow =
            positionKnown &&
            !!isOnAnyRunway(
                message.latitude as number,
                message.longitude as number,
                message.altitude,
                this.config.myAirports,
            )?.onRunway
        // Latch pavement contact before the vacate check. Short final is off the
        // polygon with groundstate already ARR; that must not clear airborne.
        if (wasAirborne && message.altitude <= airborneThreshold && onRunwayNow) {
            this.landingRunwayTouched.add(callsign)
        }

        if (gateLike) {
            flight.airborne = false
            this.landingRunwayTouched.delete(callsign)
        } else if (
            !wasAirborne &&
            message.altitude > airborneThreshold &&
            gsKnown &&
            gs! > groundSpeedThreshold
        ) {
            flight.airborne = true
            this.landingRunwayTouched.delete(callsign)
            // Airborne again after a landing stamp = go-around (or new dep) — clear ATA
            if (flight.ata) flight.ata = undefined
            // HP/HS are ground annotations — clear once airborne (EFS + EuroScope)
            const hadHp = !!flight.hp
            const hadHs = !!flight.hs
            if (hadHp) {
                flight.hp = undefined
                clearAirborneScratch = buildCombinedScratch(flight.remarks, undefined)
            }
            if (hadHs) {
                flight.hs = undefined
                clearAirborneHs = true
            }
            // DEP airborne: clear TopSky WX_ scratch token but keep MET UI green
            if (originMine && flight.weatherGiven && clearAirborneScratch === undefined) {
                clearAirborneScratch = buildCombinedScratch(flight.remarks, flight.hp)
            }
        } else if (wasAirborne && message.altitude <= airborneThreshold) {
            // Short final is often below field+30 with GS still >> 55 (flare over threshold).
            // Clearing airborne on altitude alone yanked CTL strips to taxi_arr while still
            // flying — require slow GS when known; alt-only fallback only if GS unknown.
            const slowEnough = gsKnown
                ? gs! <= groundSpeedThreshold
                : message.altitude <= defNotAirborneThreshold
            // Vacated runway after ARR / roll-out: unlock TXI / TWR→GND XFER without waiting
            // for GS ≤ 55 (high-speed taxiways often stay above that for a while).
            // Requires a prior hit on the pavement — short final is already ARR and
            // outside the polygon, which used to bounce CTL strips to taxi_arr and
            // back onto the runway at the threshold.
            const vacatedAfterLanding = hasVacatedRunwayAfterLanding({
                positionKnown,
                onRunway: onRunwayNow,
                touchedRunway: this.landingRunwayTouched.has(callsign),
                groundstate: flight.groundstate,
                groundSpeed: gs,
            })
            if (slowEnough || vacatedAfterLanding) {
                // Aircraft has landed / vacated
                flight.airborne = false
                if (!flight.ata && destMine && !flight.missedApproach) {
                    flight.ata = utcHhmm()
                }
            }
        }

        // Go-around / next approach: drop the pavement latch once back above the
        // airborne band and clear of the runway, so the following short final
        // is not treated as an immediate vacate.
        if (message.altitude > airborneThreshold && !onRunwayNow) {
            this.landingRunwayTouched.delete(callsign)
        }

        const result = this.finalizeFlightStrips(
            callsign,
            flight,
            !this.stripAssignments.get(callsign)
        )
        if (clearAirborneScratch !== undefined && result.setScratchValue === undefined) {
            result.setScratchValue = clearAirborneScratch
        }
        if (clearAirborneHs) result.clearHs = true
        return result
    }

    /**
     * Find section configuration by bay and section ID
     */
    private findSectionConfig(bayId: string, sectionId: string): Section | undefined {
        const bay = this.config.layout.bays.find(b => b.id === bayId)
        return bay?.sections.find(s => s.id === sectionId)
    }

    /** TAXI / PÅ TAXI / RTC TAXIWAY (twy / *_twy / *_taxi). */
    private isTaxiSectionId(sectionId: string): boolean {
        return (
            sectionId === 'taxi' ||
            sectionId.endsWith('_taxi') ||
            sectionId === 'twy' ||
            sectionId.endsWith('_twy')
        )
    }

    /** Headerless bay above PÅ BANAN (CTR ARR / manual RWY sequence). */
    private isRwySequenceBaySectionId(sectionId: string): boolean {
        return sectionId === 'ctr_arr' || sectionId.endsWith('_ctr_arr')
    }

    /**
     * TWR (or higher) with no dedicated GND online — covers GND “below”.
     * Used for the manual RWY occupation sequence bay above PÅ BANAN.
     */
    private isTwrWithoutGndBelow(): boolean {
        const myRole = this.config.myRole
        if (myRole !== 'TWR' && myRole !== 'APP' && myRole !== 'CTR') return false
        return !getControllerCallsign('GND')
    }

    /**
     * Keep a strip in the bay above PÅ BANAN while still taxiing (TXO/TXIN).
     * Rules would otherwise snap it back to PÅ TAXI / PÅ BANAN on every update.
     * - Solo TWR (no GND): any taxiing strip placed here
     * - Paper: DEP/local sequence (manual / after undo L/U·CTO) — sticky until dragged out
     */
    private shouldHoldInRwySequenceBay(
        flight: Flight,
        assignment: { bayId: string; sectionId: string; position: number; bottom: boolean },
    ): boolean {
        if (!this.isRwySequenceBaySectionId(assignment.sectionId)) return false
        if (flight.airborne) return false
        if (flight.clearedToLand) return false
        const gs = (flight.groundstate || '').toUpperCase()
        if (gs !== 'TAXI' && gs !== 'TXIN') return false
        if (this.isTwrWithoutGndBelow()) return true
        if (this.config.look === 'paper') {
            const type = this.determineStripType(flight)
            // Manual rwy-seq is sticky for taxiing DEP/local (ownership optional —
            // SI/callsign lag must not bounce them back to PÅ BANAN / PÅ TAXI).
            return type === 'departure' || type === 'local'
        }
        return false
    }

    /** GND-owned taxiing DEP/local with pending handoff to TWR (pin tray). */
    private isPendingOutboundGndDepTransfer(flight: Flight): boolean {
        if (this.config.look !== 'paper') return false
        if (!this.isControlledByMe(flight)) return false
        if (flight.airborne) return false
        const gs = (flight.groundstate || '').toUpperCase()
        if (gs !== 'TAXI' && gs !== 'TXIN') return false
        const type = this.determineStripType(flight)
        if (type !== 'departure' && type !== 'local') return false
        const target =
            flight.handoffTargetController ||
            getCallsignForPositionId(flight.handoffTargetControllerId)
        if (!target) return false
        return parseControllerRole(target, this.config.myAirports) === 'TWR'
    }

    /** PÅ BANAN / runway section id. */
    private isRunwaySectionId(sectionId: string): boolean {
        return sectionId === 'runway' || sectionId.includes('runway')
    }

    /**
     * ESGG paper: keep landed ARR/local on PÅ BANAN after vacating — do not auto-pull
     * to PÅ TAXI (taxi_arr). Manual drag to taxi releases the hold.
     */
    private shouldHoldLandedArrOnRunway(
        flight: Flight,
        assignment: { bayId: string; sectionId: string; position: number; bottom: boolean },
    ): boolean {
        if (this.config.look !== 'paper') return false
        if (!this.isRunwaySectionId(assignment.sectionId)) return false
        if (flight.airborne) return false
        const type = this.determineStripType(flight)
        if (type !== 'arrival' && type !== 'local') return false
        const gs = (flight.groundstate || '').toUpperCase()
        return gs === '' || gs === 'NSTS' || gs === 'ARR'
    }

    /**
     * ESGG CD→GND: keep strips in the headerless bay above START-UP/PUSH until
     * assumed / push / taxi (rules would otherwise snap them back under KLARERING).
     */
    private shouldHoldInAbovePush(
        flight: Flight,
        assignment: { bayId: string; sectionId: string; position: number; bottom: boolean },
    ): boolean {
        if (this.config.look !== 'paper') return false
        if (assignment.sectionId !== 'above_push') return false
        if (flight.airborne) return false
        const gs = (flight.groundstate || '').toUpperCase()
        if (gs === 'PUSH' || gs === 'STUP' || gs === 'TAXI' || gs === 'LINEUP' || gs === 'DEPA') {
            return false
        }
        if (this.isAbovePushPinned(flight.callsign)) return true
        const type = this.determineStripType(flight)
        return type === 'departure' || type === 'local'
    }

    private isAbovePushSectionId(sectionId: string): boolean {
        return sectionId === 'above_push'
    }

    private isCtrDepSectionId(sectionId: string): boolean {
        return sectionId === 'ctr_dep' || sectionId.endsWith('_ctr_dep')
    }

    /**
     * ESGG paper: keep soft G/A / UTFLYGNING pin strips in ctr_dep (rules would
     * otherwise snap ARR back to ctr_arr when TopSky MISAP_ is absent).
     */
    private shouldHoldInUtflygning(
        flight: Flight,
        assignment: { bayId: string; sectionId: string; position: number; bottom: boolean },
    ): boolean {
        if (this.config.look !== 'paper') return false
        if (!this.isCtrDepSectionId(assignment.sectionId)) return false
        if (!flight.airborne) return false
        if (flight.missedApproach) return true
        if (this.isUtflygningPinned(flight.callsign)) return true
        const target =
            flight.handoffTargetController ||
            getCallsignForPositionId(flight.handoffTargetControllerId)
        if (target && parseControllerRole(target, this.config.myAirports) === 'APP') {
            return true
        }
        return false
    }

    /**
     * ESGG paper: VFR airborne — do not auto-snap (CTR ARR / UTFLYGNING / fallbacks).
     * Pending APP→TWR inbound transfer may still place on the sequence pin (ctr_arr).
     */
    private shouldHoldVfrAirbornePlacement(
        flight: Flight,
        assignment: { bayId: string; sectionId: string; position: number; bottom: boolean },
        targetSectionId: string,
    ): boolean {
        if (this.config.look !== 'paper') return false
        if (!flight.airborne) return false
        if (isIfrSidEligible(flight.flightRules)) return false
        // Allow auto-move onto pending inbound transfer pin (above PÅ BANAN)
        if (this.isHandoffToMe(flight) && this.isRwySequenceBaySectionId(targetSectionId)) {
            return false
        }
        void assignment
        return true
    }

    /** Pending inbound handoff target is me (callsign or SI). Ignores CFL / approach clearance. */
    private isHandoffToMe(flight: Flight): boolean {
        const my = this.config.myCallsign
        const mySi = this.config.myPositionId?.toUpperCase()
        return (
            (!!flight.handoffTargetController &&
                !!my &&
                flight.handoffTargetController.toUpperCase() === my.toUpperCase()) ||
            (!!mySi &&
                !!flight.handoffTargetControllerId &&
                flight.handoffTargetControllerId.toUpperCase() === mySi)
        )
    }

    private shouldAutoAssumeHandover(flight: Flight): boolean {
        return (
            !!flight.handoverAssistantInbound &&
            this.getHandoverAssistantAutoAssume() &&
            this.config.isController === true &&
            this.isHandoffToMe(flight) &&
            !this.isControlledByMe(flight)
        )
    }

    private queueAutoAssume(result: ProcessMessageResult, flight: Flight): void {
        flight.handoverAssistantInbound = undefined
        const list = result.autoAssumeCallsigns ?? []
        if (!list.includes(flight.callsign)) list.push(flight.callsign)
        result.autoAssumeCallsigns = list
        console.log(`[Handover Assistant] Auto-ASSUME ${flight.callsign}`)
    }

    /** Pending inbound handoff to me (any owner — APP/CTR/…). */
    private isPendingInboundTransferToMe(flight: Flight): boolean {
        return this.isHandoffToMe(flight) && !this.isControlledByMe(flight)
    }

    /** True when flight is assumed / owned by me (EuroScope accept — callsign or SI). */
    private isControlledByMe(flight: Flight): boolean {
        const my = this.config.myCallsign
        if (my && flight.controller && flight.controller.toUpperCase() === my.toUpperCase()) {
            return true
        }
        const mySi = (this.config.myPositionId || '').toUpperCase()
        const ownerSi = (flight.controllerId || '').toUpperCase()
        return !!mySi && !!ownerSi && mySi === ownerSi
    }

    /**
     * Pin to the paper stick-top tray (`bottom: true`).
     * New pins insert at position 0 (top of tray); earlier pins keep higher positions
     * (first transfer stays at the bottom of the pin bar — same as other bays).
     * Already-pinned strips keep a stable position (do not re-force to 0 every update).
     */
    private pinAssignmentToStickTop(
        bayId: string,
        sectionId: string,
        callsign: string,
    ): { position: number; bottom: boolean; bumped: boolean } {
        let mine = this.stripAssignments.get(callsign)
        // Already in this section's pin tray — keep order stable
        if (mine && mine.bayId === bayId && mine.sectionId === sectionId && mine.bottom) {
            this.lastShiftedCallsigns = []
            return { position: mine.position, bottom: true, bumped: false }
        }

        // Entering pin tray: insert at top (0), bump existing pins down (older → bottom)
        const shifted: string[] = []
        this.stripAssignments.forEach((assignment, id) => {
            if (id === callsign) return
            if (assignment.bayId !== bayId || assignment.sectionId !== sectionId || !assignment.bottom) {
                return
            }
            const f = this.flights.get(id)
            if (f?.deleted) return
            assignment.position += 1
            shifted.push(id)
        })
        if (!mine || mine.bayId !== bayId || mine.sectionId !== sectionId) {
            mine = { bayId, sectionId, position: 0, bottom: true }
            this.stripAssignments.set(callsign, mine)
        } else {
            mine.bottom = true
            mine.position = 0
        }
        this.lastShiftedCallsigns = shifted
        return { position: 0, bottom: true, bumped: true }
    }

    /**
     * Leave the pin tray for the main stack. Compacts remaining pins first.
     * `toTop`: insert at top of main zone (shift others down); else append at bottom.
     */
    private unpinAssignmentToMainStack(
        bayId: string,
        sectionId: string,
        callsign: string,
        toTop = false,
    ): { position: number; bottom: boolean; bumped: boolean } {
        const mine = this.stripAssignments.get(callsign)
        if (!mine || mine.bayId !== bayId || mine.sectionId !== sectionId) {
            this.lastShiftedCallsigns = []
            return { position: 0, bottom: false, bumped: false }
        }
        if (!mine.bottom) {
            this.lastShiftedCallsigns = []
            return { position: mine.position, bottom: false, bumped: false }
        }
        // Compact other pins above the one we remove
        const pinShifted: string[] = []
        const leavingPos = mine.position
        this.stripAssignments.forEach((assignment, id) => {
            if (id === callsign) return
            if (assignment.bayId !== bayId || assignment.sectionId !== sectionId || !assignment.bottom) {
                return
            }
            const f = this.flights.get(id)
            if (f?.deleted) return
            if (assignment.position > leavingPos) {
                assignment.position -= 1
                pinShifted.push(id)
            }
        })
        mine.bottom = false
        if (toTop) {
            this.shiftPositionsDown(bayId, sectionId)
            mine.position = 0
            // shiftPositionsDown already set lastShiftedCallsigns (main zone)
            for (const id of pinShifted) {
                if (!this.lastShiftedCallsigns.includes(id)) this.lastShiftedCallsigns.push(id)
            }
        } else {
            const pos = this.getNextPosition(bayId, sectionId)
            mine.position = pos
            this.lastShiftedCallsigns = pinShifted
        }
        return { position: mine.position, bottom: false, bumped: true }
    }

    /**
     * GND assumed TWR→GND taxi transfer while strip still in pin tray →
     * move to top of main PÅ TAXI stack. No-op if already unpinned or left taxi
     * (manual drag elsewhere).
     */
    releaseGndTaxiPinToMainTop(callsign: string): {
        didUnpin: boolean
        bayId?: string
        sectionId?: string
        position?: number
        shiftedCallsigns: string[]
    } {
        const mine = this.stripAssignments.get(callsign)
        if (!mine || !this.isTaxiSectionId(mine.sectionId) || !mine.bottom) {
            this.clearGndTaxiPinned(callsign)
            return { didUnpin: false, shiftedCallsigns: [] }
        }
        const { bayId, sectionId } = mine
        const unpinned = this.unpinAssignmentToMainStack(bayId, sectionId, callsign, true)
        this.clearGndTaxiPinned(callsign)
        console.log(
            `[RULE] ${callsign} → top of main ${sectionId} (GND assumed taxi transfer, pos ${unpinned.position})`,
        )
        return {
            didUnpin: true,
            bayId,
            sectionId,
            position: unpinned.position,
            shiftedCallsigns: [...this.lastShiftedCallsigns],
        }
    }

    /**
     * ESGG paper look only (not CFL / approach clearance):
     * - Pending inbound transfer to me → pin tray (stable order: first at bottom)
     * - Explicit drag-out this handoff → do not re-pin
     * - EuroScope accept → main stack just above PÅ BANAN
     *
     * Important: section enter sets bottom=false before this runs — that must NOT
     * be treated as “user released” (that bug skipped the pin on the 2nd transfer).
     */
    private applyAppTransferCtrArrTop(
        callsign: string,
        flight: Flight,
        bayId: string,
        sectionId: string,
        currentPosition: number,
        currentBottom: boolean,
    ): { position: number; bottom: boolean; bumped: boolean } {
        // Paper look is ESGG-only today — do not change ESSA / other configs
        if (this.config.look !== 'paper') {
            this.clearAppTransferPinned(callsign)
            return { position: currentPosition, bottom: currentBottom, bumped: false }
        }
        if (!this.isRwySequenceBaySectionId(sectionId)) {
            this.clearAppTransferPinned(callsign)
            return { position: currentPosition, bottom: currentBottom, bumped: false }
        }

        const assumedByMe = this.isControlledByMe(flight)
        const pending =
            this.isPendingInboundTransferToMe(flight) ||
            this.isPendingOutboundGndDepTransfer(flight) ||
            (!assumedByMe &&
                this.appTransferPinSession.has(callsign) &&
                this.isHandoffToMe(flight))

        if (pending) {
            // New handoff session → always allow pin again
            if (!this.appTransferPinSession.has(callsign)) {
                this.appTransferDragReleased.delete(callsign)
            }
            if (this.appTransferDragReleased.has(callsign)) {
                return { position: currentPosition, bottom: currentBottom, bumped: false }
            }
            const pinned = this.pinAssignmentToStickTop(bayId, sectionId, callsign)
            if (!this.appTransferPinSession.has(callsign)) {
                this.appTransferPinSession.add(callsign)
                const kind = this.isPendingOutboundGndDepTransfer(flight)
                    ? 'GND→TWR DEP transfer'
                    : 'inbound transfer'
                console.log(
                    `[RULE] ${callsign} → pinned top of ${sectionId} (${kind}, pos ${pinned.position})`,
                )
            }
            return {
                position: pinned.position,
                bottom: true,
                bumped: pinned.bumped || !currentBottom,
            }
        }

        // Handoff ended
        const hadSession =
            this.appTransferPinSession.has(callsign) || this.appTransferDragReleased.has(callsign)
        const wasDragReleased = this.appTransferDragReleased.has(callsign)
        this.clearAppTransferPinned(callsign)

        if (hadSession && (assumedByMe || wasDragReleased)) {
            const mine = this.stripAssignments.get(callsign)
            if (mine?.bottom) {
                const unpinned = this.unpinAssignmentToMainStack(bayId, sectionId, callsign)
                console.log(`[RULE] ${callsign} → main stack of ${sectionId} (transfer accepted)`)
                return unpinned
            }
            return {
                position: currentPosition,
                bottom: false,
                bumped: !!currentBottom,
            }
        }

        return { position: currentPosition, bottom: currentBottom, bumped: false }
    }

    /** Clear APP-transfer pin session (handoff ended / config leave). */
    clearAppTransferPinned(callsign: string): void {
        this.appTransferPinSession.delete(callsign)
        this.appTransferDragReleased.delete(callsign)
    }

    /** Mark that the user dragged out of the pin tray for this handoff. */
    markAppTransferDragReleased(callsign: string): void {
        this.appTransferDragReleased.add(callsign)
        this.appTransferPinSession.add(callsign)
    }

    /**
     * Force pin in RWY sequence stick-top tray (e.g. GND dropped DEP on main stack).
     * Returns regenerated strip when assignment was updated.
     */
    pinRwySequenceTray(callsign: string): {
        strip: FlightStrip
        shiftedCallsigns: string[]
    } | null {
        const assignment = this.stripAssignments.get(callsign)
        if (!assignment || !this.isRwySequenceBaySectionId(assignment.sectionId)) return null
        this.appTransferDragReleased.delete(callsign)
        this.appTransferPinSession.add(callsign)
        const pinned = this.pinAssignmentToStickTop(
            assignment.bayId,
            assignment.sectionId,
            callsign,
        )
        const strip = this.regenerateStrip(callsign)
        if (!strip) return null
        return {
            strip: { ...strip, position: pinned.position, bottom: true },
            shiftedCallsigns: this.getLastShiftedCallsigns(),
        }
    }

    /**
     * Start / refresh ESGG paper PÅ TAXI pin for TWR→GND inbound transfer.
     * Call when TWR moves ARR to taxi with GND online (or GND sees pending in).
     */
    startGndTaxiPin(callsign: string): void {
        this.gndTaxiDragReleased.delete(callsign)
        this.gndTaxiPinSession.add(callsign)
    }

    /** Clear GND-taxi pin session. */
    clearGndTaxiPinned(callsign: string): void {
        this.gndTaxiPinSession.delete(callsign)
        this.gndTaxiDragReleased.delete(callsign)
    }

    /** User dragged out of the PÅ TAXI pin tray for this GND handoff. */
    markGndTaxiDragReleased(callsign: string): void {
        this.gndTaxiDragReleased.add(callsign)
        this.gndTaxiPinSession.add(callsign)
    }

    /** True while strip is in an active GND taxi pin session (not yet drag-released). */
    isGndTaxiPinned(callsign: string): boolean {
        return this.gndTaxiPinSession.has(callsign) && !this.gndTaxiDragReleased.has(callsign)
    }

    /** Start / refresh ESGG paper UTFLYGNING pin for APP handoff (G/A or DEP). */
    startUtflygningPin(callsign: string): void {
        this.utflygningDragReleased.delete(callsign)
        this.utflygningPinSession.add(callsign)
    }

    clearUtflygningPinned(callsign: string): void {
        this.utflygningPinSession.delete(callsign)
        this.utflygningDragReleased.delete(callsign)
    }

    markUtflygningDragReleased(callsign: string): void {
        this.utflygningDragReleased.add(callsign)
        this.utflygningPinSession.add(callsign)
    }

    isUtflygningPinned(callsign: string): boolean {
        return this.utflygningPinSession.has(callsign) && !this.utflygningDragReleased.has(callsign)
    }

    /**
     * Force pin at bottom of UTFLYGNING (ctr_dep pin tray).
     * Returns regenerated strip when assignment was updated.
     */
    pinUtflygningTray(callsign: string): {
        strip: FlightStrip
        shiftedCallsigns: string[]
    } | null {
        const assignment = this.stripAssignments.get(callsign)
        if (!assignment || !this.isCtrDepSectionId(assignment.sectionId)) return null
        this.utflygningDragReleased.delete(callsign)
        this.utflygningPinSession.add(callsign)
        const pinned = this.pinAssignmentToStickTop(
            assignment.bayId,
            assignment.sectionId,
            callsign,
        )
        const strip = this.regenerateStrip(callsign)
        if (!strip) return null
        return {
            strip: { ...strip, position: pinned.position, bottom: true },
            shiftedCallsigns: this.getLastShiftedCallsigns(),
        }
    }

    /**
     * Keep UTFLYGNING pin tray while TWR→APP handoff is pending (G/A or DEP).
     */
    private applyUtflygningPin(
        callsign: string,
        flight: Flight,
        bayId: string,
        sectionId: string,
        currentPosition: number,
        currentBottom: boolean,
    ): { position: number; bottom: boolean; bumped: boolean } {
        if (this.config.look !== 'paper') {
            this.clearUtflygningPinned(callsign)
            return { position: currentPosition, bottom: currentBottom, bumped: false }
        }
        if (!this.isCtrDepSectionId(sectionId)) {
            this.clearUtflygningPinned(callsign)
            return { position: currentPosition, bottom: currentBottom, bumped: false }
        }

        const wasDragReleased = this.utflygningDragReleased.has(callsign)
        const inPinSession = this.utflygningPinSession.has(callsign) && !wasDragReleased
        const target =
            flight.handoffTargetController ||
            getCallsignForPositionId(flight.handoffTargetControllerId)
        const pendingOutToApp =
            this.isControlledByMe(flight) &&
            !!target &&
            parseControllerRole(target, this.config.myAirports) === 'APP'

        if (inPinSession || (pendingOutToApp && this.utflygningPinSession.has(callsign))) {
            if (wasDragReleased) {
                return { position: currentPosition, bottom: currentBottom, bumped: false }
            }
            const pinned = this.pinAssignmentToStickTop(bayId, sectionId, callsign)
            if (pinned.bumped) {
                console.log(
                    `[RULE] ${callsign} → pinned bottom of ${sectionId} (UTFLYGNING APP xfer, pos ${pinned.position})`,
                )
            }
            return {
                position: pinned.position,
                bottom: true,
                bumped: pinned.bumped || !currentBottom,
            }
        }

        const hadSession =
            this.utflygningPinSession.has(callsign) || this.utflygningDragReleased.has(callsign)
        if (hadSession && (wasDragReleased || !pendingOutToApp)) {
            this.clearUtflygningPinned(callsign)
            const mine = this.stripAssignments.get(callsign)
            if (mine?.bottom) {
                const unpinned = this.unpinAssignmentToMainStack(bayId, sectionId, callsign, false)
                console.log(`[RULE] ${callsign} → main stack of ${sectionId} (UTFLYGNING pin released)`)
                return unpinned
            }
            return {
                position: currentPosition,
                bottom: false,
                bumped: !!currentBottom,
            }
        }

        return { position: currentPosition, bottom: currentBottom, bumped: false }
    }

    /**
     * Pin on PÅ TAXI stick-top during TWR→GND transfer (ARR vacate or DEP from seq/RWY).
     * Session starts via startGndTaxiPin (TWR move) or pending inbound to me (GND).
     * Stays pinned until drag-out / clear; then drops to main stack.
     */
    private applyGndTaxiPin(
        callsign: string,
        flight: Flight,
        bayId: string,
        sectionId: string,
        currentPosition: number,
        currentBottom: boolean,
    ): { position: number; bottom: boolean; bumped: boolean } {
        if (this.config.look !== 'paper') {
            this.clearGndTaxiPinned(callsign)
            return { position: currentPosition, bottom: currentBottom, bumped: false }
        }
        if (!this.isTaxiSectionId(sectionId)) {
            this.clearGndTaxiPinned(callsign)
            return { position: currentPosition, bottom: currentBottom, bumped: false }
        }
        const type = this.determineStripType(flight)
        if (type !== 'arrival' && type !== 'local' && type !== 'departure') {
            this.clearGndTaxiPinned(callsign)
            return { position: currentPosition, bottom: currentBottom, bumped: false }
        }

        const assumedByMe = this.isControlledByMe(flight)
        const ownerRole = parseControllerRole(flight.controller, this.config.myAirports)
        const pendingInFromTwr =
            this.isHandoffToMe(flight) &&
            !assumedByMe &&
            (ownerRole === 'TWR' || ownerRole === 'APP' || ownerRole === 'CTR')
        const wasDragReleased = this.gndTaxiDragReleased.has(callsign)
        const inPinSession =
            this.gndTaxiPinSession.has(callsign) && !wasDragReleased

        // GND receiving: start pin session on first sight of inbound handoff
        if (pendingInFromTwr && !this.gndTaxiPinSession.has(callsign)) {
            this.gndTaxiDragReleased.delete(callsign)
            this.gndTaxiPinSession.add(callsign)
        }

        // Assumed by me while still in pin tray (EFS ASSUME or ES Accept) → top of main.
        // Must run before the pin branch — otherwise we keep re-pinning after assume.
        if (assumedByMe && inPinSession) {
            const mine = this.stripAssignments.get(callsign)
            if (mine?.bottom) {
                const unpinned = this.unpinAssignmentToMainStack(bayId, sectionId, callsign, true)
                this.clearGndTaxiPinned(callsign)
                console.log(
                    `[RULE] ${callsign} → top of main ${sectionId} (GND assumed taxi transfer, pos ${unpinned.position})`,
                )
                return unpinned
            }
            this.clearGndTaxiPinned(callsign)
            return {
                position: currentPosition,
                bottom: false,
                bumped: !!currentBottom,
            }
        }

        // Pending inbound (not yet assumed) → keep / place in pin tray
        if (
            (pendingInFromTwr || this.gndTaxiPinSession.has(callsign)) &&
            !wasDragReleased &&
            !assumedByMe
        ) {
            const pinned = this.pinAssignmentToStickTop(bayId, sectionId, callsign)
            if (!this.gndTaxiPinSession.has(callsign)) {
                this.gndTaxiPinSession.add(callsign)
            }
            if (pinned.bumped) {
                console.log(
                    `[RULE] ${callsign} → pinned top of ${sectionId} (GND taxi transfer, pos ${pinned.position})`,
                )
            }
            return {
                position: pinned.position,
                bottom: true,
                bumped: pinned.bumped || !currentBottom,
            }
        }

        // Pin session ended without assume path above (e.g. drag-release / handoff cancelled)
        const hadSession =
            this.gndTaxiPinSession.has(callsign) || this.gndTaxiDragReleased.has(callsign)
        if (hadSession && (wasDragReleased || !pendingInFromTwr)) {
            this.clearGndTaxiPinned(callsign)
            const mine = this.stripAssignments.get(callsign)
            if (mine?.bottom) {
                // Drag-release: keep placement if already unpinned; else drop to main (not forced top)
                const unpinned = this.unpinAssignmentToMainStack(bayId, sectionId, callsign, false)
                console.log(`[RULE] ${callsign} → main stack of ${sectionId} (GND taxi pin released)`)
                return unpinned
            }
            return {
                position: currentPosition,
                bottom: false,
                bumped: !!currentBottom,
            }
        }

        return { position: currentPosition, bottom: currentBottom, bumped: false }
    }

    /** Start / refresh ESGG paper above-push pin for CD→GND READY handoff. */
    startAbovePushPin(callsign: string): void {
        this.abovePushDragReleased.delete(callsign)
        this.abovePushPinSession.add(callsign)
    }

    clearAbovePushPinned(callsign: string): void {
        this.abovePushPinSession.delete(callsign)
        this.abovePushDragReleased.delete(callsign)
    }

    markAbovePushDragReleased(callsign: string): void {
        this.abovePushDragReleased.add(callsign)
        this.abovePushPinSession.add(callsign)
    }

    isAbovePushPinned(callsign: string): boolean {
        return this.abovePushPinSession.has(callsign) && !this.abovePushDragReleased.has(callsign)
    }

    /**
     * Force pin at stick-top of above_push (CD→GND transfer tray).
     * Relocates assignment into above_push when needed.
     */
    pinAbovePushTray(callsign: string): {
        strip: FlightStrip
        shiftedCallsigns: string[]
    } | null {
        const bayId = this.config.sectionToBay.get('above_push')
        if (!bayId) return null
        this.abovePushDragReleased.delete(callsign)
        this.abovePushPinSession.add(callsign)
        const pinned = this.pinAssignmentToStickTop(bayId, 'above_push', callsign)
        const strip = this.regenerateStrip(callsign)
        if (!strip) return null
        return {
            strip: { ...strip, position: pinned.position, bottom: true },
            shiftedCallsigns: this.getLastShiftedCallsigns(),
        }
    }

    /**
     * Pin on above START-UP/PUSH stick-top during CD→GND READY transfer.
     * Session starts via startAbovePushPin (CD move) or pending inbound from DEL (GND).
     * Drag to non-pinned (S/P main) = ASSUME; ES ASSUME also unpins.
     */
    private applyAbovePushPin(
        callsign: string,
        flight: Flight,
        bayId: string,
        sectionId: string,
        currentPosition: number,
        currentBottom: boolean,
    ): { position: number; bottom: boolean; bumped: boolean } {
        if (this.config.look !== 'paper') {
            this.clearAbovePushPinned(callsign)
            return { position: currentPosition, bottom: currentBottom, bumped: false }
        }
        if (!this.isAbovePushSectionId(sectionId)) {
            this.clearAbovePushPinned(callsign)
            return { position: currentPosition, bottom: currentBottom, bumped: false }
        }
        const type = this.determineStripType(flight)
        if (type !== 'departure' && type !== 'local') {
            this.clearAbovePushPinned(callsign)
            return { position: currentPosition, bottom: currentBottom, bumped: false }
        }

        const assumedByMe = this.isControlledByMe(flight)
        const ownerRole = parseControllerRole(flight.controller, this.config.myAirports)
        const pendingInFromCd =
            this.isHandoffToMe(flight) && !assumedByMe && ownerRole === 'DEL'
        const target =
            flight.handoffTargetController ||
            getCallsignForPositionId(flight.handoffTargetControllerId)
        const pendingOutToGnd =
            assumedByMe &&
            !!target &&
            parseControllerRole(target, this.config.myAirports) === 'GND'
        const wasDragReleased = this.abovePushDragReleased.has(callsign)
        const inPinSession = this.abovePushPinSession.has(callsign) && !wasDragReleased

        // GND receiving: start pin session on first sight of inbound handoff from CD/DEL
        if (pendingInFromCd && !this.abovePushPinSession.has(callsign)) {
            this.abovePushDragReleased.delete(callsign)
            this.abovePushPinSession.add(callsign)
        }

        // Assumed by me while still in pin tray → top of main (non-pinned)
        if (assumedByMe && inPinSession && !pendingOutToGnd) {
            const mine = this.stripAssignments.get(callsign)
            if (mine?.bottom) {
                const unpinned = this.unpinAssignmentToMainStack(bayId, sectionId, callsign, true)
                this.clearAbovePushPinned(callsign)
                console.log(
                    `[RULE] ${callsign} → top of main ${sectionId} (GND assumed CD transfer, pos ${unpinned.position})`,
                )
                return unpinned
            }
            this.clearAbovePushPinned(callsign)
            return {
                position: currentPosition,
                bottom: false,
                bumped: !!currentBottom,
            }
        }

        // Pending inbound or outbound CD→GND → keep / place in pin tray (stick-top)
        if (
            (pendingInFromCd || pendingOutToGnd || this.abovePushPinSession.has(callsign)) &&
            !wasDragReleased &&
            (!assumedByMe || pendingOutToGnd)
        ) {
            const pinned = this.pinAssignmentToStickTop(bayId, sectionId, callsign)
            if (!this.abovePushPinSession.has(callsign)) {
                this.abovePushPinSession.add(callsign)
            }
            if (pinned.bumped) {
                console.log(
                    `[RULE] ${callsign} → pinned top of ${sectionId} (CD→GND transfer, pos ${pinned.position})`,
                )
            }
            return {
                position: pinned.position,
                bottom: true,
                bumped: pinned.bumped || !currentBottom,
            }
        }

        const hadSession =
            this.abovePushPinSession.has(callsign) || this.abovePushDragReleased.has(callsign)
        if (hadSession && (wasDragReleased || (!pendingInFromCd && !pendingOutToGnd))) {
            this.clearAbovePushPinned(callsign)
            const mine = this.stripAssignments.get(callsign)
            if (mine?.bottom) {
                const unpinned = this.unpinAssignmentToMainStack(bayId, sectionId, callsign, false)
                console.log(`[RULE] ${callsign} → main stack of ${sectionId} (above-push pin released)`)
                return unpinned
            }
            return {
                position: currentPosition,
                bottom: false,
                bumped: !!currentBottom,
            }
        }

        return { position: currentPosition, bottom: currentBottom, bumped: false }
    }

    /**
     * Mixed-stack insert side (PÅ TAXI / RTC TWY / RTC RWY):
     * arrivals (and taxi-in locals) → top; departures (and taxi-out locals) → bottom.
     * After that, appearance `position` sticks (manual drag / same-slot updates).
     */
    private taxiStripAddFromTop(flight: Flight): boolean {
        const type = this.determineStripType(flight)
        if (type === 'arrival') return true
        if (type === 'departure') return false
        if (type === 'local') {
            const gs = (flight.groundstate || '').toUpperCase()
            if (gs === 'ARR' || gs === 'TXIN' || gs === 'PARK') return true
            if (flight.clearedToLand) return true
            return false
        }
        return false
    }

    /**
     * Get the position for a new strip in a section
     * Handles both "add from top" and "add from bottom" modes
     * Call getLastShiftedCallsigns() after this to get affected strips
     */
    private getNewStripPosition(bayId: string, sectionId: string, flight?: Flight): number {
        const section = this.findSectionConfig(bayId, sectionId)
        // Default: add from top.
        let addFromTop = section?.addFromTop ?? true
        // RUNWAY: without flight, append (L/U flow). With flight: arr top / dep bottom.
        if (isRunwayOrderSectionId(sectionId)) {
            addFromTop = flight ? this.taxiStripAddFromTop(flight) : false
        }
        // TAXI / RTC TWY: arr top / dep bottom (mixed stack); ignores section addFromTop
        if (flight && this.isTaxiSectionId(sectionId)) {
            addFromTop = this.taxiStripAddFromTop(flight)
        }

        // Clear previous shifted callsigns
        this.lastShiftedCallsigns = []

        // Paper pending CLR (KLARERING above header): insert by EOBT without
        // re-sorting existing strips (manual drag order stays sticky).
        if (
            flight &&
            this.config.look === "paper" &&
            (sectionId === "pending_dep" || sectionId.endsWith("_pending_dep"))
        ) {
            return this.getEobtInsertPosition(bayId, sectionId, flight)
        }

        if (addFromTop) {
            // Add at top: shift all existing strips down and return position 0
            this.shiftPositionsDown(bayId, sectionId)
            return 0
        } else {
            // Add at bottom: use next available position
            return this.getNextPosition(bayId, sectionId)
        }
    }

    /** Callsigns affected by the last shiftPositionsDown call */
    private lastShiftedCallsigns: string[] = []

    /**
     * Paper pending KLARERING: insert index by EOBT among current positions.
     * Same visual order as frontend sortByEobtEarliestBottom (CLR-read at bottom,
     * missing EOBT at top, earlier EOBT toward bay floor). Existing strips keep
     * relative order — only those at/after the insert index shift down.
     */
    private getEobtInsertPosition(bayId: string, sectionId: string, flight: Flight): number {
        const existing: { position: number; flight: Flight }[] = []
        this.stripAssignments.forEach((assignment, stripId) => {
            if (
                assignment.bayId !== bayId ||
                assignment.sectionId !== sectionId ||
                assignment.bottom
            ) {
                return
            }
            const cs = parseStripAirportId(stripId)?.callsign ?? stripId
            const f = this.flights.get(cs)
            if (!f || f.deleted) return
            existing.push({ position: assignment.position, flight: f })
        })
        existing.sort((a, b) => a.position - b.position)

        const insertAt = eobtInsertIndexAmong(
            existing.map((e) => e.flight),
            flight,
            utcNowMinutes(),
        )

        this.shiftPositionsFrom(bayId, sectionId, insertAt)
        return insertAt
    }

    /**
     * Shift top-zone strips with position >= fromPosition down by 1 (make room to insert).
     */
    private shiftPositionsFrom(bayId: string, sectionId: string, fromPosition: number): string[] {
        const shifted: string[] = []
        this.stripAssignments.forEach((assignment, stripId) => {
            if (
                assignment.bayId !== bayId ||
                assignment.sectionId !== sectionId ||
                assignment.bottom ||
                assignment.position < fromPosition
            ) {
                return
            }
            const cs = parseStripAirportId(stripId)?.callsign ?? stripId
            const flight = this.flights.get(cs)
            if (flight?.deleted) return
            assignment.position += 1
            shifted.push(stripId)
        })
        const key = `${bayId}:${sectionId}`
        const current = this.positionCounters.get(key) ?? 0
        this.positionCounters.set(key, current + 1)
        this.lastShiftedCallsigns = shifted
        return shifted
    }

    /**
     * Shift all strip positions in a section down by 1 (for add from top)
     * Returns the callsigns of affected strips
     */
    private shiftPositionsDown(bayId: string, sectionId: string): string[] {
        return this.shiftPositionsFrom(bayId, sectionId, 0)
    }

    /**
     * Get the callsigns shifted by the last getNewStripPosition call
     */
    getLastShiftedCallsigns(): string[] {
        return this.lastShiftedCallsigns
    }

    /**
     * Clear the last shifted callsigns
     */
    clearLastShiftedCallsigns() {
        this.lastShiftedCallsigns = []
    }

    /**
     * Get next position in a section (for add from bottom mode).
     * Always append after the highest live assignment so DEP→TAXI lands under
     * existing ARR/DEP strips even if the counter drifted after reorders.
     */
    private getNextPosition(bayId: string, sectionId: string): number {
        let maxPos = -1
        this.stripAssignments.forEach((assignment, stripId) => {
            if (assignment.bayId !== bayId || assignment.sectionId !== sectionId || assignment.bottom) {
                return
            }
            const cs = parseStripAirportId(stripId)?.callsign ?? stripId
            const flight = this.flights.get(cs)
            if (flight?.deleted) return
            if (assignment.position > maxPos) maxPos = assignment.position
        })
        const pos = maxPos + 1
        const key = `${bayId}:${sectionId}`
        const current = this.positionCounters.get(key) ?? 0
        this.positionCounters.set(key, Math.max(current, pos + 1))
        return pos
    }

    /**
     * Reset position counter for a section (called when recomputing positions)
     */
    resetPositionCounter(bayId: string, sectionId: string, value: number = 0) {
        const key = `${bayId}:${sectionId}`
        this.positionCounters.set(key, value)
    }

    /**
     * Create a FlightStrip from a Flight
     */
    private createStrip(
        flight: Flight,
        bayId: string,
        sectionId: string,
        position: number,
        bottom: boolean,
        airport?: string,
        actionConfig: EfsStaticConfig = this.config
    ): FlightStrip {
        // One-shot: fresh paper reprint starts without CLR read/correct derived from ES
        const paperFresh = !!flight.paperFreshPrint
        if (paperFresh) flight.paperFreshPrint = false

        // Determine strip type
        const stripType = this.determineStripType(flight, actionConfig)

        // Convert wake turbulence (use explicit value or derive from aircraft type)
        const wakeTurbulence = this.parseWakeCategory(flight.aircraftType, flight.wakeTurbulence)

        // Convert flight rules
        const flightRules = this.parseFlightRules(flight)

        // Format flight level (CFL-menu / TopSkyAirspace TA rules)
        const taAirport =
            stripType === 'arrival' || stripType === 'local'
                ? flight.destination
                : flight.origin
        const rfl = flight.rfl ? this.formatFlightLevel(flight.rfl, taAirport) : undefined
        const xfl = flight.xfl && flight.xfl > 0 ? this.formatFlightLevel(flight.xfl, taAirport) : undefined
        const clearedAltitude = (() => {
            if (flight.cfl === 1) {
                const t = (flight.approachType || '').toUpperCase()
                if (t && t !== 'CA' && t !== 'VA') return t
                return 'CA'
            }
            if (flight.cfl === 2) {
                const t = (flight.approachType || '').toUpperCase()
                if (t === 'OS') return 'OS'
                if (t && t !== 'CA' && t !== 'VA') return t
                return 'VA'
            }
            if (flight.cfl && flight.cfl > 2) return this.formatFlightLevel(flight.cfl, taAirport)
            return undefined
        })()

        // Cleared for takeoff: departure with DEPA groundstate, not yet airborne.
        // Paper: keep CFTO after ATD/airborne — ATD must not clear the CFTO mark.
        const clearedForTakeoff = paperFresh
            ? false
            : stripType === 'departure' &&
              flight.groundstate === 'DEPA' &&
              (!flight.airborne || this.config.look === 'paper')

        // Cleared to land: arrival with clearedToLand flag set, still airborne.
        // Paper: keep CTL after landing/ATA (and vacate to PÅ TAXI) — same idea as CFTO+ATD.
        const clearedToLand = paperFresh
            ? false
            : (stripType === 'arrival' || stripType === 'local') &&
              flight.clearedToLand === true &&
              (flight.airborne !== false || this.config.look === 'paper')

        // Determine actions based on controller status
        let actions: string[] | undefined
        const myCallsign = actionConfig.myCallsign
        const csEq = (a: string | undefined, b: string | undefined) =>
            !!a && !!b && a.toUpperCase() === b.toUpperCase()
        const mySi = (actionConfig.myPositionId || '').toUpperCase()
        const ownerSiRaw = (flight.controllerId || '').toUpperCase()
        const isTrackedByMe =
            csEq(flight.controller, myCallsign) ||
            (!!mySi && !!ownerSiRaw && mySi === ownerSiRaw)
        // Owned if ES reports tracking callsign OR SI (callsign is often blank at TWR)
        const isUntracked =
            (!flight.controller || flight.controller === '') &&
            (!flight.controllerId || flight.controllerId === '')
        const isHandoffToMe =
            csEq(flight.handoffTargetController, myCallsign) ||
            (!!actionConfig.myPositionId &&
                !!flight.handoffTargetControllerId &&
                actionConfig.myPositionId.toUpperCase() === flight.handoffTargetControllerId.toUpperCase())
        const handoffTarget = flight.handoffTargetController
        const hasHandoff = !!handoffTarget && handoffTarget !== ''

        let transferPending: 'in' | 'out' | undefined
        if (hasHandoff) {
            if (isHandoffToMe) transferPending = 'in'
            else if (isTrackedByMe) transferPending = 'out'
        }

        const rawOwnerSi = (flight.controllerId || getControllerPositionId(flight.controller)) || undefined
        const rawTransferSi = hasHandoff
            ? (flight.handoffTargetControllerId || getControllerPositionId(handoffTarget) || undefined)
            : undefined
        // Custom SI (ESSA / ESGG / ESMS) only when exactly one of those airports is active
        const exclusiveSi = exclusiveCustomSiAirportFromConfig(this.config)
        const ownerSi = formatCustomDisplaySi(exclusiveSi, rawOwnerSi, flight.controller)
        const transferSi = formatCustomDisplaySi(exclusiveSi, rawTransferSi, handoffTarget)
        const formatFreq = (mhz: number | undefined) =>
            mhz != null && mhz > 0 && mhz < 199 ? mhz.toFixed(3) : undefined
        const ownerFrequency = !isUntracked ? formatFreq(getFrequencyForCallsign(flight.controller)) : undefined
        const transferFrequency = hasHandoff
            ? formatFreq(
                getFrequencyForCallsign(handoffTarget)
                ?? (handoffTarget === flight.nextController ? flight.nextControllerFrequency : undefined)
              )
            : undefined

        const pendingRofFrom = isTrackedByMe ? this.getPendingRofRequest(flight) : undefined

        if (!clearedForTakeoff) {
            if (isTrackedByMe) {
                // We're the tracking controller - show action from rules
                let defaultAction = determineActionForFlight(flight, sectionId, actionConfig)
                // ESSA: stand + aircraft type → STUP instead of PUSH when no push-back
                if (isEssaRolesConfig(actionConfig)) {
                    defaultAction = remapPushActionForStand(
                        defaultAction,
                        flight.stand,
                        flight.aircraftType,
                        flight.engineType,
                    )
                }
                if (defaultAction === 'LU') {
                    // LU (line up) — show paired with CTO so controller can choose either
                    actions = ['LU', 'CTO']
                } else if (defaultAction) {
                    actions = [defaultAction]
                }
                // Incoming TopSky ROF: XFER first so one-tap handoff to requester
                if (pendingRofFrom && transferPending !== 'out') {
                    if (!actions) actions = ['XFER']
                    else if (!actions.includes('XFER')) actions = ['XFER', ...actions]
                    else actions = ['XFER', ...actions.filter(a => a !== 'XFER')]
                }
            } else if ((isUntracked || isHandoffToMe) && actionConfig.isController) {
                // Inbound handoff → always ASSUME (ROF/taxi rules must not hide it)
                if (isHandoffToMe) {
                    actions = ['ASSUME']
                } else {
                    // Untracked — let action rules decide (ASSUME, CLNC, etc.)
                    // Rules with controller:myself won't match; not_myself / no controller will
                    const action = determineActionForFlight(flight, sectionId, actionConfig)
                    if (action === 'ASSUME') {
                        actions = ['ASSUME']
                    } else if (action === 'ROF') {
                        // ROF is for other-owned only — untracked still gets ASSUME
                        actions = ['ASSUME']
                    } else if (action) {
                        actions = [action, 'ASSUME']
                    } else {
                        // No matching rule — still ASSUME when untracked
                        actions = ['ASSUME']
                    }
                }
            } else if (!isUntracked && !isTrackedByMe && actionConfig.isController) {
                // Tracked by someone else — ROF only (ASSUME is for untracked / handoff-to-me above)
                // Keep ROF visible while pink (cooldown); re-press resets the 2 min timer
                let action = determineActionForFlight(flight, sectionId, actionConfig)
                // RTC: other-owned ARR/CTR always get ROF until handoff (rules may miss DEL/GND roles)
                if (
                    action !== 'ROF' &&
                    isMultiAirportConfig(actionConfig) &&
                    !isHandoffToMe &&
                    (stripType === 'arrival' || stripType === 'local')
                ) {
                    const logical = logicalSectionId(sectionId)
                    if (logical === 'arr' || logical === 'app') {
                        action = 'ROF'
                    }
                }
                if (action === 'ROF') {
                    actions = ['ROF']
                }
            }
        } else if (this.config.look !== 'paper' && isTrackedByMe) {
            // SAAB CFTO (DEPA): show RTO — frontend expands to TAXI OUT / TAXI IN
            const action = determineActionForFlight(flight, sectionId, actionConfig)
            if (action === 'RTO') {
                actions = ['RTO']
            }
        }

        let xferFrequency: string | undefined
        let nextSi: string | undefined
        let nextSiCallsign: string | undefined

        // ESSA sequence: next SI/freq before transfer (ROF overrides inside resolver)
        const essaNext = isEssaRolesConfig(actionConfig)
            ? resolveEssaNextSi(flight, { stripType, sectionId, transferPending }, { rofFrom: pendingRofFrom })
            : undefined
        const essaRoles = actionConfig.essaRoles ?? []
        const coveringGndOnly =
            isEssaRolesConfig(actionConfig) &&
            (actionConfig.myRole === "GND" || essaRoles.some((r) => ALL_GND_POSITIONS.includes(r))) &&
            actionConfig.myRole !== "TWR" &&
            !essaRoles.some((r) => r.startsWith("TWR-"))

        const coveringTwr =
            actionConfig.myRole === "TWR" || essaRoles.some((r) => r.startsWith("TWR-"))

        if (essaNext?.callsign) {
            nextSiCallsign = essaNext.callsign
            // Custom ESSA SI labels (CD/GE…) only when ESSA is the sole custom-SI airport
            nextSi =
                exclusiveSi === "ESSA"
                    ? essaNext.displaySi || essaNext.si
                    : essaNext.si
            if (essaNext.frequency != null && essaNext.frequency > 0 && essaNext.frequency < 199) {
                xferFrequency = essaNext.frequency.toFixed(3)
            }
            // Arrival taxi: next GND beats PARK only when leaving our AoR / moving toward them
            if (isTrackedByMe && transferPending !== "out" && actions?.[0] === "PARK") {
                if (
                    !coveringGndOnly ||
                    shouldOfferGndSequenceXfer(flight, essaRoles, essaNext)
                ) {
                    actions = ["XFER"]
                }
            }
            // TWR-only (GND separate): vacated arrival/local → XFER to next GND via ESSA sequence
            // (EuroScope nextController is often APP/empty, so action rules alone miss this).
            // Same for RTO → TAXI IN (departure TXIN back to gate) — ESSA may pick split GND SI.
            // Do not require airborne===false: vacate detection unlocks XFER while the airborne
            // flag is still sticky (same timing as TXI for GND).
            if (
                coveringTwr &&
                !coveringGndOnly &&
                isTrackedByMe &&
                transferPending !== "out" &&
                parseControllerRole(essaNext.callsign, actionConfig.myAirports) === "GND"
            ) {
                const gs = flight.groundstate ?? ""
                const rtoTaxiIn = stripType === "departure" && gs === "TXIN"
                const vacatedArrLocal =
                    (stripType === "arrival" || stripType === "local") &&
                    flight.airborne !== true &&
                    (gs === "ARR" || gs === "TXIN" || gs === "" || gs === "NSTS") &&
                    (flight.latitude === undefined ||
                        flight.longitude === undefined ||
                        flight.currentAltitude === undefined ||
                        !isOnAnyRunway(
                            flight.latitude,
                            flight.longitude,
                            flight.currentAltitude,
                            actionConfig.myAirports
                        )?.onRunway)
                if (rtoTaxiIn || vacatedArrLocal) {
                    actions = ["XFER"]
                }
            }
        }

        // GND: suppress sequence XFER while still in our AoR and not moving toward next.
        // Fall back by groundstate — never show PARK/TERM before TXIN is set.
        if (
            coveringGndOnly &&
            isTrackedByMe &&
            transferPending !== "out" &&
            actions?.[0] === "XFER" &&
            essaNext &&
            !shouldOfferGndSequenceXfer(flight, essaRoles, essaNext)
        ) {
            if (stripType === "arrival" || stripType === "local") {
                const withoutXfer = actions.filter((a) => a !== "XFER")
                if (withoutXfer.length > 0) {
                    actions = withoutXfer
                } else {
                    const gs = flight.groundstate ?? ""
                    if (gs === "TXIN") {
                        actions = ["PARK"]
                    } else if (gs === "ARR" || gs === "" || gs === "NSTS") {
                        actions = ["TXI"]
                    } else {
                        actions = undefined
                    }
                }
            }
        }

        // Outbound handoff started — TRANS/READY become ASSUME (reclaim / cancel handoff)
        if (transferPending === "out") {
            actions = ["ASSUME"]
        }

        if (pendingRofFrom) {
            const rofFreq = getFrequencyForCallsign(pendingRofFrom)
            if (rofFreq != null && rofFreq > 0 && rofFreq < 199) {
                xferFrequency = rofFreq.toFixed(3)
            }
        }

        const myRole = actionConfig.myRole ?? 'TWR'
        const primaryAction = actions?.[0]
        // READY → GND: never use EuroScope nextController (often APP) when sequence missed
        if (!xferFrequency && primaryAction === 'READY' && (myRole === 'DEL' || isEssaRolesConfig(actionConfig))) {
            const freq = getControllerFrequency('GND') ?? getControllerFrequency('TWR')
            if (freq) xferFrequency = freq.toFixed(3)
        }

        const isEsgg = actionConfig.myAirports.some((a) => a.toUpperCase() === 'ESGG')
        const esggOnline = actionConfig.onlineControllers?.values()

        // ESGG TWR→APP: auto SI from DEP RNAV SID (appendix) or MISAP runway
        if (isEsgg && (myRole === 'TWR' || coveringTwr) && !essaNext) {
            const app = flight.missedApproach
                ? resolveEsggMisapApp(
                      flight.arrRwy || actionConfig.activeRunways?.['ESGG']?.arr?.[0],
                      esggOnline
                  )
                : stripType === 'departure'
                  ? resolveEsggDepApp(
                        flight.depRwy || actionConfig.activeRunways?.['ESGG']?.dep?.[0],
                        flight.sid || extractDisplaySid(flight),
                        esggOnline,
                        "ESGG",
                        flight.route
                    )
                  : undefined
            if (app) {
                nextSiCallsign = app.callsign
                const appPosId = getControllerPositionId(app.callsign)
                // Custom APP letter (A/W) only when ESGG is the sole custom-SI airport
                nextSi =
                    exclusiveSi === "ESGG"
                        ? formatEsggAppSi(app.callsign, app.side, appPosId)
                        : appPosId || app.side
                if (primaryAction === 'XFER') {
                    xferFrequency = app.frequency.toFixed(3)
                }
            }
        }

        // Missed approach (non-ESGG): always XFER to APP (ignore ES nextController — often DEL/GND)
        if (
            !isEsgg &&
            (myRole === 'TWR' || coveringTwr) &&
            flight.missedApproach &&
            primaryAction === 'XFER'
        ) {
            if (
                !(
                    essaNext?.callsign &&
                    parseControllerRole(essaNext.callsign, actionConfig.myAirports) === 'APP'
                )
            ) {
                const appCs = getControllerCallsign('APP')
                if (appCs) {
                    nextSiCallsign = appCs
                    nextSi = getControllerPositionId(appCs) || nextSi
                }
                const appFreq = getControllerFrequency('APP')
                if (appFreq) xferFrequency = appFreq.toFixed(3)
            }
            // else ESSA essaNext already set APP SI/freq
        } else if (!xferFrequency && flight.nextControllerFrequency && flight.nextController) {
            xferFrequency = flight.nextControllerFrequency.toFixed(3)
        }

        // Supplement xferFrequency from online controller tracking when flight data doesn't have it
        if (!xferFrequency && actions?.length) {
            if (primaryAction === 'XFER') {
                if (myRole === 'GND') {
                    const freq = getControllerFrequency('TWR')
                    if (freq) xferFrequency = freq.toFixed(3)
                } else if (myRole === 'TWR' && (stripType === 'arrival' || stripType === 'local')) {
                    const freq = getControllerFrequency('GND')
                    if (freq) xferFrequency = freq.toFixed(3)
                }
            }
        }

        // ROF display fields (pink SI / pink ROF key + tooltip):
        // - inbound: we track the strip and got /LAM/ROF/{requester}
        // - outbound: we sent ROF — pink key for 2 min (rofFlashUntil); still pressable
        let rofRequestSi: string | undefined
        let rofRequestCallsign: string | undefined
        let rofRequestFrequency: string | undefined
        let rofFlashUntil: number | undefined
        if (pendingRofFrom) {
            rofRequestCallsign = pendingRofFrom
            const rawRofSi = getControllerPositionId(pendingRofFrom)
            rofRequestSi = formatCustomDisplaySi(exclusiveSi, rawRofSi, pendingRofFrom)
            rofRequestFrequency = xferFrequency
            rofFlashUntil = flight.rofFlashUntil
        } else if (!isTrackedByMe && this.isRofCoolingDown(flight.callsign) && this.config.myCallsign) {
            rofRequestCallsign = this.config.myCallsign
            const rawRofSi = getControllerPositionId(this.config.myCallsign) || this.config.myPositionId
            rofRequestSi = formatCustomDisplaySi(exclusiveSi, rawRofSi, this.config.myCallsign)
            const myFreq = this.config.myFrequency
            if (myFreq != null && myFreq > 0 && myFreq < 199) {
                rofRequestFrequency = myFreq.toFixed(3)
            }
            rofFlashUntil = this.getRofCooldownUntil(flight.callsign)
        }

        // Can reset squawk if we're a controller and we track the flight (or it's untracked)
        const canResetSquawk = actionConfig.isController === true && (isTrackedByMe || isUntracked)

        // Can edit clearance if we're a controller and the flight is tracked by me or untracked
        const canEditClearance = actionConfig.isController === true && (isTrackedByMe || isUntracked)

        // Slow aircraft detection — V / Z never get auto-SLOW SID rules or SLOW flag
        const isSlow =
            (isIfrSidEligible(flightRules) &&
                isSlowAircraft(wakeTurbulence ?? '', flight.aircraftType ?? '', flight.engineType)) ||
            undefined

        // Highlight actions: determine which action buttons should be highlighted yellow
        const highlightActions: string[] = []
        if (actions && flight.latitude !== undefined && flight.longitude !== undefined && flight.currentAltitude !== undefined) {
            // TXI highlight: arrival that has left the runway (taxiing in)
            if (actions.includes('TXI') && stripType === 'arrival') {
                const onRunway = isOnAnyRunway(flight.latitude, flight.longitude, flight.currentAltitude, actionConfig.myAirports)
                if (!onRunway) {
                    highlightActions.push('TXI')
                }
            }

            // PARK highlight: arrival at a stand
            if (actions.includes('PARK') && stripType === 'arrival') {
                const nearestAirport = findNearestAirport(flight.latitude, flight.longitude, actionConfig.myAirports, getAirportCoords)
                if (nearestAirport) {
                    const stand = findStandForPosition(nearestAirport, flight.latitude, flight.longitude)
                    if (stand) {
                        highlightActions.push('PARK')
                    }
                }
            }

            if (actions.includes('XFER') && transferPending !== 'out') {
                if (coveringGndOnly && isEssaRolesConfig(actionConfig)) {
                    // GND: highlight only outside our AoR (XFER itself gated the same way)
                    if (!isInSelectedGndAor(flight, essaRoles)) {
                        highlightActions.push('XFER')
                    }
                } else if (stripType === 'departure') {
                    // TWR/etc: departure outside CTR
                    const withinCtr = isWithinCtr(
                        actionConfig.myAirports,
                        flight.latitude,
                        flight.longitude,
                        flight.currentAltitude
                    )
                    if (withinCtr === false) {
                        highlightActions.push('XFER')
                    }
                } else if (stripType === 'arrival' || stripType === 'local') {
                    // TWR→GND: vacated runway
                    const onRunway = isOnAnyRunway(
                        flight.latitude,
                        flight.longitude,
                        flight.currentAltitude,
                        actionConfig.myAirports
                    )
                    if (!onRunway) {
                        highlightActions.push('XFER')
                    }
                }
            }
        }

        // Incoming ROF: XFER yellow↔pink flash is frontend-only for rofFlashUntil; no sticky highlight

        const cdmEligible = this.isCdmEligibleFlight(flight)
        const ifrDeparture = stripType === 'departure' && (flightRules === 'I' || flightRules === 'Y')

        const activeDepForOrigin = flight.origin
            ? this.config.activeRunways?.[flight.origin]?.dep
            : undefined
        const displaySid = extractDisplaySid(flight, activeDepForOrigin)
        // First FPL point after ADEP/rwy or SID/rwy (not the SID procedure name)
        const tmaExit =
            stripType === 'departure' || stripType === 'local'
                ? extractTmaExitPoint(undefined, flight.extractedRoute || flight.route)
                : undefined

        // Anonymous VFR/CROSS: flight.callsign holds stable id (vfrdep:uuid); never use callsign@ICAO
        const anon = isAnonymousSpecialStripId(flight.callsign)
        const stripId = anon
            ? flight.callsign
            : airport
              ? stripIdForAirport(flight.callsign, airport)
              : flight.callsign
        return {
            id: stripId,
            syncKey: stripId,
            callsign: anon ? '' : flight.callsign,
            rtfCallsign: anon ? undefined : getRtfCallsign(flight.callsign, flight.fplRemarks),
            communicationSuffix: anon ? undefined : formatCommunicationSuffix(flight.communicationType),
            aircraftType: flight.aircraftType ?? (anon ? '' : 'UNKN'),
            wakeTurbulence,
            flightRules,
            adep: flight.origin ?? '????',
            ades: flight.destination ?? '????',
            adepName: flight.origin ? getIcaoAirportName(flight.origin) : undefined,
            adesName: flight.destination ? getIcaoAirportName(flight.destination) : undefined,
            route: flight.route,
            extractedRoute: flight.extractedRoute || undefined,
            // Prefer ES filed TAS (flight.tas); fall back to route speed/level group
            tas:
                stripType === "departure" || stripType === "local"
                    ? normalizeCruiseTas(flight.tas) ||
                      extractFiledTasFromRoute(flight.route) ||
                      undefined
                    : undefined,
            eobt: flight.eobt,
            eta: flight.ete ? moment(flight.lastUpdate).utc().add(flight.ete, 'minutes').format('HHmm') : undefined,
            sid: displaySid,
            tmaExit,
            star: flight.star,
            rfl,
            xfl,
            squawk: flight.squawk,
            clearedAltitude,
            assignedHeading: flight.llz
                ? 'LLZ'
                : flight.ahdg && flight.ahdg > 0
                  ? String(flight.ahdg).padStart(3, '0')
                  : undefined,
            assignedSpeed: flight.asp ? String(flight.asp) : undefined,
            stand: flight.stand,
            runway: stripType === 'departure' || stripType === 'local'
                ? (extractDisplayDepRunway(
                      flight,
                      flight.origin ? this.config.activeRunways?.[flight.origin]?.dep : undefined
                  ) || flight.arrRwy)
                : (flight.arrRwy
                    || (flight.destination
                        ? this.config.activeRunways?.[flight.destination]?.arr?.[0]
                        : undefined)),
            stripType,
            bayId,
            sectionId,
            position,
            bottom,
            actions,
            canResetSquawk: canResetSquawk || undefined,
            direct: flight.direct || undefined,
            clearance: paperFresh ? undefined : flight.clearance ?? undefined,
            clearanceRead: paperFresh
                ? undefined
                : flight.clearance || flight.clearanceReadback || flight.clearanceRead || undefined,
            clearanceReadback: paperFresh
                ? undefined
                : flight.clearance || flight.clearanceReadback || undefined,
            clearedForTakeoff,
            clearedToLand,
            airborne: flight.airborne,
            missedApproach: flight.missedApproach || undefined,
            canEditClearance: canEditClearance || undefined,
            xferFrequency,
            nextSi,
            nextSiCallsign,
            rofRequestSi,
            rofRequestCallsign,
            rofRequestFrequency,
            rofFlashUntil,
            dclStatus: flight.dclStatus,
            dclMessage: flight.dclMessage,
            dclClearance: flight.dclClearance,
            paperClrReadSuppressed: paperFresh
                ? undefined
                : flight.paperClrReadSuppressed || undefined,
            dclDismissed: paperFresh ? undefined : flight.dclDismissed || undefined,
            syncedDclMark: paperFresh ? undefined : flight.syncedDclMark || undefined,
            // CDM times only on ESSA IFR departures (not VFR / local)
            tobt: cdmEligible ? flight.tobt : undefined,
            tsat: cdmEligible ? flight.tsat : undefined,
            ttot: cdmEligible ? flight.ttot : undefined,
            tobtSetBy: cdmEligible ? flight.tobtSetBy : undefined,
            asrt: cdmEligible ? flight.asrt : undefined,
            tsac: cdmEligible ? flight.tsac : undefined,
            ctoc: cdmEligible ? flight.ctoc : undefined,
            qnhGiven: flight.qnhGiven,
            atisGiven: flight.atisGiven,
            weatherGiven: flight.weatherGiven || undefined,
            cdmSts: cdmEligible ? flight.cdmSts : undefined,
            ctot: ifrDeparture ? flight.ctot : undefined,
            ctotCancelled: ifrDeparture && flight.ctotCancelled ? true : undefined,
            ctotReason: ifrDeparture ? flight.ctotReason : undefined,
            atd: flight.atd,
            ata: flight.ata,
            remarks: flight.remarks || undefined,
            hp: flight.hp || undefined,
            hs: flight.hs || undefined,
            coo: flight.coo || undefined,
            exitCoordPending: flight.exitCoordPending || undefined,
            exitCoordOutbound: flight.exitCoordOutbound || undefined,
            exitCoordRefused: flight.exitCoordRefused || undefined,
            exitCoordPoint: flight.exitCoordPoint || undefined,
            exitCoordAltitude:
                flight.exitCoordAltitude && flight.exitCoordAltitude > 0
                    ? flight.exitCoordAltitude
                    : undefined,
            pob: parsePobFromRemarks(flight.fplRemarks),
            isSlow,
            // ESSA east SID box: preferred Appendix A sector DEP-E / ARR-E
            appDepNextSector:
                (stripType === "departure" || stripType === "local") &&
                isIfrSidEligible(flightRules) &&
                (flight.origin || "").toUpperCase() === "ESSA"
                    ? resolveFlightAppDepNextSector(flight)
                    : undefined,
            highlightActions: highlightActions.length > 0 ? highlightActions : undefined,
            isAssumed: isTrackedByMe || undefined,
            ownerSi,
            // True whenever someone else tracks (by callsign and/or SI)
            ownedByOther: (!isTrackedByMe && !isUntracked) || undefined,
            // Dimming: INBOUND dimmed unless assumed / pending transfer;
            // TWR pending+cleared when DEL/GND online.
            dimmed: (() => {
                // Assumed by me or any pending handoff → full brightness
                if (isTrackedByMe) return undefined
                if (transferPending === 'in' || transferPending === 'out') return undefined

                // INBOUND / INBOUND GND: dim everything else (other-owned / untracked)
                if (
                    sectionId === 'inbound' ||
                    sectionId === 'inbound_gnd' ||
                    sectionId.endsWith('_inbound')
                ) {
                    return true
                }

                // TWR: dim PENDING DEP / CLEARED when DEL or GND is separately online
                if (
                    actionConfig.myRole === 'TWR' &&
                    (getControllerCallsign('DEL') || getControllerCallsign('GND')) &&
                    (sectionId === 'pending_dep' ||
                        sectionId === 'cleared' ||
                        sectionId.endsWith('_pending_dep') ||
                        sectionId.endsWith('_cleared'))
                ) {
                    return true
                }

                return undefined
            })(),
            transferPending,
            transferSi: transferSi || undefined,
            ownerCallsign:
                (!isUntracked &&
                    (flight.controller || getCallsignForPositionId(flight.controllerId))) ||
                undefined,
            ownerFrequency,
            transferCallsign: hasHandoff ? handoffTarget : undefined,
            transferFrequency,
            groundstate: flight.groundstate || undefined,
            airport
        }
    }

    /**
     * Determine strip type based on flight data
     */
    private determineStripType(flight: Flight, config: EfsStaticConfig = this.config): StripType {
        const myAirports = config.myAirports

        const originIsOurs = flight.origin !== undefined && myAirports.includes(flight.origin)
        const destIsOurs = flight.destination !== undefined && myAirports.includes(flight.destination)

        // Local flight (same origin and destination at one of our airports)
        if (originIsOurs && destIsOurs) {
            return 'local'
        }

        // Departure from one of our airports
        if (originIsOurs) {
            return 'departure'
        }

        // Arrival to one of our airports
        if (destIsOurs) {
            return 'arrival'
        }

        // Cross traffic (neither origin nor destination at our airports)
        return 'cross'
    }

    /**
     * Parse wake turbulence category
     * First tries explicit value from plugin, then falls back to aircraft type lookup
     */
    private parseWakeCategory(aircraftType?: string, explicit?: string): WakeCategory | undefined {
        // Use explicit value if valid
        if (explicit && ['L', 'M', 'H', 'J'].includes(explicit)) {
            return explicit as WakeCategory
        }

        // No ATYP and no explicit WTC — do not invent a default category
        if (!aircraftType) return undefined

        // Heavy aircraft (simplified lookup table)
        const heavyTypes = ['B744', 'B748', 'B77W', 'B772', 'B773', 'B788', 'B789', 'B78X',
                          'A332', 'A333', 'A339', 'A342', 'A343', 'A345', 'A346',
                          'A388', 'A359', 'A35K']
        const superTypes = ['A388', 'A380']
        const lightTypes = ['C172', 'C152', 'PA28', 'PA32', 'DA40', 'DA42', 'SR22', 'BE20', 'BE36']

        if (superTypes.includes(aircraftType)) return 'J'
        if (heavyTypes.includes(aircraftType)) return 'H'
        if (lightTypes.includes(aircraftType)) return 'L'
        return 'M'
    }

    /**
     * Display FRUL: FPL I/V/Y/Z, with I+VFR→Y and V+IFR→Z from route tokens.
     */
    private parseFlightRules(flight: Flight): FlightRules {
        return resolveDisplayFlightRules(flight.flightRules, flight.route)
    }

    /**
     * Format altitude like the CFL menu (TopSkyAirspace TA):
     * ≤ TA → A50; > TA → 090 (no F/FL prefix).
     */
    private formatFlightLevel(feet: number, airport?: string | null): string {
        return formatCflMenuLabel(feet, getTransitionAltitudeFt(airport)) || String(Math.round(feet / 100))
    }

    /**
     * Process multiple messages (for initial loading)
     */
    processMessages(messages: PluginMessage[]): ProcessMessageResult[] {
        return messages.map(msg => this.processMessage(msg))
    }

    /**
     * Clear all data
     */
    clear() {
        this.flights.clear()
        this.stripAssignments.clear()
        this.positionCounters.clear()
        this.printedCallsigns.clear()
        this.appTransferPinSession.clear()
        this.appTransferDragReleased.clear()
        this.gndTaxiPinSession.clear()
        this.gndTaxiDragReleased.clear()
        this.utflygningPinSession.clear()
        this.utflygningDragReleased.clear()
        this.abovePushPinSession.clear()
        this.abovePushDragReleased.clear()
    }

    /**
     * Clear strip assignments only (keep flights).
     * Used when switching configs so flights can be re-evaluated with new rules.
     */
    clearAssignments() {
        this.stripAssignments.clear()
        this.positionCounters.clear()
        this.printedCallsigns.clear()
        this.appTransferPinSession.clear()
        this.appTransferDragReleased.clear()
        this.gndTaxiPinSession.clear()
        this.gndTaxiDragReleased.clear()
        this.utflygningPinSession.clear()
        this.utflygningDragReleased.clear()
        this.abovePushPinSession.clear()
        this.abovePushDragReleased.clear()
        // Reset per-flight rule tracking so rules re-evaluate cleanly
        for (const flight of this.flights.values()) {
            flight.lastSectionRule = undefined
            flight.noSectionFound = false
        }
    }

    /**
     * Flights eligible for a strip but not yet printed (manual paper mode).
     */
    listPendingPrint(): PendingPrintFlightInfo[] {
        if (!this.isManualPaperPrint()) return []
        const out: PendingPrintFlightInfo[] = []
        for (const flight of this.flights.values()) {
            if (flight.deleted || flight.manuallyDeleted) continue
            if (!flightHasRequiredData(flight) || !this.isEligibleForStrip(flight)) continue
            if (this.stripAssignments.has(flight.callsign)) continue
            if (this.printedCallsigns.has(flight.callsign.toUpperCase())) continue
            const deleteResult = shouldDeleteFlight(flight, this.config)
            if (deleteResult.shouldDelete) continue
            const targetSection = determineSectionForFlight(flight, this.config)
            if (!targetSection) continue
            out.push({
                callsign: flight.callsign,
                stripType: this.determineStripType(flight),
                adep: flight.origin ?? '',
                ades: flight.destination ?? '',
                aircraftType: flight.aircraftType ?? '',
                eobt: flight.eobt,
                ctot: flight.ctot,
                assr: hasValidAssignedSquawk(flight.squawk) ? flight.squawk : undefined,
            })
        }
        out.sort((a, b) => {
            const ae = a.eobt || a.ctot || '9999'
            const be = b.eobt || b.ctot || '9999'
            if (ae !== be) return ae.localeCompare(be)
            return a.callsign.localeCompare(b.callsign)
        })
        return out
    }

    /**
     * Merge VATSIM network FPL / position into a Flight (for manual print).
     * Does not overwrite richer EuroScope fields when already present.
     */
    ingestVatsimPilot(pilot: VatsimPilot): Flight {
        const cs = pilot.callsign.toUpperCase()
        const flight = this.getOrCreateFlight(cs)
        const fp = pilot.flight_plan
        const fromEs = !flight.synthetic && !!(flight.origin && flight.destination)

        if (fp) {
            if (!fromEs || !flight.origin) flight.origin = (fp.departure || "").toUpperCase() || flight.origin
            if (!fromEs || !flight.destination) {
                flight.destination = (fp.arrival || "").toUpperCase() || flight.destination
            }
            if (!fromEs || !flight.alternate) {
                flight.alternate = (fp.alternate || "").toUpperCase() || flight.alternate
            }
            if (!fromEs || !flight.aircraftType) {
                const short = (fp.aircraft_short || "").toUpperCase()
                const full = (fp.aircraft || "").toUpperCase()
                // Prefer short type; full string often includes /M-EQUIP/SUR
                flight.aircraftType =
                    short ||
                    full.split("/")[0]?.replace(/^\W+/, "") ||
                    flight.aircraftType
            }
            // VATSIM aircraft field often carries full ICAO TYPE/WTC-EQUIP/SUR (e.g. B738/M-VW/C)
            if (fp.aircraft && (!flight.equipment || !flight.surveillance)) {
                const parsed = parseAircraftInfo(fp.aircraft, flight.capabilities, flight.rvsm)
                applyParsedEquipment(flight, parsed, fp.aircraft)
            }
            if (!fromEs || !flight.flightRules) {
                const fr = (fp.flight_rules || "").toUpperCase()
                if (fr === "I" || fr === "V" || fr === "Y" || fr === "Z") flight.flightRules = fr
            }
            if (!fromEs || !flight.route) flight.route = fp.route || flight.route
            if (!fromEs || !flight.tas) {
                flight.tas =
                    extractFiledTasFromRoute(fp.route) ||
                    normalizeCruiseTas(fp.cruise_tas) ||
                    flight.tas
            }
            if (!fromEs || !flight.eobt) flight.eobt = normalizeVatsimDeptime(fp.deptime) || flight.eobt
            if (!fromEs || flight.rfl === undefined) {
                const rfl = parseVatsimAltitude(fp.altitude)
                if (rfl !== undefined) flight.rfl = rfl
            }
            if (!fromEs || !flight.fplRemarks) flight.fplRemarks = fp.remarks || flight.fplRemarks
            const xpdr = fp.assigned_transponder || pilot.transponder
            if ((!fromEs || !flight.squawk) && xpdr && xpdr !== "0000") {
                const n = normalizeAssignedSquawk(xpdr)
                if (n) flight.squawk = n
            }
        }

        if (pilot.latitude !== undefined) flight.latitude = pilot.latitude
        if (pilot.longitude !== undefined) flight.longitude = pilot.longitude
        if (pilot.altitude !== undefined) flight.currentAltitude = pilot.altitude
        if (pilot.groundspeed !== undefined) flight.groundSpeed = pilot.groundspeed

        if (!fromEs) flight.synthetic = true
        flight.lastUpdate = Date.now()
        if (!flight.firstSeen) flight.firstSeen = Date.now()
        return flight
    }

    /**
     * Explicitly print a strip (paper look). Creates from local flight or VATSIM FPL.
     * Forces placement even when outside normal eligibility range.
     */
    async printStrip(callsign: string): Promise<ProcessMessageResult> {
        return this.printStripFromExternal(callsign, {})
    }

    /**
     * VatFSP / VatIRIS external print — always force-creates a strip from payload
     * (+ local ES / live VATSIM when available). Sweatbox/local skips live VATSIM
     * lookup; missing ADEP/ADES default from myAirports + strip type.
     */
    async printStripFromExternal(
        callsign: string,
        overlay: {
            origin?: string
            destination?: string
            aircraftType?: string
            wakeTurbulence?: string
            flightRules?: string
            route?: string
            eobt?: string
            ctot?: string
            squawk?: string
            sid?: string
            tas?: string
            rflFeet?: number
            /** "departure" | "arrival" — used for ADEP/ADES defaults */
            stripKind?: "departure" | "arrival"
        } = {},
    ): Promise<ProcessMessageResult> {
        const cs = callsign.trim().toUpperCase()
        if (!cs) return {}

        const home = (this.config.myAirports[0] || "ESGG").toUpperCase()
        const kind = overlay.stripKind === "arrival" ? "arrival" : "departure"

        let flight = this.flights.get(cs)

        // Live network FPL only when online realm — sweatbox traffic is not on VATSIM data
        if ((!flight || !flightHasRequiredData(flight)) && !isOfflineVatsimRealm()) {
            const pilot = await lookupVatsimPilot(cs)
            if (pilot?.flight_plan?.departure && pilot.flight_plan.arrival) {
                flight = this.ingestVatsimPilot(pilot)
            }
        }

        const overlayOrigin = overlay.origin?.trim().toUpperCase() || undefined
        const overlayDest = overlay.destination?.trim().toUpperCase() || undefined

        if (!flight) {
            const origin =
                overlayOrigin ||
                (kind === "departure" ? home : "ZZZZ")
            const destination =
                overlayDest ||
                (kind === "arrival" ? home : "ZZZZ")
            flight = {
                callsign: cs,
                origin,
                destination,
                aircraftType: overlay.aircraftType?.toUpperCase(),
                wakeTurbulence: overlay.wakeTurbulence,
                flightRules: overlay.flightRules || "I",
                route: overlay.route,
                eobt: overlay.eobt,
                ctot: overlay.ctot,
                squawk: overlay.squawk,
                sid: overlay.sid,
                tas: overlay.tas,
                rfl: overlay.rflFeet,
                synthetic: true,
                firstSeen: Date.now(),
                lastUpdate: Date.now(),
            }
            this.flights.set(cs, flight)
        } else {
            // IRIS/FSP payload wins when provided (custom strip from API)
            if (overlayOrigin) flight.origin = overlayOrigin
            if (overlayDest) flight.destination = overlayDest
            if (!flight.origin) {
                flight.origin = kind === "departure" ? home : "ZZZZ"
            }
            if (!flight.destination) {
                flight.destination = kind === "arrival" ? home : "ZZZZ"
            }
            if (overlay.aircraftType) flight.aircraftType = overlay.aircraftType.toUpperCase()
            if (overlay.wakeTurbulence) flight.wakeTurbulence = overlay.wakeTurbulence
            if (overlay.flightRules) flight.flightRules = overlay.flightRules
            if (overlay.route) flight.route = overlay.route
            if (overlay.eobt) flight.eobt = overlay.eobt
            if (overlay.ctot) flight.ctot = overlay.ctot
            if (overlay.squawk) flight.squawk = overlay.squawk
            if (overlay.sid) flight.sid = overlay.sid
            if (overlay.tas) flight.tas = overlay.tas
            if (overlay.rflFeet != null) flight.rfl = overlay.rflFeet
            flight.lastUpdate = Date.now()
        }

        if (!flightHasRequiredData(flight)) return {}

        flight.deleted = false
        flight.manuallyDeleted = false
        flight.deletedByBeyondRange = false
        flight.noSectionFound = false

        const hadStrip = this.stripAssignments.has(cs)
        if (hadStrip) {
            // Re-print: drop sticky placement and paper UI state, then place as new
            this.resetFlightForFreshPrint(flight)
            this.clearUtflygningPinned(cs)
            this.stripAssignments.delete(cs)
            flight.lastDeleteRule = "strip_reprint"
        }

        this.markStripPrinted(flight.callsign)

        // Always force-place (ignore radar-range eligibility / finalize early-outs)
        const created = this.resolveStripResult(flight.callsign, flight, true)
        if (!created.strip) return created
        return {
            ...created,
            cleanReprint: hadStrip || undefined,
            freshReprint: hadStrip || undefined,
        }
    }

    /**
     * Clear paper presentation state so a re-print shows a blank strip
     * (ES clearance / groundstate / CDM times are kept).
     */
    private resetFlightForFreshPrint(flight: Flight): void {
        flight.clearanceRead = false
        flight.clearanceReadback = false
        flight.paperClrReadSuppressed = undefined
        flight.dclDismissed = undefined
        flight.syncedDclMark = undefined
        flight.qnhGiven = undefined
        flight.atisGiven = undefined
        flight.weatherGiven = undefined
        flight.placementStickyKey = undefined
        if (flight.lastSectionRule === "manual") {
            flight.lastSectionRule = undefined
        }
        flight.paperFreshPrint = true
    }

    /**
     * Re-evaluate all eligible flights and return strips.
     * Used after config switch to place flights into sections per new rules.
     */
    reprocessAll(): { strip: FlightStrip; softDeleted: boolean }[] {
        const results: { strip: FlightStrip; softDeleted: boolean }[] = []

        for (const flight of this.flights.values()) {
            if (flight.manuallyDeleted) continue

            if (isMultiAirportConfig(this.config)) {
                const multi = this.resolveMultiAirportStrips(flight.callsign, flight)
                if (multi.strips) {
                    for (const strip of multi.strips) {
                        results.push({ strip, softDeleted: false })
                    }
                }
                continue
            }

            // Must have required data and be within range
            if (!flightHasRequiredData(flight) || !this.isEligibleForStrip(flight)) continue

            // Re-evaluate delete rules
            const deleteResult = shouldDeleteFlight(flight, this.config)
            if (deleteResult.shouldDelete) {
                flight.deleted = true
                flight.lastDeleteRule = deleteResult.ruleId
                continue
            }
            flight.deleted = false
            flight.lastDeleteRule = undefined

            // Manual paper: skip unprinted flights on bulk reprocess
            if (this.shouldGateNewStrip(flight.callsign)) continue

            // Determine section for flight
            const targetSection = determineSectionForFlight(flight, this.config)
            if (!targetSection) {
                flight.noSectionFound = true
                flight.deleted = true
                flight.lastDeleteRule = 'no_section'
                continue
            }

            const position = this.getNewStripPosition(targetSection.bayId, targetSection.sectionId, flight)
            const bottom = false
            this.markStripPrinted(flight.callsign)
            this.stripAssignments.set(flight.callsign, {
                bayId: targetSection.bayId,
                sectionId: targetSection.sectionId,
                position,
                bottom
            })
            flight.lastSectionRule = targetSection.ruleId ?? 'default'

            const strip = this.createStrip(flight, targetSection.bayId, targetSection.sectionId, position, bottom)
            results.push({ strip, softDeleted: false })
        }

        return results
    }

    /**
     * Set backend-managed flags on a flight (clearedToLand, airborne, groundstate)
     * Returns the updated strip if the flight exists and has required data
     */
    setBackendFlags(
        callsign: string,
        flags: { clearedToLand?: boolean; airborne?: boolean; groundstate?: GroundState }
    ): { flight?: Flight; strip?: FlightStrip; sectionChanged?: boolean; previousSection?: { bayId: string; sectionId: string }; shiftedCallsigns?: string[] } {
        const flight = this.flights.get(callsign)
        if (!flight) return {}

        // Update flags
        if (flags.clearedToLand !== undefined) flight.clearedToLand = flags.clearedToLand
        if (flags.airborne !== undefined) flight.airborne = flags.airborne
        if (flags.groundstate !== undefined) {
            flight.groundstate = flags.groundstate
            if (flags.groundstate === 'PARK') flight.airborne = false
            if (flags.groundstate === '') {
                flight.groundstateClearedUntil = Date.now() + 3000
                flight.groundstateHoldUntil = undefined
            } else {
                flight.groundstateClearedUntil = undefined
                flight.groundstateHoldUntil = Date.now() + 12000
            }
        }
        flight.lastUpdate = Date.now()

        // Check if we should create/update a strip
        if (!flightHasRequiredData(flight)) {
            return { flight }
        }

        // Determine section based on rules
        const targetSection = determineSectionForFlight(flight, this.config)
        const currentAssignment = this.stripAssignments.get(callsign)

        if (!targetSection) {
            if (!currentAssignment) {
                return { flight }
            }
            const strip = this.createStrip(
                flight,
                currentAssignment.bayId,
                currentAssignment.sectionId,
                currentAssignment.position,
                currentAssignment.bottom
            )
            return { flight, strip }
        }

        const sectionChanged = currentAssignment &&
            (currentAssignment.bayId !== targetSection.bayId ||
             currentAssignment.sectionId !== targetSection.sectionId)

        let position: number
        let bottom: boolean
        let previousSection: { bayId: string; sectionId: string } | undefined

        // Store the rule that matched
        const ruleSource = targetSection.ruleId ?? 'default'

        if (!currentAssignment) {
            position = this.getNewStripPosition(targetSection.bayId, targetSection.sectionId, flight)
            bottom = false
            this.stripAssignments.set(callsign, {
                bayId: targetSection.bayId,
                sectionId: targetSection.sectionId,
                position,
                bottom
            })
            flight.lastSectionRule = ruleSource
            console.log(`[RULE] ${callsign} -> ${targetSection.sectionId} (rule: ${ruleSource}, backend flags)`)
        } else if (sectionChanged) {
            previousSection = {
                bayId: currentAssignment.bayId,
                sectionId: currentAssignment.sectionId
            }
            position = this.getNewStripPosition(targetSection.bayId, targetSection.sectionId, flight)
            bottom = false
            this.stripAssignments.set(callsign, {
                bayId: targetSection.bayId,
                sectionId: targetSection.sectionId,
                position,
                bottom
            })
            const previousRule = flight.lastSectionRule ?? 'unknown'
            flight.lastSectionRule = ruleSource
            console.log(`[RULE] ${callsign} ${previousSection.sectionId} -> ${targetSection.sectionId} (rule: ${ruleSource}, was: ${previousRule}, backend flags)`)
        } else {
            position = currentAssignment.position
            bottom = currentAssignment.bottom
        }

        const strip = this.createStrip(flight, targetSection.bayId, targetSection.sectionId, position, bottom)
        const shiftedCallsigns = this.getLastShiftedCallsigns()

        return {
            flight,
            strip,
            sectionChanged: sectionChanged ?? false,
            previousSection,
            shiftedCallsigns: shiftedCallsigns.length > 0 ? shiftedCallsigns : undefined
        }
    }

    /**
     * Create a special strip (VFR DEP, VFR ARR, CROSS) by creating a synthetic flight.
     * Callsign/aircraft type may be empty — then a stable `vfrdep:` / `vfrarr:` / `cross:` id is used.
     * If a matching flight already exists (non-empty callsign), uses its data instead.
     * `forcedId` reuses a remote sync key when materializing from VatIRIS.
     */
    createSpecialStrip(
        stripType: 'vfrDep' | 'vfrArr' | 'cross',
        callsign: string,
        aircraftType?: string,
        airport?: string,
        targetBayId?: string,
        targetSectionId?: string,
        position?: number,
        isBottom?: boolean,
        forcedId?: string,
    ): { strip: FlightStrip; shiftedCallsigns?: string[] } | undefined {
        const cs = (callsign ?? '').trim().toUpperCase()
        const anonymous = !cs
        const flightKey =
            anonymous
                ? (forcedId && isAnonymousSpecialStripId(forcedId)
                    ? (parseStripAirportId(forcedId)?.callsign ?? forcedId)
                    : newAnonymousSpecialStripId(stripType))
                : cs

        const existingFlight = anonymous ? undefined : this.flights.get(cs)
        const hasMatchingFlight = !!existingFlight

        // Determine origin/destination based on strip type
        const primaryAirport = airport ?? this.config.myAirports[0] ?? 'ZZZZ'
        let origin: string
        let destination: string

        if (stripType === 'vfrDep') {
            origin = primaryAirport
            destination = existingFlight?.destination ?? 'ZZZZ'
        } else if (stripType === 'vfrArr') {
            origin = existingFlight?.origin ?? 'ZZZZ'
            destination = primaryAirport
        } else {
            // cross: use existing flight data or placeholder
            origin = existingFlight?.origin ?? 'ZZZZ'
            destination = existingFlight?.destination ?? 'ZZZZ'
        }

        const atyp = (aircraftType ?? '').trim().toUpperCase()

        // Create or update the flight record (anonymous: keyed by synthetic id)
        const flight = existingFlight ?? this.getOrCreateFlight(flightKey)
        if (!existingFlight) {
            // Synthetic flight - fill in minimal data
            flight.origin = origin
            flight.destination = destination
            flight.aircraftType = atyp
            flight.flightRules = stripType === 'cross' ? 'I' : 'V'
            flight.synthetic = true
            flight.lastUpdate = Date.now()
        } else {
            // Real flight exists: override origin/destination based on strip type
            if (stripType === 'vfrDep') {
                flight.origin = origin
            } else if (stripType === 'vfrArr') {
                flight.destination = destination
            }
            if (atyp && !flight.aircraftType) flight.aircraftType = atyp
        }

        // Pre-populate default runway from active runway configuration if not already set.
        // Applied for both new synthetic flights and existing flights (e.g. radar-only contacts
        // that had no flight plan and therefore no departure runway assigned yet).
        const airportRunways = this.config.activeRunways?.[primaryAirport]
        if (stripType === 'vfrDep' && !flight.depRwy && airportRunways?.dep?.length) {
            flight.depRwy = airportRunways.dep[0]
        } else if (stripType === 'vfrArr' && !flight.arrRwy && airportRunways?.arr?.length) {
            flight.arrRwy = airportRunways.arr[0]
        }

        // Determine target section
        let bayId: string
        let sectionId: string
        let pos: number
        let bottom = isBottom ?? false
        const multi = isMultiAirportConfig(this.config)
        const stripAirport = multi ? primaryAirport : undefined

        /** RTC defaults: VFR DEP → DEP (addFromTop:false = bottom); ARR/CRS → ARR top */
        const defaultLogicalForSpecial = (): string =>
            stripType === 'vfrDep' ? 'dep' : 'arr'

        if (multi && stripAirport) {
            const airportBayId = resolveBayForAirport(stripAirport, this.config.columnAirports)
            // Honour drop target only when it is already in the selected airport's column
            if (targetBayId && targetSectionId && targetBayId === airportBayId) {
                bayId = targetBayId
                sectionId = targetSectionId
                pos = position ?? this.getNewStripPosition(bayId, sectionId, flight)
            } else {
                bayId = airportBayId
                sectionId = prefixedSectionId(bayId, defaultLogicalForSpecial())
                bottom = false
                pos = this.getNewStripPosition(bayId, sectionId, flight)
            }
        } else if (targetBayId && targetSectionId) {
            bayId = targetBayId
            sectionId = targetSectionId
            pos = position ?? this.getNewStripPosition(bayId, sectionId, flight)
        } else {
            const targetSection = determineSectionForFlight(flight, this.config)
            if (!targetSection) {
                // Use default section or first section
                const defaultSection = this.config.defaultSection
                const defaultBayId = defaultSection ? this.config.sectionToBay.get(defaultSection) : undefined
                if (defaultBayId && defaultSection) {
                    bayId = defaultBayId
                    sectionId = defaultSection
                } else if (this.config.layout.bays.length > 0 && this.config.layout.bays[0].sections.length > 0) {
                    bayId = this.config.layout.bays[0].id
                    sectionId = this.config.layout.bays[0].sections[0].id
                } else {
                    return undefined
                }
                pos = this.getNewStripPosition(bayId, sectionId, flight)
            } else {
                bayId = targetSection.bayId
                sectionId = targetSection.sectionId
                pos = this.getNewStripPosition(bayId, sectionId, flight)
            }
        }

        // User-initiated create counts as a print
        this.markStripPrinted(flightKey)

        // Record assignment — anonymous strips use stable id (no callsign@ICAO)
        const assignmentKey =
            anonymous ? flightKey : stripAirport ? stripIdForAirport(cs, stripAirport) : cs
        this.stripAssignments.set(assignmentKey, { bayId, sectionId, position: pos, bottom })
        flight.lastSectionRule = 'manual'

        // Create the strip (airport field set in multi mode; anon id ignores @ICAO)
        const strip = this.createStrip(
            flight,
            bayId,
            sectionId,
            pos,
            bottom,
            stripAirport,
            stripAirport ? withAirportScope(this.config, stripAirport) : this.config,
        )

        // Override strip type for cross
        if (stripType === 'cross') {
            strip.stripType = 'cross'
        }

        // Matching flight / empty identity
        strip.hasMatchingFlight = anonymous ? false : hasMatchingFlight
        if (anonymous) {
            strip.callsign = ''
            strip.syncKey = strip.id
        }
        // No ATYP entered → no invented ATYP/WTC
        if (!atyp) {
            strip.aircraftType = ''
            strip.wakeTurbulence = undefined
        }

        const shiftedCallsigns = this.getLastShiftedCallsigns()
        return {
            strip,
            shiftedCallsigns: shiftedCallsigns.length > 0 ? shiftedCallsigns : undefined
        }
    }

    /**
     * Get the current configuration
     */
    getConfig(): EfsStaticConfig {
        return this.config
    }

    /**
     * Re-evaluate section rules for an existing flight and return the updated result.
     * Used when flight state changes outside the plugin message pipeline (e.g. mock mode actions).
     */
    reevaluateStrip(callsign: string): ProcessMessageResult {
        const flight = this.flights.get(callsign)
        if (!flight || !flightHasRequiredData(flight) || flight.deleted) {
            return { flight }
        }
        return this.finalizeFlightStrips(callsign, flight, false)
    }

    /**
     * Recreate a strip after trash restore (flags already cleared).
     */
    restoreStripToSection(
        stripId: string,
        flight: Flight,
        bayId: string,
        sectionId: string,
        position: number
    ): FlightStrip | undefined {
        if (!flightHasRequiredData(flight)) return undefined
        const parsed = parseStripAirportId(stripId)
        const airport = parsed?.airport
        const scoped = airport ? withAirportScope(this.config, airport) : this.config
        this.stripAssignments.set(stripId, { bayId, sectionId, position, bottom: false })
        return this.createStrip(flight, bayId, sectionId, position, false, airport, scoped)
    }

    /**
     * Regenerate a strip for a flight (used when positions are shifted).
     * Accepts either a callsign or a multi-airport strip id (callsign@ICAO).
     */
    regenerateStrip(stripIdOrCallsign: string): FlightStrip | undefined {
        const parsed = parseStripAirportId(stripIdOrCallsign)
        const callsign = parsed?.callsign ?? stripIdOrCallsign
        const airport = parsed?.airport

        const flight = this.flights.get(callsign)
        if (!flight || !flightHasRequiredData(flight) || flight.deleted) {
            return undefined
        }

        const assignment = this.stripAssignments.get(stripIdOrCallsign)
        if (!assignment) {
            return undefined
        }

        const scoped = airport ? withAirportScope(this.config, airport) : this.config
        return this.createStrip(
            flight,
            assignment.bayId,
            assignment.sectionId,
            assignment.position,
            assignment.bottom,
            airport,
            scoped
        )
    }
}

// Singleton instance
export const flightStore = new FlightStore(staticConfig)

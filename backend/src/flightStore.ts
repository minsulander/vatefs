import type { FlightStrip, StripType, WakeCategory, FlightRules, Section } from "@vatefs/common"
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
import { staticConfig, determineSectionForFlight, determineActionForFlight, setMyCallsign, shouldDeleteFlight, getFieldElevationForFlight, getControllerFrequency, getControllerPositionId, getFrequencyForCallsign, getControllerCallsign, parseControllerRole } from "./config.js"
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
import { getRtfCallsign } from "./icao-airlines.js"
import { getIcaoAirportName } from "./icao-airports.js"
import { hasSidInEse, getSidInfo } from "./sid-data.js"
import {
    getRelevantActiveAirports,
    isMultiAirportConfig,
    parseStripAirportId,
    stripIdForAirport,
    withAirportScope,
    logicalSectionId,
    prefixedSectionId,
    resolveBayForAirport,
    IDLE_BAY_ID
} from "./multi-airport.js"
import moment from "moment"

/**
 * Result of processing a plugin message
 */
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

    /** Scratchpad value to push to EuroScope (e.g. auto-SLOW remark) */
    setScratchValue?: string

    /** Clear EuroScope scratchpad for this callsign (e.g. after consuming TopSky ROF) */
    clearScratchpadCallsign?: string

    /** Delay before clearScratchpadCallsign (ms); lets TopSky read outbound /ROF/ first */
    clearScratchpadDelayMs?: number

    /** Transfer sound to play (handoff request / accept / refuse) */
    transferSound?: 'request' | 'accept' | 'refuse'

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

/**
 * Extract display SID from a flight.
 * - Controller SID override (manual pick in CLNC) wins
 * - Special SIDs in route (e.g. "040·330·RESNA/01L") take priority
 * - Else first significant FPL fix when it is not part of the ESE SID (e.g. DCT NTL)
 * - Else ESE-matched flight.sid (major airports: route often starts with SID first waypoint)
 * - Else first significant FPL fix / flight.sid
 */
function extractDisplaySid(flight: Flight): string | undefined {
    if (flight.sidDisplayOverride) {
        return flight.sidDisplayOverride
    }

    if (flight.route) {
        const firstTerm = flight.route.split(/\s+/)[0]!
        const slashIdx = firstTerm.indexOf("/")
        if (slashIdx >= 0) {
            const prefix = firstTerm.substring(0, slashIdx)
            // EuroScope special SIDs appear as PREFIX/rwy and are not GetSid()
            if (
                flight.origin &&
                prefix !== flight.origin &&
                prefix !== flight.sid &&
                !/^[A-Z]{4}$/.test(prefix)
            ) {
                return prefix
            }
        }
    }

    const firstFix = flight.route ? firstSignificantRouteFix(flight.route) : undefined
    const sidInfo =
        flight.sid && flight.origin
            ? getSidInfo(flight.origin, flight.sid, flight.depRwy)
            : undefined

    if (firstFix) {
        // Route names the SID itself
        if (flight.origin && hasSidInEse(flight.origin, firstFix, flight.depRwy)) {
            return firstFix
        }
        // Stale GetSid() after FPL edit to a DCT/fix (e.g. NTL) that is not on the SID
        if (sidInfo && !sidInfo.waypoints.includes(firstFix) && firstFix !== flight.sid) {
            return firstFix
        }
        // No ESE SID — show first FPL point (regional DCT)
        if (!sidInfo) {
            return firstFix
        }
        // firstFix is the SID's initial waypoint (e.g. KAJAN for KAJAN1D) → keep SID name
    }

    if (sidInfo) return flight.sid
    return firstFix ?? flight.sid
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

/**
 * Store for managing Flight objects built from EuroScope plugin messages
 */
const ROF_COOLDOWN_MS = 60_000
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

    /** ROF button cooldown per callsign (hide for 1 minute after send) */
    private rofCooldownUntil: Map<string, number> = new Map()
    private rofCooldownTimers: Map<string, ReturnType<typeof setTimeout>> = new Map()

    /** Inbound ROF flash-end timers (regenerate strip when alternate stops; request kept) */
    private rofFlashTimers: Map<string, ReturnType<typeof setTimeout>> = new Map()
    private rofFlashEndHandler?: (callsign: string) => void

    /** User setting: Auto PARK for assumed arrivals at stands (default on). */
    private getAutoParkEnabled: () => boolean = () => true

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

    setAutoParkCommandHandler(handler: (callsign: string) => void): void {
        this.autoParkCommandHandler = handler
    }

    setRofRequestExpireHandler(handler: (callsign: string) => void): void {
        // Kept name for server.ts — fires when inbound flash ends (not when request clears)
        this.rofFlashEndHandler = handler
    }

    isRofCoolingDown(callsign: string): boolean {
        const until = this.rofCooldownUntil.get(callsign.toUpperCase())
        return until !== undefined && Date.now() < until
    }

    /**
     * Start 1-minute ROF cooldown for a callsign. onExpire regenerates the strip when the button can show again.
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
     * Persist an incoming TopSky ROF (/LAM/ROF/{requester}).
     * Caller should clear the scratchpad after this (TopSky often leaves it set).
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
     * ESSA arr/dep runway ends currently assigned on flight plans (for RWY headers).
     */
    getEssaAssignedRunways(): { arr: string[]; dep: string[] } {
        const arr = new Set<string>()
        const dep = new Set<string>()
        for (const flight of this.flights.values()) {
            if (flight.deleted || flight.manuallyDeleted) continue
            const originIsEssa = flight.origin === 'ESSA'
            const destIsEssa = flight.destination === 'ESSA'
            if (destIsEssa && flight.arrRwy) arr.add(flight.arrRwy.toUpperCase())
            if (originIsEssa && flight.depRwy) dep.add(flight.depRwy.toUpperCase())
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
     * Update strip assignment (called when strip is moved manually)
     */
    setStripAssignment(callsign: string, bayId: string, sectionId: string, position: number, bottom: boolean) {
        this.stripAssignments.set(callsign, { bayId, sectionId, position, bottom })
        const flight = this.flights.get(callsign)
        if (flight) {
            flight.lastSectionRule = 'manual'
        }
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

        // Arrival/local at our airport (PARK action is direction: either)
        const destOk =
            !!flight.destination && this.config.myAirports.includes(flight.destination)
        const originOk =
            !!flight.origin && this.config.myAirports.includes(flight.origin)
        if (!destOk && !originOk) {
            clearDwell()
            return
        }
        const standAirport = destOk ? flight.destination! : flight.origin!
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

        // PARK strip action is shown for TXIN; also allow ARR/empty briefly after landing
        const gs = flight.groundstate ?? ''
        if (gs !== '' && gs !== 'NSTS' && gs !== 'ARR' && gs !== 'TXIN') {
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
        return result
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
                multiUpdates.push({ deleteStripId: stripId, softDeleted: true })
            }
        }

        if (!flightHasRequiredData(flight) || flight.manuallyDeleted) {
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
                    this.stripAssignments.delete(stripId)
                    deletedStripIds.push(stripId)
                    multiUpdates.push({ deleteStripId: stripId, softDeleted: true })
                }
                continue
            }

            const targetSection = determineSectionForFlight(flight, scoped, airport)
            if (!targetSection) {
                if (hadAssignment) {
                    this.stripAssignments.delete(stripId)
                    deletedStripIds.push(stripId)
                    multiUpdates.push({ deleteStripId: stripId, softDeleted: true })
                }
                continue
            }

            const currentAssignment = this.stripAssignments.get(stripId)
            const isNewStrip = !currentAssignment
            const sectionChanged = !!(currentAssignment &&
                (currentAssignment.bayId !== targetSection.bayId ||
                 currentAssignment.sectionId !== targetSection.sectionId))

            let position: number
            let bottom: boolean
            let previousSection: { bayId: string; sectionId: string } | undefined

            if (isNewStrip) {
                position = this.getNewStripPosition(targetSection.bayId, targetSection.sectionId)
                bottom = false
                this.stripAssignments.set(stripId, {
                    bayId: targetSection.bayId,
                    sectionId: targetSection.sectionId,
                    position,
                    bottom
                })
                console.log(`[RULE] ${stripId} -> ${targetSection.sectionId} (rule: ${targetSection.ruleId ?? 'default'}, new)`)
            } else if (sectionChanged && currentAssignment) {
                previousSection = {
                    bayId: currentAssignment.bayId,
                    sectionId: currentAssignment.sectionId
                }
                position = this.getNewStripPosition(targetSection.bayId, targetSection.sectionId)
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
                position = this.getNewStripPosition(targetSection.bayId, targetSection.sectionId)
                bottom = false
                this.stripAssignments.set(stripId, {
                    bayId: targetSection.bayId,
                    sectionId: targetSection.sectionId,
                    position,
                    bottom
                })
            }

            // ATYP/WTC changes: clear SLOW if no longer slow, else auto-add when eligible
            if (!setScratchValue && this.tryClearAutoSlowRemark(flight)) {
                setScratchValue = ''
            } else if (!setScratchValue && this.tryAutoSlowRemark(flight)) {
                setScratchValue = '.SLOW'
            }

            const strip = this.createStrip(
                flight,
                targetSection.bayId,
                targetSection.sectionId,
                position,
                bottom,
                airport,
                scoped
            )
            const shiftedCallsigns = this.getLastShiftedCallsigns()
            strips.push(strip)
            multiUpdates.push({
                strip,
                isNew: isNewStrip,
                sectionChanged,
                previousSection,
                shiftedCallsigns: shiftedCallsigns.length > 0 ? shiftedCallsigns : undefined
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

            const position = this.getNewStripPosition(bayId, sectionId)
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
    } {
        const wasDeleted = flight.deleted ?? false
        const deleteResult = shouldDeleteFlight(flight, this.config)

        if (deleteResult.shouldDelete && !wasDeleted) {
            flight.deleted = true
            flight.lastDeleteRule = deleteResult.ruleId
            if (deleteResult.ruleId === 'delete_beyond_range') {
                flight.deletedByBeyondRange = true
            }
            console.log(`Flight ${callsign} soft-deleted by rule: ${deleteResult.ruleId}`)
            return {
                deleteResult,
                wasDeleted,
                shortCircuit: { flight, softDeleted: true }
            }
        }

        if (!deleteResult.shouldDelete && wasDeleted && !flight.manuallyDeleted) {
            if (flight.noSectionFound) {
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

        if (flight.noSectionFound) {
            flight.noSectionFound = false
            flight.deleted = false
        }

        const sectionChanged = currentAssignment &&
            (currentAssignment.bayId !== targetSection.bayId ||
             currentAssignment.sectionId !== targetSection.sectionId)

        let position: number
        let bottom: boolean
        let previousSection: { bayId: string; sectionId: string } | undefined

        const ruleSource = targetSection.ruleId ?? 'default'
        let setScratchValue: string | undefined

        if (isNewStrip) {
            position = this.getNewStripPosition(targetSection.bayId, targetSection.sectionId)
            bottom = false
            this.stripAssignments.set(callsign, {
                bayId: targetSection.bayId,
                sectionId: targetSection.sectionId,
                position,
                bottom
            })
            flight.lastSectionRule = ruleSource
            console.log(`[RULE] ${callsign} -> ${targetSection.sectionId} (rule: ${ruleSource}, new strip)`)
        } else if (sectionChanged && currentAssignment) {
            previousSection = {
                bayId: currentAssignment.bayId,
                sectionId: currentAssignment.sectionId
            }
            position = this.getNewStripPosition(targetSection.bayId, targetSection.sectionId)
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
            position = this.getNewStripPosition(targetSection.bayId, targetSection.sectionId)
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

        // ATYP/WTC changes: clear SLOW if no longer slow, else auto-add when eligible
        if (this.tryClearAutoSlowRemark(flight)) {
            setScratchValue = ''
        } else if (this.tryAutoSlowRemark(flight)) {
            setScratchValue = '.SLOW'
        }

        const strip = this.createStrip(flight, targetSection.bayId, targetSection.sectionId, position, bottom)
        const shiftedCallsigns = this.getLastShiftedCallsigns()

        return {
            flight,
            strip,
            sectionChanged: sectionChanged ?? false,
            previousSection,
            restored,
            setScratchValue,
            shiftedCallsigns: shiftedCallsigns.length > 0 ? shiftedCallsigns : undefined
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
        if (flight.flightRules !== 'I' && flight.flightRules !== 'Y') return false
        if (flight.remarks) return false
        if (flight.autoSlowDismissed) return false
        if (!isEssaAutoSlowHours()) return false

        const wakeTurbulence = this.parseWakeCategory(flight.aircraftType, flight.wakeTurbulence)
        if (!isSlowAircraft(wakeTurbulence, flight.aircraftType ?? '')) return false

        flight.remarks = 'SLOW'
        console.log(`[REMARKS] ${flight.callsign}: - -> SLOW (auto)`)
        return true
    }

    /**
     * Remove auto-SLOW remark when ATYP/WTC is no longer a slow type.
     * Only clears an exact "SLOW" remark (leaves other controller remarks alone).
     */
    private tryClearAutoSlowRemark(flight: Flight): boolean {
        if (flight.remarks !== 'SLOW') return false

        const wakeTurbulence = this.parseWakeCategory(flight.aircraftType, flight.wakeTurbulence)
        if (isSlowAircraft(wakeTurbulence, flight.aircraftType ?? '')) return false

        flight.remarks = undefined
        console.log(`[REMARKS] ${flight.callsign}: SLOW -> - (auto, not slow)`)
        return true
    }

    /**
     * Remember that the controller cleared SLOW so we do not auto-add it again.
     * Skips dismissal when the aircraft is no longer slow (auto-removal from ATYP change).
     */
    markAutoSlowDismissed(flight: Flight, previousRemarks: string | undefined, nextRemarks: string | undefined) {
        if (previousRemarks !== 'SLOW' || nextRemarks === 'SLOW') return

        const wakeTurbulence = this.parseWakeCategory(flight.aircraftType, flight.wakeTurbulence)
        if (!isSlowAircraft(wakeTurbulence, flight.aircraftType ?? '')) return

        flight.autoSlowDismissed = true
        console.log(`[REMARKS] ${flight.callsign}: auto-SLOW dismissed`)
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
        if (flight.tobtSetBy !== undefined) { flight.tobtSetBy = undefined; changed = true }
        if (flight.tobtSetByAt !== undefined) { flight.tobtSetByAt = undefined; changed = true }
        if (flight.asrt !== undefined) { flight.asrt = undefined; changed = true }
        if (flight.cdmSts !== undefined) { flight.cdmSts = undefined; changed = true }
        if (flight.localCdmTobt !== undefined) { flight.localCdmTobt = undefined; changed = true }
        if (flight.localCdmTsat !== undefined) { flight.localCdmTsat = undefined; changed = true }
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
            // ASRT (Ready Startup) from CDM strip annotation field 0
            if (entry.asrt !== undefined) {
                const asrt = entry.asrt === '' ? undefined : this.normalizeCdmHhmm(entry.asrt)
                if (asrt !== flight.asrt) {
                    flight.asrt = asrt
                    changed = true
                }
            }
            // Only apply CTOT when non-empty — empty file field must not wipe HTTP CTOT
            const ctot = this.normalizeCdmHhmm(entry.ctot)
            if (ctot && ctot !== flight.ctot) {
                flight.ctot = ctot
                changed = true
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

        if (message.controller !== undefined) {
            flight.controller = message.controller
            if (!message.controller) flight.controllerId = undefined
            // Someone else (or nobody) tracking — optimistic outbound handoff is done
            if (message.controller !== this.config.myCallsign) {
                flight.handoffOptimisticUntil = undefined
                // Incoming ROF is only relevant while we own the strip
                if (flight.rofRequestFrom) this.clearRofRequest(flight)
            }
        }
        if (message.controllerId !== undefined) {
            flight.controllerId = message.controllerId || undefined
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
     * Handle flightPlanDataUpdate message
     */
    private handleFlightPlanDataUpdate(message: FlightPlanDataUpdateMessage): ProcessMessageResult {
        const callsign = message.callsign
        const flight = this.getOrCreateFlight(callsign)
        const hadRequiredData = flightHasRequiredData(flight)
        const prevController = flight.controller
        const prevHandoff = flight.handoffTargetController

        // Update flight data
        if (message.origin !== undefined) flight.origin = message.origin
        if (message.destination !== undefined) flight.destination = message.destination
        if (message.alternate !== undefined) flight.alternate = message.alternate
        if (message.aircraftType !== undefined) flight.aircraftType = message.aircraftType
        if (message.wakeTurbulence !== undefined) flight.wakeTurbulence = message.wakeTurbulence
        if (message.flightRules !== undefined) flight.flightRules = message.flightRules
        if (message.communicationType !== undefined) {
            flight.communicationType = message.communicationType || undefined
        }
        if (message.route !== undefined) flight.route = message.route
        if (message.eobt !== undefined) flight.eobt = message.eobt
        if (message.ete !== undefined) flight.ete = message.ete
        if (message.rfl !== undefined) flight.rfl = message.rfl
        if (message.fplRemarks !== undefined) flight.fplRemarks = message.fplRemarks || undefined
        if (message.arrRwy !== undefined) flight.arrRwy = message.arrRwy
        if (message.star !== undefined) flight.star = message.star
        if (message.depRwy !== undefined) flight.depRwy = message.depRwy
        if (message.sid !== undefined) flight.sid = message.sid
        this.applyOwnershipFromPlugin(flight, message, 'DATA')
        if (message.nextController !== undefined) flight.nextController = message.nextController
        if (message.nextControllerFrequency !== undefined) flight.nextControllerFrequency = message.nextControllerFrequency
        flight.lastUpdate = Date.now()

        return this.withTransferSound(
            this.finalizeFlightStrips(
                callsign,
                flight,
                !hadRequiredData || !this.stripAssignments.get(callsign)
            ),
            prevController,
            prevHandoff,
            flight
        )
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

        // trackedByMe=false is authoritative when callsign fields lag after a remote accept
        if (message.trackedByMe === false && flight.controller === this.config.myCallsign) {
            console.log(`[OWN] ${callsign} trackedByMe=false while controller still me — clearing ownership (remote accept)`)
            flight.controller = ''
            flight.controllerId = undefined
            flight.handoffTargetController = ''
            flight.handoffTargetControllerId = undefined
            flight.handoffOptimisticUntil = undefined
        }

        flight.lastUpdate = Date.now()

        return this.withTransferSound(
            this.finalizeFlightStrips(callsign, flight, !this.stripAssignments.get(callsign)),
            prevController,
            prevHandoff,
            flight
        )
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

        // Update flight data
        this.applyOwnershipFromPlugin(flight, message, 'ASSIGN')
        if (message.squawk !== undefined) flight.squawk = message.squawk
        if (message.rfl !== undefined) flight.rfl = message.rfl
        if (message.cfl !== undefined) flight.cfl = message.cfl
        if (message.groundstate !== undefined) flight.groundstate = message.groundstate
        if (message.clearance !== undefined) flight.clearance = message.clearance
        if (message.clearedToLand !== undefined) flight.clearedToLand = message.clearedToLand
        if (message.communicationType !== undefined) {
            flight.communicationType = message.communicationType || undefined
        }
        // Process scratchpad-based missedApproach flag:
        // Plugin sends scratch: "MISAP_" when on missed approach, scratch: "" when cleared
        if (message.scratch === 'MISAP_') {
            flight.missedApproach = true
            flight.clearedToLand = false  // GOA also clears cleared-to-land
        } else if (message.scratch === '') {
            flight.missedApproach = false
        }
        // TopSky ROF: consume then clear scratch (TopSky often leaves /LAM/ROF/ and /ROF/ set)
        let clearScratchpadCallsign: string | undefined
        let clearScratchpadDelayMs: number | undefined
        if (message.scratch !== undefined) {
            const scratch = message.scratch
            const lamRof = scratch.match(/^\/LAM\/ROF\/([^/]+)/i)
            if (lamRof?.[1]) {
                this.setRofRequest(flight, lamRof[1])
                clearScratchpadCallsign = callsign
                clearScratchpadDelayMs = 100
            } else if (/^\/ROF\//i.test(scratch)) {
                // Outbound ROF on a scratch vehicle — give TopSky time to read, then wipe
                clearScratchpadCallsign = callsign
                clearScratchpadDelayMs = 800
            }
        }
        // Process scratchpad-based remarks:
        // - ".TEXT" → remark TEXT (VatEFS convention)
        // - "SLOW" (no leading ".") → keep as remark (ES/TopSky slow flag)
        // - "MISAP_" / "/LAM/ROF/..." / "/ROF/..." and other specials → leave remarks unchanged
        // - "" → remark cleared in EuroScope
        if (message.scratch !== undefined) {
            const scratch = message.scratch
            let nextRemarks: string | undefined | null = null
            if (scratch.startsWith('.')) {
                nextRemarks = scratch.substring(1).trim() || undefined
            } else if (scratch.toUpperCase() === 'SLOW') {
                nextRemarks = 'SLOW'
            } else if (scratch === '') {
                nextRemarks = undefined
            } else if (
                scratch === 'MISAP_' ||
                /^\/LAM\/ROF\//i.test(scratch) ||
                /^\/ROF\//i.test(scratch)
            ) {
                nextRemarks = null // special flag — do not hide strip remarks
            } else {
                // Other non-remark scratch values (TopSky ops, etc.) — clear remark
                nextRemarks = undefined
            }
            if (nextRemarks !== null && nextRemarks !== flight.remarks) {
                console.log(`[REMARKS] ${callsign}: ${flight.remarks ?? '-'} -> ${nextRemarks ?? '-'}`)
                this.markAutoSlowDismissed(flight, flight.remarks, nextRemarks)
                flight.remarks = nextRemarks
            }
        }
        if (message.stand !== undefined) flight.stand = message.stand
        if (message.asp !== undefined) flight.asp = message.asp
        if (message.mach !== undefined) flight.mach = message.mach
        if (message.arc !== undefined) flight.arc = message.arc
        if (message.ahdg !== undefined) flight.ahdg = message.ahdg
        if (message.direct !== undefined) flight.direct = message.direct
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
        if (clearScratchpadCallsign) {
            result.clearScratchpadCallsign = clearScratchpadCallsign
            result.clearScratchpadDelayMs = clearScratchpadDelayMs
        }
        return result
    }

    /**
     * Handle flightPlanDisconnect message
     */
    private handleFlightPlanDisconnect(message: { callsign: string }): ProcessMessageResult {
        const callsign = message.callsign
        const flight = this.flights.get(callsign)
        console.log(`[DISCONNECT] ${callsign}`)

        this.flights.delete(callsign)

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
                deletedStripIds: deletedStripIds.length ? deletedStripIds : undefined
            }
        }

        this.stripAssignments.delete(callsign)

        return {
            flight,
            deleteStripId: callsign
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

        // Set airborne flag for both departures and arrivals
        if (!wasAirborne && message.altitude > airborneThreshold) {
            flight.airborne = true
        } else if (wasAirborne && message.altitude <= airborneThreshold && (message.groundSpeed <= groundSpeedThreshold || message.altitude <= defNotAirborneThreshold)) {
            // Aircraft has landed
            flight.airborne = false
        }

        return this.finalizeFlightStrips(
            callsign,
            flight,
            !this.stripAssignments.get(callsign)
        )
    }

    /**
     * Find section configuration by bay and section ID
     */
    private findSectionConfig(bayId: string, sectionId: string): Section | undefined {
        const bay = this.config.layout.bays.find(b => b.id === bayId)
        return bay?.sections.find(s => s.id === sectionId)
    }

    /**
     * Get the position for a new strip in a section
     * Handles both "add from top" and "add from bottom" modes
     * Call getLastShiftedCallsigns() after this to get affected strips
     */
    private getNewStripPosition(bayId: string, sectionId: string): number {
        const section = this.findSectionConfig(bayId, sectionId)
        const addFromTop = section?.addFromTop ?? true // Default: add from top

        // Clear previous shifted callsigns
        this.lastShiftedCallsigns = []

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
     * Shift all strip positions in a section down by 1 (for add from top)
     * Returns the callsigns of affected strips
     */
    private shiftPositionsDown(bayId: string, sectionId: string): string[] {
        const shifted: string[] = []
        this.stripAssignments.forEach((assignment, callsign) => {
            if (assignment.bayId === bayId &&
                assignment.sectionId === sectionId &&
                !assignment.bottom) {  // Only shift top zone strips
                // Skip deleted flights - they should not affect active strip positions
                // and must not appear in shiftedCallsigns (would briefly un-delete them)
                const flight = this.flights.get(callsign)
                if (flight?.deleted) return
                assignment.position += 1
                shifted.push(callsign)
            }
        })
        // Also increment the counter
        const key = `${bayId}:${sectionId}`
        const current = this.positionCounters.get(key) ?? 0
        this.positionCounters.set(key, current + 1)

        this.lastShiftedCallsigns = shifted
        return shifted
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
     * Get next position in a section (for add from bottom mode)
     */
    private getNextPosition(bayId: string, sectionId: string): number {
        const key = `${bayId}:${sectionId}`
        const current = this.positionCounters.get(key) ?? 0
        this.positionCounters.set(key, current + 1)
        return current
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
        // Determine strip type
        const stripType = this.determineStripType(flight, actionConfig)

        // Convert wake turbulence (use explicit value or derive from aircraft type)
        const wakeTurbulence = this.parseWakeCategory(flight.aircraftType, flight.wakeTurbulence)

        // Convert flight rules
        const flightRules = this.parseFlightRules(flight)

        // Format flight level
        const rfl = flight.rfl ? this.formatFlightLevel(flight.rfl) : undefined
        const clearedAltitude = flight.cfl && flight.cfl > 2
            ? this.formatFlightLevel(flight.cfl)
            : undefined

        // Cleared for takeoff: departure with DEPA groundstate, not yet airborne
        const clearedForTakeoff = stripType === 'departure' &&
            flight.groundstate === 'DEPA' &&
            !flight.airborne

        // Cleared to land: arrival with clearedToLand flag set, still airborne
        const clearedToLand = (stripType === 'arrival' || stripType === 'local') &&
            flight.clearedToLand === true &&
            flight.airborne !== false

        // Determine actions based on controller status
        let actions: string[] | undefined
        const myCallsign = actionConfig.myCallsign
        const isTrackedByMe = flight.controller === myCallsign
        const isUntracked = !flight.controller || flight.controller === ''
        const isHandoffToMe = flight.handoffTargetController === myCallsign
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
                const defaultAction = determineActionForFlight(flight, sectionId, actionConfig)
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
                        // ROF is for other-owned traffic only; ignore here
                    } else if (action) {
                        actions = [action, 'ASSUME']
                    }
                    // No matching rule → no actions (e.g., transferred departures in CTR DEP)
                }
            } else if (!isUntracked && !isTrackedByMe && actionConfig.isController) {
                // Tracked by someone else — ROF only (ASSUME is for untracked / handoff-to-me above)
                const action = determineActionForFlight(flight, sectionId, actionConfig)
                if (action === 'ROF' && !this.isRofCoolingDown(flight.callsign)) {
                    actions = ['ROF']
                }
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
            // (EuroScope nextController is often APP/empty, so action rules alone miss this)
            if (
                coveringTwr &&
                !coveringGndOnly &&
                isTrackedByMe &&
                transferPending !== "out" &&
                (stripType === "arrival" || stripType === "local") &&
                flight.airborne === false &&
                parseControllerRole(essaNext.callsign, actionConfig.myAirports) === "GND"
            ) {
                const vacated =
                    flight.latitude === undefined ||
                    flight.longitude === undefined ||
                    flight.currentAltitude === undefined ||
                    !isOnAnyRunway(
                        flight.latitude,
                        flight.longitude,
                        flight.currentAltitude,
                        actionConfig.myAirports
                    )?.onRunway
                if (vacated) {
                    actions = ["XFER"]
                }
            }
        }

        // GND: suppress sequence XFER while still in our AoR and not moving toward next
        if (
            coveringGndOnly &&
            isTrackedByMe &&
            transferPending !== "out" &&
            actions?.[0] === "XFER" &&
            essaNext &&
            !shouldOfferGndSequenceXfer(flight, essaRoles, essaNext)
        ) {
            if (stripType === "arrival" || stripType === "local") {
                actions = ["PARK"]
            }
        }

        // Outbound handoff started — hide XFER/READY until accept/refuse
        if (transferPending === "out" && actions?.length) {
            actions = actions.filter((a) => a !== "XFER" && a !== "READY")
            if (actions.length === 0) actions = undefined
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

        // ROF display fields (pink SI + tooltip):
        // - inbound: we track the strip and got /LAM/ROF/{requester}
        // - outbound: we just sent ROF (cooldown) for other-owned traffic
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
        }

        // Can reset squawk if we're a controller and we track the flight (or it's untracked)
        const canResetSquawk = actionConfig.isController === true && (isTrackedByMe || isUntracked)

        // Can edit clearance if we're a controller and the flight is tracked by me or untracked
        const canEditClearance = actionConfig.isController === true && (isTrackedByMe || isUntracked)

        // Slow aircraft detection
        const isSlow = isSlowAircraft(wakeTurbulence, flight.aircraftType ?? '') || undefined

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

        return {
            id: airport ? stripIdForAirport(flight.callsign, airport) : flight.callsign,
            callsign: flight.callsign,
            rtfCallsign: getRtfCallsign(flight.callsign, flight.fplRemarks),
            communicationSuffix: formatCommunicationSuffix(flight.communicationType),
            aircraftType: flight.aircraftType ?? 'UNKN',
            wakeTurbulence,
            flightRules,
            adep: flight.origin ?? '????',
            ades: flight.destination ?? '????',
            adepName: flight.origin ? getIcaoAirportName(flight.origin) : undefined,
            adesName: flight.destination ? getIcaoAirportName(flight.destination) : undefined,
            route: flight.route,
            eobt: flight.eobt,
            eta: flight.ete ? moment(flight.lastUpdate).utc().add(flight.ete, 'minutes').format('HHmm') : undefined,
            sid: extractDisplaySid(flight),
            star: flight.star,
            rfl,
            squawk: flight.squawk,
            clearedAltitude,
            assignedHeading: flight.ahdg && flight.ahdg > 0 ? String(flight.ahdg).padStart(3, '0') : undefined,
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
            clearance: flight.clearance ?? undefined,
            clearedForTakeoff,
            clearedToLand,
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
            // CDM times only on ESSA IFR departures (not VFR / local)
            tobt: cdmEligible ? flight.tobt : undefined,
            tsat: cdmEligible ? flight.tsat : undefined,
            tobtSetBy: cdmEligible ? flight.tobtSetBy : undefined,
            asrt: cdmEligible ? flight.asrt : undefined,
            cdmSts: cdmEligible ? flight.cdmSts : undefined,
            ctot: ifrDeparture ? flight.ctot : undefined,
            ctotCancelled: ifrDeparture && flight.ctotCancelled ? true : undefined,
            ctotReason: ifrDeparture ? flight.ctotReason : undefined,
            remarks: flight.remarks || undefined,
            isSlow,
            highlightActions: highlightActions.length > 0 ? highlightActions : undefined,
            isAssumed: isTrackedByMe || undefined,
            ownerSi,
            ownedByOther: (!isTrackedByMe && !isUntracked) || undefined,
            // Dimming: INBOUND dimmed unless assumed / pending transfer;
            // TWR pending+cleared when DEL/GND online.
            dimmed: (() => {
                // Assumed by me or any pending handoff → full brightness
                if (isTrackedByMe) return undefined
                if (transferPending === 'in' || transferPending === 'out') return undefined

                // INBOUND: dim everything else (other-owned / untracked)
                if (sectionId === 'inbound' || sectionId.endsWith('_inbound')) {
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
            ownerCallsign: (!isUntracked && flight.controller) || undefined,
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
    private parseWakeCategory(aircraftType?: string, explicit?: string): WakeCategory {
        // Use explicit value if valid
        if (explicit && ['L', 'M', 'H', 'J'].includes(explicit)) {
            return explicit as WakeCategory
        }

        if (!aircraftType) return 'M'

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
     * Parse flight rules
     */
    private parseFlightRules(flight: Flight): FlightRules {
        if (flight.flightRules && ['I', 'V', 'Y', 'Z'].includes(flight.flightRules)) {
            return flight.flightRules as FlightRules
        }
        // Default to IFR
        return 'I'
    }

    /**
     * Format altitude in feet to FL or altitude string
     */
    private formatFlightLevel(feet: number): string {
        if (feet >= 10000) {
            return `FL${Math.round(feet / 100)}`
        } else {
            return `A${String(Math.round(feet / 100)).padStart(3, '0')}`
        }
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
    }

    /**
     * Clear strip assignments only (keep flights).
     * Used when switching configs so flights can be re-evaluated with new rules.
     */
    clearAssignments() {
        this.stripAssignments.clear()
        this.positionCounters.clear()
        // Reset per-flight rule tracking so rules re-evaluate cleanly
        for (const flight of this.flights.values()) {
            flight.lastSectionRule = undefined
            flight.noSectionFound = false
        }
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

            // Determine section for flight
            const targetSection = determineSectionForFlight(flight, this.config)
            if (!targetSection) {
                flight.noSectionFound = true
                flight.deleted = true
                continue
            }

            const position = this.getNewStripPosition(targetSection.bayId, targetSection.sectionId)
            const bottom = false
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
        if (flags.groundstate !== undefined) flight.groundstate = flags.groundstate
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
            position = this.getNewStripPosition(targetSection.bayId, targetSection.sectionId)
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
            position = this.getNewStripPosition(targetSection.bayId, targetSection.sectionId)
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
     * If a matching flight already exists, uses its data instead.
     */
    createSpecialStrip(
        stripType: 'vfrDep' | 'vfrArr' | 'cross',
        callsign: string,
        aircraftType?: string,
        airport?: string,
        targetBayId?: string,
        targetSectionId?: string,
        position?: number,
        isBottom?: boolean
    ): { strip: FlightStrip; shiftedCallsigns?: string[] } | undefined {
        const existingFlight = this.flights.get(callsign)
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

        // Create or update the flight record
        const flight = existingFlight ?? this.getOrCreateFlight(callsign)
        if (!existingFlight) {
            // Synthetic flight - fill in minimal data
            flight.origin = origin
            flight.destination = destination
            flight.aircraftType = aircraftType ?? 'UNKN'
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

        if (targetBayId && targetSectionId) {
            bayId = targetBayId
            sectionId = targetSectionId
            pos = position ?? this.getNewStripPosition(bayId, sectionId)
        } else if (multi && stripAirport) {
            const scoped = withAirportScope(this.config, stripAirport)
            const targetSection = determineSectionForFlight(flight, scoped)
            bayId = resolveBayForAirport(stripAirport, this.config.columnAirports)
            if (targetSection) {
                // Map logical section onto this airport's bay
                const logical = logicalSectionId(targetSection.sectionId)
                sectionId = prefixedSectionId(bayId, logical)
            } else {
                sectionId = prefixedSectionId(bayId, 'app')
            }
            pos = this.getNewStripPosition(bayId, sectionId)
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
                pos = this.getNewStripPosition(bayId, sectionId)
            } else {
                bayId = targetSection.bayId
                sectionId = targetSection.sectionId
                pos = this.getNewStripPosition(bayId, sectionId)
            }
        }

        // Record the assignment (multi-airport: key by callsign@ICAO)
        const assignmentKey = stripAirport ? stripIdForAirport(callsign, stripAirport) : callsign
        this.stripAssignments.set(assignmentKey, { bayId, sectionId, position: pos, bottom })
        flight.lastSectionRule = 'manual'

        // Create the strip (always attach airport in multi mode)
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

        // Set the matching flight indicator
        strip.hasMatchingFlight = hasMatchingFlight

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

    /** Update strip placement bookkeeping (used when shifting / restoring). */
    setStripAssignment(
        stripId: string,
        assignment: { bayId: string; sectionId: string; position: number; bottom: boolean }
    ) {
        this.stripAssignments.set(stripId, assignment)
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

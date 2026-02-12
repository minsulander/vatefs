import type { FlightStrip, StripType, WakeCategory, FlightRules, Section } from "@vatefs/common"
import type {
    Flight,
    PluginMessage,
    FlightPlanDataUpdateMessage,
    ControllerAssignedDataUpdateMessage,
    RadarTargetPositionUpdateMessage,
    GroundState
} from "./types.js"
import { flightHasRequiredData } from "./types.js"
import { staticConfig, determineSectionForFlight, determineActionForFlight, setMyCallsign, shouldDeleteFlight, getFieldElevationForFlight, getControllerFrequency } from "./config.js"
import type { EfsStaticConfig } from "./config.js"
import { getAirportCoords } from "./airport-data.js"
import { isWithinRangeOfAnyAirport, findNearestAirport } from "./geo-utils.js"
import { findStandForPosition } from "./stand-data.js"
import moment from "moment"

/**
 * Result of processing a plugin message
 */
export interface ProcessMessageResult {
    /** The updated or created flight (if any) */
    flight?: Flight

    /** Strip to create or update (if flight has required data) */
    strip?: FlightStrip

    /** Strip ID to delete (if flight disconnected) */
    deleteStripId?: string

    /** Whether the strip section changed (needs move) */
    sectionChanged?: boolean

    /** Previous section info if section changed */
    previousSection?: { bayId: string; sectionId: string }

    /** Whether the strip should be soft-deleted (hidden from user) */
    softDeleted?: boolean

    /** Whether the strip was un-deleted (restored from soft-delete) */
    restored?: boolean

    /** Callsigns of strips whose positions were shifted (for add-from-top) */
    shiftedCallsigns?: string[]
}

/**
 * Extract display SID from a flight. EuroScope's GetSid() doesn't return
 * special SID names (e.g. "040·330·RESNA" at ESSA, "VFR·HALL" at ESGG),
 * but they appear as the first term of the route (before the /runway).
 * Falls back to flight.sid if route doesn't contain a special SID.
 */
function extractDisplaySid(flight: Flight): string | undefined {
    if (flight.route) {
        const firstTerm = flight.route.split(' ')[0]!
        const slashIdx = firstTerm.indexOf('/')
        if (slashIdx < 0) return flight.sid
        const prefix = firstTerm.substring(0, slashIdx)
        if (flight.origin && flight.sid && prefix != flight.origin && prefix != flight.sid) {
            return prefix
        }
    }
    return flight.sid
}

/**
 * Store for managing Flight objects built from EuroScope plugin messages
 */
class FlightStore {
    private flights: Map<string, Flight> = new Map()
    private config: EfsStaticConfig

    /** Map of callsign to current strip section assignment */
    private stripAssignments: Map<string, { bayId: string; sectionId: string; position: number; bottom: boolean }> = new Map()

    /** Counter for generating strip positions */
    private positionCounters: Map<string, number> = new Map() // key: bayId:sectionId

    constructor(config: EfsStaticConfig) {
        this.config = config
    }

    /**
     * Get all flights
     */
    getAllFlights(): Flight[] {
        return Array.from(this.flights.values())
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
        // Mark as manually moved
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
     * Auto-set groundstate to PARK for uncontrolled arrivals that are
     * stationary at a stand. Supports observer mode where no controller
     * is setting groundstates via EuroScope.
     *
     * Conditions:
     * - Flight is an arrival at one of our airports
     * - No controller is tracking the flight
     * - Flight has a stand assigned
     * - Aircraft is stationary (ground speed <= 2 knots)
     * - Groundstate is not already set to a meaningful value
     */
    private tryAutoSetParked(flight: Flight) {
        // Must be an arrival at our airport
        if (!flight.destination || !this.config.myAirports.includes(flight.destination)) return

        // Must be uncontrolled
        if (flight.controller && flight.controller !== '') return

        // Must have a stand
        if (!flight.stand || flight.stand === '') return

        // Must be stationary
        if (flight.groundSpeed === undefined || flight.groundSpeed > 2) return

        // Only set if groundstate is empty/unset (don't override meaningful states)
        const gs = flight.groundstate ?? ''
        if (gs !== '' && gs !== 'NSTS' && gs !== 'ARR') return

        flight.groundstate = 'PARK'
        console.log(`Auto-PARK: ${flight.callsign} stationary at stand ${flight.stand} (observer mode)`)
    }

    /**
     * Check if a flight is eligible to have a strip created.
     * Requirements:
     * 1. Flight has a radar position (lat/lon)
     * 2. Flight's origin, destination, or alternate is in myAirports
     * 3. Flight is within radarRangeNm of any myAirport
     */
    isEligibleForStrip(flight: Flight): boolean {
        // Must have radar position
        if (flight.latitude === undefined || flight.longitude === undefined) {
            return false
        }

        // Must have origin, destination, or alternate at one of our airports
        const myAirports = this.config.myAirports
        const hasRelevantAirport =
            (flight.origin !== undefined && myAirports.includes(flight.origin)) ||
            (flight.destination !== undefined && myAirports.includes(flight.destination)) ||
            (flight.alternate !== undefined && myAirports.includes(flight.alternate))

        if (!hasRelevantAirport) {
            return false
        }

        // Must be within radar range of any of our airports
        return isWithinRangeOfAnyAirport(
            flight.latitude,
            flight.longitude,
            myAirports,
            this.config.radarRangeNm,
            getAirportCoords
        )
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

        const strip = this.createStrip(flight, targetSection.bayId, targetSection.sectionId, position, bottom)
        const shiftedCallsigns = this.getLastShiftedCallsigns()

        return {
            flight,
            strip,
            sectionChanged: sectionChanged ?? false,
            previousSection,
            restored,
            shiftedCallsigns: shiftedCallsigns.length > 0 ? shiftedCallsigns : undefined
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

            case 'flightPlanFlightStripPushed':
            case 'controllerPositionUpdate':
            case 'controllerDisconnect':
            case 'myselfUpdate':
                // These don't affect flight data directly
                return {}

            default:
                return {}
        }
    }

    /**
     * Handle flightPlanDataUpdate message
     */
    private handleFlightPlanDataUpdate(message: FlightPlanDataUpdateMessage): ProcessMessageResult {
        const callsign = message.callsign
        const flight = this.getOrCreateFlight(callsign)
        const hadRequiredData = flightHasRequiredData(flight)

        // Update flight data
        if (message.origin !== undefined) flight.origin = message.origin
        if (message.destination !== undefined) flight.destination = message.destination
        if (message.alternate !== undefined) flight.alternate = message.alternate
        if (message.aircraftType !== undefined) flight.aircraftType = message.aircraftType
        if (message.wakeTurbulence !== undefined) flight.wakeTurbulence = message.wakeTurbulence
        if (message.flightRules !== undefined) flight.flightRules = message.flightRules
        if (message.route !== undefined) flight.route = message.route
        if (message.eobt !== undefined) flight.eobt = message.eobt
        if (message.ete !== undefined) flight.ete = message.ete
        if (message.rfl !== undefined) flight.rfl = message.rfl
        if (message.arrRwy !== undefined) flight.arrRwy = message.arrRwy
        if (message.star !== undefined) flight.star = message.star
        if (message.depRwy !== undefined) flight.depRwy = message.depRwy
        if (message.sid !== undefined) flight.sid = message.sid
        if (message.controller !== undefined) flight.controller = message.controller
        if (message.handoffTargetController !== undefined) flight.handoffTargetController = message.handoffTargetController
        if (message.nextController !== undefined) flight.nextController = message.nextController
        if (message.nextControllerFrequency !== undefined) flight.nextControllerFrequency = message.nextControllerFrequency
        flight.lastUpdate = Date.now()

        // Check if we should create/update a strip
        const hasRequiredData = flightHasRequiredData(flight)
        if (!hasRequiredData) {
            return { flight }
        }

        // Check if eligible for strip (position + airport + range)
        if (!this.isEligibleForStrip(flight)) {
            return { flight }
        }

        return this.resolveStripResult(callsign, flight, !hadRequiredData || !this.stripAssignments.get(callsign))
    }

    /**
     * Handle controllerAssignedDataUpdate message
     */
    private handleControllerAssignedDataUpdate(message: ControllerAssignedDataUpdateMessage): ProcessMessageResult {
        const callsign = message.callsign
        const flight = this.getOrCreateFlight(callsign)
        const hadRequiredData = flightHasRequiredData(flight)

        // Update flight data
        if (message.controller !== undefined) flight.controller = message.controller
        if (message.squawk !== undefined) flight.squawk = message.squawk
        if (message.rfl !== undefined) flight.rfl = message.rfl
        if (message.cfl !== undefined) flight.cfl = message.cfl
        if (message.groundstate !== undefined) flight.groundstate = message.groundstate
        if (message.clearance !== undefined) flight.clearance = message.clearance
        if (message.clearedToLand !== undefined) flight.clearedToLand = message.clearedToLand
        if (message.stand !== undefined) flight.stand = message.stand
        if (message.asp !== undefined) flight.asp = message.asp
        if (message.mach !== undefined) flight.mach = message.mach
        if (message.arc !== undefined) flight.arc = message.arc
        if (message.ahdg !== undefined) flight.ahdg = message.ahdg
        if (message.direct !== undefined) flight.direct = message.direct
        flight.lastUpdate = Date.now()

        // Auto-detect stand from position if not already set
        this.trySetStandFromPosition(flight)

        const deleteState = this.applyDeleteRules(callsign, flight)
        if (deleteState.shortCircuit) {
            return deleteState.shortCircuit
        }

        // Check if we should create/update a strip
        const hasRequiredData = flightHasRequiredData(flight)
        if (!hasRequiredData || flight.deleted) {
            return { flight, softDeleted: flight.deleted }
        }

        // Check if eligible for strip (position + airport + range)
        if (!this.isEligibleForStrip(flight)) {
            return { flight }
        }

        return this.resolveStripResult(
            callsign,
            flight,
            !hadRequiredData || !this.stripAssignments.get(callsign),
            !deleteState.deleteResult.shouldDelete && deleteState.wasDeleted
        )
    }

    /**
     * Handle flightPlanDisconnect message
     */
    private handleFlightPlanDisconnect(message: { callsign: string }): ProcessMessageResult {
        const callsign = message.callsign
        const flight = this.flights.get(callsign)

        this.flights.delete(callsign)
        this.stripAssignments.delete(callsign)

        return {
            flight,
            deleteStripId: callsign
        }
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

        // Update radar data
        flight.currentAltitude = message.altitude
        if (message.ete !== undefined) flight.ete = message.ete
        if (message.controller !== undefined) flight.controller = message.controller
        if (message.handoffTargetController !== undefined) flight.handoffTargetController = message.handoffTargetController
        if (message.nextController !== undefined) flight.nextController = message.nextController
        if (message.nextControllerFrequency !== undefined) flight.nextControllerFrequency = message.nextControllerFrequency
        if (message.latitude !== undefined) flight.latitude = message.latitude
        if (message.longitude !== undefined) flight.longitude = message.longitude
        if (message.groundSpeed !== undefined) flight.groundSpeed = message.groundSpeed
        // radar target squawk is not the same as the assigned squawk
        //if (message.squawk !== undefined) flight.squawk = message.squawk
        flight.lastUpdate = Date.now()

        // Auto-detect stand from position if not already set
        this.trySetStandFromPosition(flight)

        // Auto-set PARK for uncontrolled arrivals stationary at a stand (observer mode support)
        this.tryAutoSetParked(flight)

        const wasAirborne = flight.airborne ?? false
        const fieldElevation = getFieldElevationForFlight(flight, this.config)
        const airborneThreshold = fieldElevation + 200
        const groundSpeedThreshold = 35

        // Set airborne flag for both departures and arrivals
        if (!wasAirborne && message.altitude > airborneThreshold) {
            flight.airborne = true
        } else if (wasAirborne && message.altitude <= airborneThreshold && message.groundSpeed <= groundSpeedThreshold) {
            // Aircraft has landed
            flight.airborne = false
        }

        const deleteState = this.applyDeleteRules(callsign, flight)
        if (deleteState.shortCircuit) {
            return deleteState.shortCircuit
        }

        // Check if we should create/update a strip
        if (!flightHasRequiredData(flight) || flight.deleted) {
            return { flight, softDeleted: flight.deleted }
        }

        // Check if eligible for strip (position + airport + range)
        if (!this.isEligibleForStrip(flight)) {
            return { flight }
        }

        return this.resolveStripResult(
            callsign,
            flight,
            !this.stripAssignments.get(callsign),
            !deleteState.deleteResult.shouldDelete && deleteState.wasDeleted
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
        bottom: boolean
    ): FlightStrip {
        // Determine strip type
        const stripType = this.determineStripType(flight)

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
        const myCallsign = this.config.myCallsign
        const isTrackedByMe = flight.controller === myCallsign
        const isUntracked = !flight.controller || flight.controller === ''
        const isHandoffToMe = flight.handoffTargetController === myCallsign

        if (!clearedForTakeoff && !clearedToLand) {
            if (isTrackedByMe && stripType === 'departure' && flight.groundstate === 'TAXI') {
                // Special case: TAXI departures get LU+CTO (only for TWR)
                const myRole = this.config.myRole ?? 'TWR'
                if (myRole === 'TWR') {
                    actions = ['LU', 'CTO']
                } else {
                    // GND/DEL: use rules engine (will return XFER for GND via config rule)
                    const defaultAction = determineActionForFlight(flight, sectionId, this.config)
                    if (defaultAction) actions = [defaultAction]
                }
            } else if (isTrackedByMe) {
                // We're the tracking controller - show action from rules
                const defaultAction = determineActionForFlight(flight, sectionId, this.config)
                if (defaultAction) {
                    actions = [defaultAction]
                }
            } else if ((isUntracked || isHandoffToMe) && this.config.isController) {
                // Untracked or being handed off to us - let action rules decide
                // Rules with controller:myself won't match; rules with controller:not_myself or
                // no controller condition will match (ASSUME, CLNC, etc.)
                const action = determineActionForFlight(flight, sectionId, this.config)
                if (action === 'ASSUME') {
                    actions = ['ASSUME']
                } else if (action) {
                    actions = [action, 'ASSUME']
                }
                // No matching rule → no actions (e.g., transferred departures in CTR DEP)
            }
            // If tracked by someone else (not us, not handoff to us) - no actions
        }

        let xferFrequency: string | undefined
        if (flight.nextControllerFrequency && flight.nextController) {
            xferFrequency = flight.nextControllerFrequency.toFixed(3)
        }

        // Supplement xferFrequency from online controller tracking when flight data doesn't have it
        if (!xferFrequency && actions?.length) {
            const myRole = this.config.myRole ?? 'TWR'
            const primaryAction = actions[0]
            if (primaryAction === 'READY' && myRole === 'DEL') {
                const freq = getControllerFrequency('GND') ?? getControllerFrequency('TWR')
                if (freq) xferFrequency = freq.toFixed(3)
            } else if (primaryAction === 'XFER') {
                if (myRole === 'GND') {
                    const freq = getControllerFrequency('TWR')
                    if (freq) xferFrequency = freq.toFixed(3)
                } else if (myRole === 'TWR' && stripType === 'arrival') {
                    const freq = getControllerFrequency('GND')
                    if (freq) xferFrequency = freq.toFixed(3)
                }
            }
        }

        // Can reset squawk if we're a controller and we track the flight (or it's untracked)
        const canResetSquawk = this.config.isController === true && (isTrackedByMe || isUntracked)

        // Can edit clearance if we're a controller and the flight is tracked by me or untracked
        const canEditClearance = this.config.isController === true && (isTrackedByMe || isUntracked)

        return {
            id: flight.callsign, // Use callsign as strip ID
            callsign: flight.callsign,
            aircraftType: flight.aircraftType ?? 'UNKN',
            wakeTurbulence,
            flightRules,
            adep: flight.origin ?? '????',
            ades: flight.destination ?? '????',
            route: flight.route,
            eobt: flight.eobt,
            eta: flight.ete ? moment(flight.lastUpdate).utc().add(flight.ete, 'minutes').format('HHmm') : undefined,
            sid: extractDisplaySid(flight),
            rfl,
            squawk: flight.squawk,
            clearedAltitude,
            assignedHeading: flight.ahdg && flight.ahdg > 0 ? String(flight.ahdg).padStart(3, '0') : undefined,
            assignedSpeed: flight.asp ? String(flight.asp) : undefined,
            stand: flight.stand,
            runway: stripType === 'departure' ? flight.depRwy : flight.arrRwy,
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
            canEditClearance: canEditClearance || undefined,
            xferFrequency,
            dclStatus: flight.dclStatus,
            dclMessage: flight.dclMessage,
            dclClearance: flight.dclClearance
        }
    }

    /**
     * Determine strip type based on flight data
     */
    private determineStripType(flight: Flight): StripType {
        const myAirports = this.config.myAirports

        const originIsOurs = flight.origin !== undefined && myAirports.includes(flight.origin)
        const destIsOurs = flight.destination !== undefined && myAirports.includes(flight.destination)

        // Local flight (same origin and destination at one of our airports)
        if (originIsOurs && destIsOurs) {
            return 'local'
        }

        // VFR (would need flight rules info, defaulting based on other factors for now)
        // This would need flightRules field from the plugin

        // Departure from one of our airports
        if (originIsOurs) {
            return 'departure'
        }

        // Arrival to one of our airports
        if (destIsOurs) {
            return 'arrival'
        }

        // Transit (neither origin nor destination at our airports) or alternate-only
        return 'arrival' // Default to arrival for transits
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
     * Get the current configuration
     */
    getConfig(): EfsStaticConfig {
        return this.config
    }

    /**
     * Regenerate a strip for a flight (used when positions are shifted)
     */
    regenerateStrip(callsign: string): FlightStrip | undefined {
        const flight = this.flights.get(callsign)
        if (!flight || !flightHasRequiredData(flight)) {
            return undefined
        }

        const assignment = this.stripAssignments.get(callsign)
        if (!assignment) {
            return undefined
        }

        return this.createStrip(
            flight,
            assignment.bayId,
            assignment.sectionId,
            assignment.position,
            assignment.bottom
        )
    }
}

// Singleton instance
export const flightStore = new FlightStore(staticConfig)

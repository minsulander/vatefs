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
import { staticConfig, determineSectionForFlight, determineActionForFlight, setMyCallsign, shouldDeleteFlight, getFieldElevationForFlight } from "./config.js"
import type { EfsStaticConfig } from "./config.js"
import { getAirportCoords } from "./airport-data.js"
import { isWithinRangeOfAnyAirport } from "./geo-utils.js"
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
        let flight = this.flights.get(callsign)
        const isNew = !flight
        const hadRequiredData = flight ? flightHasRequiredData(flight) : false

        if (!flight) {
            flight = {
                callsign,
                firstSeen: Date.now()
            }
            this.flights.set(callsign, flight)
        }

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

        // Determine section based on rules
        const targetSection = determineSectionForFlight(flight, this.config)
        const currentAssignment = this.stripAssignments.get(callsign)

        // If no section matches, handle appropriately
        if (!targetSection) {
            return this.handleNoSectionFound(flight)
        }

        // Clear noSectionFound if a section is now found
        if (flight.noSectionFound) {
            flight.noSectionFound = false
            flight.deleted = false
        }

        // Check if this is a new strip or section changed
        const isNewStrip = !hadRequiredData || !currentAssignment
        const sectionChanged = currentAssignment &&
            (currentAssignment.bayId !== targetSection.bayId ||
             currentAssignment.sectionId !== targetSection.sectionId)

        // Assign position
        let position: number
        let bottom: boolean
        let previousSection: { bayId: string; sectionId: string } | undefined

        // Store the rule that matched
        const ruleSource = targetSection.ruleId ?? 'default'

        if (isNewStrip) {
            // New strip - assign position based on section config
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
        } else if (sectionChanged) {
            // Section changed - move to new section
            previousSection = {
                bayId: currentAssignment!.bayId,
                sectionId: currentAssignment!.sectionId
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
        } else {
            // Keep current assignment
            position = currentAssignment!.position
            bottom = currentAssignment!.bottom
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
     * Handle controllerAssignedDataUpdate message
     */
    private handleControllerAssignedDataUpdate(message: ControllerAssignedDataUpdateMessage): ProcessMessageResult {
        const callsign = message.callsign
        let flight = this.flights.get(callsign)
        const hadRequiredData = flight ? flightHasRequiredData(flight) : false

        if (!flight) {
            // Create partial flight record
            flight = {
                callsign,
                firstSeen: Date.now()
            }
            this.flights.set(callsign, flight)
        }

        // Track previous groundstate for section change detection
        const previousGroundstate = flight.groundstate

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

        // Check delete rules (e.g., PARK for arrivals)
        const wasDeleted = flight.deleted ?? false
        const deleteResult = shouldDeleteFlight(flight, this.config)

        if (deleteResult.shouldDelete && !wasDeleted) {
            flight.deleted = true
            flight.lastDeleteRule = deleteResult.ruleId
            // Track if deleted by beyond-range rule (arrivals can be restored when in range)
            if (deleteResult.ruleId === 'delete_beyond_range') {
                flight.deletedByBeyondRange = true
            }
            console.log(`Flight ${callsign} soft-deleted by rule: ${deleteResult.ruleId}`)
            return { flight, softDeleted: true }
        } else if (!deleteResult.shouldDelete && wasDeleted && !flight.manuallyDeleted) {
            // Re-check if a section can now be found (conditions may have changed)
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
            // Special case: arrival deleted by beyond-range, check if now within range
            const isArrival = flight.destination !== undefined && this.config.myAirports.includes(flight.destination)
            if (isArrival && this.isEligibleForStrip(flight)) {
                flight.deleted = false
                flight.deletedByBeyondRange = false
                flight.lastDeleteRule = undefined
                console.log(`Flight ${callsign} (arrival) restored - now within range`)
            }
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

        // Determine section based on rules
        const targetSection = determineSectionForFlight(flight, this.config)
        const currentAssignment = this.stripAssignments.get(callsign)

        // If no section matches, handle appropriately
        if (!targetSection) {
            return this.handleNoSectionFound(flight)
        }

        // Clear noSectionFound if a section is now found
        if (flight.noSectionFound) {
            flight.noSectionFound = false
            flight.deleted = false
        }

        // Check if section changed due to groundstate change
        const isNewStrip = !hadRequiredData || !currentAssignment
        const sectionChanged = currentAssignment &&
            (currentAssignment.bayId !== targetSection.bayId ||
             currentAssignment.sectionId !== targetSection.sectionId)

        let position: number
        let bottom: boolean
        let previousSection: { bayId: string; sectionId: string } | undefined

        // Store the rule that matched
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
        } else if (sectionChanged) {
            previousSection = {
                bayId: currentAssignment!.bayId,
                sectionId: currentAssignment!.sectionId
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
        } else {
            position = currentAssignment!.position
            bottom = currentAssignment!.bottom
        }

        const strip = this.createStrip(flight, targetSection.bayId, targetSection.sectionId, position, bottom)
        const shiftedCallsigns = this.getLastShiftedCallsigns()

        return {
            flight,
            strip,
            sectionChanged: sectionChanged ?? false,
            previousSection,
            restored: !deleteResult.shouldDelete && wasDeleted,
            shiftedCallsigns: shiftedCallsigns.length > 0 ? shiftedCallsigns : undefined
        }
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
        if (message.latitude !== undefined) flight.latitude = message.latitude
        if (message.longitude !== undefined) flight.longitude = message.longitude
        // radar target squawk is not the same as the assigned squawk
        //if (message.squawk !== undefined) flight.squawk = message.squawk
        flight.lastUpdate = Date.now()

        // Check for airborne status
        // Aircraft is airborne if altitude > field elevation + 300ft
        const fieldElevation = getFieldElevationForFlight(flight, this.config)
        const airborneThreshold = fieldElevation + 50
        const wasAirborne = flight.airborne ?? false
        const isNowAirborne = message.altitude > airborneThreshold

        // Set airborne flag for both departures and arrivals
        if (!wasAirborne && isNowAirborne) {
            flight.airborne = true
            console.log(`Flight ${callsign} is now airborne (alt: ${message.altitude}ft)`)
        } else if (wasAirborne && !isNowAirborne) {
            // Aircraft has landed
            flight.airborne = false
        }

        // Check delete rules
        const wasDeleted = flight.deleted ?? false
        const deleteResult = shouldDeleteFlight(flight, this.config)

        if (deleteResult.shouldDelete && !wasDeleted) {
            // Soft-delete the flight
            flight.deleted = true
            flight.lastDeleteRule = deleteResult.ruleId
            // Track if deleted by beyond-range rule (arrivals can be restored when in range)
            if (deleteResult.ruleId === 'delete_beyond_range') {
                flight.deletedByBeyondRange = true
            }
            console.log(`Flight ${callsign} soft-deleted by rule: ${deleteResult.ruleId}`)
            return { flight, softDeleted: true }
        } else if (!deleteResult.shouldDelete && wasDeleted && !flight.manuallyDeleted) {
            // Re-check if a section can now be found (conditions may have changed)
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
            // Special case: arrival deleted by beyond-range, check if now within range
            const isArrival = flight.destination !== undefined && this.config.myAirports.includes(flight.destination)
            if (isArrival && this.isEligibleForStrip(flight)) {
                flight.deleted = false
                flight.deletedByBeyondRange = false
                flight.lastDeleteRule = undefined
                console.log(`Flight ${callsign} (arrival) restored - now within range`)
            }
        }

        // Check if we should create/update a strip
        if (!flightHasRequiredData(flight) || flight.deleted) {
            return { flight, softDeleted: flight.deleted }
        }

        // Check if eligible for strip (position + airport + range)
        if (!this.isEligibleForStrip(flight)) {
            return { flight }
        }

        // Determine section based on rules (airborne flag may have changed)
        const targetSection = determineSectionForFlight(flight, this.config)
        const currentAssignment = this.stripAssignments.get(callsign)

        // If no section matches, handle appropriately
        if (!targetSection) {
            return this.handleNoSectionFound(flight)
        }

        // Clear noSectionFound if a section is now found
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
            console.log(`[RULE] ${callsign} -> ${targetSection.sectionId} (rule: ${ruleSource}, new strip)`)
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
            console.log(`[RULE] ${callsign} ${previousSection.sectionId} -> ${targetSection.sectionId} (rule: ${ruleSource}, was: ${previousRule})`)
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
            restored: !deleteResult.shouldDelete && wasDeleted,
            shiftedCallsigns: shiftedCallsigns.length > 0 ? shiftedCallsigns : undefined
        }
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

        // Cleared to land: arrival with clearedToLand flag set
        const clearedToLand = (stripType === 'arrival' || stripType === 'local') &&
            flight.clearedToLand === true

        // Determine actions based on controller status
        let actions: string[] | undefined
        const myCallsign = this.config.myCallsign
        const isTrackedByMe = flight.controller === myCallsign
        const isUntracked = !flight.controller || flight.controller === ''
        const isHandoffToMe = flight.handoffTargetController === myCallsign

        if (!clearedForTakeoff && !clearedToLand) {
            if (isTrackedByMe) {
                // We're the tracking controller - show normal actions
                if (stripType === 'departure' && flight.groundstate === 'TAXI') {
                    actions = ['LU', 'CTO']
                } else {
                    const defaultAction = determineActionForFlight(flight, sectionId, this.config)
                    if (defaultAction) {
                        actions = [defaultAction]
                    }
                }
            } else if ((isUntracked || isHandoffToMe) && this.config.isController) {
                // Untracked or being handed off to us - show ASSUME (only in controller mode)
                actions = ['ASSUME']
            }
            // If tracked by someone else (not us, not handoff to us) - no actions
        }

        // Can reset squawk if we're a controller and we track the flight (or it's untracked)
        const canResetSquawk = this.config.isController === true && (isTrackedByMe || isUntracked)

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
            sid: flight.sid,
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
            clearedForTakeoff,
            clearedToLand
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

import type { FlightStrip, StripType, WakeCategory, FlightRules } from "@vatefs/common"
import type {
    Flight,
    PluginMessage,
    FlightPlanDataUpdateMessage,
    ControllerAssignedDataUpdateMessage
} from "./types.js"
import { flightHasRequiredData } from "./types.js"
import { staticConfig, determineSectionForFlight, determineActionForFlight, setMyCallsign } from "./config.js"
import type { EfsStaticConfig } from "./config.js"

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
        if (message.aircraftType !== undefined) flight.aircraftType = message.aircraftType
        if (message.wakeTurbulence !== undefined) flight.wakeTurbulence = message.wakeTurbulence
        if (message.flightRules !== undefined) flight.flightRules = message.flightRules
        if (message.route !== undefined) flight.route = message.route
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

        // Determine section based on rules
        const targetSection = determineSectionForFlight(flight, this.config)
        const currentAssignment = this.stripAssignments.get(callsign)

        // Check if this is a new strip or section changed
        const isNewStrip = !hadRequiredData || !currentAssignment
        const sectionChanged = currentAssignment &&
            (currentAssignment.bayId !== targetSection.bayId ||
             currentAssignment.sectionId !== targetSection.sectionId)

        // Assign position
        let position: number
        let bottom: boolean
        let previousSection: { bayId: string; sectionId: string } | undefined

        if (isNewStrip) {
            // New strip - assign to end of section
            position = this.getNextPosition(targetSection.bayId, targetSection.sectionId)
            bottom = false
            this.stripAssignments.set(callsign, {
                bayId: targetSection.bayId,
                sectionId: targetSection.sectionId,
                position,
                bottom
            })
        } else if (sectionChanged) {
            // Section changed - move to new section
            previousSection = {
                bayId: currentAssignment!.bayId,
                sectionId: currentAssignment!.sectionId
            }
            position = this.getNextPosition(targetSection.bayId, targetSection.sectionId)
            bottom = false
            this.stripAssignments.set(callsign, {
                bayId: targetSection.bayId,
                sectionId: targetSection.sectionId,
                position,
                bottom
            })
        } else {
            // Keep current assignment
            position = currentAssignment!.position
            bottom = currentAssignment!.bottom
        }

        const strip = this.createStrip(flight, targetSection.bayId, targetSection.sectionId, position, bottom)

        return {
            flight,
            strip,
            sectionChanged: sectionChanged ?? false,
            previousSection
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
        if (message.clearence !== undefined) flight.clearance = message.clearence
        if (message.stand !== undefined) flight.stand = message.stand
        if (message.asp !== undefined) flight.asp = message.asp
        if (message.mach !== undefined) flight.mach = message.mach
        if (message.arc !== undefined) flight.arc = message.arc
        if (message.ahdg !== undefined) flight.ahdg = message.ahdg
        if (message.direct !== undefined) flight.direct = message.direct
        flight.lastUpdate = Date.now()

        // Check if we should create/update a strip
        const hasRequiredData = flightHasRequiredData(flight)
        if (!hasRequiredData) {
            return { flight }
        }

        // Determine section based on rules
        const targetSection = determineSectionForFlight(flight, this.config)
        const currentAssignment = this.stripAssignments.get(callsign)

        // Check if section changed due to groundstate change
        const isNewStrip = !hadRequiredData || !currentAssignment
        const sectionChanged = currentAssignment &&
            (currentAssignment.bayId !== targetSection.bayId ||
             currentAssignment.sectionId !== targetSection.sectionId)

        let position: number
        let bottom: boolean
        let previousSection: { bayId: string; sectionId: string } | undefined

        if (isNewStrip) {
            position = this.getNextPosition(targetSection.bayId, targetSection.sectionId)
            bottom = false
            this.stripAssignments.set(callsign, {
                bayId: targetSection.bayId,
                sectionId: targetSection.sectionId,
                position,
                bottom
            })
        } else if (sectionChanged) {
            previousSection = {
                bayId: currentAssignment!.bayId,
                sectionId: currentAssignment!.sectionId
            }
            position = this.getNextPosition(targetSection.bayId, targetSection.sectionId)
            bottom = false
            this.stripAssignments.set(callsign, {
                bayId: targetSection.bayId,
                sectionId: targetSection.sectionId,
                position,
                bottom
            })
        } else {
            position = currentAssignment!.position
            bottom = currentAssignment!.bottom
        }

        const strip = this.createStrip(flight, targetSection.bayId, targetSection.sectionId, position, bottom)

        return {
            flight,
            strip,
            sectionChanged: sectionChanged ?? false,
            previousSection
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
     * Get next position in a section
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

        // Determine default action
        const defaultAction = determineActionForFlight(flight, sectionId, this.config)

        return {
            id: flight.callsign, // Use callsign as strip ID
            callsign: flight.callsign,
            aircraftType: flight.aircraftType ?? 'UNKN',
            wakeTurbulence,
            flightRules,
            adep: flight.origin ?? '????',
            ades: flight.destination ?? '????',
            route: flight.route,
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
            defaultAction
        }
    }

    /**
     * Determine strip type based on flight data
     */
    private determineStripType(flight: Flight): StripType {
        const ourAirport = this.config.ourAirport

        // Local flight (same origin and destination at our airport)
        if (flight.origin === ourAirport && flight.destination === ourAirport) {
            return 'local'
        }

        // VFR (would need flight rules info, defaulting based on other factors for now)
        // This would need flightRules field from the plugin

        // Departure from our airport
        if (flight.origin === ourAirport) {
            return 'departure'
        }

        // Arrival to our airport
        if (flight.destination === ourAirport) {
            return 'arrival'
        }

        // Transit (neither origin nor destination at our airport)
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
     * Set backend-managed flags on a flight (clearedToLand, airborne)
     * Returns the updated strip if the flight exists and has required data
     */
    setBackendFlags(
        callsign: string,
        flags: { clearedToLand?: boolean; airborne?: boolean }
    ): { flight?: Flight; strip?: FlightStrip; sectionChanged?: boolean; previousSection?: { bayId: string; sectionId: string } } {
        const flight = this.flights.get(callsign)
        if (!flight) return {}

        // Update flags
        if (flags.clearedToLand !== undefined) flight.clearedToLand = flags.clearedToLand
        if (flags.airborne !== undefined) flight.airborne = flags.airborne
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

        if (!currentAssignment) {
            position = this.getNextPosition(targetSection.bayId, targetSection.sectionId)
            bottom = false
            this.stripAssignments.set(callsign, {
                bayId: targetSection.bayId,
                sectionId: targetSection.sectionId,
                position,
                bottom
            })
        } else if (sectionChanged) {
            previousSection = {
                bayId: currentAssignment.bayId,
                sectionId: currentAssignment.sectionId
            }
            position = this.getNextPosition(targetSection.bayId, targetSection.sectionId)
            bottom = false
            this.stripAssignments.set(callsign, {
                bayId: targetSection.bayId,
                sectionId: targetSection.sectionId,
                position,
                bottom
            })
        } else {
            position = currentAssignment.position
            bottom = currentAssignment.bottom
        }

        const strip = this.createStrip(flight, targetSection.bayId, targetSection.sectionId, position, bottom)

        return {
            flight,
            strip,
            sectionChanged: sectionChanged ?? false,
            previousSection
        }
    }

    /**
     * Get the current configuration
     */
    getConfig(): EfsStaticConfig {
        return this.config
    }
}

// Singleton instance
export const flightStore = new FlightStore(staticConfig)

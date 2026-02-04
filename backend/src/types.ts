// Flight data types - raw data from EuroScope plugin

/**
 * Ground state values from EuroScope
 * Empty string means no groundstate set (aircraft not on ground or state unknown)
 */
export type GroundState = '' | 'NSTS' | 'STUP' | 'PUSH' | 'TAXI' | 'TXIN' | 'DEPA' | 'ARR' | 'LINEUP' | 'ONFREQ' | 'DE-ICE' | 'PARK'

/**
 * Raw flight data built from EuroScope plugin messages.
 * This represents the current known state of a flight.
 */
export interface Flight {
    callsign: string

    // Flight plan data (from flightPlanDataUpdate)
    origin?: string           // ADEP - departure aerodrome
    destination?: string      // ADES - destination aerodrome
    alternate?: string        // ALTN - alternate aerodrome
    aircraftType?: string
    wakeTurbulence?: string   // L/M/H/J
    flightRules?: string      // I/V/Y/Z
    route?: string

    // Route assignments
    sid?: string              // Standard Instrument Departure
    star?: string             // Standard Terminal Arrival Route
    depRwy?: string           // Departure runway
    arrRwy?: string           // Arrival runway

    // Controller assigned data (from controllerAssignedDataUpdate)
    controller?: string       // Tracking controller callsign
    squawk?: string
    rfl?: number              // Requested/Final flight level (feet)
    cfl?: number              // Cleared flight level (feet), 0=use RFL, 1=ILS, 2=visual
    groundstate?: GroundState
    clearance?: boolean       // Clearance flag
    stand?: string            // Parking stand/gate

    // Speed/altitude assignments
    asp?: number              // Assigned speed (knots)
    mach?: number             // Assigned mach number
    arc?: number              // Assigned rate of climb/descent
    ahdg?: number             // Assigned heading (0 = no heading)
    direct?: string           // Direct to waypoint (empty = no direct)

    // Backend-managed state flags
    clearedToLand?: boolean   // Aircraft cleared to land (managed by backend)
    airborne?: boolean        // Aircraft is airborne after departure
    deleted?: boolean         // Strip is soft-deleted (hidden from user)

    // Radar position data
    currentAltitude?: number  // Current altitude from radar in feet
    latitude?: number         // Current latitude from radar
    longitude?: number        // Current longitude from radar

    // Timestamps
    firstSeen?: number        // When flight was first seen (Date.now())
    lastUpdate?: number       // Last update timestamp
}

/**
 * Check if a flight has minimum required data to produce a strip
 */
export function flightHasRequiredData(flight: Flight): boolean {
    return !!(
        flight.callsign &&
        flight.origin &&
        flight.destination
    )
}

// Plugin message types

export interface FlightPlanDataUpdateMessage {
    type: 'flightPlanDataUpdate'
    callsign: string
    // Core flight plan data
    origin?: string           // ADEP
    destination?: string      // ADES
    alternate?: string        // ALTN
    aircraftType?: string
    wakeTurbulence?: string   // L/M/H/J
    flightRules?: string      // I/V/Y/Z
    route?: string
    rfl?: number              // Requested flight level (feet)
    // Route data from UpdateRoute()
    arrRwy?: string
    star?: string
    depRwy?: string
    sid?: string
}

export interface ControllerAssignedDataUpdateMessage {
    type: 'controllerAssignedDataUpdate'
    callsign: string
    controller?: string
    squawk?: string
    rfl?: number
    cfl?: number
    groundstate?: GroundState
    clearance?: boolean
    clearedToLand?: boolean
    stand?: string
    asp?: number
    mach?: number
    arc?: number
    ahdg?: number
    direct?: string
}

export interface FlightPlanDisconnectMessage {
    type: 'flightPlanDisconnect'
    callsign: string
}

export interface FlightStripPushedMessage {
    type: 'flightPlanFlightStripPushed'
    callsign: string
    sender?: string
    target?: string
}

export interface ControllerPositionUpdateMessage {
    type: 'controllerPositionUpdate'
    callsign: string
    position: string
    name: string
    frequency: number
    rating: number
    facility: number
    sector: string
    controller: boolean
    me: boolean
}

export interface ControllerDisconnectMessage {
    type: 'controllerDisconnect'
    callsign: string
}

export interface MyselfUpdateMessage {
    type: 'myselfUpdate'
    callsign: string
    name: string
    frequency: number
    rating: number
    facility: number
    sector: string
    controller: boolean
    pluginVersion: string
    rwyconfig: Record<string, Record<string, { arr?: boolean; dep?: boolean }>>
}

export interface RadarTargetPositionUpdateMessage {
    type: 'radarTargetPositionUpdate'
    callsign: string
    altitude: number      // Current altitude in feet
    groundSpeed?: number  // Ground speed in knots (optional)
    heading?: number      // Track heading in degrees (optional)
    latitude?: number     // Position latitude (optional)
    longitude?: number    // Position longitude (optional)
}

export type PluginMessage =
    | FlightPlanDataUpdateMessage
    | ControllerAssignedDataUpdateMessage
    | FlightPlanDisconnectMessage
    | FlightStripPushedMessage
    | ControllerPositionUpdateMessage
    | ControllerDisconnectMessage
    | MyselfUpdateMessage
    | RadarTargetPositionUpdateMessage

/**
 * Type guard for plugin messages
 */
export function isPluginMessage(data: unknown): data is PluginMessage {
    if (typeof data !== 'object' || data === null || !('type' in data)) {
        return false
    }
    const type = (data as { type: unknown }).type
    return (
        type === 'flightPlanDataUpdate' ||
        type === 'controllerAssignedDataUpdate' ||
        type === 'flightPlanDisconnect' ||
        type === 'flightPlanFlightStripPushed' ||
        type === 'controllerPositionUpdate' ||
        type === 'controllerDisconnect' ||
        type === 'myselfUpdate' ||
        type === 'radarTargetPositionUpdate'
    )
}

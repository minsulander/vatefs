/**
 * Configuration type definitions for the EFS backend rules engine.
 * These types define the structure of section mapping, action, delete, and move rules.
 */

import type { EfsLayout } from "@vatefs/common"
import type { GroundState } from "./types.js"

/**
 * Default action codes for flight strips
 */
export type StripAction = 'ASSUME' | 'CTL' | 'CTO' | 'XFER' | 'PUSH' | 'TAXI' | 'TXO' | 'TXI' | 'PARK' | 'CLNC'

/**
 * Flight direction relative to our airport
 */
export type FlightDirection = 'departure' | 'arrival' | 'either'

/**
 * Controller relationship for rule matching
 */
export type ControllerCondition = 'myself' | 'not_myself' | 'any'

/**
 * Section mapping rule - determines which section a flight goes into
 */
export interface SectionRule {
    /** Rule identifier for debugging */
    id: string

    /** Target section ID when rule matches (bayId is auto-resolved from layout) */
    sectionId: string

    /**
     * Rule priority - higher priority rules are evaluated first
     * Default: 0
     */
    priority?: number

    // === Conditions (all specified conditions must match) ===

    /**
     * Flight direction at our airport
     * 'departure' = origin is our airport
     * 'arrival' = destination is our airport
     * 'either' = origin OR destination is our airport
     */
    direction?: FlightDirection

    /**
     * Groundstate must be one of these values
     * Empty string '' means no groundstate set
     */
    groundstates?: GroundState[]

    /**
     * Controller relationship
     * 'myself' = flight is tracked by me
     * 'not_myself' = flight is not tracked by me (or untracked)
     * 'any' = don't check controller
     */
    controller?: ControllerCondition

    /**
     * Clearance flag must match this value
     */
    clearance?: boolean

    /**
     * Cleared to land flag must match this value
     */
    clearedToLand?: boolean

    /**
     * Airborne flag must match this value
     */
    airborne?: boolean

    /**
     * Aircraft must be on a runway (geographically within runway surface and low altitude)
     * Checks all runways at myAirports
     */
    onRunway?: boolean

    /**
     * Maximum altitude above field elevation (in feet) for this rule to match.
     * Aircraft must be at or below this altitude relative to field elevation.
     * Requires radar position data.
     */
    maxAltitudeAboveField?: number

    /**
     * Whether the aircraft must be within (true) or outside (false) a CTR/TIZ zone.
     * Uses real boundary data from LFV (polygon + upper altitude limit).
     * If CTR data is not available, this condition fails (rule does not match),
     * allowing lower-priority fallback rules to take over.
     */
    withinCtr?: boolean
}

/**
 * Action rule - determines the default action for a flight strip
 */
export interface ActionRule {
    /** Rule identifier for debugging */
    id: string

    /** The action to show (e.g., "ASSUME", "CTL", "CTO") */
    action: StripAction

    /**
     * Rule priority - higher priority rules are evaluated first
     * Default: 0
     */
    priority?: number

    // === Conditions (all specified conditions must match) ===

    /** Section the strip must be in */
    sectionId?: string

    /** Flight direction at our airport */
    direction?: FlightDirection

    /** Groundstate must be one of these values */
    groundstates?: GroundState[]

    /** Controller relationship */
    controller?: ControllerCondition

    /** Clearance flag must match */
    clearance?: boolean

    /** Cleared to land flag must match */
    clearedToLand?: boolean

    /** Airborne flag must match */
    airborne?: boolean

    /**
     * Aircraft must be on a runway (geographically within runway surface and low altitude)
     */
    onRunway?: boolean

    /**
     * Whether a handoff has been initiated (handoffTargetController is non-empty)
     */
    handoffInitiated?: boolean
}

/**
 * Delete rule - determines when a strip should be soft-deleted (hidden)
 */
export interface DeleteRule {
    /** Rule identifier for debugging */
    id: string

    /**
     * Rule priority - higher priority rules are evaluated first
     * Default: 0
     */
    priority?: number

    // === Conditions (all specified conditions must match) ===

    /** Flight direction at our airport */
    direction?: FlightDirection

    /** Groundstate must be one of these values */
    groundstates?: GroundState[]

    /** Controller relationship */
    controller?: ControllerCondition

    /**
     * Minimum altitude above field elevation (in feet) to trigger delete
     * Only applies when radarTargetPositionUpdate provides altitude data
     */
    minAltitudeAboveField?: number

    /**
     * Delete if aircraft is beyond radar range of all configured airports.
     * When true, flight must be outside radarRangeNm to match.
     */
    beyondRange?: boolean

    /**
     * Whether the aircraft must be within (true) or outside (false) a CTR/TIZ zone.
     * If CTR data is not available, this condition fails (rule does not match).
     */
    withinCtr?: boolean
}

/**
 * Command type to send to EuroScope plugin
 */
export type EuroscopeCommand =
    | { type: 'setClearance'; value: boolean }
    | { type: 'setGroundstate'; value: GroundState }
    | { type: 'setClearedToLand'; value: boolean }
    | { type: 'setClearedForTakeoff'; value: boolean }

/**
 * Move rule - determines what command to send to EuroScope when a strip
 * is manually moved from one section to another
 */
export interface MoveRule {
    /** Rule identifier for debugging */
    id: string

    /**
     * Rule priority - higher priority rules are evaluated first
     * Default: 0
     */
    priority?: number

    // === Conditions (all specified conditions must match) ===

    /** Section the strip is moving FROM */
    fromSectionId: string

    /** Section the strip is moving TO */
    toSectionId: string

    /** Flight direction at our airport */
    direction?: FlightDirection

    // === Action to execute ===

    /** Command to send to EuroScope plugin */
    command: EuroscopeCommand
}

/**
 * Static configuration for the EFS backend
 */
export interface EfsStaticConfig {
    /** ICAO codes of "my" airports - used for filtering and rules */
    myAirports: string[]

    /** My controller callsign (will be updated from myselfUpdate) */
    myCallsign?: string

    /** Whether we are logged in as a controller (false = observer mode) */
    isController?: boolean

    /** My primary frequency in MHz (e.g., 118.505) */
    myFrequency?: number

    /** Radar range in nautical miles for strip filtering (default: 25) */
    radarRangeNm: number

    /** Bay/section layout configuration */
    layout: EfsLayout

    /** Lookup map: sectionId -> bayId (built from layout) */
    sectionToBay: Map<string, string>

    /** Section mapping rules - evaluated in priority order */
    sectionRules: SectionRule[]

    /** Default section for flights that don't match any rule (optional) */
    defaultSection?: string  // sectionId only, bayId is looked up

    /** Action rules - determines default action for strips */
    actionRules: ActionRule[]

    /** Delete rules - determines when strips should be soft-deleted */
    deleteRules: DeleteRule[]

    /** Move rules - determines what command to send when strip is manually moved */
    moveRules: MoveRule[]

    /** Active runways per airport, extracted from rwyconfig */
    activeRunways?: Record<string, { arr: string[]; dep: string[] }>
}

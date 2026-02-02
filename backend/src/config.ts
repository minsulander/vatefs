import type { EfsConfig } from "@vatefs/common"
import type { Flight, GroundState } from "./types.js"

/**
 * Default action codes
 */
export type StripAction = 'ASSUME' | 'CTL' | 'CTO' | 'XFER' | 'PUSH' | 'TAXI'

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

    /** Target section ID when rule matches */
    sectionId: string

    /** Target bay ID when rule matches */
    bayId: string

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
}

/**
 * Static configuration for the EFS backend
 */
export interface EfsStaticConfig {
    /** ICAO code of "our" airport - used for filtering and rules */
    ourAirport: string

    /** My controller callsign (will be updated from myselfUpdate) */
    myCallsign?: string

    /** Bay/section layout configuration */
    layout: EfsConfig

    /** Section mapping rules - evaluated in priority order */
    sectionRules: SectionRule[]

    /** Default section for flights that don't match any rule */
    defaultSection: {
        bayId: string
        sectionId: string
    }

    /** Action rules - determines default action for strips */
    actionRules: ActionRule[]
}

/**
 * Mock static configuration - will be loaded from file or server later
 */
export const staticConfig: EfsStaticConfig = {
    ourAirport: 'ESGG',
    myCallsign: 'ESGG_TWR', // Mock - will be updated from myselfUpdate

    layout: {
        bays: [
            {
                id: 'bay1',
                sections: [
                    { id: 'inbound', title: 'INBOUND' }
                ]
            },
            {
                id: 'bay2',
                sections: [
                    { id: 'ctr_arr', title: 'CTR ARR' },
                    { id: 'runway', title: 'RUNWAY' },
                    { id: 'ctr_dep', title: 'CTR DEP' }
                ]
            },
            {
                id: 'bay3',
                sections: [
                    { id: 'taxi', title: 'TAXI' }
                ]
            },
            {
                id: 'bay4',
                sections: [
                    { id: 'pending_clr', title: 'PENDING CLR' },
                    { id: 'cleared', title: 'CLEARED' },
                    { id: 'start_push', title: 'START&PUSH' }
                ]
            }
        ]
    },

    sectionRules: [
        // === ARRIVAL FLOW ===

        // CTR DEP: Airborne departures (groundstate DEPA + airborne flag)
        {
            id: 'ctr_dep_airborne',
            sectionId: 'ctr_dep',
            bayId: 'bay2',
            direction: 'departure',
            groundstates: ['DEPA'],
            airborne: true,
            priority: 100
        },

        // RUNWAY: Cleared to land arrivals
        {
            id: 'runway_cleared_to_land',
            sectionId: 'runway',
            bayId: 'bay2',
            direction: 'arrival',
            clearedToLand: true,
            priority: 95
        },

        // RUNWAY: Lineup and departure roll
        {
            id: 'runway_lineup',
            sectionId: 'runway',
            bayId: 'bay2',
            groundstates: ['LINEUP'],
            priority: 90
        },
        {
            id: 'runway_depa',
            sectionId: 'runway',
            bayId: 'bay2',
            groundstates: ['DEPA'],
            airborne: false, // Still on runway, not yet airborne
            priority: 90
        },

        // CTR ARR: Arrivals assumed by me
        {
            id: 'ctr_arr_assumed',
            sectionId: 'ctr_arr',
            bayId: 'bay2',
            direction: 'arrival',
            controller: 'myself',
            priority: 80
        },

        // INBOUND: Arrivals not yet assumed (ARR groundstate or just arriving)
        {
            id: 'inbound_arr_groundstate',
            sectionId: 'inbound',
            bayId: 'bay1',
            direction: 'arrival',
            groundstates: ['ARR'],
            controller: 'not_myself',
            priority: 70
        },
        {
            id: 'inbound_no_groundstate',
            sectionId: 'inbound',
            bayId: 'bay1',
            direction: 'arrival',
            groundstates: [''],
            controller: 'not_myself',
            priority: 70
        },

        // === DEPARTURE FLOW ===

        // START&PUSH: Departures with DE-ICE or PUSH
        {
            id: 'start_push_deice',
            sectionId: 'start_push',
            bayId: 'bay4',
            direction: 'departure',
            groundstates: ['DE-ICE'],
            priority: 60
        },
        {
            id: 'start_push_push',
            sectionId: 'start_push',
            bayId: 'bay4',
            direction: 'departure',
            groundstates: ['PUSH'],
            priority: 60
        },

        // CLEARED: Departures with clearance flag
        {
            id: 'cleared',
            sectionId: 'cleared',
            bayId: 'bay4',
            direction: 'departure',
            clearance: true,
            groundstates: ['', 'ONFREQ', 'STUP', 'NSTS'], // Not yet pushing
            priority: 50
        },

        // PENDING CLR: Departures without clearance (no groundstate or ONFREQ)
        {
            id: 'pending_clr_no_gs',
            sectionId: 'pending_clr',
            bayId: 'bay4',
            direction: 'departure',
            groundstates: [''],
            clearance: false,
            priority: 40
        },
        {
            id: 'pending_clr_onfreq',
            sectionId: 'pending_clr',
            bayId: 'bay4',
            direction: 'departure',
            groundstates: ['ONFREQ'],
            clearance: false,
            priority: 40
        },
        {
            id: 'pending_clr_stup',
            sectionId: 'pending_clr',
            bayId: 'bay4',
            direction: 'departure',
            groundstates: ['STUP', 'NSTS'],
            clearance: false,
            priority: 40
        },

        // === TAXI ===

        // TAXI: Departures taxiing (after pushback, before lineup)
        {
            id: 'taxi_dep',
            sectionId: 'taxi',
            bayId: 'bay3',
            direction: 'departure',
            groundstates: ['TAXI'],
            priority: 30
        },

        // TAXI: Arrivals taxiing in (after vacating runway)
        {
            id: 'taxi_arr',
            sectionId: 'taxi',
            bayId: 'bay3',
            direction: 'arrival',
            groundstates: ['TAXI'],
            priority: 30
        },

        // === FALLBACKS ===

        // Catch-all for arrivals at our airport
        {
            id: 'fallback_arrival',
            sectionId: 'inbound',
            bayId: 'bay1',
            direction: 'arrival',
            priority: 5
        },

        // Catch-all for departures at our airport
        {
            id: 'fallback_departure',
            sectionId: 'pending_clr',
            bayId: 'bay4',
            direction: 'departure',
            priority: 5
        }
    ],

    defaultSection: {
        bayId: 'bay1',
        sectionId: 'inbound'
    },

    actionRules: [
        // INBOUND arrivals: ASSUME to take control
        {
            id: 'assume_inbound',
            action: 'ASSUME',
            sectionId: 'inbound',
            direction: 'arrival',
            controller: 'not_myself',
            priority: 100
        },

        // CTR ARR arrivals: CTL (cleared to land)
        {
            id: 'ctl_ctr_arr',
            action: 'CTL',
            sectionId: 'ctr_arr',
            direction: 'arrival',
            controller: 'myself',
            clearedToLand: false, // Only if not already cleared
            priority: 90
        },

        // RUNWAY lineup: CTO (cleared for takeoff)
        {
            id: 'cto_lineup',
            action: 'CTO',
            sectionId: 'runway',
            direction: 'departure',
            groundstates: ['LINEUP'],
            priority: 90
        },

        // CTR DEP airborne: XFER (transfer to next controller)
        {
            id: 'xfer_ctr_dep',
            action: 'XFER',
            sectionId: 'ctr_dep',
            direction: 'departure',
            airborne: true,
            priority: 80
        },

        // START&PUSH with PUSH complete (ready to taxi): TAXI
        // Note: For now we don't have a way to know when push is complete
        // This rule might need refinement later

        // CLEARED departures: PUSH (approve startup/pushback)
        {
            id: 'push_cleared',
            action: 'PUSH',
            sectionId: 'cleared',
            direction: 'departure',
            clearance: true,
            groundstates: ['', 'ONFREQ', 'STUP', 'NSTS'],
            priority: 70
        }
    ]
}

/**
 * Update my callsign (called when myselfUpdate is received)
 */
export function setMyCallsign(callsign: string) {
    staticConfig.myCallsign = callsign
}

/**
 * Check if a flight is at our airport
 */
export function isAtOurAirport(
    flight: Flight,
    config: EfsStaticConfig,
    direction: FlightDirection
): boolean {
    const ourAirport = config.ourAirport
    switch (direction) {
        case 'departure':
            return flight.origin === ourAirport
        case 'arrival':
            return flight.destination === ourAirport
        case 'either':
            return flight.origin === ourAirport || flight.destination === ourAirport
    }
}

/**
 * Check controller condition
 */
function checkControllerCondition(
    flight: Flight,
    condition: ControllerCondition,
    config: EfsStaticConfig
): boolean {
    if (condition === 'any') return true

    const isMyself = flight.controller === config.myCallsign
    if (condition === 'myself') return isMyself
    if (condition === 'not_myself') return !isMyself

    return true
}

/**
 * Evaluate a single rule against a flight
 */
function evaluateRule(flight: Flight, rule: SectionRule, config: EfsStaticConfig): boolean {
    // Check direction condition
    if (rule.direction !== undefined) {
        if (!isAtOurAirport(flight, config, rule.direction)) {
            return false
        }
    }

    // Check groundstate condition
    if (rule.groundstates !== undefined) {
        const flightGroundstate = flight.groundstate ?? ''
        if (!rule.groundstates.includes(flightGroundstate)) {
            return false
        }
    }

    // Check controller condition
    if (rule.controller !== undefined) {
        if (!checkControllerCondition(flight, rule.controller, config)) {
            return false
        }
    }

    // Check clearance flag
    if (rule.clearance !== undefined) {
        const hasClearance = flight.clearance ?? false
        if (hasClearance !== rule.clearance) {
            return false
        }
    }

    // Check cleared to land flag
    if (rule.clearedToLand !== undefined) {
        const isClearedToLand = flight.clearedToLand ?? false
        if (isClearedToLand !== rule.clearedToLand) {
            return false
        }
    }

    // Check airborne flag
    if (rule.airborne !== undefined) {
        const isAirborne = flight.airborne ?? false
        if (isAirborne !== rule.airborne) {
            return false
        }
    }

    return true
}

/**
 * Determine which section a flight should be in based on rules
 */
export function determineSectionForFlight(
    flight: Flight,
    config: EfsStaticConfig
): { bayId: string; sectionId: string; ruleId?: string } {
    // Sort rules by priority (highest first)
    const sortedRules = [...config.sectionRules].sort(
        (a, b) => (b.priority ?? 0) - (a.priority ?? 0)
    )

    // Find first matching rule
    for (const rule of sortedRules) {
        if (evaluateRule(flight, rule, config)) {
            return {
                bayId: rule.bayId,
                sectionId: rule.sectionId,
                ruleId: rule.id
            }
        }
    }

    // No rule matched, use default
    return config.defaultSection
}

/**
 * Evaluate an action rule against a flight
 */
function evaluateActionRule(
    flight: Flight,
    sectionId: string,
    rule: ActionRule,
    config: EfsStaticConfig
): boolean {
    // Check section condition
    if (rule.sectionId !== undefined && rule.sectionId !== sectionId) {
        return false
    }

    // Check direction condition
    if (rule.direction !== undefined) {
        if (!isAtOurAirport(flight, config, rule.direction)) {
            return false
        }
    }

    // Check groundstate condition
    if (rule.groundstates !== undefined) {
        const flightGroundstate = flight.groundstate ?? ''
        if (!rule.groundstates.includes(flightGroundstate)) {
            return false
        }
    }

    // Check controller condition
    if (rule.controller !== undefined) {
        if (!checkControllerCondition(flight, rule.controller, config)) {
            return false
        }
    }

    // Check clearance flag
    if (rule.clearance !== undefined) {
        const hasClearance = flight.clearance ?? false
        if (hasClearance !== rule.clearance) {
            return false
        }
    }

    // Check cleared to land flag
    if (rule.clearedToLand !== undefined) {
        const isClearedToLand = flight.clearedToLand ?? false
        if (isClearedToLand !== rule.clearedToLand) {
            return false
        }
    }

    // Check airborne flag
    if (rule.airborne !== undefined) {
        const isAirborne = flight.airborne ?? false
        if (isAirborne !== rule.airborne) {
            return false
        }
    }

    return true
}

/**
 * Determine the default action for a flight strip
 */
export function determineActionForFlight(
    flight: Flight,
    sectionId: string,
    config: EfsStaticConfig
): StripAction | undefined {
    // Sort rules by priority (highest first)
    const sortedRules = [...config.actionRules].sort(
        (a, b) => (b.priority ?? 0) - (a.priority ?? 0)
    )

    // Find first matching rule
    for (const rule of sortedRules) {
        if (evaluateActionRule(flight, sectionId, rule, config)) {
            return rule.action
        }
    }

    // No action
    return undefined
}

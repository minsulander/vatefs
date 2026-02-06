/**
 * Rules engine for evaluating section, action, delete, and move rules.
 * This module contains the logic for matching flights against configured rules.
 */

import type { Flight } from "./types.js"
import type {
    EfsStaticConfig,
    FlightDirection,
    ControllerCondition,
    SectionRule,
    ActionRule,
    DeleteRule,
    MoveRule,
    StripAction,
    EuroscopeCommand
} from "./config-types.js"
import { getAirportElevation, getAirportCoords } from "./airport-data.js"
import { findNearestAirport, isWithinRangeOfAnyAirport } from "./geo-utils.js"
import { isOnAnyRunway } from "./runway-detection.js"

/**
 * Check if a flight is at one of our airports in the given direction
 */
export function isAtOurAirport(
    flight: Flight,
    config: EfsStaticConfig,
    direction: FlightDirection
): boolean {
    const myAirports = config.myAirports
    switch (direction) {
        case 'departure':
            return flight.origin !== undefined && myAirports.includes(flight.origin)
        case 'arrival':
            return flight.destination !== undefined && myAirports.includes(flight.destination)
        case 'either':
            return (flight.origin !== undefined && myAirports.includes(flight.origin)) ||
                   (flight.destination !== undefined && myAirports.includes(flight.destination))
    }
}

/**
 * Get the field elevation for a flight based on its nearest myAirport.
 * Falls back to the first myAirport's elevation, then to 500ft.
 */
export function getFieldElevationForFlight(
    flight: Flight,
    config: EfsStaticConfig
): number {
    const DEFAULT_ELEVATION = 500

    // If the flight has a known position, find the nearest airport
    if (flight.latitude !== undefined && flight.longitude !== undefined) {
        const nearest = findNearestAirport(
            flight.latitude,
            flight.longitude,
            config.myAirports,
            getAirportCoords
        )
        if (nearest) {
            const elevation = getAirportElevation(nearest)
            if (elevation !== undefined) {
                return elevation
            }
        }
    }

    // Fall back: check departure airport first (for departures), then arrival
    if (flight.origin && config.myAirports.includes(flight.origin)) {
        const elevation = getAirportElevation(flight.origin)
        if (elevation !== undefined) {
            return elevation
        }
    }

    if (flight.destination && config.myAirports.includes(flight.destination)) {
        const elevation = getAirportElevation(flight.destination)
        if (elevation !== undefined) {
            return elevation
        }
    }

    // Fall back to first airport in the list
    if (config.myAirports.length > 0) {
        const elevation = getAirportElevation(config.myAirports[0])
        if (elevation !== undefined) {
            return elevation
        }
    }

    return DEFAULT_ELEVATION
}

/**
 * Check controller condition against flight
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
 * Evaluate a single section rule against a flight
 */
function evaluateSectionRule(flight: Flight, rule: SectionRule, config: EfsStaticConfig): boolean {
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

    // Check onRunway condition
    if (rule.onRunway !== undefined) {
        // Need position and altitude data to check runway
        if (
            flight.latitude === undefined ||
            flight.longitude === undefined ||
            flight.currentAltitude === undefined
        ) {
            // Can't evaluate runway condition without position data
            if (rule.onRunway === true) {
                return false // Need to be on runway but can't verify
            }
            // If rule.onRunway === false, we can't verify so skip this condition
        } else {
            const runwayResult = isOnAnyRunway(
                flight.latitude,
                flight.longitude,
                flight.currentAltitude,
                config.myAirports
            )
            const isOnRunway = runwayResult !== undefined && runwayResult.onRunway
            if (isOnRunway !== rule.onRunway) {
                return false
            }
        }
    }

    // Check maxAltitudeAboveField condition
    if (rule.maxAltitudeAboveField !== undefined) {
        const currentAltitude = flight.currentAltitude
        if (currentAltitude === undefined) {
            return false // No altitude data, can't evaluate
        }
        const fieldElevation = getFieldElevationForFlight(flight, config)
        const altitudeAboveField = currentAltitude - fieldElevation
        if (altitudeAboveField > rule.maxAltitudeAboveField) {
            return false // Aircraft is above the maximum altitude threshold
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
): { bayId: string; sectionId: string; ruleId?: string } | undefined {
    // Sort rules by priority (highest first)
    const sortedRules = [...config.sectionRules].sort(
        (a, b) => (b.priority ?? 0) - (a.priority ?? 0)
    )

    // Find first matching rule
    for (const rule of sortedRules) {
        if (evaluateSectionRule(flight, rule, config)) {
            const bayId = config.sectionToBay.get(rule.sectionId)
            if (!bayId) {
                console.error(`Section "${rule.sectionId}" from rule "${rule.id}" not found in layout`)
                continue
            }
            return {
                bayId,
                sectionId: rule.sectionId,
                ruleId: rule.id
            }
        }
    }

    // No rule matched, use default if configured
    if (config.defaultSection) {
        const bayId = config.sectionToBay.get(config.defaultSection)
        if (bayId) {
            return { bayId, sectionId: config.defaultSection }
        }
    }

    return undefined
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

    // Check onRunway condition
    if (rule.onRunway !== undefined) {
        if (
            flight.latitude === undefined ||
            flight.longitude === undefined ||
            flight.currentAltitude === undefined
        ) {
            if (rule.onRunway === true) {
                return false
            }
        } else {
            const runwayResult = isOnAnyRunway(
                flight.latitude,
                flight.longitude,
                flight.currentAltitude,
                config.myAirports
            )
            const onRunway = runwayResult !== undefined && runwayResult.onRunway
            if (onRunway !== rule.onRunway) {
                return false
            }
        }
    }

    // Check handoff initiated condition
    if (rule.handoffInitiated !== undefined) {
        const hasHandoff = !!flight.handoffTargetController && flight.handoffTargetController !== ''
        if (hasHandoff !== rule.handoffInitiated) {
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

/**
 * Evaluate a delete rule against a flight
 */
function evaluateDeleteRule(
    flight: Flight,
    rule: DeleteRule,
    config: EfsStaticConfig
): boolean {
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

    // Check altitude above field elevation
    if (rule.minAltitudeAboveField !== undefined) {
        const currentAltitude = flight.currentAltitude
        if (currentAltitude === undefined) {
            return false // No altitude data, can't evaluate
        }
        const fieldElevation = getFieldElevationForFlight(flight, config)
        const altitudeAboveField = currentAltitude - fieldElevation
        if (altitudeAboveField < rule.minAltitudeAboveField) {
            return false
        }
    }

    // Check beyond range condition
    if (rule.beyondRange === true) {
        // Can't evaluate without airports or position data
        if (config.myAirports.length === 0) {
            return false
        }
        if (flight.latitude === undefined || flight.longitude === undefined) {
            return false // Can't evaluate without position
        }
        // Check if flight is within range - if it is, rule doesn't match
        const withinRange = isWithinRangeOfAnyAirport(
            flight.latitude,
            flight.longitude,
            config.myAirports,
            config.radarRangeNm,
            getAirportCoords
        )
        if (withinRange) {
            return false // Flight is within range, don't delete
        }
    }

    return true
}

/**
 * Determine if a flight should be soft-deleted based on delete rules
 * Returns the rule ID if a delete rule matches, undefined otherwise
 */
export function shouldDeleteFlight(
    flight: Flight,
    config: EfsStaticConfig
): { shouldDelete: boolean; ruleId?: string } {
    // Sort rules by priority (highest first)
    const sortedRules = [...config.deleteRules].sort(
        (a, b) => (b.priority ?? 0) - (a.priority ?? 0)
    )

    // Find first matching rule
    for (const rule of sortedRules) {
        if (evaluateDeleteRule(flight, rule, config)) {
            return { shouldDelete: true, ruleId: rule.id }
        }
    }

    return { shouldDelete: false }
}

/**
 * Evaluate a move rule against a flight and section change
 */
function evaluateMoveRule(
    flight: Flight,
    fromSectionId: string,
    toSectionId: string,
    rule: MoveRule,
    config: EfsStaticConfig
): boolean {
    // Check section conditions
    if (rule.fromSectionId !== fromSectionId) {
        return false
    }
    if (rule.toSectionId !== toSectionId) {
        return false
    }

    // Check direction condition
    if (rule.direction !== undefined) {
        if (!isAtOurAirport(flight, config, rule.direction)) {
            return false
        }
    }

    return true
}

/**
 * Determine what command to send to EuroScope when a strip is manually moved
 * Returns the command and rule ID if a move rule matches, undefined otherwise
 */
export function determineMoveAction(
    flight: Flight,
    fromSectionId: string,
    toSectionId: string,
    config: EfsStaticConfig
): { command: EuroscopeCommand; ruleId: string } | undefined {
    // Sort rules by priority (highest first)
    const sortedRules = [...config.moveRules].sort(
        (a, b) => (b.priority ?? 0) - (a.priority ?? 0)
    )

    // Find first matching rule
    for (const rule of sortedRules) {
        if (evaluateMoveRule(flight, fromSectionId, toSectionId, rule, config)) {
            return { command: rule.command, ruleId: rule.id }
        }
    }

    return undefined
}

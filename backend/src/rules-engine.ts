/**
 * Rules engine for evaluating section, action, delete, and move rules.
 * This module contains the logic for matching flights against configured rules.
 */

import type { Flight } from "./types.js"
import type {
    EfsStaticConfig,
    FlightDirection,
    ControllerCondition,
    ControllerRole,
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
import { isWithinCtr } from "./ctr-data.js"

type PrioritizedRule = { priority?: number }
type CommonRuleConditions = {
    direction?: FlightDirection
    groundstates?: string[]
    controller?: ControllerCondition
    clearance?: boolean
    clearedToLand?: boolean
    airborne?: boolean
    onRunway?: boolean
    depRunway?: boolean
    myRole?: ControllerRole[]
    delOnline?: boolean
    gndOnline?: boolean
}

function sortByPriorityDesc<T extends PrioritizedRule>(rules: T[]): T[] {
    return [...rules].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
}

/**
 * Check if a flight is at one of our airports in the given direction.
 * 'departure' and 'arrival' are exclusive — they do NOT match local flights.
 * 'local' matches flights where BOTH origin and destination are at our airports.
 * 'either' matches any of departure, arrival, or local.
 */
export function isAtOurAirport(
    flight: Flight,
    config: EfsStaticConfig,
    direction: FlightDirection
): boolean {
    const myAirports = config.myAirports
    const originIsOurs = flight.origin !== undefined && myAirports.includes(flight.origin)
    const destIsOurs = flight.destination !== undefined && myAirports.includes(flight.destination)

    switch (direction) {
        case 'departure':
            return originIsOurs && !destIsOurs
        case 'arrival':
            return destIsOurs && !originIsOurs
        case 'local':
            return originIsOurs && destIsOurs
        case 'either':
            return originIsOurs || destIsOurs
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

function evaluateOnRunwayCondition(
    flight: Flight,
    config: EfsStaticConfig,
    expectedOnRunway: boolean
): boolean {
    if (
        flight.latitude === undefined ||
        flight.longitude === undefined ||
        flight.currentAltitude === undefined
    ) {
        return expectedOnRunway === false
    }

    const runwayResult = isOnAnyRunway(
        flight.latitude,
        flight.longitude,
        flight.currentAltitude,
        config.myAirports
    )
    const isOnRunway = runwayResult !== undefined && runwayResult.onRunway
    return isOnRunway === expectedOnRunway
}

/**
 * Evaluate whether the flight's assigned runway is an active departure runway.
 * For departures/local on ground: checks depRwy
 * For arrivals/local airborne: checks arrRwy
 */
function evaluateDepRunwayCondition(
    flight: Flight,
    config: EfsStaticConfig,
    expectedDepRunway: boolean
): boolean {
    // Collect all active departure runways across our airports
    const depRunways: string[] = []
    if (config.activeRunways) {
        for (const airport of config.myAirports) {
            const rwy = config.activeRunways[airport]
            if (rwy) depRunways.push(...rwy.dep)
        }
    }
    if (depRunways.length === 0) return !expectedDepRunway // No active runway data

    // Determine the flight's relevant runway based on direction
    const originIsOurs = flight.origin !== undefined && config.myAirports.includes(flight.origin)
    const destIsOurs = flight.destination !== undefined && config.myAirports.includes(flight.destination)

    let relevantRunway: string | undefined
    if (originIsOurs && destIsOurs) {
        // Local flight: depRwy on ground, arrRwy when airborne
        relevantRunway = (flight.airborne ?? false) ? flight.arrRwy : flight.depRwy
    } else if (originIsOurs) {
        // Departure
        relevantRunway = flight.depRwy
    } else if (destIsOurs) {
        // Arrival
        relevantRunway = flight.arrRwy
    }

    if (!relevantRunway) return !expectedDepRunway // No runway assigned

    const isDepRunway = depRunways.includes(relevantRunway)
    return isDepRunway === expectedDepRunway
}

function evaluateCommonConditions(
    flight: Flight,
    rule: CommonRuleConditions,
    config: EfsStaticConfig
): boolean {
    if (rule.direction !== undefined && !isAtOurAirport(flight, config, rule.direction)) {
        return false
    }

    if (rule.groundstates !== undefined) {
        const flightGroundstate = flight.groundstate ?? ''
        if (!rule.groundstates.includes(flightGroundstate)) {
            return false
        }
    }

    if (rule.controller !== undefined && !checkControllerCondition(flight, rule.controller, config)) {
        return false
    }

    if (rule.clearance !== undefined) {
        const hasClearance = flight.clearance ?? false
        if (hasClearance !== rule.clearance) {
            return false
        }
    }

    if (rule.clearedToLand !== undefined) {
        const isClearedToLand = flight.clearedToLand ?? false
        if (isClearedToLand !== rule.clearedToLand) {
            return false
        }
    }

    if (rule.airborne !== undefined) {
        const isAirborne = flight.airborne ?? false
        if (isAirborne !== rule.airborne) {
            return false
        }
    }

    if (rule.onRunway !== undefined && !evaluateOnRunwayCondition(flight, config, rule.onRunway)) {
        return false
    }

    if (rule.depRunway !== undefined && !evaluateDepRunwayCondition(flight, config, rule.depRunway)) {
        return false
    }

    // myRole: if specified, config.myRole (default 'TWR') must be in the list
    if (rule.myRole && !rule.myRole.includes(config.myRole ?? 'TWR')) {
        return false
    }

    // delOnline: if specified, must match config.delOnline (default false)
    if (rule.delOnline !== undefined && (config.delOnline ?? false) !== rule.delOnline) {
        return false
    }

    // gndOnline: if specified, must match config.gndOnline (default false)
    if (rule.gndOnline !== undefined && (config.gndOnline ?? false) !== rule.gndOnline) {
        return false
    }

    return true
}

/**
 * Evaluate a single section rule against a flight
 */
function evaluateSectionRule(flight: Flight, rule: SectionRule, config: EfsStaticConfig): boolean {
    if (!evaluateCommonConditions(flight, rule, config)) {
        return false
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

    // Check withinCtr condition (real CTR/TIZ boundary data from LFV)
    if (rule.withinCtr !== undefined) {
        if (flight.latitude === undefined || flight.longitude === undefined || flight.currentAltitude === undefined) {
            return false // No position/altitude data, can't evaluate
        }
        const ctrResult = isWithinCtr(config.myAirports, flight.latitude, flight.longitude, flight.currentAltitude)
        if (ctrResult === undefined) {
            return false // No CTR data available, fail to allow fallback rules
        }
        if (ctrResult !== rule.withinCtr) {
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
): { bayId: string; sectionId: string; ruleId?: string } | undefined {
    const sortedRules = sortByPriorityDesc(config.sectionRules)

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

    if (!evaluateCommonConditions(flight, rule, config)) {
        return false
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
    const sortedRules = sortByPriorityDesc(config.actionRules)

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
    if (!evaluateCommonConditions(flight, rule, config)) {
        return false
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

    // Check withinCtr condition (real CTR/TIZ boundary data from LFV)
    if (rule.withinCtr !== undefined) {
        if (flight.latitude === undefined || flight.longitude === undefined || flight.currentAltitude === undefined) {
            return false
        }
        const ctrResult = isWithinCtr(config.myAirports, flight.latitude, flight.longitude, flight.currentAltitude)
        if (ctrResult === undefined) {
            return false // No CTR data available
        }
        if (ctrResult !== rule.withinCtr) {
            return false
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
    const sortedRules = sortByPriorityDesc(config.deleteRules)

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

    // Check depRunway condition
    if (rule.depRunway !== undefined && !evaluateDepRunwayCondition(flight, config, rule.depRunway)) {
        return false
    }

    // Check myRole condition
    if (rule.myRole && !rule.myRole.includes(config.myRole ?? 'TWR')) {
        return false
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
    const sortedRules = sortByPriorityDesc(config.moveRules)

    // Find first matching rule
    for (const rule of sortedRules) {
        if (evaluateMoveRule(flight, fromSectionId, toSectionId, rule, config)) {
            return { command: rule.command, ruleId: rule.id }
        }
    }

    return undefined
}

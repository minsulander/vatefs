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
import { findNearestAirport, isWithinRangeOfAnyAirport, isWithinStripVisibilityRange } from "./geo-utils.js"
import { isOnAnyRunway } from "./runway-detection.js"
import { isWithinCtr } from "./ctr-data.js"
import { parseControllerRole, isParallelTwr } from "./static-config.js"
import { logicalSectionId, prefixedSectionId, resolveBayForAirport } from "./multi-airport.js"
import { essaRunwaySectionId } from "@vatefs/common"
import {
    familiesFromRoles,
    isEssaRolesConfig,
    isEssaLegacyRunwaySectionId,
    resolveEssaPairForFlight,
    type EssaFamily,
} from "./essa-roles.js"

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
    arrRunway?: boolean
    myRole?: ControllerRole[]
    notMyRole?: ControllerRole[]
    essaFamilies?: EssaFamily[]
    notEssaFamilies?: EssaFamily[]
    nextControllerRole?: ControllerRole[]
    missedApproach?: boolean
}

function sortByPriorityDesc<T extends PrioritizedRule>(rules: T[]): T[] {
    return [...rules].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
}

/**
 * Get the set of my effective roles for a flight's relevant airport(s).
 * Union across all relevant airports so rules without a direction condition still work.
 * Falls back to the callsign role when myRolesByAirport is not yet populated.
 */
function getEffectiveRolesForFlight(flight: Flight, config: EfsStaticConfig): Set<ControllerRole> {
    const myAirports = config.myAirports
    const originIsOurs = flight.origin !== undefined && myAirports.includes(flight.origin)
    const destIsOurs = flight.destination !== undefined && myAirports.includes(flight.destination)

    let relevantAirports: string[]
    if (originIsOurs && destIsOurs) {
        relevantAirports = [...new Set([flight.origin!, flight.destination!])]
    } else if (originIsOurs) {
        relevantAirports = [flight.origin!]
    } else if (destIsOurs) {
        relevantAirports = [flight.destination!]
    } else {
        // Cross/note/unknown — union of all airports
        relevantAirports = myAirports
    }

    if (config.myRolesByAirport && relevantAirports.length > 0) {
        const roles = new Set<ControllerRole>()
        for (const airport of relevantAirports) {
            const airportRoles = config.myRolesByAirport.get(airport)
            if (airportRoles) {
                for (const r of airportRoles) roles.add(r)
            }
        }
        if (roles.size > 0) return roles
    }

    // Fallback: callsign role only
    return new Set([config.myRole ?? 'TWR'])
}

/**
 * Check if a flight is at one of our airports in the given direction.
 * 'departure' and 'arrival' are exclusive — they do NOT match local flights.
 * 'local' matches flights where BOTH origin and destination are at our airports.
 * 'cross' matches flights where NEITHER origin NOR destination is at our airports.
 * 'either' matches any of departure, arrival, or local (NOT cross).
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
        case 'cross':
            return !originIsOurs && !destIsOurs
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

function callsignsEqual(a: string | undefined, b: string | undefined): boolean {
    if (!a || !b) return false
    return a.toUpperCase() === b.toUpperCase()
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

    const isMyself = callsignsEqual(flight.controller, config.myCallsign)
    if (condition === 'myself') return isMyself
    if (condition === 'not_myself') return !isMyself

    return true
}

/** True when handoff target is me (callsign or my position SI). */
function isHandoffToMyself(flight: Flight, config: EfsStaticConfig): boolean {
    if (callsignsEqual(flight.handoffTargetController, config.myCallsign)) return true
    const mySi = config.myPositionId?.toUpperCase()
    const hoSi = flight.handoffTargetControllerId?.toUpperCase()
    return !!mySi && !!hoSi && mySi === hoSi
}

/**
 * Effective roles for rule matching. In ESSA mode, selected TWR-* picker
 * roles also count as covering TWR (same idea as strip XFER coveringTwr).
 */
function getRolesForRuleMatch(flight: Flight, config: EfsStaticConfig): Set<ControllerRole> {
    const roles = getEffectiveRolesForFlight(flight, config)
    if (isEssaRolesConfig(config) && (config.essaRoles ?? []).some((r) => r.startsWith('TWR-'))) {
        roles.add('TWR')
    }
    return roles
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

/**
 * Evaluate whether the flight's assigned runway is an active arrival runway.
 * Symmetric to evaluateDepRunwayCondition — use both with false to target a "third" runway.
 */
function evaluateArrRunwayCondition(
    flight: Flight,
    config: EfsStaticConfig,
    expectedArrRunway: boolean
): boolean {
    // Collect all active arrival runways across our airports
    const arrRunways: string[] = []
    if (config.activeRunways) {
        for (const airport of config.myAirports) {
            const rwy = config.activeRunways[airport]
            if (rwy) arrRunways.push(...rwy.arr)
        }
    }
    if (arrRunways.length === 0) return !expectedArrRunway // No active runway data

    // Determine the flight's relevant runway based on direction (same logic as depRunway)
    const originIsOurs = flight.origin !== undefined && config.myAirports.includes(flight.origin)
    const destIsOurs = flight.destination !== undefined && config.myAirports.includes(flight.destination)

    let relevantRunway: string | undefined
    if (originIsOurs && destIsOurs) {
        relevantRunway = (flight.airborne ?? false) ? flight.arrRwy : flight.depRwy
    } else if (originIsOurs) {
        relevantRunway = flight.depRwy
    } else if (destIsOurs) {
        relevantRunway = flight.arrRwy
    }

    if (!relevantRunway) return !expectedArrRunway // No runway assigned

    const isArrRunway = arrRunways.includes(relevantRunway)
    return isArrRunway === expectedArrRunway
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

    if (rule.arrRunway !== undefined && !evaluateArrRunwayCondition(flight, config, rule.arrRunway)) {
        return false
    }

    // myRole: my effective roles for this flight's airport must include at least one of these
    if (rule.myRole) {
        const effectiveRoles = getRolesForRuleMatch(flight, config)
        if (!rule.myRole.some(r => effectiveRoles.has(r))) {
            return false
        }
    }

    // notMyRole: my effective roles must NOT include any of these
    if (rule.notMyRole) {
        const effectiveRoles = getRolesForRuleMatch(flight, config)
        if (rule.notMyRole.some(r => effectiveRoles.has(r))) {
            return false
        }
    }

    // ESSA role-picker families (selected positions, not top-down coverage)
    if (rule.essaFamilies || rule.notEssaFamilies) {
        if (!isEssaRolesConfig(config)) return false
        const families = familiesFromRoles(config.essaRoles ?? [])
        if (rule.essaFamilies && !rule.essaFamilies.some(f => families.has(f))) {
            return false
        }
        if (rule.notEssaFamilies && rule.notEssaFamilies.some(f => families.has(f))) {
            return false
        }
    }

    // nextControllerRole: when EuroScope sets nextController, it must match.
    // If unset (common at ESSA — sequence uses ESE OWNER, not ES next), allow the rule.
    if (rule.nextControllerRole) {
        if (flight.nextController) {
            const nextRole = parseControllerRole(flight.nextController, config.myAirports)
            if (!rule.nextControllerRole.includes(nextRole)) return false
        }
    }

    // missedApproach: if specified, must match flight.missedApproach (default false)
    if (rule.missedApproach !== undefined && (flight.missedApproach ?? false) !== rule.missedApproach) {
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

    // Ground-based rules (airborne: false) use a tighter range check
    // to avoid matching flights at nearby airports
    if (rule.airborne === false && flight.latitude !== undefined && flight.longitude !== undefined) {
        if (!isWithinRangeOfAnyAirport(flight.latitude, flight.longitude, config.myAirports, config.groundRangeNm, getAirportCoords)) {
            return false
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

    // Check handoff initiated condition
    if (rule.handoffInitiated !== undefined) {
        const hasHandoff = !!flight.handoffTargetController && flight.handoffTargetController !== ''
        if (hasHandoff !== rule.handoffInitiated) {
            return false
        }
    }

    // Pending inbound transfer: handoff target is me
    if (rule.handoffToMyself !== undefined) {
        if (isHandoffToMyself(flight, config) !== rule.handoffToMyself) {
            return false
        }
    }

    return true
}

/**
 * Determine which section a flight should be in based on rules.
 * @param airport When set in multiAirport mode, maps logical section IDs onto that airport's bay.
 */
export function determineSectionForFlight(
    flight: Flight,
    config: EfsStaticConfig,
    airport?: string
): { bayId: string; sectionId: string; ruleId?: string } | undefined {
    const sortedRules = sortByPriorityDesc(config.sectionRules)
    const isMulti = config.layoutMode === 'multiAirport'

    // Find first matching rule
    for (const rule of sortedRules) {
        if (evaluateSectionRule(flight, rule, config)) {
            if (isMulti && airport) {
                const bayId = resolveBayForAirport(airport, config.columnAirports)
                return {
                    bayId,
                    sectionId: prefixedSectionId(bayId, rule.sectionId),
                    ruleId: rule.id
                }
            }
            let sectionId = rule.sectionId
            // ESSA: map legacy arr_runway/dep_runway onto physical RWY pair sections
            if (isEssaRolesConfig(config) && isEssaLegacyRunwaySectionId(sectionId)) {
                let geoEnds: { leIdent: string; heIdent: string } | undefined
                if (
                    flight.latitude !== undefined &&
                    flight.longitude !== undefined &&
                    flight.currentAltitude !== undefined
                ) {
                    const geo = isOnAnyRunway(
                        flight.latitude,
                        flight.longitude,
                        flight.currentAltitude,
                        config.myAirports
                    )
                    if (geo?.onRunway && geo.runway) geoEnds = geo.runway
                }
                const pair = resolveEssaPairForFlight(
                    flight,
                    config.activeRunways,
                    config.myAirports,
                    geoEnds
                )
                if (pair) {
                    const pairSectionId = essaRunwaySectionId(pair)
                    const pairBay =
                        config.sectionToBay.get(pairSectionId) ??
                        config.sectionToBay.get(sectionId)
                    if (pairBay) {
                        return {
                            bayId: pairBay,
                            sectionId: pairSectionId,
                            ruleId: rule.id
                        }
                    }
                }
            }
            const bayId = config.sectionToBay.get(sectionId)
            if (!bayId) {
                console.error(`Section "${sectionId}" from rule "${rule.id}" not found in layout`)
                continue
            }
            return {
                bayId,
                sectionId,
                ruleId: rule.id
            }
        }
    }

    // No rule matched, use default if configured
    if (config.defaultSection) {
        if (isMulti && airport) {
            const bayId = resolveBayForAirport(airport, config.columnAirports)
            return {
                bayId,
                sectionId: prefixedSectionId(bayId, config.defaultSection)
            }
        }
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
    // Check section condition (compare logical IDs in multiAirport mode)
    if (rule.sectionId !== undefined) {
        const effectiveSection = config.layoutMode === 'multiAirport'
            ? logicalSectionId(sectionId)
            : sectionId
        if (rule.sectionId !== effectiveSection) {
            // ESSA: YAML arr_runway/dep_runway actions also match dynamic runway_* sections
            const ruleIsRunway = isEssaLegacyRunwaySectionId(rule.sectionId)
            const sectionIsRunway = isEssaLegacyRunwaySectionId(effectiveSection)
            if (!(isEssaRolesConfig(config) && ruleIsRunway && sectionIsRunway)) {
                return false
            }
        }
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

    // Check withinCtr condition (real CTR/TIZ boundary data from LFV)
    if (rule.withinCtr !== undefined) {
        if (flight.latitude === undefined || flight.longitude === undefined || flight.currentAltitude === undefined) {
            return false
        }
        const ctrResult = isWithinCtr(config.myAirports, flight.latitude, flight.longitude, flight.currentAltitude)
        if (ctrResult === undefined) {
            return false
        }
        if (ctrResult !== rule.withinCtr) {
            return false
        }
    }

    // Optional nm ring (e.g. ESSA inbound ROF only within 20 nm of ESSA)
    if (rule.withinRangeNm !== undefined) {
        if (flight.latitude === undefined || flight.longitude === undefined) {
            return false
        }
        const airports = rule.withinRangeAirports?.length
            ? rule.withinRangeAirports
            : config.myAirports
        if (
            !isWithinRangeOfAnyAirport(
                flight.latitude,
                flight.longitude,
                airports,
                rule.withinRangeNm,
                getAirportCoords
            )
        ) {
            return false
        }
    }

    // Tracked by someone else who is not a parallel TWR (e.g. other ESSA TWR)
    if (rule.notParallelTwrOwner === true) {
        if (!flight.controller) return false
        if (isParallelTwr(config.myCallsign, flight.controller)) return false
    }

    // Tracking controller role (e.g. ownerRole: [TWR] for GND→TWR ROF)
    if (rule.ownerRole) {
        if (!flight.controller) return false
        const ownerRole = parseControllerRole(flight.controller, config.myAirports)
        if (!rule.ownerRole.includes(ownerRole)) return false
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

    const transferredToMe = isHandoffToMyself(flight, config)

    // Find first matching rule (never ROF when the handoff is to us — ASSUME wins)
    for (const rule of sortedRules) {
        if (evaluateActionRule(flight, sectionId, rule, config)) {
            if (transferredToMe && rule.action === 'ROF') continue
            return rule.action
        }
    }

    // Fallback: ASSUME when nobody has the track or flight is transferred to me
    const uncontrolled = !flight.controller
    if (uncontrolled || transferredToMe) {
        return 'ASSUME'
    }

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

    // Check beyond range condition (same visibility rules as strip create)
    if (rule.beyondRange === true) {
        // Can't evaluate without airports or position data
        if (config.myAirports.length === 0) {
            return false
        }
        if (flight.latitude === undefined || flight.longitude === undefined) {
            return false // Can't evaluate without position
        }
        // Within radar (any) or arrival 100nm / ETA≤20 → keep strip
        if (
            isWithinStripVisibilityRange(
                flight,
                config.myAirports,
                {
                    radarRangeNm: config.radarRangeNm,
                    arrivalRangeNm: config.arrivalRangeNm,
                    arrivalEtaMinutes: config.arrivalEtaMinutes,
                },
                getAirportCoords
            )
        ) {
            return false // Still visible, don't delete
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
    const fromId = config.layoutMode === 'multiAirport' ? logicalSectionId(fromSectionId) : fromSectionId
    const toId = config.layoutMode === 'multiAirport' ? logicalSectionId(toSectionId) : toSectionId

    // Check from-section conditions
    if (rule.fromSectionId !== undefined && rule.fromSectionId !== fromId) {
        return false
    }
    if (rule.fromSectionIdContains !== undefined && !fromSectionId.includes(rule.fromSectionIdContains) && !fromId.includes(rule.fromSectionIdContains)) {
        return false
    }

    // Check to-section conditions (exact and/or substring)
    if (rule.toSectionId !== undefined && rule.toSectionId !== toId) {
        return false
    }
    if (rule.toSectionIdContains !== undefined && !toSectionId.includes(rule.toSectionIdContains) && !toId.includes(rule.toSectionIdContains)) {
        return false
    }
    if (rule.toSectionId === undefined && rule.toSectionIdContains === undefined) {
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

    // Check myRole condition using effective roles
    if (rule.myRole) {
        const effectiveRoles = getRolesForRuleMatch(flight, config)
        if (!rule.myRole.some(r => effectiveRoles.has(r))) {
            return false
        }
    }

    return true
}

/**
 * Determine what command(s) to send to EuroScope when a strip is manually moved.
 * Returns commands and rule ID if a move rule matches, undefined otherwise.
 */
export function determineMoveAction(
    flight: Flight,
    fromSectionId: string,
    toSectionId: string,
    config: EfsStaticConfig
): { commands: EuroscopeCommand[]; ruleId: string } | undefined {
    const sortedRules = sortByPriorityDesc(config.moveRules)

    // Find first matching rule
    for (const rule of sortedRules) {
        if (evaluateMoveRule(flight, fromSectionId, toSectionId, rule, config)) {
            const commands =
                rule.commands && rule.commands.length > 0
                    ? rule.commands
                    : rule.command
                      ? [rule.command]
                      : []
            if (commands.length === 0) continue
            return { commands, ruleId: rule.id }
        }
    }

    return undefined
}

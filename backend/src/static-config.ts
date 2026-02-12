/**
 * Static configuration for the EFS backend.
 * This module holds the current configuration state, which can be loaded from YAML files.
 */

import type { EfsStaticConfig, ControllerRole } from "./config-types.js"

/**
 * Default configuration - used before config is loaded from file
 */
const defaultConfig: EfsStaticConfig = {
    myAirports: [],
    radarRangeNm: 25,
    layout: { bays: [] },
    sectionToBay: new Map(),
    sectionRules: [],
    actionRules: [],
    deleteRules: [],
    moveRules: []
}

/**
 * Current active configuration
 * This is mutable and will be replaced when config is loaded from file
 */
export const staticConfig: EfsStaticConfig = { ...defaultConfig }

/**
 * Apply loaded configuration
 */
export function applyConfig(config: EfsStaticConfig) {
    // Preserve myCallsign if already set (from myselfUpdate or CLI)
    const currentCallsign = staticConfig.myCallsign
    // Preserve runtime controller state
    const currentRole = staticConfig.myRole
    const currentOnlineControllers = staticConfig.onlineControllers
    const currentDelOnline = staticConfig.delOnline
    const currentGndOnline = staticConfig.gndOnline

    // Replace all config properties
    staticConfig.myAirports = config.myAirports
    staticConfig.radarRangeNm = config.radarRangeNm
    staticConfig.layout = config.layout
    staticConfig.sectionToBay = config.sectionToBay
    staticConfig.sectionRules = config.sectionRules
    staticConfig.defaultSection = config.defaultSection
    staticConfig.actionRules = config.actionRules
    staticConfig.deleteRules = config.deleteRules
    staticConfig.moveRules = config.moveRules

    // Restore callsign if it was set
    if (currentCallsign) {
        staticConfig.myCallsign = currentCallsign
    }

    // Restore runtime controller state
    if (currentRole) staticConfig.myRole = currentRole
    if (currentOnlineControllers) staticConfig.onlineControllers = currentOnlineControllers
    if (currentDelOnline !== undefined) staticConfig.delOnline = currentDelOnline
    if (currentGndOnline !== undefined) staticConfig.gndOnline = currentGndOnline
}

/**
 * Update my callsign (called when myselfUpdate is received or from CLI)
 */
export function setMyCallsign(callsign: string) {
    staticConfig.myCallsign = callsign
}

/**
 * Update my airports (called when myselfUpdate is received or from CLI)
 */
export function setMyAirports(airports: string[]) {
    staticConfig.myAirports = airports
}

/**
 * Update controller mode (called when myselfUpdate is received)
 */
export function setIsController(isController: boolean) {
    staticConfig.isController = isController
}

/**
 * Update my frequency (called when myselfUpdate is received)
 */
export function setMyFrequency(frequency: number) {
    staticConfig.myFrequency = frequency
}

/**
 * Update active runways per airport (called when rwyconfig is received)
 */
export function setActiveRunways(runways: Record<string, { arr: string[]; dep: string[] }>) {
    staticConfig.activeRunways = runways
}

/**
 * Parse controller role from callsign.
 * Checks if callsign matches any of our airports and ends with _DEL or _GND.
 * Everything else defaults to TWR (covers TWR, APP, CTR, etc.)
 */
export function parseControllerRole(callsign: string, myAirports: string[]): ControllerRole {
    const upper = callsign.toUpperCase()
    for (const airport of myAirports) {
        if (upper.startsWith(airport)) {
            if (upper.endsWith('_DEL')) return 'DEL'
            if (upper.endsWith('_GND')) return 'GND'
        }
    }
    return 'TWR'
}

/**
 * Set my controller role
 */
export function setMyRole(role: ControllerRole) {
    staticConfig.myRole = role
}

/**
 * Recalculate delOnline/gndOnline flags from the online controllers map
 */
function recalculateOnlineFlags() {
    const controllers = staticConfig.onlineControllers
    if (!controllers || controllers.size === 0) {
        staticConfig.delOnline = false
        staticConfig.gndOnline = false
        return
    }
    let del = false
    let gnd = false
    for (const ctrl of controllers.values()) {
        if (ctrl.role === 'DEL') del = true
        if (ctrl.role === 'GND') gnd = true
    }
    staticConfig.delOnline = del
    staticConfig.gndOnline = gnd
}

/**
 * Update or add an online controller at our airports.
 * Only tracks controllers whose callsign starts with one of our airports.
 * Returns true if delOnline/gndOnline changed (requiring strip regeneration).
 */
export function updateOnlineController(callsign: string, frequency: number, myAirports: string[]): boolean {
    const upper = callsign.toUpperCase()
    const matchesAirport = myAirports.some(a => upper.startsWith(a))
    if (!matchesAirport) return false

    if (!staticConfig.onlineControllers) {
        staticConfig.onlineControllers = new Map()
    }

    const role = parseControllerRole(callsign, myAirports)
    const prevDel = staticConfig.delOnline ?? false
    const prevGnd = staticConfig.gndOnline ?? false

    staticConfig.onlineControllers.set(callsign, { role, frequency, callsign })
    recalculateOnlineFlags()

    return (staticConfig.delOnline ?? false) !== prevDel || (staticConfig.gndOnline ?? false) !== prevGnd
}

/**
 * Remove an online controller.
 * Returns true if delOnline/gndOnline changed (requiring strip regeneration).
 */
export function removeOnlineController(callsign: string): boolean {
    if (!staticConfig.onlineControllers) return false

    const had = staticConfig.onlineControllers.delete(callsign)
    if (!had) return false

    const prevDel = staticConfig.delOnline ?? false
    const prevGnd = staticConfig.gndOnline ?? false

    recalculateOnlineFlags()

    return (staticConfig.delOnline ?? false) !== prevDel || (staticConfig.gndOnline ?? false) !== prevGnd
}

/**
 * Get the frequency of the first online controller with the given role.
 * Returns the frequency in MHz or undefined if no such controller is online.
 */
export function getControllerFrequency(role: ControllerRole): number | undefined {
    if (!staticConfig.onlineControllers) return undefined
    for (const ctrl of staticConfig.onlineControllers.values()) {
        if (ctrl.role === role) return ctrl.frequency
    }
    return undefined
}

/**
 * Clear all online controller tracking (called on disconnect)
 */
export function clearOnlineControllers() {
    if (staticConfig.onlineControllers) {
        staticConfig.onlineControllers.clear()
    }
    staticConfig.delOnline = false
    staticConfig.gndOnline = false
}

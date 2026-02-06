/**
 * Static configuration for the EFS backend.
 * This module holds the current configuration state, which can be loaded from YAML files.
 */

import type { EfsStaticConfig } from "./config-types.js"

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

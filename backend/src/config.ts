/**
 * Configuration module - re-exports from split modules for backward compatibility.
 *
 * The configuration is now split into three modules:
 * - config-types.ts: Type definitions
 * - static-config.ts: Static configuration data
 * - rules-engine.ts: Rule evaluation functions
 */

// Re-export types
export type {
    ControllerRole,
    StripAction,
    FlightDirection,
    ControllerCondition,
    SectionRule,
    ActionRule,
    DeleteRule,
    EuroscopeCommand,
    MoveRule,
    EfsStaticConfig
} from "./config-types.js"

// Re-export config and setter functions
export {
    staticConfig,
    setMyCallsign,
    setMyAirports,
    setIsController,
    setMyFrequency,
    setActiveRunways,
    applyConfig,
    parseControllerRole,
    setMyRole,
    updateOnlineController,
    removeOnlineController,
    getControllerFrequency,
    clearOnlineControllers
} from "./static-config.js"

// Re-export rules engine functions
export {
    isAtOurAirport,
    determineSectionForFlight,
    determineActionForFlight,
    shouldDeleteFlight,
    determineMoveAction,
    getFieldElevationForFlight
} from "./rules-engine.js"

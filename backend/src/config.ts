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

// Re-export config and setMyCallsign
export { staticConfig, setMyCallsign } from "./static-config.js"

// Re-export rules engine functions
export {
    isAtOurAirport,
    determineSectionForFlight,
    determineActionForFlight,
    shouldDeleteFlight,
    determineMoveAction
} from "./rules-engine.js"

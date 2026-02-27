/**
 * Static configuration for the EFS backend.
 * This module holds the current configuration state, which can be loaded from YAML files.
 */

import type { EfsStaticConfig, ControllerRole } from "./config-types.js"

/**
 * Top-down controller hierarchy, lowest to highest.
 * A controller at level X covers all levels below X that have no dedicated online controller.
 */
export const ROLE_ORDER: ControllerRole[] = ['DEL', 'GND', 'TWR', 'APP', 'CTR']

/**
 * Compute my effective roles at a single airport given the roles of other online controllers
 * at that airport.
 *
 * Example: I'm TWR (level 2). GND (level 1) is online.
 *   → I cover from level 2 down to (level of highest lower controller + 1) = [TWR]
 * Example: I'm TWR (level 2). Nobody else online.
 *   → I cover all the way down = [DEL, GND, TWR]
 */
export function computeEffectiveRolesForAirport(
    myRole: ControllerRole,
    onlineRolesAtAirport: ControllerRole[]
): ControllerRole[] {
    const myLevel = ROLE_ORDER.indexOf(myRole)
    if (myLevel === -1) return [myRole]

    const lowerOnlineLevels = onlineRolesAtAirport
        .map(r => ROLE_ORDER.indexOf(r))
        .filter(l => l >= 0 && l < myLevel)

    const coverageStart = lowerOnlineLevels.length > 0
        ? Math.max(...lowerOnlineLevels) + 1
        : 0

    return ROLE_ORDER.slice(coverageStart, myLevel + 1)
}

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
 * Recompute myRolesByAirport from myRole + online controllers.
 * Called whenever myRole, myAirports, or online controllers change.
 */
function recomputeMyRolesByAirport() {
    const myCallsignRole = staticConfig.myRole
    if (!myCallsignRole || staticConfig.myAirports.length === 0) {
        staticConfig.myRolesByAirport = undefined
        return
    }

    const rolesByAirport = new Map<string, ControllerRole[]>()

    for (const airport of staticConfig.myAirports) {
        const onlineRolesAtAirport: ControllerRole[] = []
        if (staticConfig.onlineControllers) {
            for (const ctrl of staticConfig.onlineControllers.values()) {
                // CTR covers all airports; DEL/GND/TWR/APP match by callsign prefix
                const coversAirport =
                    ctrl.role === 'CTR' ||
                    ctrl.callsign.toUpperCase().startsWith(airport)
                if (coversAirport) {
                    onlineRolesAtAirport.push(ctrl.role)
                }
            }
        }
        rolesByAirport.set(airport, computeEffectiveRolesForAirport(myCallsignRole, onlineRolesAtAirport))
    }

    staticConfig.myRolesByAirport = rolesByAirport
}

/**
 * Check if two myRolesByAirport maps differ (used to decide whether to regenerate strips).
 */
function rolesChanged(
    prev: Map<string, ControllerRole[]> | undefined,
    next: Map<string, ControllerRole[]> | undefined
): boolean {
    if (!prev && !next) return false
    if (!prev || !next) return true
    if (prev.size !== next.size) return true
    for (const [airport, roles] of prev) {
        const nextRoles = next.get(airport)
        if (!nextRoles) return true
        if (roles.length !== nextRoles.length) return true
        if (roles.some((r, i) => r !== nextRoles[i])) return true
    }
    return false
}

/**
 * Apply loaded configuration
 */
export function applyConfig(config: EfsStaticConfig) {
    // Preserve runtime state that was set from myselfUpdate / CLI / plugin
    const currentCallsign = staticConfig.myCallsign
    const currentMyAirports = staticConfig.myAirports
    const currentRole = staticConfig.myRole
    const currentOnlineControllers = staticConfig.onlineControllers
    const currentActiveRunways = staticConfig.activeRunways
    const currentIsController = staticConfig.isController
    const currentMyFrequency = staticConfig.myFrequency

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

    // Restore runtime state
    if (currentCallsign) staticConfig.myCallsign = currentCallsign
    if (currentMyAirports.length > 0) staticConfig.myAirports = currentMyAirports
    if (currentRole) staticConfig.myRole = currentRole
    if (currentOnlineControllers) staticConfig.onlineControllers = currentOnlineControllers
    if (currentActiveRunways) staticConfig.activeRunways = currentActiveRunways
    if (currentIsController !== undefined) staticConfig.isController = currentIsController
    if (currentMyFrequency !== undefined) staticConfig.myFrequency = currentMyFrequency

    // Recompute effective roles with restored runtime state
    recomputeMyRolesByAirport()
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
    recomputeMyRolesByAirport()
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
 * Also detects _APP and _CTR roles (excluding _R_APP and _R_CTR remote tower positions).
 * Everything else defaults to TWR.
 */
export function parseControllerRole(callsign: string, _myAirports: string[]): ControllerRole {
    const upper = callsign.toUpperCase()
    // DEL and GND are always local positions in VATSIM — no airport prefix needed
    if (upper.endsWith('_DEL')) return 'DEL'
    if (upper.endsWith('_GND')) return 'GND'
    // R_APP and R_CTR are remote tower positions — treat as TWR
    if (!upper.endsWith('_R_APP') && !upper.endsWith('_R_CTR')) {
        if (upper.endsWith('_CTR')) return 'CTR'
        if (upper.endsWith('_APP')) return 'APP'
    }
    return 'TWR'
}

/**
 * Set my controller role and recompute effective roles per airport.
 */
export function setMyRole(role: ControllerRole) {
    staticConfig.myRole = role
    recomputeMyRolesByAirport()
}

/**
 * Update or add an online controller at our airports.
 * Tracks DEL/GND/TWR/APP controllers whose callsign starts with a configured airport,
 * and CTR controllers universally (they cover all airports).
 * Returns true if myRolesByAirport changed (requiring strip regeneration).
 */
export function updateOnlineController(callsign: string, frequency: number, myAirports: string[]): boolean {
    const upper = callsign.toUpperCase()

    // Skip ATIS stations — they are not real controllers
    if (upper.endsWith('_ATIS')) return false

    // Skip unprimed controllers (frequency 199.998 means not yet active online)
    if (frequency === 199.998) return false

    const role = parseControllerRole(callsign, myAirports)

    // Track if: callsign starts with one of our airports (DEL/GND/TWR/APP), OR is CTR
    const matchesAirport = myAirports.some(a => upper.startsWith(a))
    if (!matchesAirport && role !== 'CTR') return false

    if (!staticConfig.onlineControllers) {
        staticConfig.onlineControllers = new Map()
    }

    const prevRoles = staticConfig.myRolesByAirport
    staticConfig.onlineControllers.set(callsign, { role, frequency, callsign })
    recomputeMyRolesByAirport()

    return rolesChanged(prevRoles, staticConfig.myRolesByAirport)
}

/**
 * Remove an online controller.
 * Returns true if myRolesByAirport changed (requiring strip regeneration).
 */
export function removeOnlineController(callsign: string): boolean {
    if (!staticConfig.onlineControllers) return false

    const had = staticConfig.onlineControllers.delete(callsign)
    if (!had) return false

    const prevRoles = staticConfig.myRolesByAirport
    recomputeMyRolesByAirport()

    return rolesChanged(prevRoles, staticConfig.myRolesByAirport)
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
 * Get the callsign of the first online controller with the given role.
 * Returns the callsign or undefined if no such controller is online.
 */
export function getControllerCallsign(role: ControllerRole): string | undefined {
    if (!staticConfig.onlineControllers) return undefined
    for (const ctrl of staticConfig.onlineControllers.values()) {
        if (ctrl.role === role) return ctrl.callsign
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
    recomputeMyRolesByAirport()
}

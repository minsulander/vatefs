/**
 * Static configuration for the EFS backend.
 * This module holds the current configuration state, which can be loaded from YAML files.
 */

import type { EfsStaticConfig, ControllerRole } from "./config-types.js"
import {
    buildMultiAirportLayout,
    DEFAULT_COLUMN_COUNT,
    MIN_COLUMN_COUNT,
    MAX_COLUMN_COUNT,
    isMultiAirportConfig,
    normalizeColumnAirports,
} from "./multi-airport.js"
import {
    computeAutoEssaRoles,
    normalizeEssaRoles,
    isEssaRolesConfig,
    isEssaAppCallsign,
    type EssaPositionRole
} from "./essa-roles.js"
import {
    computeAutoEsggRoles,
    computeEsggStaffedRoles,
    esggRoleToControllerRole,
    highestEsggControllerRole,
    isEsggRolesConfig,
    normalizeEsggRoles,
    type EsggPositionRole,
} from "./esgg-roles.js"
import {
    computeAutoPaperRoles,
    computePaperStaffedRoles,
    highestPaperControllerRole,
    isAdStripTowerBoard,
    PAPER_OPTIONAL_SECTION_PUSHBACK,
    paperAllowsOptionalPushback,
    paperAvailableForAirports,
    primaryPaperAirport,
    resolvePaperPositionRole,
    type PaperPositionRole,
} from "./paper-roles.js"
import { normalizePaperRoles, sortPaperRoles } from "./paper-positions.js"

export { isEssaRolesConfig, isEsggRolesConfig }

/**
 * Generic paper AD/T/P mode.
 * look:std = generic board; look:paper + ESMS/ESSB = AD strip chrome with AD roles
 * (Landvetter look:paper keeps CD/GND/TWR via isEsggRolesConfig).
 */
export function isPaperRolesConfig(config: {
    look?: string
    myCallsign?: string
    myAirports?: string[]
}): boolean {
    if (config.look === "std") return true
    return isAdStripTowerBoard(config)
}

/** Paper FPS boards: AD strips (look:paper) and T strips (look:std). */
export function isPaperStripLook(config: { look?: string }): boolean {
    return config.look === "paper" || config.look === "std"
}

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
    arrivalRangeNm: 100,
    arrivalEtaMinutes: 30,
    groundRangeNm: 3,
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
        // Still refresh ESGG/ESSA/paper auto roles so layout does not stick on a stale remap
        refreshEssaRolesIfAuto()
        refreshEsggRolesIfAuto()
        refreshPaperRolesIfAuto()
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
    refreshEssaRolesIfAuto()
    refreshEsggRolesIfAuto()
    refreshPaperRolesIfAuto()
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
    const currentMyPositionId = staticConfig.myPositionId
    const currentActiveAirports = staticConfig.activeAirports
    const currentEssaRoles = staticConfig.essaRoles
    const currentEssaRolesManual = staticConfig.essaRolesManual

    // Replace all config properties
    staticConfig.myAirports = config.myAirports
    staticConfig.radarRangeNm = config.radarRangeNm
    staticConfig.arrivalRangeNm = config.arrivalRangeNm
    staticConfig.arrivalEtaMinutes = config.arrivalEtaMinutes
    staticConfig.groundRangeNm = config.groundRangeNm
    staticConfig.layout = config.layout
    staticConfig.sectionToBay = config.sectionToBay
    staticConfig.sectionRules = config.sectionRules
    staticConfig.defaultSection = config.defaultSection
    staticConfig.actionRules = config.actionRules
    staticConfig.deleteRules = config.deleteRules
    staticConfig.moveRules = config.moveRules
    staticConfig.layoutMode = config.layoutMode
    staticConfig.look = config.look === 'paper' || config.look === 'std' ? config.look : 'saab'
    staticConfig.sectionVisibleFor = config.sectionVisibleFor
    staticConfig.bayTemplate = config.bayTemplate
    staticConfig.columnCount = config.columnCount
    staticConfig.activeAirports = config.activeAirports
    staticConfig.columnAirports = config.columnAirports
    staticConfig.saabLayoutId = config.saabLayoutId
    staticConfig.saabLayouts = config.saabLayouts
    staticConfig.essaRoles = undefined
    staticConfig.essaRolesManual = undefined
    staticConfig.esggRoles = undefined
    staticConfig.esggLayoutRoles = undefined
    staticConfig.esggRolesManual = undefined
    staticConfig.paperRoles = undefined
    staticConfig.paperLayoutRoles = undefined
    staticConfig.paperAvailableRoles = undefined
    staticConfig.paperRolesManual = undefined
    staticConfig.paperEsLinked = undefined
    staticConfig.paperOpenSectionIds = undefined
    // Workspace open-section sync is client-owned; drop stale board until reconnect
    staticConfig.workspaceOpenSectionIds = undefined
    staticConfig.workspaceOpenSectionsFingerprint = undefined

    // Restore runtime state
    if (currentCallsign) staticConfig.myCallsign = currentCallsign
    if (currentMyAirports.length > 0) staticConfig.myAirports = currentMyAirports
    if (currentRole) staticConfig.myRole = currentRole
    if (currentOnlineControllers) staticConfig.onlineControllers = currentOnlineControllers
    if (currentActiveRunways) staticConfig.activeRunways = currentActiveRunways
    if (currentIsController !== undefined) staticConfig.isController = currentIsController
    if (currentMyFrequency !== undefined) staticConfig.myFrequency = currentMyFrequency
    if (currentMyPositionId !== undefined) staticConfig.myPositionId = currentMyPositionId

    // Restore multi-airport selections when staying in / entering multi mode
    if (isMultiAirportConfig(staticConfig)) {
        if (currentActiveAirports && currentActiveAirports.length > 0) {
            staticConfig.activeAirports = currentActiveAirports
            staticConfig.myAirports = currentActiveAirports
        } else if (currentMyAirports.length > 0) {
            staticConfig.activeAirports = [...currentMyAirports]
            staticConfig.myAirports = [...currentMyAirports]
        }
        // Always start RTC with empty columns (no restore / no seed from active)
        const count = staticConfig.columnCount ?? DEFAULT_COLUMN_COUNT
        staticConfig.columnAirports = normalizeColumnAirports([], count)
        rebuildMultiAirportLayout()
    }

    // Restore ESSA role selection when staying in / entering essaRoles mode
    if (isEssaRolesConfig(staticConfig) && currentEssaRolesManual && currentEssaRoles) {
        staticConfig.essaRoles = currentEssaRoles
        staticConfig.essaRolesManual = true
    }

    // ESGG roles are always covering-auto (never restore manual override)

    // Recompute effective roles with restored runtime state
    recomputeMyRolesByAirport()
    refreshEssaRolesIfAuto()
    refreshEsggRolesIfAuto()
    refreshPaperRolesIfAuto()
}

/**
 * Rebuild multi-airport layout from bayTemplate + columnAirports.
 */
export function rebuildMultiAirportLayout() {
    if (!isMultiAirportConfig(staticConfig) || !staticConfig.bayTemplate) return

    const count = staticConfig.columnCount ?? DEFAULT_COLUMN_COUNT
    const columns = normalizeColumnAirports(staticConfig.columnAirports, count)
    staticConfig.columnAirports = columns
    staticConfig.columnCount = count

    const built = buildMultiAirportLayout(staticConfig.bayTemplate, count, columns)
    staticConfig.layout = { bays: [...built.layout.bays, ...built.idleLayout.bays] }
    staticConfig.sectionToBay = built.sectionToBay
}

/**
 * Set active airports (multi-airport mode). Also updates myAirports.
 */
export function setActiveAirports(airports: string[]) {
    const unique = [...new Set(airports.map(a => a.toUpperCase()))]
    staticConfig.activeAirports = unique
    staticConfig.myAirports = unique

    // Drop column bindings for airports no longer active
    if (staticConfig.columnAirports) {
        staticConfig.columnAirports = staticConfig.columnAirports.map(a =>
            a && unique.includes(a) ? a : null
        )
    }
    rebuildMultiAirportLayout()
    recomputeMyRolesByAirport()
}

/**
 * Bind an airport to a visible column slot (or clear with null).
 */
export function setColumnAirport(columnIndex: number, airport: string | null): boolean {
    if (!isMultiAirportConfig(staticConfig)) return false
    const count = staticConfig.columnCount ?? DEFAULT_COLUMN_COUNT
    if (columnIndex < 0 || columnIndex >= count) return false

    const columns = normalizeColumnAirports(staticConfig.columnAirports, count)
    const icao = airport ? airport.toUpperCase() : null

    if (icao) {
        // Ensure airport is in active set
        if (!staticConfig.activeAirports?.includes(icao)) {
            staticConfig.activeAirports = [...(staticConfig.activeAirports ?? []), icao]
            staticConfig.myAirports = staticConfig.activeAirports
        }
        // Already bound elsewhere → swap with this column's current airport
        const previous = columns[columnIndex] ?? null
        for (let i = 0; i < columns.length; i++) {
            if (i !== columnIndex && columns[i] === icao) {
                columns[i] = previous
            }
        }
    }

    columns[columnIndex] = icao
    staticConfig.columnAirports = columns
    rebuildMultiAirportLayout()
    recomputeMyRolesByAirport()
    return true
}

/**
 * Change number of visible column slots.
 */
export function setColumnCount(count: number): boolean {
    if (!isMultiAirportConfig(staticConfig)) return false
    const n = Math.max(MIN_COLUMN_COUNT, Math.min(MAX_COLUMN_COUNT, Math.floor(count)))
    if (n === staticConfig.columnCount) return false
    staticConfig.columnCount = n
    staticConfig.columnAirports = normalizeColumnAirports(staticConfig.columnAirports, n)
    rebuildMultiAirportLayout()
    return true
}

/**
 * Update my airports (called when myselfUpdate is received or from CLI).
 * In multiAirport mode:
 * - Seeds activeAirports if empty
 * - Otherwise merges newly discovered airports into the active set (never removes)
 *   so EuroScope rwyconfig additions become active and can blink in the top bar.
 */
export function setMyAirports(airports: string[], opts?: { force?: boolean }): string[] {
    const incoming = [...new Set(airports.map(a => a.toUpperCase()))]
    if (isMultiAirportConfig(staticConfig) && !opts?.force) {
        if (!staticConfig.activeAirports || staticConfig.activeAirports.length === 0) {
            setActiveAirports(incoming)
            // Do not seed column slots — RTC columns stay empty until the user picks
            return incoming
        }
        // Merge only — rwyconfig often lists a subset and must not wipe user selection
        const current = staticConfig.activeAirports
        const added = incoming.filter(a => !current.includes(a))
        if (added.length > 0) {
            setActiveAirports([...current, ...added])
            console.log(`[MULTI] Active airports from EuroScope: +${added.join(", ")}`)
        }
        return added
    }
    staticConfig.myAirports = incoming
    if (isMultiAirportConfig(staticConfig)) {
        staticConfig.activeAirports = [...incoming]
        rebuildMultiAirportLayout()
    }
    recomputeMyRolesByAirport()
    return incoming
}

/**
 * Collapse VATSIM login underscores for ownership compares.
 * ESGG__TWR (empty facility token) must match ESGG_TWR on strips/handoffs.
 */
export function normalizeControllerCallsign(callsign: string): string {
    return callsign.toUpperCase().replace(/_/g, "")
}

/** True when two controller callsigns refer to the same login (underscore-insensitive). */
export function controllerCallsignsEqual(
    a: string | undefined,
    b: string | undefined,
): boolean {
    if (!a || !b) return false
    return normalizeControllerCallsign(a) === normalizeControllerCallsign(b)
}

/**
 * Update my callsign (called when myselfUpdate is received or from CLI)
 */
export function setMyCallsign(callsign: string) {
    staticConfig.myCallsign = callsign
}

/**
 * Update controller mode (called when myselfUpdate is received)
 */
export function setIsController(isController: boolean) {
    staticConfig.isController = isController
}

/**
 * Update my frequency (called when myselfUpdate is received).
 * Returns true when paper AD/T/P covering changed (F_APP via ESE freq match).
 */
export function setMyFrequency(frequency: number | undefined): boolean {
    const prev = staticConfig.myFrequency
    staticConfig.myFrequency = frequency
    const freqChanged =
        prev !== frequency &&
        !(prev != null && frequency != null && Math.abs(prev - frequency) < 0.0015)
    if (!freqChanged) return false
    return refreshPaperRolesIfAuto()
}

/**
 * Update my position ID / SI (called when myselfUpdate is received).
 * Returns true when paper AD/T/P covering changed (F_APP via ESE SI).
 */
export function setMyPositionId(positionId: string | undefined): boolean {
    const next = positionId || undefined
    if (staticConfig.myPositionId === next) return false
    staticConfig.myPositionId = next
    return refreshPaperRolesIfAuto()
}

/**
 * Update active runways per airport (called when rwyconfig is received)
 */
export function setActiveRunways(runways: Record<string, { arr: string[]; dep: string[] }>) {
    staticConfig.activeRunways = runways
}

/**
 * Update ESSA FPL-assigned runway ends used for extra RWY headers.
 * Returns true when the set changed.
 */
export function setEssaAssignedRunways(assigned: { arr: string[]; dep: string[] }): boolean {
    const prev = JSON.stringify(staticConfig.essaAssignedRunways ?? { arr: [], dep: [] })
    const next = JSON.stringify(assigned)
    if (prev === next) return false
    staticConfig.essaAssignedRunways = assigned
    return true
}

/**
 * Parse controller role from callsign.
 * Checks if callsign matches any of our airports and ends with _DEL or _GND.
 * Also detects _APP and _CTR roles (excluding _R_APP and _R_CTR remote tower positions).
 * Everything else defaults to TWR.
 * Missing/empty callsign (unowned printed strip) → TWR — never throw.
 */
export function parseControllerRole(
    callsign: string | undefined | null,
    _myAirports: string[],
): ControllerRole {
    if (!callsign) return 'TWR'
    const upper = callsign.toUpperCase()
    // DEL and GND are always local positions in VATSIM — no airport prefix needed
    if (upper.endsWith('_DEL')) return 'DEL'
    if (upper.endsWith('_GND')) return 'GND'
    // R_APP and R_CTR are remote tower positions — treat as TWR
    if (!upper.endsWith('_R_APP') && !upper.endsWith('_R_CTR')) {
        if (upper.endsWith('_CTR')) return 'CTR'
        if (upper.endsWith('_APP')) return 'APP'
        // ESSA*APP with flexible underscores (ESSA__APP, ESSA_E__APP, …)
        if (isEssaAppCallsign(upper)) return 'APP'
    }
    return 'TWR'
}

/**
 * Parallel TWR: both positions are TWR at the same airport (ICAO prefix),
 * e.g. ESSA_E_TWR and ESSA_W_TWR. Used to suppress ROF between split towers.
 */
export function isParallelTwr(myCallsign: string | undefined, otherCallsign: string | undefined): boolean {
    if (!myCallsign || !otherCallsign) return false
    const me = myCallsign.toUpperCase()
    const other = otherCallsign.toUpperCase()
    if (me === other) return false
    if (parseControllerRole(me, []) !== 'TWR' || parseControllerRole(other, []) !== 'TWR') return false
    return me.slice(0, 4) === other.slice(0, 4)
}

/**
 * Set my controller role and recompute effective roles per airport.
 * Returns true when ESGG covering or layout (staffed) roles changed.
 */
export function setMyRole(role: ControllerRole): boolean {
    const prevEsgg = esggRolesKey(staticConfig.esggRoles)
    const prevEsggLayout = esggRolesKey(staticConfig.esggLayoutRoles)
    const prevPaper = paperRolesKey(staticConfig.paperRoles)
    const prevPaperLayout = paperRolesKey(staticConfig.paperLayoutRoles)
    staticConfig.myRole = role
    recomputeMyRolesByAirport()
    return (
        esggRolesKey(staticConfig.esggRoles) !== prevEsgg ||
        esggRolesKey(staticConfig.esggLayoutRoles) !== prevEsggLayout ||
        paperRolesKey(staticConfig.paperRoles) !== prevPaper ||
        paperRolesKey(staticConfig.paperLayoutRoles) !== prevPaperLayout
    )
}

/** EuroScope "not primed" primary frequency (~199.998; SDK cites 199.980). */
function isPrimedControllerFrequency(frequency: number): boolean {
    if (!(frequency > 0)) return false
    if (Math.abs(frequency - 199.998) <= 0.001) return false
    if (Math.abs(frequency - 199.98) <= 0.001) return false
    return true
}

/** Case-insensitive lookup key for onlineControllers map. */
function onlineControllerKey(callsign: string): string {
    return callsign.trim().toUpperCase()
}

/**
 * Update or add an online controller at our airports.
 * Tracks DEL/GND/TWR/APP controllers whose callsign starts with a configured airport,
 * and CTR controllers universally (they cover all airports).
 * Returns true if myRolesByAirport / covering roles changed (strip regen / layout).
 */
export function updateOnlineController(
    callsign: string,
    frequency: number,
    myAirports: string[],
    positionId?: string
): boolean {
    const upper = onlineControllerKey(callsign)
    if (!upper) return false

    // Never track ourselves as an "other" online controller (ghost after position switch)
    if (staticConfig.myCallsign && upper === staticConfig.myCallsign.toUpperCase()) {
        return removeOnlineController(upper)
    }

    // Skip ATIS stations — they are not real controllers
    if (upper.endsWith("_ATIS")) return false

    // Unprimed (199.998) or offline: drop ghost so covering includes that role again
    // (ES often sends 199.998 on logoff before/without a reliable disconnect).
    if (!isPrimedControllerFrequency(frequency)) {
        return removeOnlineController(upper)
    }

    const role = parseControllerRole(callsign, myAirports)

    // Track if: callsign starts with one of our airports (DEL/GND/TWR/APP), OR is CTR
    const matchesAirport = myAirports.some((a) => upper.startsWith(a.toUpperCase()))
    if (!matchesAirport && role !== "CTR") return false

    if (!staticConfig.onlineControllers) {
        staticConfig.onlineControllers = new Map()
    }

    const prevRoles = staticConfig.myRolesByAirport
    const prevEssa = essaRolesKey(staticConfig.essaRoles)
    const prevEsgg = esggRolesKey(staticConfig.esggRoles)
    const prevEsggLayout = esggRolesKey(staticConfig.esggLayoutRoles)
    const prevPaper = paperRolesKey(staticConfig.paperRoles)
    const prevPaperLayout = paperRolesKey(staticConfig.paperLayoutRoles)
    const prev = staticConfig.onlineControllers.get(upper)
    // Update SI when present, but never treat SI-only churn as a roles change.
    // EuroScope often re-sends controllers with fluctuating position IDs; that used to
    // trigger full reprocessAllFlights + client refresh storms (RTC Sweden Live).
    staticConfig.onlineControllers.set(upper, {
        role,
        frequency,
        callsign: upper,
        positionId: positionId || prev?.positionId,
    })
    recomputeMyRolesByAirport()

    return (
        rolesChanged(prevRoles, staticConfig.myRolesByAirport) ||
        essaRolesKey(staticConfig.essaRoles) !== prevEssa ||
        esggRolesKey(staticConfig.esggRoles) !== prevEsgg ||
        esggRolesKey(staticConfig.esggLayoutRoles) !== prevEsggLayout ||
        paperRolesKey(staticConfig.paperRoles) !== prevPaper ||
        paperRolesKey(staticConfig.paperLayoutRoles) !== prevPaperLayout
    )
}

/**
 * Look up the sector indicator (position ID) for a tracking controller callsign.
 */
export function getControllerPositionId(callsign: string | undefined): string | undefined {
    return getOnlineController(callsign)?.positionId
        ?? (staticConfig.myCallsign && callsign === staticConfig.myCallsign
            ? staticConfig.myPositionId
            : undefined)
}

/**
 * Look up primary frequency (MHz) for a controller callsign.
 */
export function getFrequencyForCallsign(callsign: string | undefined): number | undefined {
    if (!callsign) return undefined
    if (staticConfig.myCallsign && callsign === staticConfig.myCallsign) {
        return staticConfig.myFrequency
    }
    return getOnlineController(callsign)?.frequency
}

function getOnlineController(callsign: string | undefined): { role: ControllerRole; frequency: number; callsign: string; positionId?: string } | undefined {
    if (!callsign || !staticConfig.onlineControllers) return undefined
    const exact = staticConfig.onlineControllers.get(callsign)
    if (exact) return exact
    const upper = callsign.toUpperCase()
    for (const c of staticConfig.onlineControllers.values()) {
        if (c.callsign.toUpperCase() === upper) return c
    }
    return undefined
}

/**
 * Remove an online controller (case-insensitive).
 * Returns true if myRolesByAirport / covering roles changed.
 */
export function removeOnlineController(callsign: string): boolean {
    if (!staticConfig.onlineControllers) return false

    const upper = onlineControllerKey(callsign)
    let had = staticConfig.onlineControllers.delete(upper)
    // Legacy entries may have been stored with mixed case before key normalization
    if (!had) {
        for (const key of [...staticConfig.onlineControllers.keys()]) {
            if (key.toUpperCase() === upper) {
                staticConfig.onlineControllers.delete(key)
                had = true
            }
        }
    }
    if (!had) return false

    const prevRoles = staticConfig.myRolesByAirport
    const prevEssa = essaRolesKey(staticConfig.essaRoles)
    const prevEsgg = esggRolesKey(staticConfig.esggRoles)
    const prevEsggLayout = esggRolesKey(staticConfig.esggLayoutRoles)
    const prevPaper = paperRolesKey(staticConfig.paperRoles)
    const prevPaperLayout = paperRolesKey(staticConfig.paperLayoutRoles)
    recomputeMyRolesByAirport()

    return (
        rolesChanged(prevRoles, staticConfig.myRolesByAirport) ||
        essaRolesKey(staticConfig.essaRoles) !== prevEssa ||
        esggRolesKey(staticConfig.esggRoles) !== prevEsgg ||
        esggRolesKey(staticConfig.esggLayoutRoles) !== prevEsggLayout ||
        paperRolesKey(staticConfig.paperRoles) !== prevPaper ||
        paperRolesKey(staticConfig.paperLayoutRoles) !== prevPaperLayout
    )
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

/** Resolve online controller login callsign from EuroScope position SI (e.g. GE → ESGG_E_APP). */
export function getCallsignForPositionId(positionId: string | undefined): string | undefined {
    if (!positionId || !staticConfig.onlineControllers) return undefined
    const want = positionId.toUpperCase()
    for (const ctrl of staticConfig.onlineControllers.values()) {
        if (ctrl.positionId?.toUpperCase() === want) return ctrl.callsign
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

function essaRolesKey(roles: EssaPositionRole[] | undefined): string {
    // Roles are stored in canonical order (CD → GND → TWR); join is enough for equality
    return (roles ?? []).join(',')
}

function getEffectiveRolesUnion(): ControllerRole[] {
    if (staticConfig.myRolesByAirport && staticConfig.myRolesByAirport.size > 0) {
        const set = new Set<ControllerRole>()
        for (const roles of staticConfig.myRolesByAirport.values()) {
            for (const r of roles) set.add(r)
        }
        return [...set]
    }
    return staticConfig.myRole ? [staticConfig.myRole] : []
}

/**
 * Recompute ESSA layout roles from callsign + coverage when not in manual override.
 * Returns true if the selected roles changed.
 */
export function refreshEssaRolesIfAuto(): boolean {
    if (!isEssaRolesConfig(staticConfig)) {
        if (staticConfig.essaRoles !== undefined || staticConfig.essaRolesManual) {
            staticConfig.essaRoles = undefined
            staticConfig.essaRolesManual = undefined
            return true
        }
        return false
    }

    if (staticConfig.essaRolesManual) return false

    const onlineCallsigns = staticConfig.onlineControllers
        ? [...staticConfig.onlineControllers.keys()]
        : []
    const next = computeAutoEssaRoles(
        staticConfig.myCallsign,
        getEffectiveRolesUnion(),
        onlineCallsigns
    )
    const changed = essaRolesKey(staticConfig.essaRoles) !== essaRolesKey(next)
    staticConfig.essaRoles = next
    return changed
}

/**
 * Set ESSA roles (manual picker or restore from settings).
 * When manual=false, immediately re-runs auto-detect.
 * Returns true if roles / manual flag changed.
 */
export function setEssaRoles(roles: EssaPositionRole[], manual: boolean): boolean {
    if (!isEssaRolesConfig(staticConfig)) return false

    if (!manual) {
        const wasManual = !!staticConfig.essaRolesManual
        staticConfig.essaRolesManual = false
        const autoChanged = refreshEssaRolesIfAuto()
        return wasManual || autoChanged
    }

    const next = normalizeEssaRoles(roles) ?? []
    const changed =
        essaRolesKey(staticConfig.essaRoles) !== essaRolesKey(next) ||
        !staticConfig.essaRolesManual
    staticConfig.essaRoles = next
    staticConfig.essaRolesManual = true
    return changed
}

/**
 * Restore ESSA roles from persisted user settings (call after applyConfig on startup).
 */
export function restoreEssaRolesFromSettings(
    roles: EssaPositionRole[] | undefined,
    manual: boolean | undefined
) {
    if (!isEssaRolesConfig(staticConfig)) return
    if (manual && roles) {
        staticConfig.essaRoles = normalizeEssaRoles(roles) ?? []
        staticConfig.essaRolesManual = true
    } else {
        staticConfig.essaRolesManual = false
        refreshEssaRolesIfAuto()
    }
}

/**
 * Sync which section ids are open on the flexible workspace board.
 * Returns true when the open set changed (caller should reprocess strips).
 */
export function setWorkspaceOpenSectionIds(sectionIds: string[]): boolean {
    const next = new Set(
        sectionIds
            .map((id) => (typeof id === 'string' ? id.trim() : ''))
            .filter(Boolean),
    )
    const fp = [...next].sort().join('|')
    if (fp === (staticConfig.workspaceOpenSectionsFingerprint ?? '')) {
        return false
    }
    staticConfig.workspaceOpenSectionIds = next
    staticConfig.workspaceOpenSectionsFingerprint = fp
    return true
}

function esggRolesKey(roles: EsggPositionRole[] | undefined): string {
    return (roles ?? []).join(",")
}

/** Online DEL/GND/TWR at ESGG (excludes self — never stored in onlineControllers). */
function onlineEsggTowerRoles(): ControllerRole[] {
    const out: ControllerRole[] = []
    if (!staticConfig.onlineControllers) return out
    for (const ctrl of staticConfig.onlineControllers.values()) {
        if (!ctrl.callsign.toUpperCase().startsWith("ESGG")) continue
        if (ctrl.role === "DEL" || ctrl.role === "GND" || ctrl.role === "TWR") {
            out.push(ctrl.role)
        }
    }
    return out
}

/**
 * Recompute ESGG covering + layout (staffed) roles from callsign + online.
 * Manual override removed — always auto.
 */
export function refreshEsggRolesIfAuto(): boolean {
    if (!isEsggRolesConfig(staticConfig)) {
        if (
            staticConfig.esggRoles !== undefined ||
            staticConfig.esggLayoutRoles !== undefined ||
            staticConfig.esggRolesManual
        ) {
            staticConfig.esggRoles = undefined
            staticConfig.esggLayoutRoles = undefined
            staticConfig.esggRolesManual = undefined
            return true
        }
        return false
    }

    staticConfig.esggRolesManual = false

    let esggEffective: ControllerRole[] | undefined
    if (staticConfig.myRolesByAirport) {
        for (const [airport, roles] of staticConfig.myRolesByAirport) {
            if (airport.toUpperCase() === "ESGG") {
                esggEffective = roles
                break
            }
        }
    }
    const nextCovering = computeAutoEsggRoles(esggEffective ?? getEffectiveRolesUnion())
    const nextLayout = computeEsggStaffedRoles(staticConfig.myRole, onlineEsggTowerRoles())
    const changed =
        esggRolesKey(staticConfig.esggRoles) !== esggRolesKey(nextCovering) ||
        esggRolesKey(staticConfig.esggLayoutRoles) !== esggRolesKey(nextLayout)
    staticConfig.esggRoles = nextCovering
    staticConfig.esggLayoutRoles = nextLayout
    return changed
}

/**
 * Legacy client message — ESGG roles are auto-only; force refresh from coverage.
 */
export function setEsggRoles(_roles: EsggPositionRole[], _manual: boolean): boolean {
    if (!isEsggRolesConfig(staticConfig)) return false
    const wasManual = !!staticConfig.esggRolesManual
    staticConfig.esggRolesManual = false
    recomputeMyRolesByAirport()
    return wasManual || refreshEsggRolesIfAuto()
}

/**
 * Restore ESGG roles from settings — always auto (ignore persisted manual).
 */
export function restoreEsggRolesFromSettings(
    _roles: EsggPositionRole[] | undefined,
    _manual: boolean | undefined
) {
    if (!isEsggRolesConfig(staticConfig)) return
    staticConfig.esggRolesManual = false
    refreshEsggRolesIfAuto()
}

/** Whether covering-derived ESGG roles include the given position. */
export function hasEsggPositionRole(role: EsggPositionRole): boolean {
    return (staticConfig.esggRoles ?? []).includes(role)
}

/**
 * Acting callsign-style role for paper ESGG GND/TWR checks.
 * Prefer highest covering ESGG role when paper roles are active.
 * Generic paper AD/T/P uses the highest covered paper role.
 */
export function getActingControllerRole(): ControllerRole | undefined {
    if (isEsggRolesConfig(staticConfig) && staticConfig.esggRoles && staticConfig.esggRoles.length > 0) {
        return highestEsggControllerRole(staticConfig.esggRoles) ?? staticConfig.myRole
    }
    if (isPaperRolesConfig(staticConfig) && staticConfig.paperRoles && staticConfig.paperRoles.length > 0) {
        return highestPaperControllerRole(staticConfig.paperRoles) ?? staticConfig.myRole
    }
    return staticConfig.myRole
}

function paperRolesKey(roles: PaperPositionRole[] | undefined): string {
    return (roles ?? []).join(",")
}

/** Online paper roles at our primary airport (excludes self). */
function onlinePaperRolesAtAirport(icao: string): PaperPositionRole[] {
    const out: PaperPositionRole[] = []
    const prefix = icao.toUpperCase()
    if (!staticConfig.onlineControllers) return out
    for (const ctrl of staticConfig.onlineControllers.values()) {
        if (!ctrl.callsign.toUpperCase().startsWith(prefix)) continue
        const paper = resolvePaperPositionRole({
            callsign: ctrl.callsign,
            frequency: ctrl.frequency,
            positionId: ctrl.positionId,
            airport: icao,
            controllerRole: ctrl.role,
        })
        if (paper) out.push(paper)
    }
    return out
}

/**
 * Recompute generic paper covering + layout (staffed) roles.
 * Only when look is std. Landvetter tower uses ESGG roles instead.
 * Director (P) comes from ESE _F_APP via SI / primary frequency, not _DIR.
 * When paperRolesManual, covering stays user-chosen (cut to catalog); layout still auto.
 */
export function refreshPaperRolesIfAuto(): boolean {
    if (!isPaperRolesConfig(staticConfig)) {
        if (
            staticConfig.paperRoles !== undefined ||
            staticConfig.paperLayoutRoles !== undefined ||
            staticConfig.paperAvailableRoles !== undefined ||
            staticConfig.paperRolesManual !== undefined
        ) {
            staticConfig.paperRoles = undefined
            staticConfig.paperLayoutRoles = undefined
            staticConfig.paperAvailableRoles = undefined
            staticConfig.paperRolesManual = undefined
            return true
        }
        return false
    }

    const available = paperAvailableForAirports(
        staticConfig.myAirports,
        staticConfig.myCallsign,
    )
    const icao =
        primaryPaperAirport(staticConfig.myAirports, staticConfig.myCallsign) ?? ""
    const myPaper = resolvePaperPositionRole({
        callsign: staticConfig.myCallsign,
        frequency: staticConfig.myFrequency,
        positionId: staticConfig.myPositionId,
        airport: icao,
        controllerRole: staticConfig.myRole,
    })
    const online = onlinePaperRolesAtAirport(icao)
    const nextLayout = computePaperStaffedRoles(myPaper, online, available)
    const availSet = new Set(available)
    // Manual covering is sticky until the user presses Auto — never re-run
    // computeAutoPaperRoles while paperRolesManual (even if login role is unchecked).
    const nextCovering = staticConfig.paperRolesManual
        ? sortPaperRoles((staticConfig.paperRoles ?? []).filter((r) => availSet.has(r)))
        : computeAutoPaperRoles(myPaper, nextLayout, available)

    const changed =
        paperRolesKey(staticConfig.paperRoles) !== paperRolesKey(nextCovering) ||
        paperRolesKey(staticConfig.paperLayoutRoles) !== paperRolesKey(nextLayout) ||
        paperRolesKey(staticConfig.paperAvailableRoles) !== paperRolesKey(available)

    staticConfig.paperAvailableRoles = available
    staticConfig.paperLayoutRoles = nextLayout
    staticConfig.paperRoles = nextCovering

    // PUSHBACK posang is AD-only — drop when covering is T and/or P
    if (
        !paperAllowsOptionalPushback(nextCovering) &&
        staticConfig.paperOpenSectionIds?.has(PAPER_OPTIONAL_SECTION_PUSHBACK)
    ) {
        staticConfig.paperOpenSectionIds.delete(PAPER_OPTIONAL_SECTION_PUSHBACK)
        return true
    }

    return changed
}

/**
 * Set generic paper covering roles (manual picker or Auto).
 * When manual=false, immediately re-runs auto covering.
 */
export function setPaperRoles(roles: PaperPositionRole[], manual: boolean): boolean {
    if (!isPaperRolesConfig(staticConfig)) return false

    if (!manual) {
        const wasManual = !!staticConfig.paperRolesManual
        staticConfig.paperRolesManual = false
        const autoChanged = refreshPaperRolesIfAuto()
        return wasManual || autoChanged
    }

    const available = new Set(
        staticConfig.paperAvailableRoles ??
            paperAvailableForAirports(staticConfig.myAirports, staticConfig.myCallsign),
    )
    const next = sortPaperRoles(normalizePaperRoles(roles).filter((r) => available.has(r)))
    const changed =
        paperRolesKey(staticConfig.paperRoles) !== paperRolesKey(next) ||
        !staticConfig.paperRolesManual
    staticConfig.paperRoles = next
    staticConfig.paperRolesManual = true
    return changed
}

/** Restore paper covering from persisted user settings (after applyConfig). */
export function restorePaperRolesFromSettings(
    roles: PaperPositionRole[] | undefined,
    manual: boolean | undefined,
) {
    if (!isPaperRolesConfig(staticConfig)) return
    if (manual && roles) {
        staticConfig.paperRolesManual = true
        staticConfig.paperRoles = normalizePaperRoles(roles)
        // Refresh layout/available; keep manual covering (cut to catalog)
        refreshPaperRolesIfAuto()
    } else {
        staticConfig.paperRolesManual = false
        refreshPaperRolesIfAuto()
    }
}

/** ES/TopSky link for ASSUME/transfer on generic paper (default on). */
export function isPaperEsLinked(): boolean {
    if (!isPaperRolesConfig(staticConfig)) return true
    return staticConfig.paperEsLinked !== false
}

export function setPaperEsLinked(linked: boolean): boolean {
    if (!isPaperRolesConfig(staticConfig)) return false
    const next = !!linked
    if (staticConfig.paperEsLinked === next) return false
    staticConfig.paperEsLinked = next
    return true
}

export function setPaperOpenSectionIds(sectionIds: string[]): boolean {
    if (!isPaperRolesConfig(staticConfig)) return false
    const next = new Set(
        sectionIds.map((s) => s.trim().toLowerCase()).filter(Boolean),
    )
    const prev = staticConfig.paperOpenSectionIds
    const same =
        !!prev &&
        prev.size === next.size &&
        [...next].every((id) => prev.has(id))
    if (same) return false
    staticConfig.paperOpenSectionIds = next
    return true
}

export function ensurePaperOpenSection(sectionId: string): boolean {
    if (!isPaperRolesConfig(staticConfig)) return false
    const id = sectionId.trim().toLowerCase()
    if (!id) return false
    const set = staticConfig.paperOpenSectionIds ?? new Set<string>()
    if (set.has(id)) return false
    set.add(id)
    staticConfig.paperOpenSectionIds = set
    return true
}

export function closePaperOpenSection(sectionId: string): boolean {
    if (!isPaperRolesConfig(staticConfig)) return false
    const id = sectionId.trim().toLowerCase()
    if (!id) return false
    const set = staticConfig.paperOpenSectionIds ?? new Set<string>()
    const had = set.has(id)
    if (had) {
        set.delete(id)
        staticConfig.paperOpenSectionIds = set
    }
    // Idempotent: still report success so clients can refresh even if open-ids
    // were already cleared while the divider remained visible.
    return true
}

export type { EssaPositionRole, EsggPositionRole, PaperPositionRole }


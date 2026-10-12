// WebSocket API message types

import type { AirportAtisInfo, DclMode, EfsLayout, FlightStrip, Gap, Section, UiSettings } from "./types.js"

// Server -> Client messages

export interface LayoutMessage {
    type: 'layout'
    layout: EfsLayout
}

export interface StripMessage {
    type: 'strip'
    strip: FlightStrip
    autoMoved?: boolean
    /** G/A APP-assume reprint: clear local scribbles + play print anim */
    cleanReprint?: boolean
}

export interface StripDeleteMessage {
    type: 'stripDelete'
    stripId: string
}

export interface GapMessage {
    type: 'gap'
    gap: Gap
}

export interface GapDeleteMessage {
    type: 'gapDelete'
    bayId: string
    sectionId: string
    index: number
}

export interface SectionMessage {
    type: 'section'
    bayId: string
    section: Section
}

export interface RefreshMessage {
    type: 'refresh'
    reason?: string  // Optional reason for logging/debugging
}

/** One row in Connection / Parsing status (OK uses normal colour; !ok is error red). */
export interface FeedStatusItem {
    ok: boolean
    /** Short status text, e.g. "Connected", "Not found", "Loaded (42)" */
    detail: string
}

/**
 * Live + startup data-feed health for the Connection popup.
 * Network feeds refresh while running; local/parsing feeds are mostly startup.
 */
export interface FeedsStatus {
    // Network
    plugin: FeedStatusItem
    hoppie: FeedStatusItem
    viff: FeedStatusItem
    atis: FeedStatusItem
    afv: FeedStatusItem
    ctr: FeedStatusItem
    // Local / parsing
    euroscopeDir: FeedStatusItem
    hoppieConfig: FeedStatusItem
    cdmLocal: FeedStatusItem
    stands: FeedStatusItem
    eseSid: FeedStatusItem
    eseAirspace: FeedStatusItem
    topskyAirspace: FeedStatusItem
}

export interface StatusMessage {
    type: 'status'
    callsign: string      // Controller callsign (e.g., 'ESGG_TWR')
    airports: string[]    // Configured / active airports (e.g., ['ESGG', 'ESGT'])
    role?: string         // Controller role (e.g., 'DEL', 'GND', 'TWR')
    /** EuroScope position / SI (e.g. OS, TW) */
    positionId?: string
    /**
     * True while the EuroScope plugin is sending UDP (myselfUpdate ~5s).
     * False when plugin unloaded / ES logged off / UDP stale. Mock mode always true.
     */
    pluginConnected?: boolean
    /** Connection + parsing feed health for status popup */
    feeds?: FeedsStatus
    /** Backend / installed VatEFS version (from @vatefs/common) */
    backendVersion?: string
    /** EuroScope plugin version from loaded plugin myselfUpdate (not from disk) */
    pluginVersion?: string
    /** Primary frequency from myselfUpdate (MHz) */
    frequency?: number
    isController?: boolean // Whether connected as a controller (false = observer)
    /** Multi-airport: all airports being processed */
    activeAirports?: string[]
    /** Multi-airport: airports currently ARR/DEP in EuroScope rwyselect */
    esAirports?: string[]
    /** Multi-airport: ICAO per visible column slot (null = empty) */
    columnAirports?: (string | null)[]
    /** Multi-airport: number of visible column slots */
    columnCount?: number
    /** Multi-airport mode active */
    multiAirport?: boolean
    /** RTC: ICAOs where IFR DEPs need ACC coordination (COO checkmark) */
    needsCoordination?: string[]
    /** RTC: per-airport TMA exits that do NOT need COO (e.g. ESNU) */
    needsCoordinationExits?: Record<string, string[]>
    /** ESSA role-profile mode active */
    essaRolesMode?: boolean
    /** Selected ESSA positions (CD, GND-E, …) */
    essaRoles?: string[]
    /** True when roles were chosen manually */
    essaRolesManual?: boolean
    /** ESGG paper role picker active */
    esggRolesMode?: boolean
    /** Selected ESGG positions (CD, GND, TWR) */
    esggRoles?: string[]
    /** True when ESGG roles were chosen manually */
    esggRolesManual?: boolean
    /**
     * ESSA TWR AOR split: runway ends we cover (e.g. 01L,19R).
     * Undefined = all runways (solo / no split). Used to hide MAP/breakout for uncovered ARR.
     */
    essaCoveredRunways?: string[]
    /** Strip chrome from active YAML (`look: paper` → paper; default saab) */
    look?: 'saab' | 'paper'
}

export interface DclStatusMessage {
    type: 'dclStatus'
    status: 'available' | 'connected' | 'error' | 'unavailable'
    error?: string
    dclMode?: DclMode
}

export interface HoppieMessage {
    type: 'hoppieMessage'
    from: string
    messageType: string  // e.g. 'cpdlc', 'telex'
    packet: string
}

export interface AtisUpdateMessage {
    type: 'atisUpdate'
    airports: AirportAtisInfo[]
}

/** AUP R16 ("R16 utökad") status — see backend/src/aup. */
export interface AupR16Status {
    /** R16/ESR16 active now and upper limit > 1600 ft */
    active: boolean
    /** Highest upper limit among active R16 rows (ft) */
    topAltitudeFt: number | null
    /** Active window start / end (ISO UTC) */
    from: string | null
    to: string | null
    /** ESSA RWY config the client MAY apply in AUTO mode (never in manual lock) */
    suggestConfigId: '9C' | '15C' | null
    /**
     * AUP fetch/parse outcome for UI messaging:
     * - ok: plan loaded (active may still be false if not utökad / outside window)
     * - error: fetch/parse failed
     * - pending: not yet attempted
     */
    fetchStatus?: 'ok' | 'error' | 'pending'
}

export interface AupR16Message extends AupR16Status {
    type: 'aupR16'
}

/** Active RWY occupied/closed flags — synced across EFS clients (not localStorage). */
export interface RwyFlagsMessage {
    type: 'rwyFlags'
    /** Flag ids: `rwyOccupied:runway_08_26`, `rwyClosed:runway_01L_19R`, … */
    active: string[]
}

export interface ConfigInfo {
    /** Config file basename (e.g. "singlerwy4bays.yml") */
    file: string
    /** Display name from the "name" field in YAML (e.g. "1RWY4BAY") */
    name: string
}

export interface ConfigListMessage {
    type: 'configList'
    configs: ConfigInfo[]
    activeConfig: string  // file basename of the currently active config
}

export interface ControllerInfo {
    callsign: string
    frequency: string  // Formatted frequency e.g. "118.505"
}

export interface ControllersMessage {
    type: 'controllers'
    controllers: ControllerInfo[]
}

export interface UserSettingsMessage {
    type: 'userSettings'
    settings: UiSettings
    /** True when any myAirport has GNG stand data (show Auto PARK option). */
    autoParkAvailable?: boolean
}

/** Transient UI toast (e.g. ROF send failure) */
export interface NotifyMessage {
    type: 'notify'
    level: 'error' | 'info'
    text: string
}

/** Soft-deleted strip summary for trash recovery UI */
export interface DeletedStripInfo {
    stripId: string
    callsign: string
    stripType: FlightStrip['stripType']
    adep: string
    ades: string
    aircraftType: string
    sectionId: string
    bayId: string
    noteText?: string
    deletedAt: number
    reason?: string
}

export interface DeletedStripsMessage {
    type: 'deletedStrips'
    strips: DeletedStripInfo[]
}

/** Flight waiting for manual strip print (paper look + manual mode) */
export interface PendingPrintFlightInfo {
    callsign: string
    stripType: FlightStrip['stripType']
    adep: string
    ades: string
    aircraftType: string
    eobt?: string
    ctot?: string
    assr?: string
}

export interface PendingPrintListMessage {
    type: 'pendingPrintList'
    flights: PendingPrintFlightInfo[]
}

export type ServerMessage = LayoutMessage | StripMessage | StripDeleteMessage | GapMessage | GapDeleteMessage | SectionMessage | RefreshMessage | StatusMessage | DclStatusMessage | HoppieMessage | AtisUpdateMessage | ConfigListMessage | ControllersMessage | UserSettingsMessage | NotifyMessage | DeletedStripsMessage | PendingPrintListMessage | AupR16Message | RwyFlagsMessage

// Client -> Server messages

export interface RequestMessage {
    type: 'request'
    request: 'layout' | 'strips' | 'refresh'
}

/** Re-parse local EuroScope/data files and refresh network feeds */
export interface ReloadFeedsMessage {
    type: 'reloadFeeds'
}

export interface MoveStripMessage {
    type: 'moveStrip'
    stripId: string
    targetBayId: string
    targetSectionId: string
    position?: number
    isBottom: boolean
}

/** Freeze top-zone strip order (e.g. enter MAN sort) — ids top→bottom */
export interface ReorderStripsMessage {
    type: 'reorderStrips'
    bayId: string
    sectionId: string
    stripIds: string[]
}

export interface SetGapMessage {
    type: 'setGap'
    bayId: string
    sectionId: string
    index: number
    gapSize: number
}

export interface SetSectionHeightMessage {
    type: 'setSectionHeight'
    bayId: string
    sectionId: string
    height: number
}

export interface StripActionMessage {
    type: 'stripAction'
    stripId: string
    action: string             // e.g., "ASSUME", "CTL", "CTO"
}

export type AssignmentType =
    | 'assignDepartureRunway'
    | 'assignArrivalRunway'
    | 'assignSid'
    | 'assignHeading'
    /** Direct-to waypoint (FPR / DCT); empty clears */
    | 'assignDirect'
    | 'assignCfl'
    /** TopSky approach clearance type (CA/VA/CAT2/CAT3/OS/…) */
    | 'assignAppClr'

export interface StripAssignMessage {
    type: 'stripAssign'
    stripId: string
    assignType: AssignmentType
    value: string              // e.g., "21", "LABAN4J", "270", "5000"
}

export interface DeleteStripMessage {
    type: 'deleteStrip'
    stripId: string
}

export interface ListDeletedStripsMessage {
    type: 'listDeletedStrips'
}

export interface RestoreStripMessage {
    type: 'restoreStrip'
    stripId: string
}

export interface DclActionMessage {
    type: 'dclAction'
    action: 'login' | 'logout'
}

export interface DclRejectMessage {
    type: 'dclReject'
    stripId: string
}

export interface DclSendMessage {
    type: 'dclSend'
    stripId: string
    remarks: string
    /**
     * Controller-initiated clearance (no prior pilot REQUEST).
     * Same CLD CPDLC as request-flow send; must not send RCD/STANDBY ack.
     */
    proactive?: boolean
}

export interface DclSetModeMessage {
    type: 'dclSetMode'
    mode: DclMode
}

export interface SwitchConfigMessage {
    type: 'switchConfig'
    file: string  // Config file basename (e.g. "dualrwy4bays.yml")
}

export interface CreateStripMessage {
    type: 'createStrip'
    stripType: 'vfrDep' | 'vfrArr' | 'cross' | 'note' | 'vehicle'
    callsign?: string           // For VFR DEP/ARR/CROSS
    aircraftType?: string       // For VFR DEP/ARR
    airport?: string            // Airport for VFR origin/dest, CROSS/NOTE/VEHICLE column placement
    targetBayId?: string        // If dragged to a specific section
    targetSectionId?: string
    position?: number
    isBottom?: boolean
    /** Paper-look blank / info strip template (note strips only) */
    paperInfoKind?: import('./types.js').PaperInfoKind
}

export interface UpdateNoteMessage {
    type: 'updateNote'
    stripId: string
    text: string
}

/** Update a field on a local vehicle strip (C/S, HP, STD) — no EuroScope sync */
export interface UpdateVehicleStripMessage {
    type: 'updateVehicleStrip'
    stripId: string
    field: 'callsign' | 'hp' | 'std'
    text: string
}

export interface UpdateRemarksMessage {
    type: 'updateRemarks'
    stripId: string
    text: string
}

/** Set holding point — scratchpad /TEXT (empty clears) */
export interface UpdateHpMessage {
    type: 'updateHp'
    stripId: string
    text: string
}

/** Set hold short — VCH strip annotation 4 (empty clears; max 5 chars) */
export interface UpdateHsMessage {
    type: 'updateHs'
    stripId: string
    text: string
}

/** Toggle ACC coordination flag — scratchpad `.COO` */
export interface SetCooMessage {
    type: 'setCoo'
    stripId: string
    coo: boolean
}

export interface ReleaseStripMessage {
    type: 'releaseStrip'
    stripId: string
}

export interface ManualTransferMessage {
    type: 'manualTransfer'
    stripId: string
    targetCallsign: string
}

export interface ViffReaMessage {
    type: 'viffRea'
    stripId: string
    set: boolean
}

export interface ViffUpdateEobtMessage {
    type: 'viffUpdateEobt'
    stripId: string
    eobt: string  // HHMM
}

export interface ViffUpdateTobtMessage {
    type: 'viffUpdateTobt'
    stripId: string
    tobt: string  // HHMM
}

/**
 * Set TOBT to now (UTC HHMM) then REA (sequential on server).
 * Optional `tobt` is ignored — Ready always uses current UTC time.
 */
export interface ViffReadyTobtMessage {
    type: 'viffReadyTobt'
    stripId: string
    /** @deprecated Ignored; server always sets TOBT to now UTC */
    tobt?: string
}

/** Toggle Ready Startup: ASRT + REA (CDM TAG_FUNC_TOGGLEASRTREA) */
export interface ViffToggleReadyStartupMessage {
    type: 'viffToggleReadyStartup'
    stripId: string
}

/** Set or clear TSAC (communicated TSAT) — empty string clears */
export interface SetTsacMessage {
    type: 'setTsac'
    stripId: string
    /** HHmm to store, or empty to clear */
    tsac: string
}

/** Set or clear CTOC (communicated CTOT) — empty string clears */
export interface SetCtocMessage {
    type: 'setCtoc'
    stripId: string
    /** HHmm to store, or empty to clear */
    ctoc: string
}

/** Record QNH given to pilot (hPa), or clear with null */
export interface SetQnhGivenMessage {
    type: 'setQnhGiven'
    stripId: string
    /** Current ATIS QNH in hPa, or null to clear */
    qnh: number | null
    /** ATIS letter stamped with QNH (paper col 6); cleared when qnh is null */
    atis?: string | null
}

export interface SetColumnAirportMessage {
    type: 'setColumnAirport'
    columnIndex: number
    airport: string | null
}

export interface AddActiveAirportMessage {
    type: 'addActiveAirport'
    airport: string
}

export interface RemoveActiveAirportMessage {
    type: 'removeActiveAirport'
    airport: string
}

export interface SetColumnCountMessage {
    type: 'setColumnCount'
    count: number
}

export interface UpdateUserSettingsMessage {
    type: 'updateUserSettings'
    settings: Partial<UiSettings>
}

export interface SetEssaRolesMessage {
    type: 'setEssaRoles'
    /** Physical ESSA positions to show; ignored when manual is false (auto) */
    roles: string[]
    /** true = manual override; false = return to auto-detect */
    manual: boolean
}

export interface SetEsggRolesMessage {
    type: 'setEsggRoles'
    /** ESGG positions (CD, GND, TWR); ignored when manual is false (auto) */
    roles: string[]
    /** true = manual override; false = return to auto-detect */
    manual: boolean
}

/** Toggle or set a RWY occupied/closed flag (broadcast to all clients). */
export interface SetRwyFlagMessage {
    type: 'setRwyFlag'
    /** Full flag id: `rwyOccupied:runway_08_26` or `rwyClosed:…` */
    flagId: string
    active: boolean
}

/** List flights eligible for strip print but not yet printed (manual paper mode) */
export interface ListPendingPrintMessage {
    type: 'listPendingPrint'
}

/** Explicitly print (create) a strip for a callsign in manual paper mode */
export interface PrintStripMessage {
    type: 'printStrip'
    callsign: string
}

/**
 * Amend EuroScope flight plan from the FPL dialog (TopSky Apply).
 * Only include fields that changed; plugin amends then echoes FPD/CAD.
 */
export interface AmendFlightPlanMessage {
    type: 'amendFlightPlan'
    stripId: string
    flightRules?: string
    aircraftType?: string
    wakeTurbulence?: string
    /** Formation / field 9 number of aircraft (1–99); embedded in AircraftInfo as N/TYPE/… */
    numberOfAircraft?: number
    /** ICAO field 10a, or omitted when using faaEquipment */
    equipment?: string
    /** ICAO field 10b surveillance */
    surveillance?: string
    /** FAA single-letter equip (ATYP/G) — plugin sets TYPE/WTC-G style if needed */
    faaEquipment?: string
    origin?: string
    destination?: string
    alternate?: string
    /** Second alternate → remarks RALT/ */
    alternate2?: string
    eobd?: string
    eobt?: string
    tas?: string
    /** Cleared/requested level as feet, or A050/F090/090 string */
    rfl?: string | number
    /** Filed EET HHmm */
    eet?: string
    route?: string
    /** Item 18 remarks (Other) */
    fplRemarks?: string
    /** SUP: endurance E/HHmm and/or C/name */
    supl?: string
    /** Assigned SSR (with or without A prefix) */
    squawk?: string
    /** PEL/CFL as feet or A/F label */
    cfl?: string | number
}

export type ClientMessage = RequestMessage | ReloadFeedsMessage | MoveStripMessage | ReorderStripsMessage | SetGapMessage | SetSectionHeightMessage | StripActionMessage | StripAssignMessage | DeleteStripMessage | ListDeletedStripsMessage | RestoreStripMessage | DclActionMessage | DclRejectMessage | DclSendMessage | DclSetModeMessage | SwitchConfigMessage | CreateStripMessage | UpdateNoteMessage | UpdateVehicleStripMessage | UpdateRemarksMessage | UpdateHpMessage | UpdateHsMessage | ReleaseStripMessage | ManualTransferMessage | ViffReaMessage | ViffUpdateEobtMessage | ViffUpdateTobtMessage | ViffReadyTobtMessage | ViffToggleReadyStartupMessage | SetTsacMessage | SetCtocMessage | SetQnhGivenMessage | SetColumnAirportMessage | AddActiveAirportMessage | RemoveActiveAirportMessage | SetColumnCountMessage | UpdateUserSettingsMessage | SetEssaRolesMessage | SetEsggRolesMessage | SetRwyFlagMessage | ListPendingPrintMessage | PrintStripMessage | AmendFlightPlanMessage

// Type guards for message parsing

export function isServerMessage(data: unknown): data is ServerMessage {
    if (typeof data !== 'object' || data === null || !('type' in data)) {
        return false
    }
    const type = (data as { type: unknown }).type
    return type === 'layout' || type === 'strip' || type === 'stripDelete' ||
           type === 'gap' || type === 'gapDelete' || type === 'section' ||
           type === 'refresh' || type === 'status' || type === 'dclStatus' ||
           type === 'hoppieMessage' || type === 'atisUpdate' || type === 'configList' ||
           type === 'controllers' || type === 'userSettings' || type === 'notify' ||
           type === 'deletedStrips' || type === 'pendingPrintList' || type === 'aupR16' || type === 'rwyFlags'
}

export function isClientMessage(data: unknown): data is ClientMessage {
    if (typeof data !== 'object' || data === null || !('type' in data)) {
        return false
    }
    const type = (data as { type: unknown }).type
    return type === 'request' || type === 'reloadFeeds' || type === 'moveStrip' || type === 'reorderStrips' || type === 'setGap' || type === 'setSectionHeight' || type === 'stripAction' || type === 'stripAssign' || type === 'deleteStrip' || type === 'listDeletedStrips' || type === 'restoreStrip' || type === 'dclAction' || type === 'dclReject' || type === 'dclSend' || type === 'dclSetMode' || type === 'switchConfig' || type === 'createStrip' || type === 'updateNote' || type === 'updateVehicleStrip' || type === 'updateRemarks' || type === 'updateHp' || type === 'updateHs' || type === 'releaseStrip' || type === 'manualTransfer' || type === 'viffRea' || type === 'viffUpdateEobt' || type === 'viffUpdateTobt' || type === 'viffReadyTobt' || type === 'viffToggleReadyStartup' || type === 'setTsac' || type === 'setCtoc' || type === 'setQnhGiven' || type === 'setColumnAirport' || type === 'addActiveAirport' || type === 'removeActiveAirport' || type === 'setColumnCount' || type === 'updateUserSettings' || type === 'setEssaRoles' || type === 'setEsggRoles' || type === 'setRwyFlag' || type === 'listPendingPrint' || type === 'printStrip' || type === 'amendFlightPlan'
}

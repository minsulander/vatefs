// WebSocket API message types

import type {
    AirportAtisInfo,
    DclMode,
    EfsLayout,
    FlightStrip,
    Gap,
    ScribbleStrokePayload,
    Section,
    UiSettings,
    SharedWorkspaceStore,
} from "./types.js"
import type { EssaSepIndicators, EssaSepOverrides } from "./essa-sep-indicators.js"

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
    /** FSP / external print: always play print anim+sound (incl. blank/info strips) */
    playPrintAnim?: boolean
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
    /** VatEFS / VatIRIS scribble + strip sync */
    irisSync: FeedStatusItem
    // Local / parsing
    euroscopeDir: FeedStatusItem
    /** Resolved ESAA sector package (Plugins / TopSky / GRP) */
    esaaPackage: FeedStatusItem
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
    /**
     * CDM.dll plugin version (e.g. "2.31b") detected next to CDM_data_*.txt.
     * Master claim/release requires ≥ 2.31; older builds are indicator-only.
     */
    cdmPluginVersion?: string
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
    /** OTHER bay-profile mode (saab.yml + Layout picker; digital SAAB strip look) */
    saabLayoutsMode?: boolean
    /** Active OTHER (saab.yml) profile id (e.g. 1rwy4); null when not in OTHER mode */
    saabLayoutId?: string | null
    /** Built-in OTHER profiles for the Layout menu */
    saabLayouts?: Array<{ id: string; name: string; bayCount: number }>
    /** Addable RUNWAY headers (active airports / physical strips) for OTHER catalog */
    saabRunwayCatalog?: Array<{ sectionId: string; title: string }>
    /**
     * Per-airport TMA/CTR ownership from ESE OWNER chains (this login first online).
     * Drives OTHER / RTC builtin defaults; does not move strips by itself.
     */
    airportCoverage?: Record<string, { tma: boolean; ctr: boolean }>
    /**
     * RTC: local TWR/AFIS frequency (MHz string, e.g. "118.105") per airport where
     * AFV lists that frequency among our monitored (RX) transceivers.
     */
    airportRxFrequencies?: Record<string, string>
}

export interface DclStatusMessage {
    type: 'dclStatus'
    status: 'available' | 'connected' | 'error' | 'unavailable'
    error?: string
    dclMode?: DclMode
    /**
     * True when the DCL airport callsign (ESSA/ESGG) is already online on Hoppie
     * while we are not connected — another controller likely holds DCL.
     * Omitted / false when connected or unknown.
     */
    airportStationOnline?: boolean
    /** DCL airport ICAO when known (for tooltips). */
    dclAirport?: string
}

/** CDM master for an airport (vIFF GET /airport). position = ATC callsign or null if none. */
export interface CdmMasterStatusMessage {
    type: 'cdmMasterStatus'
    airport: string
    position: string | null
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

/**
 * ESSA SEP/DLV/DEP GAP inputs + auto-resolved display values (roles mode).
 * Clients recompute with local RWY config lock using `scc` + `metar`, then apply `overrides`.
 */
export interface EssaSepIndicatorsMessage extends EssaSepIndicators {
    type: 'essaSepIndicators'
    /** AWOS designators → SCC thirds (01L / 01R / 08) */
    scc: Record<string, [number, number, number]>
    /** Latest ESSA METAR line (for IMC), if any */
    metar: string | null
    /** TWR-managed field overrides (absent = auto) */
    overrides: EssaSepOverrides
}

/**
 * TWR sets/clears SEP/DLV/DEP GAP overrides.
 * Omit a field to leave it unchanged; set `null` to clear that field back to auto.
 */
export interface SetEssaSepIndicatorsMessage {
    type: 'setEssaSepIndicators'
    sep?: string | null
    dlv?: string | null
    depGap?: string | null
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
    /** Config file basename (e.g. "saab.yml") */
    file: string
    /** Display name from the "name" field in YAML (e.g. "OTHER", "ESSA") */
    name: string
}

export interface ConfigListMessage {
    type: 'configList'
    configs: ConfigInfo[]
    activeConfig: string  // file basename of the currently active config
    /** Active OTHER profile when activeConfig is saab.yml */
    saabLayoutId?: string
    saabLayouts?: Array<{ id: string; name: string; bayCount: number }>
}

export interface ControllerInfo {
    callsign: string
    frequency: string  // Formatted frequency e.g. "118.505"
    /** EuroScope position / SI (e.g. OS, TW, RTM) */
    positionId?: string
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
    /** True when ESAA/Plugins/TopSkyCPDLChoppieCode.txt contains a valid code. */
    hoppieFileCodePresent?: boolean
}

/** Install-shared workspace Catalog (named layouts + role defaults). */
export interface WorkspaceStoreMessage {
    type: 'workspaceStore'
    store: SharedWorkspaceStore
}

/** Transient UI toast (e.g. ROF send failure) */
export interface NotifyMessage {
    type: 'notify'
    level: 'error' | 'info'
    text: string
}

/** Plugin confirmed contactme / CDM (VDGS) PM send — or focus failure */
export interface PmResultMessage {
    type: 'pmResult'
    kind: 'contactme' | 'cdmPm'
    callsign: string
    ok: boolean
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
    /** Plain-text why the strip was removed */
    reason?: string
    /** Delete rule id or synthetic cause code (debug) */
    ruleId?: string
    /** Rule / cause name for debug */
    ruleName?: string
    /** True when EuroScope sent flightPlanDisconnect */
    pilotDisconnected?: boolean
    /** Disconnect / data-loss extras (pilot FP disconnect, FP data lost, radar range) */
    disconnectKind?: 'pilot' | 'flight_plan' | 'radar'
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

/** Full scribble state for one strip (local multi-client + remote sync) */
export interface ScribbleUpdateMessage {
    type: 'scribbleUpdate'
    stripId: string
    strokes: ScribbleStrokePayload[]
    /** Remote updatedAt when applied from sync server */
    updatedAt?: string
}

/** Ask UI to open CID dialog (.efs cid or missing CID when enabling sync) */
export interface OpenCidDialogMessage {
    type: 'openCidDialog'
    suggestedCid?: string
    reason?: 'missing' | 'command'
}

/** Suggested CID from ES*.prf (for dialog prefill) */
export interface CidSuggestMessage {
    type: 'cidSuggest'
    suggestedCid?: string
}

/** Sync auth failed — ask controller to sign in to VatIRIS once */
export interface OpenVatIrisSignInMessage {
    type: 'openVatIrisSignIn'
    /** Optional detail (e.g. allowlist / network error) */
    detail?: string
}

/** One stand row in the ESSA stand menu (fixed apron slot; status is style only). */
export interface StandMenuStand {
    name: string
    /** preferred = airline+Schengen highlight; allowed = fits; notAllowed = size/type fail (still selectable) */
    fit: 'preferred' | 'allowed' | 'notAllowed'
    /** Why fit is notAllowed (wingspan/type/use/…); for tooltip. */
    reason?: string
    /**
     * label = callsign; occupied = on stand, assigned = planned, blocked = GRP BLOCKS/LIMITS.
     * blockFrom / relatedStand: for blocked only — related stand occupied (red) vs assigned (amber).
     * airborne: for planned / planned-blocked — softer shade when the aircraft is still airborne.
     * departure: for occupied — ESSA departure on stand (takeoff icon) vs arrival (parking).
     * tsat/tobt/eobt: departure times on Occupied (or hard-Blocked from occupied);
     * UI labels TS / TB / EB (prefer TS → TB → EB). Not set for Planned/Inbound.
     * gsLabel: STUP/PUSH/TAXI when cleared but still on stand (replaces TS/TB/EB).
     */
    occupied?: {
        label: string
        kind: 'occupied' | 'assigned' | 'blocked'
        blockFrom?: 'occupied' | 'assigned'
        relatedStand?: string
        airborne?: boolean
        departure?: boolean
        tsat?: string
        tobt?: string
        eobt?: string
        gsLabel?: string
    }
    /**
     * APNH/APNJ/APNL/APNP only: count of aircraft on/assigned to the area (info text;
     * not occupied/planned styling).
     */
    assignedCount?: number
    area: boolean
    /** Always true today (AREA and notAllowed stay selectable; style-only). */
    selectable: boolean
}

export interface StandMenuApron {
    title: string
    stands: StandMenuStand[]
}

/** Reply to requestStandMenu — apron-grouped ESSA stands */
export interface StandMenuMessage {
    type: 'standMenu'
    stripId: string
    currentStand?: string
    aprons: StandMenuApron[]
}

export type ServerMessage = LayoutMessage | StripMessage | StripDeleteMessage | GapMessage | GapDeleteMessage | SectionMessage | RefreshMessage | StatusMessage | DclStatusMessage | CdmMasterStatusMessage | HoppieMessage | AtisUpdateMessage | EssaSepIndicatorsMessage | ConfigListMessage | ControllersMessage | UserSettingsMessage | WorkspaceStoreMessage | NotifyMessage | PmResultMessage | DeletedStripsMessage | PendingPrintListMessage | AupR16Message | RwyFlagsMessage | ScribbleUpdateMessage | OpenCidDialogMessage | CidSuggestMessage | OpenVatIrisSignInMessage | HandoverAssistantResultMessage | StandMenuMessage

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

/** Sync YAML/server insert end with workspace sort-flow (newestTop → addFromTop). */
export interface SetSectionAddFromTopMessage {
    type: 'setSectionAddFromTop'
    bayId: string
    sectionId: string
    addFromTop: boolean
}

export interface StripActionMessage {
    type: 'stripAction'
    stripId: string
    action: string             // e.g., "ASSUME", "CTL", "CTO"
    /** For toggleClearanceFlag: explicit set (ACK CLR → true). Avoids toggle races. */
    desired?: boolean
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

/** Claim or release ESSA CDM master via vIFF setMaster / removeMaster. */
export interface CdmMasterToggleMessage {
    type: 'cdmMasterToggle'
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
    file: string  // Config file basename (e.g. "saab.yml")
}

/** Switch OTHER bay profile within saab.yml (does not change activeConfig file). */
export interface SwitchSaabLayoutMessage {
    type: 'switchSaabLayout'
    layoutId: string
}

/** Add a section to the live OTHER server layout (catalog drop / click). */
export interface SaabEnsureSectionMessage {
    type: 'saabEnsureSection'
    sectionId: string
    title: string
    /** Target bay (default: bay with runway / first bay) */
    bayId?: string
    /** Insert before this section id within the bay */
    beforeSectionId?: string
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

/** Toggle Departure Coordination — strip annotation 6 ("DepC"; legacy "EST") */
export interface SetCooMessage {
    type: 'setCoo'
    stripId: string
    coo: boolean
}

/**
 * Request EuroScope COPX/XFL exit coordination to the next/ACC controller.
 * Does NOT set clearance flag, DepC annotation, or DEP state.
 */
export interface InitiateXflCoordinationMessage {
    type: 'initiateXflCoordination'
    stripId: string
    /** Proposed exit level in feet (0 = point-only if supported) */
    altitudeFeet?: number
    /** COPX / TMA exit; plugin falls back to ES exit coordination point */
    point?: string
    /** Optional target controller callsign; plugin falls back to coordinated next / online CTR */
    targetController?: string
}

/** Accept ACC exit-coordination counter-proposal */
export interface AcceptCoordinationMessage {
    type: 'acceptCoordination'
    stripId: string
}

/** Reject ACC exit-coordination counter-proposal */
export interface RefuseCoordinationMessage {
    type: 'refuseCoordination'
    stripId: string
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

/** Bulk transfer of assumed strips via Handover Assistant */
export interface HandoverAssistantTransferMessage {
    type: 'handoverAssistantTransfer'
    targetCallsign: string
    /** Strip ids to transfer; if omitted, backend uses all strips assumed by me */
    stripIds?: string[]
}

export interface HandoverAssistantFailure {
    callsign: string
    reason: string
}

/** Result of a Handover Assistant bulk transfer (partial success OK) */
export interface HandoverAssistantResultMessage {
    type: 'handoverAssistantResult'
    targetCallsign: string
    transferred: string[]
    failed: HandoverAssistantFailure[]
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

/** Set Actual Time of Departure (UTC HHmm) — EFS-only; empty clears */
export interface SetAtdMessage {
    type: 'setAtd'
    stripId: string
    /** HHmm to store, or empty to clear */
    atd: string
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

/** Sideways offset — paper klack / SAAB cock. Null clears. Synced via EFS strip sync. */
export interface SetKlackMessage {
    type: 'setKlack'
    stripId: string
    /** `left` / `right`, or null to reset */
    klack: 'left' | 'right' | null
}

/** @deprecated SAAB highlight replaced by cock (`setKlack`). Kept for older clients. */
export interface SetHighlightMessage {
    type: 'setHighlight'
    stripId: string
    highlight: 'local' | 'global' | null
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

/** Replace install-shared workspace Catalog (layouts + userDefaults + defaultSortFlow). */
export interface UpdateWorkspaceStoreMessage {
    type: 'updateWorkspaceStore'
    store: SharedWorkspaceStore
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

/** Replace local scribble strokes for a strip (fans out to other clients) */
export interface ScribbleSetMessage {
    type: 'scribbleSet'
    stripId: string
    strokes: ScribbleStrokePayload[]
}

/** Push current strokes for strip to remote sync server (zoom close) */
export interface ScribbleSyncPushMessage {
    type: 'scribbleSyncPush'
    stripId: string
}

/** Request CID dialog / persist CID from UI */
export interface SetVatsimCidMessage {
    type: 'setVatsimCid'
    cid: string
}

export interface RequestCidSuggestMessage {
    type: 'requestCidSuggest'
}

/** Request ESSA stand menu classification for an arrival strip */
export interface RequestStandMenuMessage {
    type: 'requestStandMenu'
    stripId: string
}

/**
 * Publish / assign / clear Ground Radar stand via GRP/S scratch broadcast.
 * - assign: set stand (also used when picking from the menu)
 * - publish: re-broadcast current stand (no-op if none)
 * - clear: GRP/S/
 */
export interface GrpStandMessage {
    type: 'grpStand'
    stripId: string
    /** Stand designator; omit/empty with action clear, or for assign/publish of current */
    stand?: string
    action: 'assign' | 'publish' | 'clear'
}

export type ClientMessage = RequestMessage | ReloadFeedsMessage | MoveStripMessage | ReorderStripsMessage | SetGapMessage | SetSectionHeightMessage | SetSectionAddFromTopMessage | StripActionMessage | StripAssignMessage | DeleteStripMessage | ListDeletedStripsMessage | RestoreStripMessage | DclActionMessage | CdmMasterToggleMessage | DclRejectMessage | DclSendMessage | DclSetModeMessage | SwitchConfigMessage | SwitchSaabLayoutMessage | SaabEnsureSectionMessage | CreateStripMessage | UpdateNoteMessage | UpdateVehicleStripMessage | UpdateRemarksMessage | UpdateHpMessage | UpdateHsMessage | SetCooMessage | InitiateXflCoordinationMessage | AcceptCoordinationMessage | RefuseCoordinationMessage | ReleaseStripMessage | ManualTransferMessage | HandoverAssistantTransferMessage | ViffReaMessage | ViffUpdateEobtMessage | ViffUpdateTobtMessage | ViffReadyTobtMessage | ViffToggleReadyStartupMessage | SetTsacMessage | SetCtocMessage | SetAtdMessage | SetQnhGivenMessage | SetKlackMessage | SetHighlightMessage | SetColumnAirportMessage | AddActiveAirportMessage | RemoveActiveAirportMessage | SetColumnCountMessage | UpdateUserSettingsMessage | UpdateWorkspaceStoreMessage | SetEssaRolesMessage | SetEsggRolesMessage | SetRwyFlagMessage | SetEssaSepIndicatorsMessage | ListPendingPrintMessage | PrintStripMessage | AmendFlightPlanMessage | ScribbleSetMessage | ScribbleSyncPushMessage | SetVatsimCidMessage | RequestCidSuggestMessage | RequestStandMenuMessage | GrpStandMessage

// Type guards for message parsing

export function isServerMessage(data: unknown): data is ServerMessage {
    if (typeof data !== 'object' || data === null || !('type' in data)) {
        return false
    }
    const type = (data as { type: unknown }).type
    return type === 'layout' || type === 'strip' || type === 'stripDelete' ||
           type === 'gap' || type === 'gapDelete' || type === 'section' ||
           type === 'refresh' || type === 'status' || type === 'dclStatus' || type === 'cdmMasterStatus' ||
           type === 'hoppieMessage' || type === 'atisUpdate' || type === 'essaSepIndicators' || type === 'configList' ||
           type === 'controllers' || type === 'userSettings' || type === 'workspaceStore' || type === 'notify' || type === 'pmResult' ||
           type === 'deletedStrips' || type === 'pendingPrintList' || type === 'aupR16' || type === 'rwyFlags' ||
           type === 'scribbleUpdate' || type === 'openCidDialog' || type === 'cidSuggest' ||
           type === 'openVatIrisSignIn' || type === 'handoverAssistantResult' ||
           type === 'standMenu'
}

export function isClientMessage(data: unknown): data is ClientMessage {
    if (typeof data !== 'object' || data === null || !('type' in data)) {
        return false
    }
    const type = (data as { type: unknown }).type
    return type === 'request' || type === 'reloadFeeds' || type === 'moveStrip' || type === 'reorderStrips' || type === 'setGap' || type === 'setSectionHeight' || type === 'setSectionAddFromTop' || type === 'stripAction' || type === 'stripAssign' || type === 'deleteStrip' || type === 'listDeletedStrips' || type === 'restoreStrip' || type === 'dclAction' || type === 'cdmMasterToggle' || type === 'dclReject' || type === 'dclSend' || type === 'dclSetMode' || type === 'switchConfig' || type === 'switchSaabLayout' || type === 'saabEnsureSection' || type === 'createStrip' || type === 'updateNote' || type === 'updateVehicleStrip' || type === 'updateRemarks' || type === 'updateHp' || type === 'updateHs' || type === 'setCoo' || type === 'initiateXflCoordination' || type === 'acceptCoordination' || type === 'refuseCoordination' || type === 'releaseStrip' || type === 'manualTransfer' || type === 'handoverAssistantTransfer' || type === 'viffRea' || type === 'viffUpdateEobt' || type === 'viffUpdateTobt' || type === 'viffReadyTobt' || type === 'viffToggleReadyStartup' || type === 'setTsac' || type === 'setCtoc' || type === 'setAtd' || type === 'setQnhGiven' || type === 'setKlack' || type === 'setHighlight' || type === 'setColumnAirport' || type === 'addActiveAirport' || type === 'removeActiveAirport' || type === 'setColumnCount' || type === 'updateUserSettings' || type === 'updateWorkspaceStore' || type === 'setEssaRoles' || type === 'setEsggRoles' || type === 'setRwyFlag' || type === 'setEssaSepIndicators' || type === 'listPendingPrint' || type === 'printStrip' || type === 'amendFlightPlan' || type === 'scribbleSet' || type === 'scribbleSyncPush' || type === 'setVatsimCid' || type === 'requestCidSuggest' || type === 'requestStandMenu' || type === 'grpStand'
}

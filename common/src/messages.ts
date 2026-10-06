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

export interface StatusMessage {
    type: 'status'
    callsign: string      // Controller callsign (e.g., 'ESGG_TWR')
    airports: string[]    // Configured / active airports (e.g., ['ESGG', 'ESGT'])
    role?: string         // Controller role (e.g., 'DEL', 'GND', 'TWR')
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
}

export type ServerMessage = LayoutMessage | StripMessage | StripDeleteMessage | GapMessage | GapDeleteMessage | SectionMessage | RefreshMessage | StatusMessage | DclStatusMessage | HoppieMessage | AtisUpdateMessage | ConfigListMessage | ControllersMessage | UserSettingsMessage

// Client -> Server messages

export interface RequestMessage {
    type: 'request'
    request: 'layout' | 'strips' | 'refresh'
}

export interface MoveStripMessage {
    type: 'moveStrip'
    stripId: string
    targetBayId: string
    targetSectionId: string
    position?: number
    isBottom: boolean
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

export type AssignmentType = 'assignDepartureRunway' | 'assignSid' | 'assignHeading' | 'assignCfl'

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
    stripType: 'vfrDep' | 'vfrArr' | 'cross' | 'note'
    callsign?: string           // For VFR DEP/ARR/CROSS
    aircraftType?: string       // For VFR DEP/ARR
    airport?: string            // Airport for VFR origin/dest, CROSS/NOTE column placement
    targetBayId?: string        // If dragged to a specific section
    targetSectionId?: string
    position?: number
    isBottom?: boolean
}

export interface UpdateNoteMessage {
    type: 'updateNote'
    stripId: string
    text: string
}

export interface UpdateRemarksMessage {
    type: 'updateRemarks'
    stripId: string
    text: string
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

/** Set TOBT=now then REA (sequential on server) */
export interface ViffReadyTobtMessage {
    type: 'viffReadyTobt'
    stripId: string
}

/** Toggle Ready Startup: ASRT + REA (CDM TAG_FUNC_TOGGLEASRTREA) */
export interface ViffToggleReadyStartupMessage {
    type: 'viffToggleReadyStartup'
    stripId: string
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

export type ClientMessage = RequestMessage | MoveStripMessage | SetGapMessage | SetSectionHeightMessage | StripActionMessage | StripAssignMessage | DeleteStripMessage | DclActionMessage | DclRejectMessage | DclSendMessage | DclSetModeMessage | SwitchConfigMessage | CreateStripMessage | UpdateNoteMessage | UpdateRemarksMessage | ReleaseStripMessage | ManualTransferMessage | ViffReaMessage | ViffUpdateEobtMessage | ViffUpdateTobtMessage | ViffReadyTobtMessage | ViffToggleReadyStartupMessage | SetColumnAirportMessage | AddActiveAirportMessage | RemoveActiveAirportMessage | SetColumnCountMessage | UpdateUserSettingsMessage

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
           type === 'controllers' || type === 'userSettings'
}

export function isClientMessage(data: unknown): data is ClientMessage {
    if (typeof data !== 'object' || data === null || !('type' in data)) {
        return false
    }
    const type = (data as { type: unknown }).type
    return type === 'request' || type === 'moveStrip' || type === 'setGap' || type === 'setSectionHeight' || type === 'stripAction' || type === 'stripAssign' || type === 'deleteStrip' || type === 'dclAction' || type === 'dclReject' || type === 'dclSend' || type === 'dclSetMode' || type === 'switchConfig' || type === 'createStrip' || type === 'updateNote' || type === 'updateRemarks' || type === 'releaseStrip' || type === 'manualTransfer' || type === 'viffRea' || type === 'viffUpdateEobt' || type === 'viffUpdateTobt' || type === 'viffReadyTobt' || type === 'viffToggleReadyStartup' || type === 'setColumnAirport' || type === 'addActiveAirport' || type === 'removeActiveAirport' || type === 'setColumnCount' || type === 'updateUserSettings'
}

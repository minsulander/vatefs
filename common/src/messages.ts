// WebSocket API message types

import type { EfsLayout, FlightStrip, Gap, Section } from "./types.js"

// Server -> Client messages

export interface LayoutMessage {
    type: 'layout'
    layout: EfsLayout
}

export interface StripMessage {
    type: 'strip'
    strip: FlightStrip
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
    airports: string[]    // Configured airports (e.g., ['ESGG', 'ESGT'])
}

export type ServerMessage = LayoutMessage | StripMessage | StripDeleteMessage | GapMessage | GapDeleteMessage | SectionMessage | RefreshMessage | StatusMessage

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

export type ClientMessage = RequestMessage | MoveStripMessage | SetGapMessage | SetSectionHeightMessage | StripActionMessage | StripAssignMessage | DeleteStripMessage

// Type guards for message parsing

export function isServerMessage(data: unknown): data is ServerMessage {
    if (typeof data !== 'object' || data === null || !('type' in data)) {
        return false
    }
    const type = (data as { type: unknown }).type
    return type === 'layout' || type === 'strip' || type === 'stripDelete' ||
           type === 'gap' || type === 'gapDelete' || type === 'section' ||
           type === 'refresh' || type === 'status'
}

export function isClientMessage(data: unknown): data is ClientMessage {
    if (typeof data !== 'object' || data === null || !('type' in data)) {
        return false
    }
    const type = (data as { type: unknown }).type
    return type === 'request' || type === 'moveStrip' || type === 'setGap' || type === 'setSectionHeight' || type === 'stripAction' || type === 'stripAssign' || type === 'deleteStrip'
}

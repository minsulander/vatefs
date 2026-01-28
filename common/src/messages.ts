// WebSocket API message types

import type { EfsConfig, FlightStrip } from "./types.js"

// Server -> Client messages

export interface ConfigMessage {
    type: 'config'
    config: EfsConfig
}

export interface StripMessage {
    type: 'strip'
    strip: FlightStrip
}

export type ServerMessage = ConfigMessage | StripMessage

// Client -> Server messages

export interface RequestMessage {
    type: 'request'
    request: 'config' | 'strips'
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

export type ClientMessage = RequestMessage | MoveStripMessage | SetGapMessage | SetSectionHeightMessage

// Type guards for message parsing

export function isServerMessage(data: unknown): data is ServerMessage {
    return typeof data === 'object' && data !== null && 'type' in data &&
        (data.type === 'config' || data.type === 'strip')
}

export function isClientMessage(data: unknown): data is ClientMessage {
    if (typeof data !== 'object' || data === null || !('type' in data)) {
        return false
    }
    const type = (data as { type: unknown }).type
    return type === 'request' || type === 'moveStrip' || type === 'setGap' || type === 'setSectionHeight'
}

// WebSocket API message types

import type { EfsConfig, FlightStrip } from "./types.js"

// Server -> Client messages

export interface ConfigMessage {
    type: 'config'
    config: EfsConfig
}

export interface FlightMessage {
    type: 'flight'
    flight: FlightStrip
}

export type ServerMessage = ConfigMessage | FlightMessage

// Client -> Server messages

export interface RequestMessage {
    type: 'request'
    request: 'config' | 'flights'
}

export type ClientMessage = RequestMessage

// Type guards for message parsing

export function isServerMessage(data: unknown): data is ServerMessage {
    return typeof data === 'object' && data !== null && 'type' in data &&
        (data.type === 'config' || data.type === 'flight')
}

export function isClientMessage(data: unknown): data is ClientMessage {
    return typeof data === 'object' && data !== null && 'type' in data &&
        data.type === 'request'
}

export { default as constants } from "./constants.js"

// Types
export type {
    StripType,
    FlightRules,
    WakeCategory,
    FlightStrip,
    Section,
    Bay,
    EfsConfig,
    Gap
} from "./types.js"

// WebSocket API messages
export type {
    ConfigMessage,
    StripMessage,
    StripDeleteMessage,
    GapMessage,
    GapDeleteMessage,
    SectionMessage,
    ServerMessage,
    RequestMessage,
    MoveStripMessage,
    SetGapMessage,
    SetSectionHeightMessage,
    StripActionMessage,
    ClientMessage
} from "./messages.js"

export { isServerMessage, isClientMessage } from "./messages.js"

// Gap utilities (shared between frontend and backend)
export { GAP_BUFFER, gapKey, parseGapKey, calculateGapAdjustments } from "./gap-utils.js"

export { default as constants } from "./constants.js"

// Types
export type {
    StripType,
    FlightRules,
    WakeCategory,
    FlightStrip,
    Section,
    Bay,
    EfsLayout,
    Gap,
    DclMode,
    UiSettings,
    AutoLopSsrMode,
    StripPrintSound,
    StripPrintMode,
    StripLook,
    PaperInfoKind,
    AirportAtisInfo,
    ScribbleStrokePayload,
} from "./types.js"

export { DEFAULT_UI_SETTINGS, PAPER_INFO_KINDS, isPaperInfoKind, isAutoLopSsrMode } from "./types.js"

export {
    ESSA_RWY_COMBINATIONS,
    ESSA_QUICKREF_KEYS,
    ESSA_PHYSICAL_RWY_PAIRS,
    VATIRIS_QUICKREF_BASE,
    resolveEssaRwyConfigId,
    type ResolveEssaRwyConfigOptions,
    formatEssaRwyConfigLabel,
    formatEssaRwyPdfName,
    formatEssaArrDisplay,
    findMatchingEssaRwyConfigs,
    getEssaRwyCombination,
    isEssaRwyDayHours,
    normalizeEssaRwy,
    essaRwyQuickrefImageId,
    essaRwyQuickrefImageUrl,
    essaPhysicalPairForRunway,
    essaRunwaySectionId,
    formatEssaRunwaySectionTitle,
    isEssaDynamicRunwaySectionId,
} from "./essa-rwy-config.js"
export type { EssaRwyCombination, EssaPhysicalRwyPair } from "./essa-rwy-config.js"

export {
    isRunwayOrderSectionId,
    runwayLuRank,
    compareRunwayLuOrder,
    sortRunwayLuOrder,
} from "./runway-strip-order.js"
export type { RunwayOrderStrip } from "./runway-strip-order.js"

export {
    DEFAULT_TRANSITION_ALTITUDE_FT,
    parseAltitudeToFeet,
    parseManualCfl,
    formatStripAltitude,
    formatEfsLevel,
    formatCflMenuLabel,
    buildCflMenuOptions,
    isAltitudeAtOrBelowTa,
    isApproachClearanceLabel,
} from "./altitude-format.js"

export {
    FAA_TO_ICAO,
    faaToIcaoEquip,
    formatFaaEquipDisplay,
    isFaaEquipLetter,
} from "./faa-equipment.js"

export {
    formatSidForDisplay,
    formatTrackSidDisplay,
    formatVectorSidDisplay,
    parseVectorSidName,
    parseTrackSid,
    normalizeSidName,
    sidsMatch,
    hasForcedSidInRoute,
    isTrackSidName,
    isVectorSidName,
    isIfrSidEligible,
    resolveDisplayFlightRules,
    hasSlowRemark,
    withSlowRemark,
    hasVectRemark,
    withVectRemark,
    formatAhdVectorSidDisplay,
    extractTmaExitPoint,
    extractSignificantRouteFixes,
} from "./sid-format.js"

export {
    parseRflToFeet,
    isLopFprDepAirport,
    hasExplicitDepRunway,
    fprDepDisplayFix,
    sidFieldLabel,
    resolveLopAutoDirect,
    resolveLopSuggestDirects,
    resolveLopDirectHighlights,
} from "./auto-direct.js"
export type { LopDirectMode, LopDirectSuggestion, LopDirectInput } from "./auto-direct.js"

export { parsePobFromRemarks, withPobInRemarks } from "./fpl-remarks.js"

export {
    requiresAccCoordination,
    requiresSsrCoordination,
    resolveEssaHeavyPreferredDepRwy,
    ESMS_AUTO_COORD_INIT_XFL_FT,
    ESMS_AUTO_COORD_REPLY_XFL_FT,
    ESMS_AUTO_COORD_EXITS,
    normalizeEsmsAutoCoordRwy,
    isEsmsAutoCoordSid,
    isEsmsAutoCoordReplyAltitude,
} from "./airport-rules.js"
export type { SsrCoordinationOpts, EssaHeavyPreferredDepRwyInput } from "./airport-rules.js"

export {
    normalizeAircraftTypeDesignator,
    isHeavyAsLeaderAircraftType,
    isThickAtypBorderAircraftType,
} from "./wake-highlight.js"

// WebSocket API messages
export type {
    LayoutMessage,
    StripMessage,
    StripDeleteMessage,
    GapMessage,
    GapDeleteMessage,
    SectionMessage,
    RefreshMessage,
    StatusMessage,
    FeedStatusItem,
    FeedsStatus,
    DclStatusMessage,
    HoppieMessage,
    AtisUpdateMessage,
    AupR16Status,
    AupR16Message,
    RwyFlagsMessage,
    ControllerInfo,
    ControllersMessage,
    UserSettingsMessage,
    NotifyMessage,
    ServerMessage,
    RequestMessage,
    ReloadFeedsMessage,
    MoveStripMessage,
    ReorderStripsMessage,
    SetGapMessage,
    SetSectionHeightMessage,
    StripActionMessage,
    AssignmentType,
    StripAssignMessage,
    DeleteStripMessage,
    ListDeletedStripsMessage,
    RestoreStripMessage,
    DeletedStripInfo,
    PendingPrintFlightInfo,
    DeletedStripsMessage,
    DclActionMessage,
    DclRejectMessage,
    DclSendMessage,
    DclSetModeMessage,
    SwitchConfigMessage,
    CreateStripMessage,
    UpdateNoteMessage,
    UpdateVehicleStripMessage,
    ReleaseStripMessage,
    ManualTransferMessage,
    ViffReaMessage,
    ViffUpdateEobtMessage,
    SetColumnAirportMessage,
    AddActiveAirportMessage,
    RemoveActiveAirportMessage,
    SetColumnCountMessage,
    UpdateUserSettingsMessage,
    SetEssaRolesMessage,
    SetEsggRolesMessage,
    SetRwyFlagMessage,
    ConfigInfo,
    ConfigListMessage,
    ScribbleUpdateMessage,
    OpenCidDialogMessage,
    CidSuggestMessage,
    OpenVatIrisSignInMessage,
    ScribbleSetMessage,
    ScribbleSyncPushMessage,
    SetVatsimCidMessage,
    RequestCidSuggestMessage,
    InitiateXflCoordinationMessage,
    AcceptCoordinationMessage,
    RefuseCoordinationMessage,
    ClientMessage
} from "./messages.js"

export { isServerMessage, isClientMessage } from "./messages.js"

// Gap utilities (shared between frontend and backend)
export { GAP_BUFFER, gapKey, parseGapKey, calculateGapAdjustments } from "./gap-utils.js"

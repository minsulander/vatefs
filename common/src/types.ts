// Flight strip types

export type StripType = 'departure' | 'arrival' | 'local' | 'vfr' | 'cross' | 'note' | 'vehicle'
export type FlightRules = 'I' | 'V' | 'Y' | 'Z' // IFR, VFR, IFR->VFR, VFR->IFR
export type WakeCategory = 'L' | 'M' | 'H' | 'J' // Light, Medium, Heavy, Super

export interface FlightStrip {
    id: string
    callsign: string
    /** Radiotelephony designator from ICAO_Airlines.txt (e.g. "SCANDINAVIAN") */
    rtfCallsign?: string

    // Aircraft info
    aircraftType: string        // e.g., "A320", "B738"
    wakeTurbulence?: WakeCategory
    flightRules: FlightRules
    /**
     * Non-voice EuroScope communication suffix shown after callsign ("/t" or "/r").
     * Voice (/v) is omitted — same as EuroScope tags.
     */
    communicationSuffix?: string

    // Route info
    adep: string               // Departure aerodrome (ICAO)
    ades: string               // Destination aerodrome (ICAO)
    /** Full airport name for adep (tooltip) */
    adepName?: string
    /** Full airport name for ades (tooltip) */
    adesName?: string
    route?: string             // Flight planned route
    /**
     * EuroScope extracted (airway-expanded) route points, space-joined.
     * Prefer for FPR/DCT menus when present.
     */
    extractedRoute?: string
    sid?: string               // Standard Instrument Departure
    /**
     * TMA exit fix — first significant FPL route point (excludes ADEP/rwy, SID/rwy).
     * Independent of SID procedure name (e.g. ROKNI4R/08 ARS … → ARS).
     */
    tmaExit?: string
    star?: string              // Standard Terminal Arrival Route
    rfl?: string               // Requested Flight Level e.g., "FL340", "A050"
    /** EuroScope exit coordination altitude / XFL e.g. "A050", "FL90" */
    xfl?: string

    // Assigned data (from controller)
    squawk?: string            // Assigned transponder code
    clearedAltitude?: string   // Cleared altitude/FL
    assignedHeading?: string   // Assigned heading
    assignedSpeed?: string     // Assigned speed
    /**
     * Filed cruise TAS from FPL (ICAO group), e.g. "N0448", "M078".
     * Paper DEP strips show this between C/S and FRUL/ATYP; ARR omits it.
     */
    tas?: string

    // Times
    eobt?: string              // Estimated Off Block Time (HHmm)
    eta?: string               // Estimated Time of Arrival (HHmm)
    /** Actual Time of Departure (HHmm) — shown in dep triangle after airborne */
    atd?: string
    /** Actual Time of Arrival (HHmm) — shown in arr triangle after landing */
    ata?: string

    // vIFF / CDM (departing IFR)
    tobt?: string              // Target Off Block Time (HHmm) — CDM airports (ESSA)
    tsat?: string              // Target Startup Approval Time (HHmm) — CDM airports (ESSA)
    ttot?: string              // Target Take Off Time (HHmm) — CDM airports (ESSA)
    tobtSetBy?: 'P' | 'A'      // Who set TOBT: Pilot or ATC (blank if TOBT==EOBT)
    /** Actual Start-up Request Time (HHmm) — CDM annotation ASRT / Ready Startup */
    asrt?: string
    /** TSAT communicated to pilot (HHmm) — CDM annotation TSAC */
    tsac?: string
    /** CTOT communicated to pilot (HHmm) — CDM annotation CTOC */
    ctoc?: string
    /** QNH (hPa) last given to the pilot — highlight top ▲ when ATIS QNH differs */
    qnhGiven?: number
    /** ATIS letter stamped with QNH (paper FPS col 6) */
    atisGiven?: string
    /**
     * TopSky WEATHER manual alert (WX_) acknowledged / on for this strip.
     * Survives scratch clear (TopSky often consumes WX_; DEP airborne clears scratch but keeps this).
     */
    weatherGiven?: boolean
    ctot?: string              // Calculated Take Off Time (HHmm) when regulated
    /** CTOT was cancelled (network SLC) — show SCL in the CTOT slot */
    ctotCancelled?: boolean
    cdmSts?: string            // Network status e.g. 'REA', 'FLS-CDM'/'CDM-FLS', 'FLS-NRA', 'COMPLY', 'AIRB'
    ctotReason?: string        // mostPenalisingRegulation (optional tooltip)

    // Additional info
    stand?: string             // Parking stand/gate
    runway?: string            // Assigned runway
    remarks?: string           // Controller remarks/annotations (scratchpad .TEXT)
    /** Holding point — scratchpad /TEXT */
    hp?: string
    /** Hold short — VCH strip annotation 4 (H/S), max 5 chars */
    hs?: string
    /** Departure Coordination — strip annotation 6 ("DepC" / empty; legacy "EST") */
    coo?: boolean
    /**
     * ACC sent a coordination proposal (REQUESTED_BY_OTHER on exit COPX/XFL
     * or entry COPN/PEL). Plugin maps both onto this field.
     * RTC DEP: pink XFL / pink C on coo cell; RTC ARR: pink C on PEL.
     */
    exitCoordPending?: boolean
    /**
     * We initiated exit coordination and are waiting (REQUESTED_BY_ME).
     * RTC: pink XFL on outbound Departure Coordination / XFL request.
     */
    exitCoordOutbound?: boolean
    /**
     * ACC refused our outbound XFL / Departure Coordination.
     * RTC: amber XFL until DepC set or a later coord is accepted.
     */
    exitCoordRefused?: boolean
    /** Proposed COPX / DCT point from pending exit coordination */
    exitCoordPoint?: string
    /** Proposed XFL (feet) from pending exit coordination */
    exitCoordAltitude?: number
    /**
     * Persons on board from FPL remarks `P/XXX` (always 3 digits when set).
     * Synced via amendFlightPlan → EuroScope item 18.
     */
    pob?: string

    // Strip metadata
    stripType: StripType
    bayId: string
    sectionId: string
    position: number
    bottom: boolean            // Whether strip is in bottom zone (pinned)

    // Actions (if any) - shown as button(s)
    actions?: string[]         // e.g., ["ASSUME"], ["LU", "CTO"]

    // Interactive flags
    canResetSquawk?: boolean     // Whether the squawk reset button is available
    canEditClearance?: boolean   // Whether the clearance dialog OK button is enabled

    // Clearance dialog data
    direct?: string              // Direct-to waypoint (for AHDG display in dialog)
    clearance?: boolean          // Clearance flag (for dialog OK/Cancel behavior / ES CLR)
    /** Paper strip col 4: clearance has been read. Auto-set when readback or ES CLR. */
    clearanceRead?: boolean
    /** Paper strip col 5: CLR correct — toggles EuroScope CLR flag. */
    clearanceReadback?: boolean

    // DCL (Data-Link Clearance) state
    dclStatus?: 'REQUEST' | 'INVALID' | 'SENT' | 'WILCO' | 'UNABLE' | 'REJECTED' | 'DONE'
    dclMessage?: string           // Original pilot request text
    dclClearance?: string         // Filled-out clearance template for preview
    /**
     * Paper CLR-read: DCL text was dismissed. Hides the DCL mark and the left
     * check until the next explicit read click. Synced to other EFS clients.
     */
    paperClrReadSuppressed?: boolean
    /** Paper: DCL word dismissed and must not return on the next read click. */
    dclDismissed?: boolean
    /** Peer sync: show DCL in the paper CLR-read box when this client has no Hoppie status. */
    syncedDclMark?: boolean

    // Transfer frequency (shown on XFER button when handoff target matches next controller)
    xferFrequency?: string
    /** XFER target SI (ESSA sequence / ESGG APP-E|W) — not shown as strip ownership SI */
    nextSi?: string
    /** XFER target callsign (ESSA sequence / ESGG APP-E|W) */
    nextSiCallsign?: string

    // TopSky ROF (request on frequency): inbound LAM requester, or ourselves while outbound pink
    rofRequestSi?: string
    rofRequestCallsign?: string
    rofRequestFrequency?: string
    /** Epoch ms; inbound SI/XFER alternate, or outbound pink ROF key, until this time */
    rofFlashUntil?: number

    // Slow aircraft indicator (light WTC or specific medium turboprops)
    isSlow?: boolean

    /**
     * ESSA Appendix A preferred APP/DEP sector for this departure (from SID prefs / route).
     * SID black box when DEP-E or ARR-E.
     */
    appDepNextSector?: 'DEP-W' | 'DEP-E' | 'ARR-W' | 'ARR-E'

    // Actions that should be highlighted (yellow) to prompt controller action
    highlightActions?: string[]

    // Status indicators
    clearedForTakeoff?: boolean  // Show green upward triangle (departure rolling)
    clearedToLand?: boolean      // Show green downward triangle (arrival cleared to land)
    missedApproach?: boolean     // Aircraft on missed approach (hides GOA button)
    /** Explicit airborne state from radar (false = on ground after detection) */
    airborne?: boolean

    // Special strip fields
    noteText?: string            // Text content for note strips
    /**
     * Stable key for cross-controller scribble sync (usually same as id for flights;
     * note:/veh:/vfrdep:/vfrarr:/cross: UUID ids for specials with no callsign).
     */
    syncKey?: string
    /**
     * Paper-look printed info / blank strip template (note strips only).
     * When set, the strip uses a fixed FPS-style layout instead of free note text.
     */
    paperInfoKind?: PaperInfoKind
    /**
     * Free-text STD field on local vehicle strips (not EuroScope-linked).
     * Distinct from stand / scratchpad HP on flight strips.
     */
    std?: string
    hasMatchingFlight?: boolean  // Whether a matching flight was found (false = greyed-out callsign)

    // Controller state
    isAssumed?: boolean          // Whether the strip is assumed/tracked by me
    /** Sector indicator (EuroScope position ID) of the tracking controller */
    ownerSi?: string
    /** Tracked by a controller other than me (for ownership styling) */
    ownedByOther?: boolean
    /**
     * Dim strip visually (e.g. INBOUND unless assumed / pending transfer).
     * Independent of ownership dimming settings.
     */
    dimmed?: boolean
    /**
     * Pending handoff relative to me:
     * - 'in'  — someone is transferring the strip to me
     * - 'out' — I am transferring the strip to someone else
     */
    transferPending?: 'in' | 'out'
    /** SI of the handoff target (who the strip is being transferred to) */
    transferSi?: string
    /** Full login callsign of the tracking controller (for tooltips) */
    ownerCallsign?: string
    /** Primary frequency of the tracking controller (MHz, for tooltips) */
    ownerFrequency?: string
    /** Full login callsign of the handoff target (for tooltips) */
    transferCallsign?: string
    /** Primary frequency of the handoff target (MHz, for tooltips) */
    transferFrequency?: string
    groundstate?: string         // Current ground state (NSTS, STUP, PUSH, TAXI, etc.)

    // Multi-airport column mode: which airport this strip instance belongs to
    airport?: string

    /**
     * Paper (ESGG) sideways offset — "klackat". Synced to other EFS clients.
     * `left` / `right` shift the strip in the bay; omit / undefined = flush.
     */
    klack?: 'left' | 'right'

    /**
     * SAAB strip highlight (no physical offset). Synced when `global`.
     * Badge shows G (global) or L (local-only).
     */
    highlight?: 'local' | 'global'
}

export interface Section {
    id: string
    title: string
    height?: number            // Section height in pixels (for resize)
    addFromTop?: boolean       // Whether new strips are added at top (default: true) or bottom
    /** When true, omit the section header bar (strips only). Used by paper ESGG layout. */
    hideHeader?: boolean
}

export interface Gap {
    bayId: string
    sectionId: string
    index: number              // Position index (gap appears before strip at this index)
    size: number               // Gap size in pixels
}

export interface Bay {
    id: string
    sections: Section[]
    /** Display title (e.g. ICAO in multi-airport mode) */
    title?: string
    /** Bound airport ICAO when this bay is a multi-airport column */
    airport?: string
}

export interface EfsLayout {
    bays: Bay[]
}

export type DclMode = 'manual' | 'auto' | 'semi'

/** Print / new-strip notification sound (client-side MP3). */
export type StripPrintSound = 'off' | 'short' | 'long'

/** Paper-look strip print mode (ignored unless config look is paper). */
export type StripPrintMode = 'auto' | 'manual'

/** Visual strip chrome selected by YAML config. */
export type StripLook = 'saab' | 'paper'

/** Paper FPS info / blank strip templates (printed via printer dialog). */
export type PaperInfoKind =
    | 'empty'
    | 'empty_frame'
    | 'empty_arr'
    | 'empty_dep'
    | 'hinder'
    | 'snorojning'
    | 'prel_rojning'
    | 'bogsering'

export const PAPER_INFO_KINDS: readonly PaperInfoKind[] = [
    'empty',
    'empty_frame',
    'empty_arr',
    'empty_dep',
    'hinder',
    'snorojning',
    'prel_rojning',
    'bogsering',
] as const

export function isPaperInfoKind(value: unknown): value is PaperInfoKind {
    return (
        value === 'empty' ||
        value === 'empty_frame' ||
        value === 'empty_arr' ||
        value === 'empty_dep' ||
        value === 'hinder' ||
        value === 'snorojning' ||
        value === 'prel_rojning' ||
        value === 'bogsering'
    )
}

/**
 * Auto LOP+SSR timing:
 * - instant — on strip connect/spawn
 * - assume — when the flight is assumed by me
 * - manual — only when opening the clearance dialog
 */
export type AutoLopSsrMode = 'instant' | 'assume' | 'manual'

export function isAutoLopSsrMode(value: unknown): value is AutoLopSsrMode {
    return value === 'instant' || value === 'assume' || value === 'manual'
}

/**
 * Hoppie ACARS logon code (same rule as TopSkyCPDLChoppieCode.txt):
 * letters and digits only, shorter than 40 characters.
 */
export function isValidHoppieLogonCode(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length < 40 && /^[a-zA-Z0-9]+$/.test(value)
}

/** UI preferences persisted in VatEFSsettings.json (local backend). */
export interface UiSettings {
    dclSoundEnabled: boolean
    flashChangedTimes: boolean
    flashTsatWindow: boolean
    /** @deprecated Unused (paper/SAAB strips); kept for VatEFSsettings.json compat */
    showStripOwnership: boolean
    /** @deprecated Unused; kept for VatEFSsettings.json compat */
    dimOtherOwnedStrips: boolean
    /** Play EuroScope handoff sounds for transfer request / accept / refuse */
    transferSoundsEnabled: boolean
    /**
     * Force display XC frequencies: always show ideal SI+freq on XFER, even when the covering
     * controller is not AFV-monitoring that frequency. Auto XC detection still applies when off.
     */
    showAppDepXcFrequency: boolean
    /**
     * Auto-set PARK (+ release) for assumed arrivals stationary at a stand.
     * Only applies at airports with GRP stand geometry loaded.
     */
    autoParkEnabled: boolean
    /**
     * Auto LOP+SSR: assign LOP DCT / preferred SID, CFL and TopSky squawk for untracked/own
     * IFR departures. Instant/assume show ACK CLR; manual applies on CLR dialog open.
     */
    autoLopSsr: AutoLopSsrMode
    /**
     * RTC ASSR Simulation: for LOP verbal-ACC SSR airports, hide live ES ASSR until
     * manual entry or double-click TopSky generate/override. Default on.
     * (Legacy settings key: rtcSsrSimulation — migrated on load.)
     */
    rtcAssrSimulation: boolean
    /**
     * Show Contact me (C ME) on non-assumed arrivals. Uses brittle EuroScope
     * keyboard inject (ESC → callsign → ASEL → HOME → ASEL); needs ES focus.
     */
    contactMeEnabled: boolean
    /**
     * Show the "A" (ATC) marker next to TOBT when TOBT was set by ATC.
     * Pilot "P" always shows when applicable. Default on.
     */
    showTobtSetByA: boolean
    /**
     * Play a printer-style sound in the browser when a new strip is added.
     * Default: short. Suppressed during bulk refresh / reconnect sync.
     * Only used when config look is paper.
     */
    stripPrintSound: StripPrintSound
    /**
     * Paper-look only: auto = create strips when eligible (default);
     * manual = wait for an explicit print action per flight.
     */
    stripPrintMode: StripPrintMode
    /**
     * Paper-look only: accept VatIRIS / VatFSP POST /api/print/external.
     * Default off — enable in Options and copy the FSP URL into IRIS.
     */
    fspServerEnabled: boolean
    /**
     * Share scribbles and strip state (placement, note/vehicle, CLR/QNH/ATIS) via VatIRIS.
     * On by default. Turn off only when sync is causing problems.
     */
    syncEnabled: boolean
    /**
     * Legacy persisted sync base URL — ignored in UI.
     * Effective URL is VATEFS_SYNC_URL env or https://backend.vatiris.se.
     */
    scribbleSyncUrl: string
    /** VATSIM CID used as X-Vatsim-Cid for scribble sync (empty = not set) */
    vatsimCid: string
    /**
     * Manual Hoppie logon code. Non-empty overrides ESAA/Plugins/TopSkyCPDLChoppieCode.txt.
     * Empty uses that file.
     */
    hoppieLogonCode: string
    /** Network realm for scribble rooms: auto from ES connection, or override */
    scribbleSyncRealm: 'auto' | 'live' | 'sweatbox' | 'playback' | 'local'
}

/** Stroke payload for local + remote scribble sync */
export interface ScribbleStrokePayload {
    points: string
    color: 'blue' | 'red' | 'black'
    tag?: string
}

export const DEFAULT_UI_SETTINGS: UiSettings = {
    dclSoundEnabled: true,
    flashChangedTimes: true,
    flashTsatWindow: true,
    showStripOwnership: true,
    dimOtherOwnedStrips: true,
    transferSoundsEnabled: false,
    showAppDepXcFrequency: false,
    autoParkEnabled: true,
    autoLopSsr: 'instant',
    rtcAssrSimulation: true,
    contactMeEnabled: true,
    showTobtSetByA: true,
    stripPrintSound: 'short',
    stripPrintMode: 'auto',
    fspServerEnabled: false,
    syncEnabled: true,
    scribbleSyncUrl: '',
    vatsimCid: '',
    scribbleSyncRealm: 'auto',
    hoppieLogonCode: '',
}

export interface AirportAtisInfo {
    airport: string
    atis?: string          // ATIS letter (single-ATIS airports)
    arrAtis?: string       // Arrival ATIS letter (ESSA-style split)
    depAtis?: string       // Departure ATIS letter (ESSA-style split)
    qnh?: number           // QNH in hPa
    arrRunways: string[]   // Active arrival runways
    depRunways: string[]   // Active departure runways
}

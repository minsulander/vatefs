// Flight strip types

export type StripType = 'departure' | 'arrival' | 'local' | 'vfr' | 'cross' | 'note'
export type FlightRules = 'I' | 'V' | 'Y' | 'Z' // IFR, VFR, IFR->VFR, VFR->IFR
export type WakeCategory = 'L' | 'M' | 'H' | 'J' // Light, Medium, Heavy, Super

export interface FlightStrip {
    id: string
    callsign: string
    /** Radiotelephony designator from ICAO_Airlines.txt (e.g. "SCANDINAVIAN") */
    rtfCallsign?: string

    // Aircraft info
    aircraftType: string        // e.g., "A320", "B738"
    wakeTurbulence: WakeCategory
    flightRules: FlightRules

    // Route info
    adep: string               // Departure aerodrome (ICAO)
    ades: string               // Destination aerodrome (ICAO)
    /** Full airport name for adep (tooltip) */
    adepName?: string
    /** Full airport name for ades (tooltip) */
    adesName?: string
    route?: string             // Flight planned route
    sid?: string               // Standard Instrument Departure
    star?: string              // Standard Terminal Arrival Route
    rfl?: string               // Requested Flight Level e.g., "FL340", "A050"

    // Assigned data (from controller)
    squawk?: string            // Assigned transponder code
    clearedAltitude?: string   // Cleared altitude/FL
    assignedHeading?: string   // Assigned heading
    assignedSpeed?: string     // Assigned speed

    // Times
    eobt?: string              // Estimated Off Block Time (HHmm)
    eta?: string               // Estimated Time of Arrival (HHmm)
    atd?: string               // Actual Time of Departure
    ata?: string               // Actual Time of Arrival

    // vIFF / CDM (departing IFR)
    tobt?: string              // Target Off Block Time (HHmm) — CDM airports (ESSA)
    tsat?: string              // Target Startup Approval Time (HHmm) — CDM airports (ESSA)
    tobtSetBy?: 'P' | 'A'      // Who set TOBT: Pilot or ATC (blank if TOBT==EOBT)
    /** Actual Start-up Request Time (HHmm) — CDM annotation ASRT / Ready Startup */
    asrt?: string
    ctot?: string              // Calculated Take Off Time (HHmm) when regulated
    cdmSts?: string            // Network status e.g. 'REA', 'FLS-CDM'/'CDM-FLS', 'FLS-NRA', 'COMPLY', 'AIRB'
    ctotReason?: string        // mostPenalisingRegulation (optional tooltip)

    // Additional info
    stand?: string             // Parking stand/gate
    runway?: string            // Assigned runway
    remarks?: string           // Controller remarks/annotations

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
    clearance?: boolean          // Clearance flag (for dialog OK/Cancel behavior)

    // DCL (Data-Link Clearance) state
    dclStatus?: 'REQUEST' | 'INVALID' | 'SENT' | 'WILCO' | 'UNABLE' | 'REJECTED' | 'DONE'
    dclMessage?: string           // Original pilot request text
    dclClearance?: string         // Filled-out clearance template for preview

    // Transfer frequency (shown on XFER button when handoff target matches next controller)
    xferFrequency?: string
    /** Suggested next sector indicator (ESSA sequence) before transfer is initiated */
    nextSi?: string
    /** Suggested next controller login callsign (ESSA sequence) */
    nextSiCallsign?: string

    // TopSky ROF (request on frequency): inbound LAM requester, or ourselves while outbound cooldown
    rofRequestSi?: string
    rofRequestCallsign?: string
    rofRequestFrequency?: string
    /** Epoch ms; inbound ROF flash (SI/XFER alternate) until this time */
    rofFlashUntil?: number

    // Slow aircraft indicator (light WTC or specific medium turboprops)
    isSlow?: boolean

    // Actions that should be highlighted (yellow) to prompt controller action
    highlightActions?: string[]

    // Status indicators
    clearedForTakeoff?: boolean  // Show green upward triangle (departure rolling)
    clearedToLand?: boolean      // Show green downward triangle (arrival cleared to land)
    missedApproach?: boolean     // Aircraft on missed approach (hides GOA button)

    // Special strip fields
    noteText?: string            // Text content for note strips
    hasMatchingFlight?: boolean  // Whether a matching flight was found (false = greyed-out callsign)

    // Controller state
    isAssumed?: boolean          // Whether the strip is assumed/tracked by me
    /** Sector indicator (EuroScope position ID) of the tracking controller */
    ownerSi?: string
    /** Tracked by a controller other than me (for ownership styling) */
    ownedByOther?: boolean
    /**
     * Dim strip visually (e.g. GND viewing INBOUND while still airborne on final).
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
}

export interface Section {
    id: string
    title: string
    height?: number            // Section height in pixels (for resize)
    addFromTop?: boolean       // Whether new strips are added at top (default: true) or bottom
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

/** UI preferences persisted in VatEFSsettings.json (local backend). */
export interface UiSettings {
    dclSoundEnabled: boolean
    flashChangedTimes: boolean
    flashTsatWindow: boolean
    /** Show tracking controller SI on strips */
    showStripOwnership: boolean
    /** Dim strips assumed by other positions */
    dimOtherOwnedStrips: boolean
    /** Play EuroScope handoff sounds for transfer request / accept / refuse */
    transferSoundsEnabled: boolean
    /**
     * Force display XC frequencies: always show ideal SI+freq on XFER, even when the covering
     * controller is not AFV-monitoring that frequency. Auto XC detection still applies when off.
     */
    showAppDepXcFrequency: boolean
}

export const DEFAULT_UI_SETTINGS: UiSettings = {
    dclSoundEnabled: true,
    flashChangedTimes: true,
    flashTsatWindow: true,
    showStripOwnership: true,
    dimOtherOwnedStrips: true,
    transferSoundsEnabled: false,
    showAppDepXcFrequency: false,
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

// Flight strip types

export type StripType = 'departure' | 'arrival' | 'local' | 'vfr'
export type FlightRules = 'I' | 'V' | 'Y' | 'Z' // IFR, VFR, IFR->VFR, VFR->IFR
export type WakeCategory = 'L' | 'M' | 'H' | 'J' // Light, Medium, Heavy, Super

export interface FlightStrip {
    id: string
    callsign: string

    // Aircraft info
    aircraftType: string        // e.g., "A320", "B738"
    wakeTurbulence: WakeCategory
    flightRules: FlightRules

    // Route info
    adep: string               // Departure aerodrome (ICAO)
    ades: string               // Destination aerodrome (ICAO)
    route?: string             // Flight planned route
    sid?: string               // Standard Instrument Departure
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

    // Status indicators
    clearedForTakeoff?: boolean  // Show green upward triangle (departure rolling)
    clearedToLand?: boolean      // Show green downward triangle (arrival cleared to land)
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
}

export interface EfsLayout {
    bays: Bay[]
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

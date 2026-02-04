/**
 * Mock plugin messages for development and testing.
 *
 * These messages simulate EuroScope plugin data for testing the flight store
 * without a live connection. Enable with the --mock command-line flag.
 */

import type { PluginMessage, FlightPlanDataUpdateMessage, ControllerAssignedDataUpdateMessage, RadarTargetPositionUpdateMessage, GroundState } from "./types.js"

// ESGG (Gothenburg) airport coordinates
const ESGG_LAT = 57.6628
const ESGG_LON = 12.2798
const ESGG_ELEV = 59 // feet

// Helper to create a flight plan update
function fpUpdate(
    callsign: string,
    origin: string,
    destination: string,
    aircraftType: string,
    opts: Partial<FlightPlanDataUpdateMessage> = {}
): FlightPlanDataUpdateMessage {
    return {
        type: 'flightPlanDataUpdate',
        callsign,
        origin,
        destination,
        aircraftType,
        ...opts
    }
}

// Helper to create a controller assigned data update
function ctrUpdate(
    callsign: string,
    opts: Partial<ControllerAssignedDataUpdateMessage> = {}
): ControllerAssignedDataUpdateMessage {
    return {
        type: 'controllerAssignedDataUpdate',
        callsign,
        ...opts
    }
}

// Helper to create a radar target position update
function radarUpdate(
    callsign: string,
    altitude: number,
    latitude: number = ESGG_LAT,
    longitude: number = ESGG_LON,
    opts: Partial<RadarTargetPositionUpdateMessage> = {}
): RadarTargetPositionUpdateMessage {
    return {
        type: 'radarTargetPositionUpdate',
        callsign,
        altitude,
        latitude,
        longitude,
        ...opts
    }
}

/**
 * Mock messages to simulate initial flight data at ESGG (Gothenburg)
 *
 * Layout:
 * - Bay 1: INBOUND (arrivals not assumed by me)
 * - Bay 2: CTR ARR (arrivals assumed by me), RUNWAY (lineup/departing/cleared to land), CTR DEP (airborne)
 * - Bay 3: TAXI (all taxiing aircraft)
 * - Bay 4: PENDING CLR (no clearance), CLEARED (has clearance), START&PUSH (de-ice/push)
 */
export const mockPluginMessages: PluginMessage[] = [
    // === INBOUND: Arrivals not yet assumed ===

    // SAS911 - Arrival from Oslo, not yet on frequency
    fpUpdate('SAS911', 'ENGM', 'ESGG', 'A320', {
        rfl: 18000,
        arrRwy: '21',
        star: 'OSNAK1B'
    }),
    ctrUpdate('SAS911', {
        squawk: '1234',
        groundstate: '',
        controller: 'ESMM_CTR' // Controlled by someone else
    }),

    // DLH432 - Arrival from Frankfurt, ARR groundstate but not assumed
    fpUpdate('DLH432', 'EDDF', 'ESGG', 'A321', {
        rfl: 36000,
        arrRwy: '21',
        star: 'OSNAK1B'
    }),
    ctrUpdate('DLH432', {
        squawk: '2341',
        groundstate: 'ARR',
        controller: 'ESGG_APP' // Approach, not tower
    }),

    // === CTR ARR: Arrivals assumed by me ===

    // KLM1142 - Arrival from Amsterdam, assumed by tower
    fpUpdate('KLM1142', 'EHAM', 'ESGG', 'B738', {
        rfl: 34000,
        arrRwy: '21',
        star: 'OSNAK1B'
    }),
    ctrUpdate('KLM1142', {
        squawk: '5612',
        groundstate: 'ARR',
        controller: 'ESGG_TWR' // Assumed by me (tower)
    }),

    // THY18A - Arrival from Istanbul, assumed by tower
    fpUpdate('THY18A', 'LTFM', 'ESGG', 'B77W', {
        rfl: 39000,
        arrRwy: '21',
        star: 'OSNAK1B'
    }),
    ctrUpdate('THY18A', {
        squawk: '3012',
        groundstate: 'ARR',
        controller: 'ESGG_TWR',
        cfl: 3000
    }),

    // === RUNWAY: Lineup, departure roll, cleared to land ===

    // NAX254 - Departure to Rome, lined up
    fpUpdate('NAX254', 'ESGG', 'LIRF', 'B738', {
        rfl: 38000,
        depRwy: '21',
        sid: 'KAJAN1D',
        route: 'KAJAN Y352 EVLAN'
    }),
    ctrUpdate('NAX254', {
        squawk: '2234',
        groundstate: 'LINEUP',
        clearance: true,
        controller: 'ESGG_TWR'
    }),

    // BAW791G - Departure to London, departure roll (DEPA, not airborne)
    fpUpdate('BAW791G', 'ESGG', 'EGLL', 'A320', {
        rfl: 34000,
        depRwy: '21',
        sid: 'KAJAN1D',
        route: 'KAJAN L610 SILVA'
    }),
    ctrUpdate('BAW791G', {
        squawk: '6071',
        groundstate: 'DEPA',
        clearance: true,
        controller: 'ESGG_TWR',
        cfl: 5000
    }),

    // === CTR DEP: Airborne departures ===
    // Note: airborne flag needs to be set by backend

    // BRA841 - Departure to Bromma, airborne
    fpUpdate('BRA841', 'ESGG', 'ESSB', 'AT76', {
        rfl: 12000,
        depRwy: '21',
        sid: 'OSNAK1D',
        route: 'DCT'
    }),
    ctrUpdate('BRA841', {
        squawk: '3421',
        groundstate: 'DEPA',
        clearance: true,
        controller: 'ESGG_TWR'
        // airborne: true will be set by backend
    }),

    // === TAXI: All taxiing aircraft ===

    // AFR1234 - Departure taxiing to runway
    fpUpdate('AFR1234', 'ESGG', 'LFPG', 'A320', {
        rfl: 37000,
        depRwy: '21',
        sid: 'KAJAN1D'
    }),
    ctrUpdate('AFR1234', {
        squawk: '4521',
        groundstate: 'TAXI',
        clearance: true,
        controller: 'ESGG_TWR',
        stand: '45'
    }),

    // FIN842 - Arrival taxiing to stand
    fpUpdate('FIN842', 'EFHK', 'ESGG', 'E190', {
        rfl: 33000,
        arrRwy: '21',
        star: 'OSNAK1B'
    }),
    ctrUpdate('FIN842', {
        squawk: '1122',
        groundstate: 'TXIN',
        controller: 'ESGG_GND',
        stand: '23'
    }),

    // === PENDING CLR: Departures without clearance ===

    // SAS462 - Departure to London, no clearance yet, no groundstate
    fpUpdate('SAS462', 'ESGG', 'EGLL', 'A320', {
        rfl: 36000,
        depRwy: '21',
        sid: 'KAJAN1D',
        route: 'KAJAN L610 SILVA'
    }),
    ctrUpdate('SAS462', {
        squawk: '1567',
        groundstate: '',
        clearance: false,
        stand: '22A'
    }),

    // EZY8821 - Departure to Gatwick, ONFREQ but no clearance
    fpUpdate('EZY8821', 'ESGG', 'EGKK', 'A319', {
        rfl: 35000,
        depRwy: '21',
        sid: 'KAJAN1D'
    }),
    ctrUpdate('EZY8821', {
        squawk: '0000',
        groundstate: 'ONFREQ',
        clearance: false,
        stand: '12'
    }),

    // === CLEARED: Departures with clearance ===

    // RYR123 - Departure to Dublin, has clearance
    fpUpdate('RYR123', 'ESGG', 'EIDW', 'B738', {
        rfl: 38000,
        depRwy: '21',
        sid: 'KAJAN1D'
    }),
    ctrUpdate('RYR123', {
        squawk: '5544',
        groundstate: '',
        clearance: true,
        stand: '8'
    }),

    // IBE3456 - Departure to Madrid, has clearance, ONFREQ
    fpUpdate('IBE3456', 'ESGG', 'LEMD', 'A321', {
        rfl: 39000,
        depRwy: '21',
        sid: 'KAJAN1D'
    }),
    ctrUpdate('IBE3456', {
        squawk: '6622',
        groundstate: 'ONFREQ',
        clearance: true,
        stand: '31'
    }),

    // === START&PUSH: De-ice or push ===

    // WZZ7890 - Departure to Budapest, pushing back
    fpUpdate('WZZ7890', 'ESGG', 'LHBP', 'A321', {
        rfl: 37000,
        depRwy: '21',
        sid: 'KAJAN1D'
    }),
    ctrUpdate('WZZ7890', {
        squawk: '3344',
        groundstate: 'PUSH',
        clearance: true,
        stand: '55'
    }),

    // SAS999 - Departure to Copenhagen, de-icing
    fpUpdate('SAS999', 'ESGG', 'EKCH', 'CRJ9', {
        rfl: 28000,
        depRwy: '21',
        sid: 'OSNAK1D'
    }),
    ctrUpdate('SAS999', {
        squawk: '7711',
        groundstate: 'DE-ICE',
        clearance: true,
        stand: '7'
    }),

    // === RADAR POSITION UPDATES ===
    // Required for strip creation (flights must have position data)

    // INBOUND arrivals - approaching from various directions
    radarUpdate('SAS911', 8000, 57.85, 12.10),    // NW of ESGG, descending
    radarUpdate('DLH432', 5000, 57.55, 12.50),    // SE of ESGG, on approach

    // CTR ARR arrivals - closer in, assumed by tower
    radarUpdate('KLM1142', 3000, 57.70, 12.35),   // Final approach
    radarUpdate('THY18A', 4000, 57.75, 12.25),    // Downwind/base

    // RUNWAY - on or near runway
    radarUpdate('NAX254', ESGG_ELEV, ESGG_LAT, ESGG_LON),      // Lined up on runway
    radarUpdate('BAW791G', ESGG_ELEV + 50, ESGG_LAT - 0.01, ESGG_LON), // Departure roll

    // CTR DEP - airborne, climbing out
    radarUpdate('BRA841', 2500, 57.60, 12.20),    // Just departed, climbing

    // TAXI - on ground at airport
    radarUpdate('AFR1234', ESGG_ELEV, ESGG_LAT + 0.002, ESGG_LON + 0.003), // Taxiway
    radarUpdate('FIN842', ESGG_ELEV, ESGG_LAT - 0.001, ESGG_LON + 0.005),  // Taxiing in

    // PENDING CLR - at stands
    radarUpdate('SAS462', ESGG_ELEV, ESGG_LAT + 0.003, ESGG_LON - 0.002),
    radarUpdate('EZY8821', ESGG_ELEV, ESGG_LAT + 0.001, ESGG_LON - 0.004),

    // CLEARED - at stands
    radarUpdate('RYR123', ESGG_ELEV, ESGG_LAT + 0.002, ESGG_LON - 0.001),
    radarUpdate('IBE3456', ESGG_ELEV, ESGG_LAT - 0.002, ESGG_LON - 0.003),

    // START&PUSH - pushing/de-icing
    radarUpdate('WZZ7890', ESGG_ELEV, ESGG_LAT + 0.001, ESGG_LON + 0.001),
    radarUpdate('SAS999', ESGG_ELEV, ESGG_LAT - 0.003, ESGG_LON + 0.002)
]

/**
 * Backend state updates - these set the clearedToLand and airborne flags
 * that aren't received from the plugin but managed by the backend
 */
export interface BackendStateUpdate {
    callsign: string
    clearedToLand?: boolean
    airborne?: boolean
}

export const mockBackendStateUpdates: BackendStateUpdate[] = [
    // BRA841 is airborne (in CTR DEP section)
    { callsign: 'BRA841', airborne: true }
]

/**
 * Mock plugin messages for development and testing.
 *
 * These messages simulate EuroScope plugin data for testing the flight store
 * without a live connection. Enable with the --mock command-line flag.
 *
 * Currently ESSA-oriented (role layout). Revert to ESGG samples when
 * exercising Gothenburg again.
 */

import type { PluginMessage, FlightPlanDataUpdateMessage, ControllerAssignedDataUpdateMessage, RadarTargetPositionUpdateMessage, MyselfUpdateMessage } from "./types.js"

// ESSA (Arlanda) airport coordinates
const ESSA_LAT = 59.64849
const ESSA_LON = 17.928829
const ESSA_ELEV = 137 // feet

function fpUpdate(
    callsign: string,
    origin: string,
    destination: string,
    aircraftType: string,
    opts: Partial<FlightPlanDataUpdateMessage> = {},
): FlightPlanDataUpdateMessage {
    return {
        type: "flightPlanDataUpdate",
        callsign,
        origin,
        destination,
        aircraftType,
        ...opts,
    }
}

function ctrUpdate(
    callsign: string,
    opts: Partial<ControllerAssignedDataUpdateMessage> = {},
): ControllerAssignedDataUpdateMessage {
    return {
        type: "controllerAssignedDataUpdate",
        callsign,
        ...opts,
    }
}

function radarUpdate(
    callsign: string,
    altitude: number,
    latitude: number = ESSA_LAT,
    longitude: number = ESSA_LON,
    opts: Partial<RadarTargetPositionUpdateMessage> = {},
): RadarTargetPositionUpdateMessage {
    return {
        type: "radarTargetPositionUpdate",
        callsign,
        altitude,
        latitude,
        longitude,
        ...opts,
    }
}

/**
 * Mock messages to simulate initial flight data at ESSA (Arlanda)
 */
export const mockPluginMessages: PluginMessage[] = [
    // === Core sample arrivals ===
    fpUpdate("SAS911", "ENGM", "ESSA", "A320", {
        rfl: 18000,
        arrRwy: "01L",
        star: "XILAN3M",
    }),
    ctrUpdate("SAS911", {
        squawk: "1234",
        groundstate: "",
        controller: "ESOS_CTR",
    }),

    fpUpdate("DLH432", "EDDF", "ESSA", "A321", {
        rfl: 36000,
        arrRwy: "01L",
        star: "XILAN3M",
        handoffTargetController: "ESSA_TWR",
    }),
    ctrUpdate("DLH432", {
        squawk: "2341",
        groundstate: "ARR",
        controller: "ESSA_APP",
    }),

    fpUpdate("KLM1142", "EHAM", "ESSA", "B738", {
        rfl: 34000,
        arrRwy: "01L",
        star: "XILAN3M",
        ete: 10,
    }),
    ctrUpdate("KLM1142", {
        squawk: "5612",
        groundstate: "ARR",
        controller: "ESSA_TWR",
    }),

    fpUpdate("THY18A", "LTFM", "ESSA", "B77W", {
        rfl: 39000,
        arrRwy: "01L",
        star: "XILAN3M",
    }),
    ctrUpdate("THY18A", {
        squawk: "3012",
        groundstate: "ARR",
        controller: "ESSA_TWR",
        cfl: 3000,
    }),

    // === RUNWAY ===
    fpUpdate("NAX254", "ESSA", "LIRF", "B738", {
        rfl: 38000,
        depRwy: "01L",
        sid: "NOSLI6C",
        route: "NOSLI",
    }),
    ctrUpdate("NAX254", {
        squawk: "2234",
        groundstate: "LINEUP",
        clearance: true,
        controller: "ESSA_TWR",
    }),

    fpUpdate("BAW791G", "ESSA", "EGLL", "A320", {
        rfl: 34000,
        depRwy: "01L",
        sid: "NOSLI6C",
        route: "NOSLI",
    }),
    ctrUpdate("BAW791G", {
        squawk: "6071",
        groundstate: "DEPA",
        clearance: true,
        controller: "ESSA_TWR",
        cfl: 5000,
    }),

    // === CTR DEP ===
    fpUpdate("BRA841", "ESSA", "ESSB", "AT76", {
        rfl: 12000,
        depRwy: "01L",
        sid: "NOSLI6C",
        route: "DCT",
        nextController: "ESSA_E_APP",
        nextControllerFrequency: 120.15,
    }),
    ctrUpdate("BRA841", {
        squawk: "3421",
        groundstate: "DEPA",
        clearance: true,
        controller: "ESSA_TWR",
    }),

    // === TAXI ===
    fpUpdate("AFR1234", "ESSA", "LFPG", "A320", {
        rfl: 37000,
        depRwy: "01L",
        sid: "NOSLI6C",
        eobt: "1310",
    }),
    ctrUpdate("AFR1234", {
        squawk: "4521",
        groundstate: "TAXI",
        clearance: true,
        controller: "ESSA_TWR",
        stand: "F34",
    }),

    fpUpdate("FIN842", "EFHK", "ESSA", "E190", {
        rfl: 33000,
        arrRwy: "01L",
        star: "XILAN3M",
    }),
    ctrUpdate("FIN842", {
        squawk: "1122",
        groundstate: "TXIN",
        controller: "ESSA_GND",
        stand: "01",
    }),

    // === PENDING CLR ===
    fpUpdate("SAS462", "ESSA", "EGLL", "A320", {
        rfl: 36000,
        depRwy: "01L",
        sid: "NOSLI6C",
        route: "NOSLI",
        eobt: "1234",
        fplRemarks: "PBN/A1B1 DOF/260404 REG/SEABC CALLSIGN/VIKING DOF/260404",
    }),
    ctrUpdate("SAS462", {
        squawk: "1567",
        groundstate: "",
        clearance: false,
        stand: "03",
    }),

    fpUpdate("EZY8821", "ESSA", "EGKK", "A319", {
        rfl: 35000,
        depRwy: "01L",
        sid: "NOSLI6C",
        eobt: "1245",
    }),
    ctrUpdate("EZY8821", {
        squawk: "0000",
        groundstate: "ONFREQ",
        clearance: false,
        stand: "F28",
    }),

    // === CLEARED ===
    fpUpdate("RYR123", "ESSA", "EIDW", "B738", {
        rfl: 38000,
        depRwy: "01L",
        sid: "NOSLI6C",
        eobt: "1305",
    }),
    ctrUpdate("RYR123", {
        squawk: "5544",
        groundstate: "",
        clearance: true,
        stand: "31",
        controller: "ESSA_TWR",
    }),

    fpUpdate("IBE3456", "ESSA", "LEMD", "A321", {
        rfl: 39000,
        depRwy: "01L",
        sid: "NOSLI6C",
        eobt: "1320",
    }),
    ctrUpdate("IBE3456", {
        squawk: "6622",
        groundstate: "ONFREQ",
        clearance: true,
        stand: "32",
        controller: "ESSA_TWR",
    }),

    // === START&PUSH ===
    fpUpdate("WZZ7890", "ESSA", "LHBP", "A321", {
        rfl: 37000,
        depRwy: "01L",
        sid: "NOSLI6C",
        eobt: "1255",
    }),
    ctrUpdate("WZZ7890", {
        squawk: "3344",
        groundstate: "PUSH",
        clearance: true,
        stand: "F30",
        controller: "ESSA_TWR",
    }),

    fpUpdate("SAS999", "ESSA", "EKCH", "CRJ9", {
        rfl: 28000,
        depRwy: "01L",
        sid: "NOSLI6C",
        eobt: "1220",
    }),
    ctrUpdate("SAS999", {
        squawk: "7711",
        groundstate: "DE-ICE",
        clearance: true,
        stand: "04",
        controller: "ESSA_TWR",
    }),

    // === RADAR for core samples ===
    radarUpdate("SAS911", 8000, 59.85, 17.7),
    radarUpdate("DLH432", 5000, 59.55, 18.1),
    radarUpdate("KLM1142", 1500, 59.62, 17.91),
    radarUpdate("THY18A", 4000, 59.75, 17.9),
    radarUpdate("NAX254", ESSA_ELEV, ESSA_LAT, ESSA_LON),
    radarUpdate("BAW791G", ESSA_ELEV + 50, ESSA_LAT - 0.01, ESSA_LON),
    radarUpdate("BRA841", 2500, 59.6, 17.9),
    radarUpdate("AFR1234", ESSA_ELEV, ESSA_LAT - 0.004, ESSA_LON + 0.005),
    radarUpdate("FIN842", ESSA_ELEV, ESSA_LAT - 0.001, ESSA_LON + 0.005),
    radarUpdate("SAS462", ESSA_ELEV, ESSA_LAT + 0.003, ESSA_LON - 0.002),
    radarUpdate("EZY8821", ESSA_ELEV, ESSA_LAT + 0.001, ESSA_LON - 0.004),
    radarUpdate("RYR123", ESSA_ELEV, ESSA_LAT - 0.002, ESSA_LON + 0.001),
    radarUpdate("IBE3456", ESSA_ELEV, ESSA_LAT - 0.002, ESSA_LON + 0.003),
    radarUpdate("WZZ7890", ESSA_ELEV, ESSA_LAT - 0.001, ESSA_LON + 0.001),
    radarUpdate("SAS999", ESSA_ELEV, ESSA_LAT - 0.003, ESSA_LON + 0.002),
]

export interface BackendStateUpdate {
    callsign: string
    clearedToLand?: boolean
    airborne?: boolean
    /** Mock CDM TSAT (HHmm) — applied after plugin messages */
    tsat?: string
}

export const mockBackendStateUpdates: BackendStateUpdate[] = [
    { callsign: "BRA841", airborne: true },
    // Departure TSAT samples
    { callsign: "SAS462", tsat: "1240" },
    { callsign: "AFR1234", tsat: "1315" },
    { callsign: "SAS999", tsat: "1230" },
    { callsign: "WZZ7890", tsat: "1300" },
]

export const mockMyselfUpdate: MyselfUpdateMessage = {
    type: "myselfUpdate",
    callsign: "ESSA_TWR",
    name: "Mock Controller",
    frequency: 118.5,
    rating: 5,
    facility: 4,
    sector: "",
    position: "SA",
    controller: true,
    pluginVersion: "mock",
    rwyconfig: {
        ESSA: {
            "01L": { arr: true, dep: true },
            "01R": { arr: false, dep: false },
        },
    },
}

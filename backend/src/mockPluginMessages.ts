/**
 * Mock plugin messages for development and testing.
 *
 * These messages simulate EuroScope plugin data for testing the flight store
 * without a live connection. Enable with the --mock command-line flag.
 *
 * Includes ESSA role samples plus one inbound per GRP stand-menu airport
 * (radar near each field; myAirports seeded from mockMyselfUpdate.rwyconfig).
 */

import type { PluginMessage, FlightPlanDataUpdateMessage, ControllerAssignedDataUpdateMessage, RadarTargetPositionUpdateMessage, MyselfUpdateMessage } from "./types.js"

/** Mock myself callsign — strips with this controller are editable under --mock. */
export const MOCK_MYSELF_CALLSIGN = "ESSA_TWR"

// ESSA (Arlanda) airport coordinates
const ESSA_LAT = 59.64849
const ESSA_LON = 17.928829
const ESSA_ELEV = 137 // feet

// ESGG (Landvetter)
const ESGG_LAT = 57.6628
const ESGG_LON = 12.2798
const ESGG_ELEV = 506

// C-box visual-check airports
const ESMS_LAT = 55.535564
const ESMS_LON = 13.376327
const ESMS_ELEV = 236
const ESSV_LAT = 57.6628
const ESSV_LON = 18.3462
const ESSV_ELEV = 164
const ESNU_LAT = 63.791801
const ESNU_LON = 20.282801
const ESNU_ELEV = 24
const ESNQ_LAT = 67.821999
const ESNQ_LON = 20.3368
const ESNQ_ELEV = 1508

/** GRP airports with stand menus — one inbound each for UI review. */
const GRP_STAND_MENU_AIRPORTS: {
    icao: string
    lat: number
    lon: number
    elev: number
    /** Optional assigned stand so STD / occupancy shows in the menu */
    stand?: string
}[] = [
    { icao: "ESSA", lat: 59.64849, lon: 17.928829, elev: 137, stand: "F34" },
    { icao: "ESGG", lat: 57.6628, lon: 12.2798, elev: 506, stand: "16" },
    { icao: "ESSB", lat: 59.3544, lon: 17.9417, elev: 47, stand: "10" },
    { icao: "ESMS", lat: 55.535564, lon: 13.376327, elev: 236, stand: "5" },
    { icao: "ESOW", lat: 59.5894, lon: 16.6336, elev: 21, stand: "3" },
    { icao: "ESPA", lat: 65.5438, lon: 22.122, elev: 65 },
    { icao: "ESKN", lat: 58.788601, lon: 16.912201, elev: 140 },
    { icao: "ESGT", lat: 58.3181, lon: 12.345, elev: 137 },
    { icao: "ESNZ", lat: 63.194135, lon: 14.500322, elev: 1233 },
    { icao: "ESNU", lat: 63.791801, lon: 20.282801, elev: 24 },
    { icao: "ESNX", lat: 65.5903, lon: 19.2819, elev: 1245 },
    { icao: "ESNN", lat: 62.5281, lon: 17.4439, elev: 16 },
    { icao: "ESNQ", lat: 67.822, lon: 20.3368, elev: 1508 },
    { icao: "ESNS", lat: 64.6248, lon: 21.0769, elev: 157 },
    { icao: "ESSL", lat: 58.4062, lon: 15.6805, elev: 172 },
    { icao: "ESSV", lat: 57.6628, lon: 18.3462, elev: 164 },
    { icao: "ESTA", lat: 56.2961, lon: 12.8471, elev: 68 },
    { icao: "ESMQ", lat: 56.685501, lon: 16.2876, elev: 17 },
    { icao: "ESKS", lat: 61.158393, lon: 12.842503, elev: 1608 },
    { icao: "ESIB", lat: 58.426399, lon: 12.7144, elev: 181 },
    { icao: "ESDF", lat: 56.266701, lon: 15.265, elev: 191 },
    { icao: "ESCM", lat: 59.897301, lon: 17.5886, elev: 68 },
    { icao: "ESCF", lat: 58.402302, lon: 15.5257, elev: 308 },
    { icao: "ESMX", lat: 56.9291, lon: 14.728, elev: 610 },
]

const GRP_ORIGINS = ["ENGM", "EKCH", "EDDF", "EHAM", "EFHK", "EGLL", "ESGG", "ESSA"]

function grpStandMenuArrivalMessages(): PluginMessage[] {
    const out: PluginMessage[] = []
    GRP_STAND_MENU_AIRPORTS.forEach((apt, idx) => {
        // STGG1 / STSA1 / … — unique, readable destination tag
        const callsign = `ST${apt.icao.slice(2)}${1 + (idx % 9)}`
        const origin = GRP_ORIGINS[idx % GRP_ORIGINS.length]!
        const squawk = String(2000 + idx).padStart(4, "0")
        out.push(
            fpUpdate(callsign, origin, apt.icao, idx % 3 === 0 ? "B738" : "A320", {
                flightRules: "I",
                rfl: 25000 + (idx % 5) * 1000,
                arrRwy: "01",
            }),
            // Owned by mock myself so STD/stand menu is editable immediately
            ctrUpdate(callsign, {
                squawk,
                groundstate: "ARR",
                clearance: true,
                stand: apt.stand,
                controller: MOCK_MYSELF_CALLSIGN,
            }),
            // Slight offset so GPS is near field but not exactly on ARP
            radarUpdate(callsign, apt.elev + 800, apt.lat + 0.012, apt.lon + 0.01, {
                groundSpeed: 180,
                controller: MOCK_MYSELF_CALLSIGN,
            }),
        )
    })
    // Extra Landvetter / Malmö inbounds so those menus look busier
    out.push(
        fpUpdate("STGG2", "ESSA", "ESGG", "A321", {
            flightRules: "I",
            rfl: 28000,
            arrRwy: "03",
        }),
        ctrUpdate("STGG2", {
            squawk: "2210",
            groundstate: "ARR",
            stand: "21",
            controller: MOCK_MYSELF_CALLSIGN,
        }),
        radarUpdate("STGG2", ESGG_ELEV + 1200, ESGG_LAT + 0.02, ESGG_LON - 0.015, {
            groundSpeed: 200,
            controller: MOCK_MYSELF_CALLSIGN,
        }),
        fpUpdate("STMS2", "ESGG", "ESMS", "E190", {
            flightRules: "I",
            rfl: 22000,
            arrRwy: "17",
        }),
        ctrUpdate("STMS2", {
            squawk: "2211",
            groundstate: "",
            stand: "9",
            controller: MOCK_MYSELF_CALLSIGN,
        }),
        radarUpdate("STMS2", 236 + 2500, 55.535564 + 0.03, 13.376327 + 0.02, {
            groundSpeed: 220,
            controller: MOCK_MYSELF_CALLSIGN,
        }),
    )
    return out
}

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
    // Landvetter inbound — assumed by mock myself (stand menu / STD editable)
    fpUpdate("BLX812", "ESSA", "ESGG", "A321", {
        flightRules: "I",
        rfl: 28000,
        arrRwy: "03",
        star: "SOPAM1A",
    }),
    ctrUpdate("BLX812", {
        squawk: "2612",
        groundstate: "ARR",
        clearance: true,
        stand: "16",
        controller: MOCK_MYSELF_CALLSIGN,
    }),
    radarUpdate("BLX812", ESGG_ELEV + 900, ESGG_LAT + 0.015, ESGG_LON + 0.012, {
        groundSpeed: 190,
        controller: MOCK_MYSELF_CALLSIGN,
    }),

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
        sid: "TOVRI6C",
        route: "TOVRI",
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
        sid: "BABAP6C",
        route: "BABAP",
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
        controller: "ESSA_TWR",
        stand: "01",
    }),

    // === PENDING CLR (untracked — ASSUME as TWR top-down / CD) ===
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
        sid: "TOVRI6C",
        route: "TOVRI",
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
        sid: "BABAP6C",
        route: "BABAP",
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

    // === C-box coordination visual check (ADEP-gated; works OTHER + RTC) ===
    // ESMS → C YES (always in NEEDS_COORDINATION)
    fpUpdate("COOEMS1", "ESMS", "ESSA", "A320", {
        flightRules: "I",
        rfl: 28000,
        depRwy: "17",
        sid: "BABSI2K",
        route: "BABSI N850 NOSLI",
        eobt: "0800",
    }),
    ctrUpdate("COOEMS1", {
        squawk: "4101",
        groundstate: "",
        clearance: false,
        stand: "12",
        controller: "ESMS_TWR",
    }),
    // Slight apron offset so on_runway_geographic does not steal the strip
    radarUpdate("COOEMS1", ESMS_ELEV, ESMS_LAT + 0.008, ESMS_LON + 0.008),

    // ESSV → C NO (Visby not in NEEDS_COORDINATION)
    fpUpdate("COOESV1", "ESSV", "ESSA", "AT76", {
        flightRules: "I",
        rfl: 18000,
        depRwy: "03",
        route: "TRS DCT NOSLI",
        eobt: "0810",
    }),
    ctrUpdate("COOESV1", {
        squawk: "4102",
        groundstate: "",
        clearance: false,
        stand: "3",
        controller: "ESSV_TWR",
    }),
    radarUpdate("COOESV1", ESSV_ELEV, ESSV_LAT + 0.008, ESSV_LON + 0.008),

    // ESNU + SOPLI → C NO (exempt TMA exit)
    fpUpdate("COOENU1", "ESNU", "ESSA", "E190", {
        flightRules: "I",
        rfl: 31000,
        depRwy: "14",
        sid: "SOPLI2A",
        route: "SOPLI DCT NOSLI",
        eobt: "0820",
    }),
    ctrUpdate("COOENU1", {
        squawk: "4103",
        groundstate: "",
        clearance: false,
        stand: "5",
        controller: "ESNU_TWR",
    }),
    radarUpdate("COOENU1", ESNU_ELEV, ESNU_LAT + 0.008, ESNU_LON + 0.008),

    // ESNU + non-exempt exit → C YES
    fpUpdate("COOENU2", "ESNU", "ESSA", "A320", {
        flightRules: "I",
        rfl: 33000,
        depRwy: "14",
        sid: "UMEXA1A",
        route: "UMEXA DCT NOSLI",
        eobt: "0830",
    }),
    ctrUpdate("COOENU2", {
        squawk: "4104",
        groundstate: "",
        clearance: false,
        stand: "6",
        controller: "ESNU_TWR",
    }),
    radarUpdate("COOENU2", ESNU_ELEV, ESNU_LAT + 0.01, ESNU_LON + 0.01),

    // ESNQ → C YES (always in NEEDS_COORDINATION)
    fpUpdate("COOENQ1", "ESNQ", "ESSA", "B738", {
        flightRules: "I",
        rfl: 35000,
        depRwy: "21",
        route: "NEKIR DCT NOSLI",
        eobt: "0840",
    }),
    ctrUpdate("COOENQ1", {
        squawk: "4105",
        groundstate: "",
        clearance: false,
        stand: "2",
        controller: "ESNQ_TWR",
    }),
    radarUpdate("COOENQ1", ESNQ_ELEV, ESNQ_LAT + 0.008, ESNQ_LON + 0.008),

    // === GRP stand-menu arrivals (one+ per airport with GRP stands) ===
    ...grpStandMenuArrivalMessages(),
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

function mockRwyConfigForAirports(
    icaos: string[],
): Record<string, Record<string, { arr: boolean; dep: boolean }>> {
    const out: Record<string, Record<string, { arr: boolean; dep: boolean }>> = {}
    for (const icao of icaos) {
        out[icao] = {
            "01": { arr: true, dep: true },
            "19": { arr: false, dep: false },
        }
    }
    // Prefer real-ish pairs where we already had them
    out.ESSA = {
        "01L": { arr: true, dep: true },
        "01R": { arr: false, dep: false },
    }
    out.ESGG = {
        "03": { arr: true, dep: true },
        "21": { arr: false, dep: false },
    }
    out.ESMS = {
        "17": { arr: true, dep: true },
        "35": { arr: false, dep: false },
    }
    return out
}

export const mockMyselfUpdate: MyselfUpdateMessage = {
    type: "myselfUpdate",
    callsign: MOCK_MYSELF_CALLSIGN,
    name: "Mock Controller",
    frequency: 118.5,
    rating: 5,
    facility: 4,
    sector: "",
    position: "SA",
    controller: true,
    pluginVersion: "mock",
    rwyconfig: mockRwyConfigForAirports(GRP_STAND_MENU_AIRPORTS.map((a) => a.icao)),
}

/**
 * Mock plugin messages for development and testing.
 *
 * These messages simulate EuroScope plugin data for testing the flight store
 * without a live connection. Enable with the --mock command-line flag.
 *
 * Currently ESSA-oriented (stand menu / role layout). Keep --mock until
 * explicitly disabled. Revert to ESGG samples when exercising Gothenburg again.
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

type ArrPhase = "inbound" | "ctr_arr" | "txin" | "park"

interface MockArrival {
    callsign: string
    origin: string
    type: string
    phase: ArrPhase
    /** Planned / assigned stand (Planned for …) */
    stand?: string
    /** Put radar on stand centroid-ish (Blocked by …) — offsets from ESSA */
    onStand?: boolean
    squawk?: string
    arrRwy?: string
}

/** Extra ESSA arrivals for stand-menu testing (mixed ATYP / Schengen / stands). */
const EXTRA_ARRIVALS: MockArrival[] = [
    // Inbound — no stand yet
    { callsign: "LOT281", origin: "EPWA", type: "B738", phase: "inbound" },
    { callsign: "AUI880", origin: "UKBB", type: "B738", phase: "inbound" },
    { callsign: "BTI641", origin: "EVRA", type: "A220", phase: "inbound" },
    { callsign: "NOZ123", origin: "ENGM", type: "B738", phase: "inbound" },
    { callsign: "ICE512", origin: "BIKF", type: "B752", phase: "inbound" },
    { callsign: "EIN65C", origin: "EIDW", type: "A320", phase: "inbound" },
    { callsign: "BAW462", origin: "EGLL", type: "A320", phase: "inbound" },
    { callsign: "EZY48KJ", origin: "EGKK", type: "A319", phase: "inbound" },
    { callsign: "RYR8XG", origin: "EGSS", type: "B738", phase: "inbound" },
    { callsign: "WZZ12A", origin: "LHBP", type: "A321", phase: "inbound" },

    // CTR ARR — tower assumed, various types (preferred / allowed / widebody)
    { callsign: "SAS601", origin: "EKCH", type: "A320", phase: "ctr_arr" },
    { callsign: "SAS603", origin: "ESGG", type: "A20N", phase: "ctr_arr" },
    { callsign: "SAS605", origin: "ENGM", type: "B738", phase: "ctr_arr" },
    { callsign: "NOZ401", origin: "ENGM", type: "B738", phase: "ctr_arr" },
    { callsign: "FIN101", origin: "EFHK", type: "A321", phase: "ctr_arr" },
    { callsign: "FIN103", origin: "EFHK", type: "E190", phase: "ctr_arr" },
    { callsign: "DLH8X", origin: "EDDF", type: "A321", phase: "ctr_arr" },
    { callsign: "DLH9Y", origin: "EDDM", type: "A320", phase: "ctr_arr" },
    { callsign: "AFR18K", origin: "LFPG", type: "A320", phase: "ctr_arr" },
    { callsign: "KLM86T", origin: "EHAM", type: "B738", phase: "ctr_arr" },
    { callsign: "SWR12X", origin: "LSZH", type: "A320", phase: "ctr_arr" },
    { callsign: "AUA72C", origin: "LOWW", type: "A320", phase: "ctr_arr" },
    { callsign: "TAP46E", origin: "LPPT", type: "A320", phase: "ctr_arr" },
    { callsign: "IBE31L", origin: "LEMD", type: "A321", phase: "ctr_arr" },
    { callsign: "BAW15M", origin: "EGLL", type: "A320", phase: "ctr_arr" },
    { callsign: "BAW17N", origin: "EGLL", type: "B772", phase: "ctr_arr" },
    { callsign: "UAE93", origin: "OMDB", type: "B77W", phase: "ctr_arr" },
    { callsign: "QTR21", origin: "OTHH", type: "A359", phase: "ctr_arr" },
    { callsign: "SIA36", origin: "WSSS", type: "A359", phase: "ctr_arr" },
    { callsign: "CPA29", origin: "VHHH", type: "B77W", phase: "ctr_arr" },
    { callsign: "THY5A", origin: "LTFM", type: "A333", phase: "ctr_arr" },
    { callsign: "AFL214", origin: "UUEE", type: "A321", phase: "ctr_arr" },
    { callsign: "ROT401", origin: "LROP", type: "B738", phase: "ctr_arr" },
    { callsign: "BEL8G", origin: "EBBR", type: "A319", phase: "ctr_arr" },
    { callsign: "CFG4H", origin: "EDDH", type: "A320", phase: "ctr_arr" },
    { callsign: "NAX12B", origin: "ENGM", type: "B38M", phase: "ctr_arr" },
    { callsign: "NSZ88", origin: "ESGG", type: "B738", phase: "ctr_arr" },
    { callsign: "BRA42C", origin: "ESMS", type: "AT76", phase: "ctr_arr" },
    { callsign: "JTD11", origin: "ESSA", type: "C172", phase: "ctr_arr" }, // local-ish / small
    { callsign: "HCA901", origin: "EGLL", type: "A388", phase: "ctr_arr" }, // oversized

    // Airborne planned (soft shade) — stand assigned while still inbound / on final
    // Compare with ground planned (txin) below: e.g. 09 soft vs 05 amber.
    { callsign: "SAS711", origin: "EKCH", type: "A320", phase: "inbound", stand: "09" },
    { callsign: "SAS713", origin: "ENGM", type: "A320", phase: "ctr_arr", stand: "10" },
    { callsign: "NOZ511", origin: "ENGM", type: "B738", phase: "inbound", stand: "F31" },
    { callsign: "FIN211", origin: "EFHK", type: "A321", phase: "ctr_arr", stand: "F29" },
    { callsign: "DLH411", origin: "EDDF", type: "A320", phase: "inbound", stand: "39" },
    // Widebody airborne planned → soft Blocked on neighbours (BLOCKS)
    { callsign: "BAW811", origin: "EGLL", type: "B744", phase: "inbound", stand: "02" },
    { callsign: "UAE511", origin: "OMDB", type: "B77W", phase: "ctr_arr", stand: "F26" },

    // Ground planned (stronger amber) — assigned, taxiing in, not on stand polygon
    { callsign: "SAS701", origin: "EKCH", type: "A320", phase: "txin", stand: "05" },
    { callsign: "SAS703", origin: "ENGM", type: "A320", phase: "txin", stand: "06" },
    { callsign: "NOZ501", origin: "ENGM", type: "B738", phase: "txin", stand: "F32" },
    { callsign: "FIN201", origin: "EFHK", type: "A321", phase: "txin", stand: "F33" },
    { callsign: "DLH401", origin: "EDDF", type: "A320", phase: "txin", stand: "33" },
    { callsign: "BAW801", origin: "EGLL", type: "A320", phase: "txin", stand: "34" },
    { callsign: "EZY901", origin: "EGKK", type: "A319", phase: "txin", stand: "35" },
    { callsign: "RYR401", origin: "EIDW", type: "B738", phase: "txin", stand: "F36" },
    { callsign: "WZZ501", origin: "LHBP", type: "A321", phase: "txin", stand: "F37" },
    { callsign: "LOT301", origin: "EPWA", type: "B738", phase: "txin", stand: "G12" },
    { callsign: "AFR501", origin: "LFPG", type: "A320", phase: "txin", stand: "H1" },
    { callsign: "KLM501", origin: "EHAM", type: "B738", phase: "txin", stand: "H2" },
    { callsign: "SWR501", origin: "LSZH", type: "A320", phase: "txin", stand: "L1" },
    { callsign: "AUA501", origin: "LOWW", type: "A320", phase: "txin", stand: "P1" },
    { callsign: "UAE501", origin: "OMDB", type: "B77W", phase: "txin", stand: "F40" },

    // Physically on stand (Blocked by …) — slight geo offset so they sit near apron
    { callsign: "SAS801", origin: "EKCH", type: "A320", phase: "park", stand: "07", onStand: true },
    { callsign: "SAS803", origin: "ESGG", type: "A20N", phase: "park", stand: "08", onStand: true },
    { callsign: "NOZ601", origin: "ENGM", type: "B738", phase: "park", stand: "F38", onStand: true },
    { callsign: "FIN301", origin: "EFHK", type: "E190", phase: "park", stand: "F39", onStand: true },
    { callsign: "DLH501", origin: "EDDM", type: "A321", phase: "park", stand: "36", onStand: true },
    { callsign: "BAW901", origin: "EGLL", type: "A321", phase: "park", stand: "37", onStand: true },
    { callsign: "EZY701", origin: "EGKK", type: "A320", phase: "park", stand: "38", onStand: true },
    { callsign: "RYR501", origin: "EGSS", type: "B738", phase: "park", stand: "F41", onStand: true },
    { callsign: "THY701", origin: "LTFM", type: "A333", phase: "park", stand: "F42", onStand: true },
    { callsign: "QTR701", origin: "OTHH", type: "A359", phase: "park", stand: "F43", onStand: true },
]

function messagesForArrival(a: MockArrival, index: number): PluginMessage[] {
    const arrRwy = a.arrRwy ?? "01L"
    const squawk = a.squawk ?? String(1000 + (index % 7000)).padStart(4, "0")
    const out: PluginMessage[] = [
        fpUpdate(a.callsign, a.origin, "ESSA", a.type, {
            rfl: 30000 + (index % 10) * 1000,
            arrRwy,
            star: "XILAN3M",
            ete: a.phase === "inbound" ? 18 : a.phase === "ctr_arr" ? 8 : 2,
        }),
    ]

    if (a.phase === "inbound") {
        out.push(
            ctrUpdate(a.callsign, {
                squawk,
                groundstate: index % 2 === 0 ? "" : "ARR",
                controller: index % 3 === 0 ? "ESOS_CTR" : "ESSA_APP",
                stand: a.stand,
            }),
        )
        // Fan around ESSA for inbound — altitude well above field → airborne=true
        const bearing = (index * 37) % 360
        const rad = (bearing * Math.PI) / 180
        const dist = 0.12 + (index % 5) * 0.02
        out.push(
            radarUpdate(
                a.callsign,
                6000 + (index % 8) * 500,
                ESSA_LAT + Math.cos(rad) * dist,
                ESSA_LON + Math.sin(rad) * dist,
            ),
        )
    } else if (a.phase === "ctr_arr") {
        out.push(
            ctrUpdate(a.callsign, {
                squawk,
                groundstate: "ARR",
                controller: "ESSA_TWR",
                cfl: 3000,
                stand: a.stand,
            }),
        )
        // On final — still above airborne threshold (field elev + 200)
        const bearing = (index * 23) % 360
        const rad = (bearing * Math.PI) / 180
        const dist = 0.03 + (index % 4) * 0.01
        out.push(
            radarUpdate(
                a.callsign,
                2000 + (index % 5) * 400,
                ESSA_LAT + Math.cos(rad) * dist,
                ESSA_LON + Math.sin(rad) * dist,
            ),
        )
    } else {
        // txin / park
        out.push(
            ctrUpdate(a.callsign, {
                squawk,
                groundstate: a.phase === "park" ? "PARK" : "TXIN",
                controller: "ESSA_GND",
                stand: a.stand,
            }),
        )
        if (a.onStand) {
            // Slight scatter on the field so multiple can be “on stand” for occupancy tests
            const dx = ((index % 7) - 3) * 0.0015
            const dy = ((index % 5) - 2) * 0.0015
            out.push(radarUpdate(a.callsign, ESSA_ELEV, ESSA_LAT + dx, ESSA_LON + dy))
        } else {
            // Taxiing in — near airport but not treated as on a specific stand polygon
            out.push(
                radarUpdate(
                    a.callsign,
                    ESSA_ELEV,
                    ESSA_LAT - 0.008 - (index % 4) * 0.001,
                    ESSA_LON + 0.006 + (index % 3) * 0.001,
                ),
            )
        }
    }
    return out
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

    // === Extra arrivals for STD menu ===
    ...EXTRA_ARRIVALS.flatMap((a, i) => messagesForArrival(a, i)),

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
    // Soft Planned shade samples (also set via high radar altitude)
    { callsign: "SAS711", airborne: true },
    { callsign: "SAS713", airborne: true },
    { callsign: "NOZ511", airborne: true },
    { callsign: "FIN211", airborne: true },
    { callsign: "DLH411", airborne: true },
    { callsign: "BAW811", airborne: true },
    { callsign: "UAE511", airborne: true },
    // Departure TSAT samples (stand menu shows TSAT over EOBT)
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

/**
 * ESSA arrival → TAXIWAY ARR placement + no geographic RWY hold:
 * - TWR separate: stay on RUNWAY until TXIN or GND assumes (XFER alone does not leave)
 * - GND separate: incoming transfer → taxi_arr
 * - Combined GND+TWR: TXIN (TAXI) → taxi_arr; ARR stays on RWY via GS until-taxi
 * - Dep airborne → CTR DEP when section visible; else DEP RWY hold
 *
 * Run: npx tsx src/essa-arr-taxi-moves.test.ts
 */
import assert from "node:assert/strict"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { loadAirports } from "./airport-data.js"
import { loadConfig } from "./config-loader.js"
import { loadRunways } from "./runway-data.js"
import {
    applyConfig,
    setEssaRoles,
    setMyCallsign,
    setMyRole,
    setMyAirports,
    staticConfig,
} from "./static-config.js"
import { determineSectionForFlight } from "./rules-engine.js"
import type { Flight } from "./types.js"
import type { ControllerRole } from "./config-types.js"
import { isEssaDynamicRunwaySectionId } from "@vatefs/common"
import { isEssaSectionVisibleForPicker } from "./essa-roles.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.resolve(__dirname, "../../data")

function check(name: string, fn: () => void) {
    try {
        fn()
        console.log(`  ok  ${name}`)
    } catch (e) {
        console.error(`  FAIL  ${name}`)
        throw e
    }
}

loadAirports(path.join(dataDir, "airports.csv"))
loadRunways(path.join(dataDir, "runways.csv"))
const cfg = loadConfig(path.join(dataDir, "config/essa.yml"))
applyConfig(cfg)
setMyAirports(["ESSA"])

/** On ESSA field, outside RWY polygon — GS until-taxi must not need geo. */
const ON_FIELD = { latitude: 59.65185, longitude: 17.9 }
/** On 01L/19R pavement — must not match deleted geographic hold rules. */
const ON_RWY = { latitude: 59.6518497467041, longitude: 17.91849994659424 }

function arrival(overrides: Partial<Flight> = {}): Flight {
    return {
        callsign: "SAS100",
        origin: "EKCH",
        destination: "ESSA",
        aircraftType: "A320",
        airborne: false,
        groundstate: "ARR",
        clearedToLand: false,
        ...ON_FIELD,
        currentAltitude: 50,
        firstSeen: Date.now(),
        lastUpdate: Date.now(),
        ...overrides,
    }
}

function departure(overrides: Partial<Flight> = {}): Flight {
    return {
        callsign: "SAS200",
        origin: "ESSA",
        destination: "EKCH",
        aircraftType: "A320",
        airborne: true,
        groundstate: "DEPA",
        clearedToLand: false,
        ...ON_RWY,
        currentAltitude: 200,
        controller: "ESSA_E_TWR",
        firstSeen: Date.now(),
        lastUpdate: Date.now(),
        ...overrides,
    }
}

console.log("essa-arr-taxi-moves")

function setRoles(
    callsign: string,
    role: ControllerRole,
    essa: Parameters<typeof setEssaRoles>[0],
    covering: ControllerRole[],
) {
    setMyCallsign(callsign)
    setMyRole(role)
    setEssaRoles(essa, true)
    staticConfig.myRolesByAirport = new Map([["ESSA", covering]])
}

check("TWR separate: XFER alone stays on RUNWAY", () => {
    setRoles("ESSA_E_TWR", "TWR", ["TWR-E"], ["TWR"])
    staticConfig.onlineControllers = new Map([
        ["ESSA_E_GND", { role: "GND", frequency: 121.7, callsign: "ESSA_E_GND" }],
    ])
    staticConfig.activeRunways = { ESSA: { arr: ["01L"], dep: ["01R"] } }
    const section = determineSectionForFlight(
        arrival({
            controller: "ESSA_E_TWR",
            handoffTargetController: "ESSA_E_GND",
            arrRwy: "01L",
            ...ON_RWY,
            currentAltitude: 50,
        }),
        staticConfig,
    )
    assert.notEqual(section?.sectionId, "taxi_arr")
    assert.equal(section?.ruleId, "runway_arr_until_taxi_arr")
})

check("TWR separate: TXIN leaves RUNWAY (hidden taxi_arr)", () => {
    setRoles("ESSA_E_TWR", "TWR", ["TWR-E"], ["TWR"])
    staticConfig.onlineControllers = new Map([
        ["ESSA_E_GND", { role: "GND", frequency: 121.7, callsign: "ESSA_E_GND" }],
    ])
    const section = determineSectionForFlight(
        arrival({
            controller: "ESSA_E_TWR",
            groundstate: "TXIN",
            ...ON_RWY,
            currentAltitude: 50,
        }),
        staticConfig,
    )
    assert.equal(section?.sectionId, "taxi_arr")
    assert.equal(section?.ruleId, "taxi_arr_txin_twr_separate")
})

check("GND separate: incoming transfer → taxi_arr", () => {
    setRoles("ESSA_E_GND", "GND", ["GND-E"], ["GND"])
    staticConfig.onlineControllers = new Map([
        ["ESSA_E_TWR", { role: "TWR", frequency: 118.5, callsign: "ESSA_E_TWR" }],
    ])
    const section = determineSectionForFlight(
        arrival({
            controller: "ESSA_E_TWR",
            handoffTargetController: "ESSA_E_GND",
        }),
        staticConfig,
    )
    assert.equal(section?.sectionId, "taxi_arr")
    assert.equal(section?.ruleId, "taxi_arr_pending_inbound_transfer")
})

check("GND separate: after ASSUME (ARR) stay taxi_arr", () => {
    setRoles("ESSA_E_GND", "GND", ["GND-E"], ["GND"])
    staticConfig.onlineControllers = new Map([
        ["ESSA_E_TWR", { role: "TWR", frequency: 118.5, callsign: "ESSA_E_TWR" }],
    ])
    const section = determineSectionForFlight(
        arrival({
            controller: "ESSA_E_GND",
            handoffTargetController: "",
        }),
        staticConfig,
    )
    assert.equal(section?.sectionId, "taxi_arr")
    assert.equal(section?.ruleId, "taxi_arr_assumed_gnd_separate")
})

check("Combined GND+TWR: TXIN (TAXI) → taxi_arr even on RWY", () => {
    setRoles("ESSA_E_TWR", "TWR", ["TWR-E", "GND-E"], ["GND", "TWR"])
    staticConfig.onlineControllers = new Map()
    const section = determineSectionForFlight(
        arrival({
            controller: "ESSA_E_TWR",
            groundstate: "TXIN",
            ...ON_RWY,
        }),
        staticConfig,
    )
    assert.equal(section?.sectionId, "taxi_arr")
    assert.equal(section?.ruleId, "taxi_arr_assumed_gnd")
})

check("Combined GND+TWR: vacated ARR (off polygon) stays on RWY until TXIN", () => {
    setRoles("ESSA_E_TWR", "TWR", ["TWR-E", "GND-E"], ["GND", "TWR"])
    staticConfig.onlineControllers = new Map()
    staticConfig.activeRunways = { ESSA: { arr: ["01L"], dep: ["01R"] } }
    const section = determineSectionForFlight(
        arrival({
            controller: "ESSA_E_TWR",
            groundstate: "ARR",
            arrRwy: "01L",
        }),
        staticConfig,
    )
    assert.notEqual(section?.sectionId, "taxi_arr")
    assert.equal(section?.ruleId, "runway_arr_until_taxi_arr")
})

check("Combined GND+TWR: on-polygon ARR uses GS until-taxi (no geo hold)", () => {
    setRoles("ESSA_E_TWR", "TWR", ["TWR-E", "GND-E"], ["GND", "TWR"])
    staticConfig.onlineControllers = new Map()
    staticConfig.activeRunways = { ESSA: { arr: ["01L"], dep: ["01R"] } }
    const section = determineSectionForFlight(
        arrival({
            controller: "ESSA_E_TWR",
            groundstate: "ARR",
            arrRwy: "01L",
            ...ON_RWY,
            currentAltitude: 50,
        }),
        staticConfig,
    )
    assert.ok(section?.ruleId)
    assert.ok(!String(section!.ruleId).startsWith("on_runway_geographic"))
    assert.ok(!String(section!.ruleId).startsWith("runway_hold_twr_only"))
    assert.equal(section?.ruleId, "runway_arr_until_taxi_arr")
    assert.ok(
        section?.sectionId === "arr_runway" ||
            (section?.sectionId && isEssaDynamicRunwaySectionId(section.sectionId)),
    )
})

check("TWR: airborne dep → CTR DEP (shown by default, including split)", () => {
    setRoles("ESSA_E_TWR", "TWR", ["TWR-E"], ["TWR"])
    staticConfig.onlineControllers = new Map([
        ["ESSA_E_GND", { role: "GND", frequency: 121.7, callsign: "ESSA_E_GND" }],
    ])
    assert.equal(
        isEssaSectionVisibleForPicker(
            "ctr_dep",
            ["TWR-E"],
            staticConfig.sectionVisibleFor,
            ["GND-E"],
        ),
        true,
    )
    const section = determineSectionForFlight(departure(), staticConfig)
    assert.equal(section?.sectionId, "ctr_dep")
    assert.equal(section?.ruleId, "ctr_dep_airborne")
})

check("Airborne dep stays DEP RWY when CTR DEP column removed from layout", () => {
    setRoles("ESSA_E_TWR", "TWR", ["TWR-E"], ["TWR"])
    staticConfig.onlineControllers = new Map()
    const prev = staticConfig.sectionVisibleFor
    staticConfig.sectionVisibleFor = new Map(prev)
    staticConfig.sectionVisibleFor.set("ctr_dep", ["APP"])
    const section = determineSectionForFlight(departure(), staticConfig)
    staticConfig.sectionVisibleFor = prev
    assert.ok(section)
    assert.ok(
        section!.sectionId === "dep_runway" ||
            isEssaDynamicRunwaySectionId(section!.sectionId),
    )
    assert.equal(section!.ruleId, "dep_runway_airborne_hold")
})

console.log("essa-arr-taxi-moves: ok")

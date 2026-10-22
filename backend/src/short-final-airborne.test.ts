/**
 * Short final must stay airborne (ARR RWY) until the aircraft has been on the
 * runway. Groundstate ARR is set on the approach, and the runway polygon starts
 * at the threshold, so "off the polygon" is not a vacate.
 *
 * Run: npx tsx src/short-final-airborne.test.ts
 */
import assert from "node:assert/strict"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { loadAirports } from "./airport-data.js"
import { loadConfig } from "./config-loader.js"
import { applyConfig, setMyAirports, setMyCallsign, setMyRole, staticConfig } from "./static-config.js"
import { determineSectionForFlight } from "./rules-engine.js"
import { loadRunways } from "./runway-data.js"
import { isOnAnyRunway } from "./runway-detection.js"
import { flightStore, hasVacatedRunwayAfterLanding } from "./flightStore.js"
import type { Flight } from "./types.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.resolve(__dirname, "../../data")

const ALT = 250 // ESSA field 137 → 113 ft AGL: below airborne band, inside runway alt gate
const GS = 140
const SHORT = { latitude: 59.677676, longitude: 17.927906 }
const ON_RWY = { latitude: 59.6518497467041, longitude: 17.91849994659424 }
// Just west of 01L/19R, still on the airport — outside the polygon, inside ground range.
const OFF_RWY = { latitude: 59.65185, longitude: 17.9 }

function check(name: string, fn: () => void) {
    try {
        fn()
        console.log(`ok - ${name}`)
    } catch (e) {
        console.error(`FAIL - ${name}`)
        throw e
    }
}

check("short final is not a vacate", () => {
    assert.equal(
        hasVacatedRunwayAfterLanding({
            positionKnown: true,
            onRunway: false,
            touchedRunway: false,
            groundstate: "ARR",
            groundSpeed: GS,
        }),
        false,
    )
})

check("still on the pavement is not a vacate", () => {
    assert.equal(
        hasVacatedRunwayAfterLanding({
            positionKnown: true,
            onRunway: true,
            touchedRunway: true,
            groundstate: "ARR",
            groundSpeed: GS,
        }),
        false,
    )
})

check("leaving the pavement after touching is a vacate", () => {
    assert.equal(
        hasVacatedRunwayAfterLanding({
            positionKnown: true,
            onRunway: false,
            touchedRunway: true,
            groundstate: "ARR",
            groundSpeed: GS,
        }),
        true,
    )
    assert.equal(
        hasVacatedRunwayAfterLanding({
            positionKnown: true,
            onRunway: false,
            touchedRunway: true,
            groundstate: "TXIN",
            groundSpeed: 90,
        }),
        true,
    )
    assert.equal(
        hasVacatedRunwayAfterLanding({
            positionKnown: true,
            onRunway: false,
            touchedRunway: true,
            groundstate: "",
            groundSpeed: 70,
        }),
        true,
    )
})

check("fast and not ARR/TXIN stays airborne until slow", () => {
    assert.equal(
        hasVacatedRunwayAfterLanding({
            positionKnown: true,
            onRunway: false,
            touchedRunway: true,
            groundstate: "",
            groundSpeed: 120,
        }),
        false,
    )
})

check("missing position is not a vacate", () => {
    assert.equal(
        hasVacatedRunwayAfterLanding({
            positionKnown: false,
            onRunway: false,
            touchedRunway: true,
            groundstate: "ARR",
            groundSpeed: GS,
        }),
        false,
    )
})

loadAirports(path.join(dataDir, "airports.csv"))
loadRunways(path.join(dataDir, "runways.csv"))
const cfg = loadConfig(path.join(dataDir, "config/essa.yml"))
applyConfig(cfg)
setMyAirports(["ESSA"])
setMyCallsign("ESSA_W_TWR")
setMyRole("TWR")
staticConfig.activeRunways = { ESSA: { arr: ["19R"], dep: ["19L"] } }

check("fixture points sit short of, on, and clear of ESSA 19R", () => {
    assert.equal(isOnAnyRunway(SHORT.latitude, SHORT.longitude, ALT, ["ESSA"])?.onRunway, undefined)
    assert.equal(isOnAnyRunway(ON_RWY.latitude, ON_RWY.longitude, ALT, ["ESSA"])?.onRunway, true)
    assert.equal(isOnAnyRunway(OFF_RWY.latitude, OFF_RWY.longitude, ALT, ["ESSA"])?.onRunway, undefined)
})

function seedArrival(callsign: string): Flight {
    const flight: Flight = {
        callsign,
        origin: "ENGM",
        destination: "ESSA",
        aircraftType: "A320",
        flightRules: "I",
        airborne: true,
        clearedToLand: true,
        groundstate: "ARR",
        arrRwy: "19R",
        firstSeen: Date.now(),
        lastUpdate: Date.now(),
    }
    ;(flightStore as unknown as { flights: Map<string, Flight> }).flights.set(callsign, flight)
    return flight
}

function radar(callsign: string, pos: { latitude: number; longitude: number }, altitude = ALT) {
    flightStore.processMessage({
        type: "radarTargetPositionUpdate",
        callsign,
        altitude,
        groundSpeed: GS,
        latitude: pos.latitude,
        longitude: pos.longitude,
    })
}

check("short final stays on the arrival runway", () => {
    const flight = seedArrival("SF1")
    radar("SF1", SHORT)
    assert.equal(flight.airborne, true)
    const section = determineSectionForFlight(flight, staticConfig)
    assert.equal(section?.ruleId, "runway_cleared_to_land_arr")
    assert.notEqual(section?.sectionId, "taxi_arr")
    const assignment = flightStore.getStripAssignment("SF1")
    assert.notEqual(assignment?.sectionId, "taxi_arr")
})

check("threshold then vacate moves to taxi only after the pavement", () => {
    const flight = seedArrival("SF2")
    radar("SF2", SHORT)
    assert.equal(flight.airborne, true)
    radar("SF2", ON_RWY)
    assert.equal(flight.airborne, true)
    assert.equal(flightStore.getStripAssignment("SF2")?.sectionId === "taxi_arr", false)
    radar("SF2", OFF_RWY)
    assert.equal(flight.airborne, false)
    const section = determineSectionForFlight(flight, staticConfig)
    assert.equal(section?.ruleId, "taxi_arr")
})

check("go-around without touching the runway stays airborne on the next short final", () => {
    const flight = seedArrival("SF3")
    radar("SF3", SHORT)
    assert.equal(flight.airborne, true)
    radar("SF3", SHORT, 2500)
    assert.equal(flight.airborne, true)
    radar("SF3", SHORT)
    assert.equal(flight.airborne, true)
    assert.equal(determineSectionForFlight(flight, staticConfig)?.ruleId, "runway_cleared_to_land_arr")
})

console.log("short-final-airborne: ok")

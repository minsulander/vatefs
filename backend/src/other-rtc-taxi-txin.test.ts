/**
 * OTHER / RTC: no geographic RWY hold; TAXI (TXIN) moves ARR to TAXIWAY.
 * Run: npx tsx src/other-rtc-taxi-txin.test.ts
 */
import assert from "node:assert/strict"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { loadAirports } from "./airport-data.js"
import { loadConfig } from "./config-loader.js"
import { loadRunways } from "./runway-data.js"
import {
    applyConfig,
    setMyAirports,
    setMyCallsign,
    setMyRole,
    staticConfig,
} from "./static-config.js"
import { determineSectionForFlight } from "./rules-engine.js"
import type { Flight } from "./types.js"

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

const ON_RWY = { latitude: 59.6518497467041, longitude: 17.91849994659424 }

function arrival(overrides: Partial<Flight> = {}): Flight {
    return {
        callsign: "SAS200",
        origin: "EKCH",
        destination: "ESSA",
        aircraftType: "A320",
        airborne: false,
        clearedToLand: false,
        ...ON_RWY,
        currentAltitude: 50,
        controller: "ESSA_TWR",
        firstSeen: Date.now(),
        lastUpdate: Date.now(),
        ...overrides,
    }
}

console.log("other-rtc-taxi-txin")

check("OTHER: ARR stays on runway until TAXI (no geo hold)", () => {
    applyConfig(loadConfig(path.join(dataDir, "config/saab.yml")))
    setMyAirports(["ESSA"])
    setMyCallsign("ESSA_TWR")
    setMyRole("TWR")
    const section = determineSectionForFlight(
        arrival({ groundstate: "ARR" }),
        staticConfig,
    )
    assert.equal(section?.sectionId, "runway")
    assert.equal(section?.ruleId, "runway_arr_until_taxi")
})

check("OTHER: TXIN → taxi", () => {
    applyConfig(loadConfig(path.join(dataDir, "config/saab.yml")))
    setMyAirports(["ESSA"])
    setMyCallsign("ESSA_TWR")
    setMyRole("TWR")
    const section = determineSectionForFlight(
        arrival({ groundstate: "TXIN" }),
        staticConfig,
    )
    assert.equal(section?.sectionId, "taxi")
    assert.equal(section?.ruleId, "taxi_arr")
})

check("RTC: ARR stays on rwy until TAXI", () => {
    applyConfig(loadConfig(path.join(dataDir, "config/multiairport.yml")))
    setMyAirports(["ESSA"])
    setMyCallsign("ESSA_TWR")
    setMyRole("TWR")
    staticConfig.columnAirports = ["ESSA", null, null, null]
    const section = determineSectionForFlight(
        arrival({ groundstate: "ARR" }),
        staticConfig,
        "ESSA",
    )
    assert.ok(section)
    assert.equal(section!.sectionId.endsWith("_rwy") || section!.sectionId === "rwy", true)
    assert.equal(section!.ruleId, "runway_arr_until_taxi")
})

check("RTC: TXIN → twy", () => {
    applyConfig(loadConfig(path.join(dataDir, "config/multiairport.yml")))
    setMyAirports(["ESSA"])
    setMyCallsign("ESSA_TWR")
    setMyRole("TWR")
    staticConfig.columnAirports = ["ESSA", null, null, null]
    const section = determineSectionForFlight(
        arrival({ groundstate: "TXIN" }),
        staticConfig,
        "ESSA",
    )
    assert.ok(section)
    assert.equal(section!.sectionId.endsWith("_twy") || section!.sectionId === "twy", true)
    assert.equal(section!.ruleId, "twy_taxi_arr")
})

console.log("other-rtc-taxi-txin: ok")

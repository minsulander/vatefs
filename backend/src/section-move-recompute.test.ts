/**
 * Regression: after a section move, recomputePositions on the OLD section must not
 * run while the mover is still listed there — that overwrites flightStore back to
 * the previous sectionId (runway↔taxi flicker).
 *
 * Run: npx tsx src/section-move-recompute.test.ts
 */
import assert from "node:assert/strict"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { loadConfig } from "./config-loader.js"
import {
    applyConfig,
    setEssaRoles,
    setMyCallsign,
    setMyRole,
    setMyAirports,
} from "./static-config.js"
import { flightStore } from "./flightStore.js"
import { store } from "./store.js"
import type { Flight } from "./types.js"
import type { FlightStrip } from "@vatefs/common"
import { determineSectionForFlight } from "./rules-engine.js"
import { staticConfig } from "./static-config.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function check(name: string, fn: () => void) {
    try {
        fn()
        console.log(`ok - ${name}`)
    } catch (e) {
        console.error(`FAIL - ${name}`)
        throw e
    }
}

const cfg = loadConfig(path.resolve(__dirname, "../../data/config/essa.yml"))
applyConfig(cfg)
setMyAirports(["ESSA"])
setMyCallsign("ESSA_W_TWR")
setMyRole("TWR")
setEssaRoles(["DEL", "GND", "TWR"], true)

function seedRunwayStrip(callsign: string): FlightStrip {
    const flight: Flight = {
        callsign,
        origin: "ENGM",
        destination: "ESSA",
        aircraftType: "A320",
        airborne: true,
        clearedToLand: true,
        groundstate: "ARR",
        controller: "ESSA_W_TWR",
        firstSeen: Date.now(),
        lastUpdate: Date.now(),
    }
    ;(flightStore as unknown as { flights: Map<string, Flight> }).flights.set(callsign, flight)
    flightStore.setStripAssignment(callsign, {
        bayId: "bay1",
        sectionId: "runway_01R_19L",
        position: 0,
        bottom: false,
    })
    const strip = flightStore.regenerateStrip(callsign)
    assert.ok(strip)
    return store.updateStripFromFlight(strip!, { allowPositionChange: true })
}

check("buggy recompute-before-apply restores old sectionId", () => {
    store.loadMockData(false)
    flightStore.clear()
    seedRunwayStrip("BUG1")

    flightStore.setStripAssignment("BUG1", {
        bayId: "bay1",
        sectionId: "taxi_arr",
        position: 0,
        bottom: false,
    })
    const taxiStrip: FlightStrip = {
        ...store.getStrip("BUG1")!,
        sectionId: "taxi_arr",
        position: 0,
    }

    // Old (buggy) order: recompute while strip still on runway in store.strips
    store.recomputePositions("bay1", "runway_01R_19L", false)
    assert.equal(
        flightStore.getStripAssignment("BUG1")?.sectionId,
        "runway_01R_19L",
        "buggy order overwrites taxi assignment back to runway",
    )
    store.updateStripFromFlight(taxiStrip, { allowPositionChange: true })
})

check("apply-then-recompute keeps taxi assignment", () => {
    store.loadMockData(false)
    flightStore.clear()
    seedRunwayStrip("OK1")

    flightStore.setStripAssignment("OK1", {
        bayId: "bay1",
        sectionId: "taxi_arr",
        position: 0,
        bottom: false,
    })
    const taxiStrip: FlightStrip = {
        ...store.getStrip("OK1")!,
        sectionId: "taxi_arr",
        position: 0,
    }

    store.updateStripFromFlight(taxiStrip, { allowPositionChange: true })
    store.recomputePositions("bay1", "runway_01R_19L", false)

    assert.equal(flightStore.getStripAssignment("OK1")?.sectionId, "taxi_arr")
    assert.equal(store.getStrip("OK1")?.sectionId, "taxi_arr")
    assert.equal(
        store.getStripsForSection("bay1", "runway_01R_19L", false).some((s) => s.id === "OK1"),
        false,
    )
})

check("taxi_arr_assumed_gnd does not match while clearedToLand", () => {
    const flight: Flight = {
        callsign: "CTL1",
        origin: "ENGM",
        destination: "ESSA",
        aircraftType: "A320",
        airborne: false,
        clearedToLand: true,
        groundstate: "ARR",
        controller: "ESSA_W_TWR",
        firstSeen: Date.now(),
        lastUpdate: Date.now(),
    }
    const section = determineSectionForFlight(flight, staticConfig)
    assert.notEqual(
        section?.ruleId,
        "taxi_arr_assumed_gnd",
        `CTL + not airborne must not use taxi_arr_assumed_gnd (got ${section?.ruleId})`,
    )
})

console.log("\nsection-move-recompute tests done")

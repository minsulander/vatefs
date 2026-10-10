/**
 * TAXIWAY ARR: groundstate ARR→TXIN/TAXI must not reshuffle appearance order.
 * Run: npx tsx src/taxi-arr-order.test.ts
 */

import assert from "node:assert/strict"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { loadConfig } from "./config-loader.js"
import {
    applyConfig,
    staticConfig,
    setEssaRoles,
    setMyCallsign,
    setMyRole,
    setMyAirports,
} from "./static-config.js"
import { determineSectionForFlight } from "./rules-engine.js"
import { flightStore } from "./flightStore.js"
import { store } from "./store.js"
import type { Flight } from "./types.js"
import type { FlightStrip } from "@vatefs/common"

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

function arrivalFlight(callsign: string, gs: Flight["groundstate"]): Flight {
    return {
        callsign,
        origin: "ENGM",
        destination: "ESSA",
        aircraftType: "A320",
        airborne: false,
        groundstate: gs,
        controller: "ESSA_W_GND",
        // No lat/lon — skip groundRange gate in evaluateSectionRule (airport CSV not required)
        firstSeen: Date.now(),
        lastUpdate: Date.now(),
    }
}

function seedTaxiArrStrip(callsign: string, position: number, gs: Flight["groundstate"] = "ARR"): FlightStrip {
    const flight = arrivalFlight(callsign, gs)
    // Test harness: seed private flight map
    ;(flightStore as unknown as { flights: Map<string, Flight> }).flights.set(callsign, flight)
    flightStore.setStripAssignment(callsign, {
        bayId: "bay1",
        sectionId: "taxi_arr",
        position,
        bottom: false,
    })
    const strip = flightStore.regenerateStrip(callsign)
    assert.ok(strip, `strip for ${callsign}`)
    // allowPositionChange: seed must write the chosen appearance index
    return store.updateStripFromFlight(strip!, { allowPositionChange: true })
}

const cfg = loadConfig(path.resolve(__dirname, "../../data/config/essa.yml"))
applyConfig(cfg)
setMyAirports(["ESSA"])
setMyCallsign("ESSA_W_GND")
setMyRole("GND")
setEssaRoles(["GND-W"], true)

check("ARR / TXIN / TAXI all stay in taxi_arr for GND", () => {
    assert.deepEqual(staticConfig.myAirports, ["ESSA"])
    const flight = arrivalFlight("TST1", "ARR")
    assert.equal(flight.destination, "ESSA")
    assert.ok(
        staticConfig.sectionRules.some((r) => r.id === "taxi_arr"),
        "taxi_arr rule present"
    )
    for (const gs of ["ARR", "TXIN", "TAXI", ""] as const) {
        const section = determineSectionForFlight(arrivalFlight("TST1", gs), staticConfig)
        assert.equal(section?.sectionId, "taxi_arr", `gs=${gs} rule=${section?.ruleId}`)
    }
})

check("same-section TXIN/TAXI keep store position when flightStore assignment is stale", () => {
    for (const nextGs of ["TXIN", "TAXI"] as const) {
        store.loadMockData(false)
        flightStore.clear()

        // Visual order in store: AAA=0, BBB=1, CCC=2
        seedTaxiArrStrip("AAA", 0)
        seedTaxiArrStrip("BBB", 1)
        seedTaxiArrStrip("CCC", 2)

        // Stale flightStore: BBB wrongly at 0 (desync after reorder / shift)
        flightStore.setStripAssignment("BBB", {
            bayId: "bay1",
            sectionId: "taxi_arr",
            position: 0,
            bottom: false,
        })

        const flight = flightStore.getFlight("BBB")!
        flight.groundstate = nextGs
        const result = flightStore.reevaluateStrip("BBB")
        assert.equal(result.sectionChanged, false, `${nextGs}: must stay in taxi_arr`)
        assert.equal(result.strip?.sectionId, "taxi_arr")
        // Without pin, regenerate trusts stale assignment → position 0
        assert.equal(result.strip?.position, 0, `${nextGs}: stale assignment from reevaluate`)

        store.updateStripFromFlight(result.strip!)
        assert.equal(store.getStrip("BBB")?.position, 1, `${nextGs}: keep appearance pos`)
        assert.equal(flightStore.getStripAssignment("BBB")?.position, 1, `${nextGs}: sync assignment`)
        assert.equal(store.getStrip("AAA")?.position, 0)
        assert.equal(store.getStrip("CCC")?.position, 2)
    }
})

console.log("All taxi-arr order checks passed")

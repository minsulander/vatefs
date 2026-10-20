/**
 * Extra ESSA RWY headers only for strip-assigned runways on pairs not already
 * covered by active ES rwyconfig.
 * Run: npx tsx src/essa-assigned-rwy-headers.test.ts
 */
import assert from "node:assert/strict"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { loadConfig } from "./config-loader.js"
import {
    applyConfig,
    setActiveRunways,
    setMyAirports,
    setMyCallsign,
    setMyRole,
    setEssaRoles,
} from "./static-config.js"
import { flightStore } from "./flightStore.js"
import type { Flight } from "./types.js"

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
setActiveRunways({ ESSA: { arr: ["01L"], dep: ["01L"] } })

function seed(flight: Flight, sectionId: string) {
    ;(flightStore as unknown as { flights: Map<string, Flight> }).flights.set(flight.callsign, flight)
    flightStore.setStripAssignment(flight.callsign, {
        bayId: "bay1",
        sectionId,
        position: 0,
        bottom: false,
    })
}

check("CLEARED dep on active 01L does not open extra header", () => {
    flightStore.clear()
    seed(
        {
            callsign: "VKG187",
            origin: "ESSA",
            destination: "ENGM",
            depRwy: "01L",
            groundstate: "",
            clearance: true,
            firstSeen: Date.now(),
            lastUpdate: Date.now(),
        },
        "cleared",
    )
    assert.deepEqual(flightStore.getEssaAssignedRunways(), { arr: [], dep: [] })
})

check("19R (same physical pair as 01L) does not open extra header", () => {
    flightStore.clear()
    seed(
        {
            callsign: "SAS2",
            origin: "ENGM",
            destination: "ESSA",
            arrRwy: "19R",
            airborne: true,
            firstSeen: Date.now(),
            lastUpdate: Date.now(),
        },
        "inbound",
    )
    assert.deepEqual(flightStore.getEssaAssignedRunways(), { arr: [], dep: [] })
})

check("forced DEP 08 while config is 01L opens 08/26 header", () => {
    flightStore.clear()
    seed(
        {
            callsign: "SAS3",
            origin: "ESSA",
            destination: "ENGM",
            depRwy: "08",
            clearance: true,
            firstSeen: Date.now(),
            lastUpdate: Date.now(),
        },
        "cleared",
    )
    assert.deepEqual(flightStore.getEssaAssignedRunways(), { arr: [], dep: ["08"] })
})

check("forced ARR 19L while config is 01L opens 01R/19L header", () => {
    flightStore.clear()
    seed(
        {
            callsign: "SAS4",
            origin: "ENGM",
            destination: "ESSA",
            arrRwy: "19L",
            airborne: true,
            firstSeen: Date.now(),
            lastUpdate: Date.now(),
        },
        "inbound",
    )
    assert.deepEqual(flightStore.getEssaAssignedRunways(), { arr: ["19L"], dep: [] })
})

check("no strip → assigned runway ignored", () => {
    flightStore.clear()
    ;(flightStore as unknown as { flights: Map<string, Flight> }).flights.set("NOS1", {
        callsign: "NOS1",
        origin: "ESSA",
        destination: "ENGM",
        depRwy: "08",
        firstSeen: Date.now(),
        lastUpdate: Date.now(),
    })
    assert.deepEqual(flightStore.getEssaAssignedRunways(), { arr: [], dep: [] })
})

console.log("\nessa-assigned-rwy-headers tests done")

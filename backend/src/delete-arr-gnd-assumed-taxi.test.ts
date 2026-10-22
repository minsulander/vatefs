/**
 * ESSA: soft-delete arrivals when separate GND has assumed + taxi-in.
 * Run: npx tsx src/delete-arr-gnd-assumed-taxi.test.ts
 */

import assert from "node:assert/strict"
import type { Flight } from "./types.js"
import type { DeleteRule, EfsStaticConfig } from "./config-types.js"
import { shouldDeleteFlight } from "./rules-engine.js"

const DELETE_RULE: DeleteRule = {
    id: "delete_arr_gnd_assumed_taxi",
    direction: "arrival",
    groundstates: ["TXIN", "TAXI"],
    airborne: false,
    controller: "not_myself",
    ownerRole: ["GND"],
    myRole: ["TWR"],
    notMyRole: ["GND"],
    essaFamilies: ["TWR"],
    notEssaFamilies: ["GND"],
    priority: 90,
}

function baseConfig(overrides: Partial<EfsStaticConfig> = {}): EfsStaticConfig {
    return {
        myAirports: ["ESSA"],
        radarRangeNm: 25,
        arrivalRangeNm: 100,
        arrivalEtaMinutes: 20,
        groundRangeNm: 3,
        layout: { bays: [] },
        sectionToBay: new Map(),
        sectionRules: [],
        actionRules: [],
        deleteRules: [DELETE_RULE],
        moveRules: [],
        layoutMode: "essaRoles",
        look: "saab",
        myRole: "TWR",
        myCallsign: "ESSA_E_TWR",
        // Separate GND online → TWR covers TWR only
        myRolesByAirport: new Map([["ESSA", ["TWR"]]]),
        essaRoles: ["TWR-E"],
        onlineControllers: new Map([
            [
                "ESSA_E_GND",
                { role: "GND", frequency: 121.7, callsign: "ESSA_E_GND" },
            ],
        ]),
        ...overrides,
    }
}

function arrivalFlight(overrides: Partial<Flight> = {}): Flight {
    return {
        callsign: "SAS123",
        origin: "EKCH",
        destination: "ESSA",
        airborne: false,
        groundstate: "TXIN",
        controller: "ESSA_E_GND",
        ...overrides,
    }
}

function check(name: string, fn: () => void) {
    try {
        fn()
        console.log(`  ok  ${name}`)
    } catch (e) {
        console.error(`  FAIL  ${name}`)
        throw e
    }
}

console.log("delete_arr_gnd_assumed_taxi")

check("hides when TWR + separate GND, GND assumed, TXIN", () => {
    const r = shouldDeleteFlight(arrivalFlight(), baseConfig())
    assert.equal(r.shouldDelete, true)
    assert.equal(r.ruleId, "delete_arr_gnd_assumed_taxi")
})

check("hides for TAXI groundstate too", () => {
    const r = shouldDeleteFlight(arrivalFlight({ groundstate: "TAXI" }), baseConfig())
    assert.equal(r.shouldDelete, true)
})

check("does not hide when solo TWR covers GND", () => {
    const r = shouldDeleteFlight(
        arrivalFlight(),
        baseConfig({
            myRolesByAirport: new Map([["ESSA", ["DEL", "GND", "TWR"]]]),
            onlineControllers: new Map(),
        }),
    )
    assert.equal(r.shouldDelete, false)
})

check("does not hide when GND+TWR both selected (combined)", () => {
    const r = shouldDeleteFlight(
        arrivalFlight(),
        baseConfig({
            essaRoles: ["TWR-E", "GND-E"],
        }),
    )
    assert.equal(r.shouldDelete, false)
})

check("does not hide when still ARR (no taxi state)", () => {
    const r = shouldDeleteFlight(arrivalFlight({ groundstate: "ARR" }), baseConfig())
    assert.equal(r.shouldDelete, false)
})

check("does not hide when TWR still owns (not GND)", () => {
    const r = shouldDeleteFlight(
        arrivalFlight({ controller: "ESSA_W_TWR" }),
        baseConfig(),
    )
    assert.equal(r.shouldDelete, false)
})

check("does not hide when I myself own it", () => {
    const r = shouldDeleteFlight(
        arrivalFlight({ controller: "ESSA_E_TWR" }),
        baseConfig(),
    )
    assert.equal(r.shouldDelete, false)
})

check("does not hide departures", () => {
    const r = shouldDeleteFlight(
        arrivalFlight({
            origin: "ESSA",
            destination: "EKCH",
            groundstate: "TAXI",
            controller: "ESSA_E_GND",
        }),
        baseConfig(),
    )
    assert.equal(r.shouldDelete, false)
})

check("does not hide for GND client (myRole TWR required)", () => {
    const r = shouldDeleteFlight(
        arrivalFlight({ controller: "ESSA_E_GND" }),
        baseConfig({
            myRole: "GND",
            myCallsign: "ESSA_E_GND",
            myRolesByAirport: new Map([["ESSA", ["DEL", "GND"]]]),
            essaRoles: ["GND-E"],
        }),
    )
    assert.equal(r.shouldDelete, false)
})

console.log("all passed")

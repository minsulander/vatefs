/**
 * ESSA: GND soft-deletes TWR-owned LINEUP/DEPA deps (separate TWR online).
 * Run: npx tsx src/delete-dep-twr-lineup-gnd.test.ts
 */

import assert from "node:assert/strict"
import type { Flight } from "./types.js"
import type { DeleteRule, EfsStaticConfig } from "./config-types.js"
import { shouldDeleteFlight } from "./rules-engine.js"

const DELETE_DEP: DeleteRule = {
    id: "delete_dep_twr_lineup_gnd",
    direction: "departure",
    airborne: false,
    controller: "not_myself",
    ownerRole: ["TWR"],
    groundstates: ["LINEUP", "DEPA"],
    myRole: ["GND"],
    notMyRole: ["TWR"],
    essaFamilies: ["GND"],
    notEssaFamilies: ["TWR"],
    priority: 95,
}

const DELETE_LOCAL: DeleteRule = {
    id: "delete_dep_twr_lineup_local_gnd",
    direction: "local",
    airborne: false,
    controller: "not_myself",
    ownerRole: ["TWR"],
    groundstates: ["LINEUP", "DEPA"],
    myRole: ["GND"],
    notMyRole: ["TWR"],
    essaFamilies: ["GND"],
    notEssaFamilies: ["TWR"],
    priority: 95,
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
        deleteRules: [DELETE_DEP, DELETE_LOCAL],
        moveRules: [],
        layoutMode: "essaRoles",
        look: "saab",
        myRole: "GND",
        myCallsign: "ESSA_W_GND",
        myRolesByAirport: new Map([["ESSA", ["GND"]]]),
        essaRoles: ["GND-W"],
        onlineControllers: new Map([
            [
                "ESSA_W__TWR",
                { role: "TWR", frequency: 118.5, callsign: "ESSA_W__TWR" },
            ],
        ]),
        ...overrides,
    }
}

function depFlight(overrides: Partial<Flight> = {}): Flight {
    return {
        callsign: "NSZ1VD",
        origin: "ESSA",
        destination: "ESGG",
        airborne: false,
        groundstate: "LINEUP",
        controller: "ESSA_W__TWR",
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

console.log("delete_dep_twr_lineup_gnd")

check("hides TWR-owned LINEUP dep on separate GND", () => {
    const r = shouldDeleteFlight(depFlight(), baseConfig())
    assert.equal(r.shouldDelete, true)
    assert.equal(r.ruleId, "delete_dep_twr_lineup_gnd")
})

check("hides TWR-owned DEPA dep on separate GND", () => {
    const r = shouldDeleteFlight(depFlight({ groundstate: "DEPA" }), baseConfig())
    assert.equal(r.shouldDelete, true)
})

check("keeps TWR-owned TAXI dep visible on GND", () => {
    const r = shouldDeleteFlight(depFlight({ groundstate: "TAXI" }), baseConfig())
    assert.equal(r.shouldDelete, false)
})

check("does not hide when GND still owns", () => {
    const r = shouldDeleteFlight(
        depFlight({ controller: "ESSA_W_GND" }),
        baseConfig(),
    )
    assert.equal(r.shouldDelete, false)
})

check("does not hide when GND covers TWR (combined roles)", () => {
    const r = shouldDeleteFlight(
        depFlight(),
        baseConfig({
            essaRoles: ["GND-W", "TWR-W"],
            myRolesByAirport: new Map([["ESSA", ["GND", "TWR"]]]),
        }),
    )
    assert.equal(r.shouldDelete, false)
})

check("hides local LINEUP owned by TWR", () => {
    const r = shouldDeleteFlight(
        depFlight({
            callsign: "ABC123",
            origin: "ESSA",
            destination: "ESSA",
            groundstate: "LINEUP",
        }),
        baseConfig(),
    )
    assert.equal(r.shouldDelete, true)
    assert.equal(r.ruleId, "delete_dep_twr_lineup_local_gnd")
})

console.log("\nall passed")

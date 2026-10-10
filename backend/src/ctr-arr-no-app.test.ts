/**
 * Bad-FLEG CTR ARR fallback when APP/CTR offline.
 * Run: npx tsx src/ctr-arr-no-app.test.ts
 */

import assert from "node:assert/strict"
import type { Flight } from "./types.js"
import type { ControllerRole, EfsStaticConfig, SectionRule } from "./config-types.js"
import {
    determineSectionForFlight,
    flightLooksLikeArrival,
    hasOnlineRolesCoveringAirports,
} from "./rules-engine.js"
import { isWithinCtr, loadCtrData } from "./ctr-data.js"

function baseConfig(overrides: Partial<EfsStaticConfig> = {}): EfsStaticConfig {
    const rules: SectionRule[] = [
        {
            id: "ctr_dep_airborne",
            sectionId: "ctr_dep",
            direction: "departure",
            airborne: true,
            priority: 100,
        },
        {
            id: "ctr_arr_within_ctr",
            sectionId: "ctr_arr",
            direction: "arrival",
            airborne: true,
            groundstates: ["", "NSTS", "ARR"],
            withinCtr: true,
            priority: 76,
        },
        {
            id: "ctr_arr_within_ctr_no_app",
            sectionId: "ctr_arr",
            airborne: true,
            withinCtr: true,
            arrivalLike: true,
            clearedToLand: false,
            notOnlineRoles: ["APP", "CTR"],
            myRole: ["TWR"],
            priority: 101,
        },
        {
            id: "runway_cleared_to_land_arr",
            sectionId: "arr_runway",
            direction: "either",
            clearedToLand: true,
            airborne: true,
            groundstates: ["", "NSTS", "ARR"],
            priority: 95,
        },
        {
            id: "fallback_arrival",
            sectionId: "inbound",
            direction: "arrival",
            airborne: true,
            priority: 5,
        },
    ]
    return {
        myAirports: ["ESSA"],
        radarRangeNm: 25,
        arrivalRangeNm: 100,
        arrivalEtaMinutes: 20,
        groundRangeNm: 3,
        layout: { bays: [{ id: "bay1", sections: [{ id: "ctr_arr", title: "CTR ARR" }, { id: "ctr_dep", title: "CTR DEP" }, { id: "arr_runway", title: "RWY" }, { id: "inbound", title: "INB" }] }] },
        sectionToBay: new Map([
            ["ctr_arr", "bay1"],
            ["ctr_dep", "bay1"],
            ["arr_runway", "bay1"],
            ["inbound", "bay1"],
        ]),
        sectionRules: rules,
        actionRules: [],
        deleteRules: [],
        moveRules: [],
        myRole: "TWR",
        myCallsign: "ESSA_Z_TWR",
        myRolesByAirport: new Map([["ESSA", ["DEL", "GND", "TWR"]]]),
        onlineControllers: new Map(),
        ...overrides,
    }
}

/** BCS8PT-ish position inside ESSA CTR (~1500 ft). */
function bcs8ptFlight(overrides: Partial<Flight> = {}): Flight {
    return {
        callsign: "BCS8PT",
        origin: "EDDH",
        destination: "ESSA",
        alternate: "EFHK",
        airborne: true,
        groundstate: "ARR",
        clearedToLand: false,
        currentAltitude: 1505,
        latitude: 59.55955,
        longitude: 17.9266,
        star: "NILUG3M",
        arrRwy: "01R",
        ...overrides,
    }
}

async function main() {
    await loadCtrData()

    // --- unit helpers ---
    assert.equal(isWithinCtr(["ESSA"], 59.55955, 17.9266, 1505), true)

    const cfg = baseConfig()
    assert.equal(flightLooksLikeArrival(bcs8ptFlight(), cfg), true)
    assert.equal(
        flightLooksLikeArrival(bcs8ptFlight({ destination: "ENGM", origin: "EDDH", alternate: "ESSA" }), cfg),
        true,
        "alternate at ESSA counts as arrival-like"
    )
    assert.equal(
        flightLooksLikeArrival(
            bcs8ptFlight({
                origin: "ESSA",
                destination: "ENGM",
                alternate: undefined,
                groundstate: "DEPA",
                star: undefined,
                arrRwy: undefined,
                clearedToLand: false,
            }),
            cfg
        ),
        false,
        "pure departure is not arrival-like"
    )
    assert.equal(hasOnlineRolesCoveringAirports(cfg, ["APP", "CTR"]), false)

    const withApp = baseConfig({
        onlineControllers: new Map([
            ["ESSA_A_APP", { role: "APP" as ControllerRole, frequency: 120.15, callsign: "ESSA_A_APP" }],
        ]),
    })
    assert.equal(hasOnlineRolesCoveringAirports(withApp, ["APP", "CTR"]), true)

    // --- section routing ---
    {
        // Normal arrival inside CTR, APP offline → no_app rule (same section as within_ctr)
        const r = determineSectionForFlight(bcs8ptFlight(), cfg)
        assert.equal(r?.sectionId, "ctr_arr")
        assert.equal(r?.ruleId, "ctr_arr_within_ctr_no_app")
    }

    {
        // Bad dest (cross) + alternate ESSA inside CTR, APP offline → CTR ARR
        const r = determineSectionForFlight(
            bcs8ptFlight({ destination: "ENGM", alternate: "ESSA" }),
            cfg
        )
        assert.equal(r?.sectionId, "ctr_arr")
        assert.equal(r?.ruleId, "ctr_arr_within_ctr_no_app")
    }

    {
        // Misclassified as departure (origin ESSA) but ARR gs → reclaim from CTR DEP
        const r = determineSectionForFlight(
            bcs8ptFlight({ origin: "ESSA", destination: "ENGM", groundstate: "ARR" }),
            cfg
        )
        assert.equal(r?.sectionId, "ctr_arr")
        assert.equal(r?.ruleId, "ctr_arr_within_ctr_no_app")
    }

    {
        // APP online + bad dest → do NOT steal (APP can correct)
        const r = determineSectionForFlight(
            bcs8ptFlight({ destination: "ENGM", alternate: "ESSA" }),
            withApp
        )
        assert.equal(r?.ruleId !== "ctr_arr_within_ctr_no_app", true)
        assert.notEqual(r?.sectionId, "ctr_arr")
    }

    {
        // CTL → runway wins (no_app requires clearedToLand: false)
        const r = determineSectionForFlight(bcs8ptFlight({ clearedToLand: true }), cfg)
        assert.equal(r?.sectionId, "arr_runway")
        assert.equal(r?.ruleId, "runway_cleared_to_land_arr")
    }

    {
        // APP online + normal arrival still uses within_ctr
        const r = determineSectionForFlight(bcs8ptFlight(), withApp)
        assert.equal(r?.sectionId, "ctr_arr")
        assert.equal(r?.ruleId, "ctr_arr_within_ctr")
    }

    console.log("ctr-arr-no-app: ok")
}

main().catch((err) => {
    console.error(err)
    process.exit(1)
})

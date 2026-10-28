/**
 * Unit tests for ESSA peer placement mapping.
 * Run: npx tsx src/essa-sync-placement.test.ts
 */

import assert from "node:assert/strict"
import { mapEssaRemotePlacement, stripMetaWithoutPlacement } from "./essa-sync-placement.js"
import type { EfsStaticConfig } from "./config-types.js"
import type { FlightStrip } from "@vatefs/common"
import type { Flight } from "./types.js"

let passed = 0
function check(name: string, fn: () => void) {
    try {
        fn()
        passed++
        console.log(`  ok  ${name}`)
    } catch (e) {
        console.error(`  FAIL ${name}`)
        throw e
    }
}

function baseConfig(roles: EfsStaticConfig["essaRoles"]): EfsStaticConfig {
    return {
        airports: ["ESSA"],
        myAirports: ["ESSA"],
        radarRange: 25,
        look: "saab",
        layoutMode: "essaRoles",
        essaRoles: roles,
        layout: {
            bays: [
                {
                    id: "bay1",
                    sections: [
                        { id: "inbound", title: "INBOUND" },
                        { id: "taxi_arr", title: "TAXIWAY ARR" },
                    ],
                },
                {
                    id: "bay3",
                    sections: [
                        { id: "inbound_gnd", title: "INBOUND GND" },
                        { id: "taxi_dep", title: "TAXIWAY DEP" },
                    ],
                },
            ],
        },
        sectionRules: {},
        actionRules: {},
        deleteRules: {},
        moveRules: {},
    } as unknown as EfsStaticConfig
}

function strip(partial: Partial<FlightStrip> & Pick<FlightStrip, "id" | "callsign">): FlightStrip {
    return {
        bayId: "bay3",
        sectionId: "taxi_dep",
        position: 0,
        stripType: "departure",
        ...partial,
    } as FlightStrip
}

console.log("essa-sync-placement tests")

check("scribble meta drops placement fields", () => {
    const out = stripMetaWithoutPlacement({
        bayId: "bay3",
        sectionId: "inbound_gnd",
        position: 2,
        bottom: true,
        ctl: true,
        callsign: "VKG1649",
    })
    assert.equal(out.bayId, undefined)
    assert.equal(out.sectionId, undefined)
    assert.equal(out.position, undefined)
    assert.equal(out.bottom, undefined)
    assert.equal(out.ctl, true)
    assert.equal(out.callsign, "VKG1649")
})

check("TWR inbound_gnd → GND taxi_dep", () => {
    const gnd = baseConfig(["GND-W"])
    gnd.layout.bays[1]!.sections = [{ id: "taxi_dep", title: "TAXIWAY DEP" }]
    const mapped = mapEssaRemotePlacement(
        gnd,
        "bay3",
        "inbound_gnd",
        strip({ id: "VKG1649", callsign: "VKG1649", sectionId: "taxi_dep" }),
        undefined,
    )
    assert.ok(mapped)
    assert.equal(mapped!.sectionId, "taxi_dep")
})

check("GND taxi_dep → TWR inbound_gnd when unassumed", () => {
    const twr = baseConfig(["TWR-W"])
    const mapped = mapEssaRemotePlacement(
        twr,
        "bay3",
        "taxi_dep",
        strip({ id: "VKG1649", callsign: "VKG1649", sectionId: "inbound_gnd" }),
        undefined,
        { assumedByMe: false },
    )
    assert.ok(mapped)
    assert.equal(mapped!.sectionId, "inbound_gnd")
})

check("vacated arrival peer inbound → taxi_arr", () => {
    const twr = baseConfig(["TWR-W"])
    const flight = {
        callsign: "SAS884",
        airborne: false,
        groundstate: "ARR",
    } as Flight
    const mapped = mapEssaRemotePlacement(
        twr,
        "bay1",
        "inbound",
        strip({
            id: "SAS884",
            callsign: "SAS884",
            stripType: "arrival",
            sectionId: "inbound",
            bayId: "bay1",
        }),
        flight,
    )
    assert.ok(mapped)
    assert.equal(mapped!.sectionId, "taxi_arr")
})

check("do not pull taxi_arr strip back to inbound", () => {
    const twr = baseConfig(["TWR-W"])
    const mapped = mapEssaRemotePlacement(
        twr,
        "bay1",
        "inbound",
        strip({
            id: "SAS884",
            callsign: "SAS884",
            stripType: "arrival",
            sectionId: "taxi_arr",
            bayId: "bay1",
        }),
        { callsign: "SAS884", airborne: false, groundstate: "ARR" } as Flight,
    )
    assert.equal(mapped, null)
})

console.log(`\n${passed} passed`)

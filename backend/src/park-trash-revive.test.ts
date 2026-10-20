/**
 * Park-trash turnaround revive (run: npx tsx src/park-trash-revive.test.ts)
 */

import assert from "node:assert/strict"
import type { Flight } from "./types.js"
import {
    beginNewDepartureCycleAfterPark,
    flightPlanFingerprint,
    isArrivalToOutboundTurnaroundFpl,
    isParkTrashDeleteRule,
    shouldAutoReviveParkTrash,
} from "./flightStore.js"

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

console.log("park-trash-revive")

check("fingerprint includes origin/dest/eobt/route", () => {
    assert.equal(
        flightPlanFingerprint({
            origin: "essa",
            destination: "vtsp",
            eobt: "2005",
            route: "babap dct",
        }),
        "ESSA|VTSP|2005|BABAP DCT",
    )
})

check("park trash rule ids", () => {
    assert.equal(isParkTrashDeleteRule("delete_parked"), true)
    assert.equal(isParkTrashDeleteRule("delete_parked_local"), true)
    assert.equal(isParkTrashDeleteRule("delete_beyond_range"), false)
})

check("no revive on groundstate-only (same FPL key)", () => {
    const flight: Flight = {
        callsign: "VKG2565",
        deleted: true,
        lastDeleteRule: "delete_parked",
        parkTrashFplKey: "EDDH|ESSA|1800|STAR",
        origin: "EDDH",
        destination: "ESSA",
        eobt: "1800",
        route: "STAR",
        groundstate: "TAXI",
    }
    assert.equal(shouldAutoReviveParkTrash(flight, ["ESSA"]), false)
})

check("revive when new outbound FPL (origin ESSA, new dest)", () => {
    const flight: Flight = {
        callsign: "VKG2565",
        deleted: true,
        lastDeleteRule: "delete_parked",
        parkTrashFplKey: "EDDH|ESSA|1800|STAR",
        origin: "ESSA",
        destination: "VTSP",
        eobt: "2005",
        route: "BABAP DCT",
        groundstate: "ONFREQ",
    }
    assert.equal(shouldAutoReviveParkTrash(flight, ["ESSA"]), true)
})

check("no revive when still inbound FPL (dest ESSA, origin foreign)", () => {
    const flight: Flight = {
        callsign: "VKG2565",
        deleted: true,
        lastDeleteRule: "delete_parked",
        parkTrashFplKey: "EDDH|ESSA|1800|STAR",
        origin: "EKCH",
        destination: "ESSA",
        eobt: "1900",
        route: "NEWSTAR",
        groundstate: "PARK",
    }
    assert.equal(shouldAutoReviveParkTrash(flight, ["ESSA"]), false)
})

check("no revive without parkTrashFplKey baseline", () => {
    const flight: Flight = {
        callsign: "VKG2565",
        deleted: true,
        lastDeleteRule: "delete_parked",
        origin: "ESSA",
        destination: "VTSP",
        eobt: "2005",
        route: "BABAP",
    }
    assert.equal(shouldAutoReviveParkTrash(flight, ["ESSA"]), false)
})

check("no revive for manual delete", () => {
    const flight: Flight = {
        callsign: "VKG2565",
        deleted: true,
        manuallyDeleted: true,
        lastDeleteRule: "delete_parked",
        parkTrashFplKey: "EDDH|ESSA|1800|STAR",
        origin: "ESSA",
        destination: "VTSP",
        eobt: "2005",
        route: "BABAP",
    }
    assert.equal(shouldAutoReviveParkTrash(flight, ["ESSA"]), false)
})

check("beginNewDepartureCycleAfterPark resets for CD ALL", () => {
    const flight: Flight = {
        callsign: "VKG2565",
        deleted: true,
        lastDeleteRule: "delete_parked",
        parkTrashFplKey: "EDDH|ESSA|1800|STAR",
        origin: "ESSA",
        destination: "VTSP",
        groundstate: "PARK",
        clearance: true,
        clearedToLand: true,
        airborne: true,
        atd: "1740",
        ata: "1755",
        missedApproach: true,
    }
    beginNewDepartureCycleAfterPark(flight)
    assert.equal(flight.deleted, false)
    assert.equal(flight.lastDeleteRule, undefined)
    assert.equal(flight.parkTrashFplKey, undefined)
    assert.equal(flight.suppressParkDelete, true)
    assert.equal(flight.clearance, false)
    assert.equal(flight.clearedToLand, false)
    assert.equal(flight.airborne, false)
    assert.equal(flight.atd, undefined)
    assert.equal(flight.ata, undefined)
    assert.equal(flight.groundstate, "")
    assert.ok((flight.groundstateClearedUntil ?? 0) > Date.now())
})

check("beginNewDepartureCycleAfterPark keeps ONFREQ/TAXI", () => {
    const onfreq: Flight = {
        callsign: "A",
        groundstate: "ONFREQ",
        deleted: true,
        lastDeleteRule: "delete_parked",
    }
    beginNewDepartureCycleAfterPark(onfreq)
    assert.equal(onfreq.groundstate, "ONFREQ")

    const taxi: Flight = {
        callsign: "B",
        groundstate: "TAXI",
        deleted: true,
        lastDeleteRule: "delete_parked",
    }
    beginNewDepartureCycleAfterPark(taxi)
    assert.equal(taxi.groundstate, "TAXI")
})

check("turnaround FPL: arrival→dep at ESGG (not ESSA-only)", () => {
    assert.equal(
        isArrivalToOutboundTurnaroundFpl(
            { origin: "EKCH", destination: "ESGG" },
            { origin: "ESGG", destination: "ENGM" },
            ["ESGG"],
        ),
        true,
    )
})

check("turnaround FPL: arrival→dep at ESSA", () => {
    assert.equal(
        isArrivalToOutboundTurnaroundFpl(
            { origin: "EDDH", destination: "ESSA" },
            { origin: "ESSA", destination: "VTSP" },
            ["ESSA"],
        ),
        true,
    )
})

check("turnaround FPL: not when still arrival", () => {
    assert.equal(
        isArrivalToOutboundTurnaroundFpl(
            { origin: "EDDH", destination: "ESSA" },
            { origin: "EKCH", destination: "ESSA" },
            ["ESSA"],
        ),
        false,
    )
})

check("revive works for any myAirport (ESMS)", () => {
    const flight: Flight = {
        callsign: "SAS1",
        deleted: true,
        lastDeleteRule: "delete_parked",
        parkTrashFplKey: "ESSA|ESMS|1000|STAR",
        origin: "ESMS",
        destination: "ESSA",
        eobt: "1200",
        route: "SID",
    }
    assert.equal(shouldAutoReviveParkTrash(flight, ["ESMS"]), true)
})

console.log(`park-trash-revive: ${passed} passed`)

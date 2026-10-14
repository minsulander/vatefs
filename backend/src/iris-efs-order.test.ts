import assert from "node:assert/strict"
import type { FlightStrip } from "@vatefs/common"
import {
    assertNoForbiddenSyncKeys,
    buildEssaIrisOrder,
    buildStripEfsFields,
    formatIrisSep,
    irisStripKey,
    isEssaStripviewOrderStrip,
} from "./iris-efs-order.js"

let passed = 0
function check(name: string, fn: () => void) {
    try {
        fn()
        passed++
        console.log(`ok - ${name}`)
    } catch (e) {
        console.error(`FAIL - ${name}`)
        throw e
    }
}

function strip(
    partial: Partial<FlightStrip> & Pick<FlightStrip, "callsign" | "sectionId">,
): FlightStrip {
    return {
        id: partial.id || partial.callsign || "id",
        syncKey: partial.syncKey,
        callsign: partial.callsign,
        aircraftType: "A320",
        flightRules: "I",
        adep: "ESSA",
        ades: "EKCH",
        stripType: partial.stripType || "departure",
        bayId: partial.bayId || "bay3",
        sectionId: partial.sectionId,
        position: partial.position ?? 0,
        bottom: false,
        airport: partial.airport || "ESSA",
        groundstate: partial.groundstate,
        clearedForTakeoff: partial.clearedForTakeoff,
        runway: partial.runway,
        clearanceRead: partial.clearanceRead,
        qnhGiven: partial.qnhGiven,
        noteText: partial.noteText,
    }
}

check("stripKey uppercase callsign", () => {
    assert.equal(irisStripKey(strip({ callsign: "sas123", sectionId: "taxi_dep" })), "SAS123")
})

check("sep bare values", () => {
    assert.deepEqual(formatIrisSep({ sep: "2.5 nm", dlv: "3.5 nm", depGap: "6 nm" }), {
        sep: "2.5",
        dlv: "3.5",
        depGap: "6",
    })
})

check("reorder: TWR-W/E + TAXI|LINEUP|DEPA", () => {
    const order = buildEssaIrisOrder(
        [
            strip({
                callsign: "SASW",
                sectionId: "taxi_dep",
                groundstate: "TAXI",
                runway: "01L",
                position: 2,
            }),
            strip({
                callsign: "SASE",
                sectionId: "runway_01R_19L",
                groundstate: "LINEUP",
                runway: "01R",
                position: 0,
            }),
            strip({
                callsign: "CFTOW",
                sectionId: "runway_01L_19R",
                groundstate: "DEPA",
                clearedForTakeoff: true,
                runway: "19R",
                position: 1,
            }),
        ],
        7,
    )
    assert.equal(order.revision, 7)
    const keys = order.entries.map((e) => `${e.bayId}/${e.sectionId}/${e.stripKey}`)
    assert.ok(keys.includes("TWR-W/TAXI/SASW"))
    assert.ok(keys.includes("TWR-E/LINEUP/SASE"))
    assert.ok(keys.includes("TWR-W/DEPA/CFTOW"))
    // Dry-run print
    console.log("DRY-RUN reorder payload:\n", JSON.stringify(order, null, 2))
    assert.equal(assertNoForbiddenSyncKeys(order).length, 0)
})

check("transfer to ctr_dep omitted from order", () => {
    const order = buildEssaIrisOrder(
        [
            strip({
                callsign: "STAY",
                sectionId: "taxi_dep",
                groundstate: "TAXI",
                runway: "01L",
            }),
            strip({
                callsign: "GONE",
                sectionId: "ctr_dep",
                groundstate: "DEPA",
                runway: "01L",
            }),
        ],
        1,
    )
    const keys = order.entries.map((e) => e.stripKey)
    assert.deepEqual(keys, ["STAY"])
    assert.ok(!keys.includes("GONE"))
    assert.equal(isEssaStripviewOrderStrip(strip({ callsign: "GONE", sectionId: "ctr_dep" })), false)
    console.log("DRY-RUN transfer-off-bay payload:\n", JSON.stringify(order, null, 2))
})

check("StripEfsFields: bayId TWR-W/E from dep RWY role", () => {
    const west = buildStripEfsFields(
        strip({
            callsign: "SAS1",
            sectionId: "taxi_dep",
            groundstate: "TAXI",
            runway: "01L",
            clearanceRead: true,
            qnhGiven: 1013,
        }),
    )
    const east = buildStripEfsFields(
        strip({
            callsign: "SAS2",
            sectionId: "runway_01R_19L",
            groundstate: "LINEUP",
            runway: "01R",
        }),
    )
    assert.equal(west.bayId, "TWR-W") // 01L → TWR-W
    assert.equal(east.bayId, "TWR-E") // 01R → TWR-E
    assert.equal(west.sectionId, "TAXI")
    assert.equal(east.sectionId, "LINEUP")
    assert.equal(assertNoForbiddenSyncKeys(west).length, 0)
    assert.equal("groundstate" in west, false)
})

console.log(`\n${passed} passed`)

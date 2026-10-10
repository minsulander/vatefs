import assert from "node:assert/strict"
import {
    compareRunwayLuOrder,
    isRunwayOrderSectionId,
    runwayLuRank,
    sortRunwayLuOrder,
} from "@vatefs/common"

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

check("runway section ids", () => {
    assert.equal(isRunwayOrderSectionId("runway_01L_19R"), true)
    assert.equal(isRunwayOrderSectionId("dep_runway"), true)
    assert.equal(isRunwayOrderSectionId("arr_runway"), true)
    assert.equal(isRunwayOrderSectionId("runway"), true)
    assert.equal(isRunwayOrderSectionId("bay1_rwy"), true)
    assert.equal(isRunwayOrderSectionId("ctr_dep"), false)
    assert.equal(isRunwayOrderSectionId("taxi_dep"), false)
})

check("ranks: CFTO/DEPA above LINEUP", () => {
    assert.equal(runwayLuRank({ clearedForTakeoff: true, groundstate: "DEPA" }), 0)
    assert.equal(runwayLuRank({ groundstate: "DEPA" }), 0)
    assert.equal(runwayLuRank({ groundstate: "LINEUP" }), 1)
    assert.equal(runwayLuRank({ groundstate: "ARR" }), null)
})

check("CFTO above later LINEUP (status overrides appearance)", () => {
    // Live bug shape: later LINEUP at pos 0, earlier CFTO at pos 2
    const gfm = { callsign: "GFM7Z", position: 0, groundstate: "LINEUP", clearedForTakeoff: false }
    const sas = {
        callsign: "SAS34DF",
        position: 2,
        groundstate: "DEPA",
        clearedForTakeoff: true,
    }
    assert.ok(compareRunwayLuOrder(sas, gfm) < 0)
    const ordered = sortRunwayLuOrder([gfm, sas]).map(s => s.callsign)
    assert.deepEqual(ordered, ["SAS34DF", "GFM7Z"])
})

check("same status: earlier appearance (lower position) above", () => {
    const first = { callsign: "AAA1", position: 0, groundstate: "LINEUP" }
    const second = { callsign: "BBB2", position: 1, groundstate: "LINEUP" }
    assert.deepEqual(
        sortRunwayLuOrder([second, first]).map(s => s.callsign),
        ["AAA1", "BBB2"],
    )
})

check("two CFTO: appearance order", () => {
    const a = { callsign: "A", position: 0, groundstate: "DEPA", clearedForTakeoff: true }
    const b = { callsign: "B", position: 1, groundstate: "DEPA", clearedForTakeoff: true }
    assert.deepEqual(
        sortRunwayLuOrder([b, a]).map(s => s.callsign),
        ["A", "B"],
    )
})

check("ARR keeps sticky position vs L/U (no forced rank)", () => {
    const arr = { callsign: "ARR1", position: 0, groundstate: "ARR" }
    const lu = { callsign: "DEP1", position: 1, groundstate: "LINEUP" }
    assert.deepEqual(
        sortRunwayLuOrder([lu, arr]).map(s => s.callsign),
        ["ARR1", "DEP1"],
    )
})

console.log(`\n${passed} passed`)

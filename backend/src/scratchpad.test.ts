/**
 * Scratchpad remarks/HP/COO parse tests (run: npx tsx src/scratchpad.test.ts)
 */

import assert from "node:assert/strict"
import {
    buildCombinedScratch,
    groundstateFromScratch,
    isProtocolScratch,
    parseCombinedScratch,
} from "./scratchpad.js"

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

console.log("scratchpad")

check("HP only", () => {
    assert.deepEqual(parseCombinedScratch("/Y2"), { remarks: undefined, hp: "Y2", coo: false })
    assert.deepEqual(parseCombinedScratch("/A1"), { remarks: undefined, hp: "A1", coo: false })
})

check("remarks only", () => {
    assert.deepEqual(parseCombinedScratch(".URNAV"), { remarks: "URNAV", hp: undefined, coo: false })
})

check("remarks + HP", () => {
    assert.deepEqual(parseCombinedScratch(".URNAV /Y2"), { remarks: "URNAV", hp: "Y2", coo: false })
})

check("SLOW", () => {
    assert.deepEqual(parseCombinedScratch("SLOW"), { remarks: "SLOW", hp: undefined, coo: false })
    assert.deepEqual(parseCombinedScratch(".SLOW"), { remarks: "SLOW", hp: undefined, coo: false })
})

check("COO only", () => {
    assert.deepEqual(parseCombinedScratch(".COO"), { remarks: undefined, hp: undefined, coo: true })
})

check("COO + remarks + HP", () => {
    assert.deepEqual(parseCombinedScratch(".COO SLOW /Y2"), {
        remarks: "SLOW",
        hp: "Y2",
        coo: true,
    })
    assert.deepEqual(parseCombinedScratch(".COO /Y2"), {
        remarks: undefined,
        hp: "Y2",
        coo: true,
    })
})

check("empty clears", () => {
    assert.deepEqual(parseCombinedScratch(""), {
        remarks: undefined,
        hp: undefined,
        coo: undefined,
    })
})

check("ROF does not touch HP/COO", () => {
    assert.deepEqual(parseCombinedScratch("/ROF/TAY7RN/ESSA_W_TWR"), {
        remarks: null,
        hp: null,
        coo: null,
    })
    assert.equal(isProtocolScratch("/ROF/TAY7RN/ESSA_W_TWR"), true)
})

check("LAM ROF does not touch HP", () => {
    assert.deepEqual(parseCombinedScratch("/LAM/ROF/ESSA_W_TWR"), {
        remarks: null,
        hp: null,
        coo: null,
    })
})

check("other TopSky protocol does not become HP", () => {
    assert.deepEqual(parseCombinedScratch("/RJC/S/ROF/ESSA_W_TWR"), {
        remarks: null,
        hp: null,
        coo: null,
    })
    assert.deepEqual(parseCombinedScratch("/ASP-/"), { remarks: null, hp: null, coo: null })
    assert.deepEqual(parseCombinedScratch("/SBY/RTI/ESMM_2_CTR"), {
        remarks: null,
        hp: null,
        coo: null,
    })
})

check("NOSTATE / MISAP leave fields", () => {
    assert.deepEqual(parseCombinedScratch("NOSTATE"), { remarks: null, hp: null, coo: null })
    assert.deepEqual(parseCombinedScratch("MISAP_"), { remarks: null, hp: null, coo: null })
})

check("GS scratch both modes (LINEUP / xLU) is not remarks", () => {
    assert.deepEqual(parseCombinedScratch("LINEUP"), { remarks: null, hp: null, coo: null })
    assert.deepEqual(parseCombinedScratch("xLU"), { remarks: null, hp: null, coo: null })
    assert.deepEqual(parseCombinedScratch("TXO"), { remarks: null, hp: null, coo: null })
    assert.equal(isProtocolScratch("LINEUP"), true)
    assert.equal(isProtocolScratch("xLU"), true)
    assert.equal(groundstateFromScratch("LINEUP"), "LINEUP")
    assert.equal(groundstateFromScratch("xLU"), "LINEUP")
    assert.equal(groundstateFromScratch("TXO"), "TAXI")
    assert.equal(groundstateFromScratch(".URNAV"), undefined)
})

check("build roundtrip", () => {
    assert.equal(buildCombinedScratch("URNAV", "Y2"), ".URNAV /Y2")
    assert.equal(buildCombinedScratch(undefined, "Y2"), "/Y2")
    assert.equal(buildCombinedScratch("SLOW", undefined), ".SLOW")
    assert.equal(buildCombinedScratch(undefined, undefined, true), ".COO")
    assert.equal(buildCombinedScratch("SLOW", "Y2", true), ".COO SLOW /Y2")
})

console.log(`scratchpad: ${passed} passed`)

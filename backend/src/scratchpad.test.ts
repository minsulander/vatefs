/**
 * Scratchpad remarks/HP parse tests (run: npx tsx src/scratchpad.test.ts)
 */

import assert from "node:assert/strict"
import {
    buildCombinedScratch,
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
    assert.deepEqual(parseCombinedScratch("/Y2"), { remarks: undefined, hp: "Y2" })
    assert.deepEqual(parseCombinedScratch("/A1"), { remarks: undefined, hp: "A1" })
})

check("remarks only", () => {
    assert.deepEqual(parseCombinedScratch(".URNAV"), { remarks: "URNAV", hp: undefined })
})

check("remarks + HP", () => {
    assert.deepEqual(parseCombinedScratch(".URNAV /Y2"), { remarks: "URNAV", hp: "Y2" })
})

check("SLOW", () => {
    assert.deepEqual(parseCombinedScratch("SLOW"), { remarks: "SLOW", hp: undefined })
})

check("empty clears", () => {
    assert.deepEqual(parseCombinedScratch(""), { remarks: undefined, hp: undefined })
})

check("ROF does not touch HP", () => {
    assert.deepEqual(parseCombinedScratch("/ROF/TAY7RN/ESSA_W_TWR"), {
        remarks: null,
        hp: null,
    })
    assert.equal(isProtocolScratch("/ROF/TAY7RN/ESSA_W_TWR"), true)
})

check("LAM ROF does not touch HP", () => {
    assert.deepEqual(parseCombinedScratch("/LAM/ROF/ESSA_W_TWR"), {
        remarks: null,
        hp: null,
    })
})

check("other TopSky protocol does not become HP", () => {
    assert.deepEqual(parseCombinedScratch("/RJC/S/ROF/ESSA_W_TWR"), {
        remarks: null,
        hp: null,
    })
    assert.deepEqual(parseCombinedScratch("/ASP-/"), { remarks: null, hp: null })
    assert.deepEqual(parseCombinedScratch("/SBY/RTI/ESMM_2_CTR"), {
        remarks: null,
        hp: null,
    })
})

check("NOSTATE / MISAP leave fields", () => {
    assert.deepEqual(parseCombinedScratch("NOSTATE"), { remarks: null, hp: null })
    assert.deepEqual(parseCombinedScratch("MISAP_"), { remarks: null, hp: null })
})

check("build roundtrip", () => {
    assert.equal(buildCombinedScratch("URNAV", "Y2"), ".URNAV /Y2")
    assert.equal(buildCombinedScratch(undefined, "Y2"), "/Y2")
    assert.equal(buildCombinedScratch("SLOW", undefined), "SLOW")
})

console.log(`scratchpad: ${passed} passed`)

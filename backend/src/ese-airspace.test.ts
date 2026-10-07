/**
 * Lightweight tests for ESE airspace helpers (run: npx tsx src/ese-airspace.test.ts)
 */

import assert from "node:assert/strict"
import {
    angleDiffDeg,
    bearingDeg,
    getAppDepOwnerChain,
    getGndOwnerChain,
    getTwrOwnerChain,
    gndFamilyPrimarySi,
    siToGndFamily,
    __setAppDepOwnerChainsForTest,
    __setGndOwnerChainsForTest,
    __setTwrOwnerChainsForTest,
} from "./ese-airspace.js"

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

console.log("ese-airspace tests")

check("SI to GND family", () => {
    assert.equal(siToGndFamily("AGE"), "GE")
    assert.equal(siToGndFamily("AGN"), "GN")
    assert.equal(siToGndFamily("AGW"), "GW")
    assert.equal(siToGndFamily("TE"), undefined)
})

check("GND family primary SI", () => {
    assert.equal(gndFamilyPrimarySi("GE"), "AGE")
    assert.equal(gndFamilyPrimarySi("GN"), "AGN")
    assert.equal(gndFamilyPrimarySi("GW"), "AGW")
})

check("bearing / angleDiff", () => {
    const brg = bearingDeg({ lat: 59.65, lon: 17.9 }, { lat: 59.66, lon: 17.9 })
    assert.ok(brg < 10 || brg > 350) // roughly north
    assert.equal(angleDiffDeg(10, 350), 20)
})

check("getAppDepOwnerChain", () => {
    __setAppDepOwnerChainsForTest({ DW: ["DW", "W", "E"] })
    assert.deepEqual(getAppDepOwnerChain("DW"), ["DW", "W", "E"])
    assert.deepEqual(getAppDepOwnerChain("DE"), ["DE"])
})

check("getGndOwnerChain defaults / ESE", () => {
    __setGndOwnerChainsForTest({})
    assert.deepEqual(getGndOwnerChain("GN"), ["AGN", "AGW"])
    assert.deepEqual(getGndOwnerChain("GE"), ["AGE", "AGW"])
    assert.deepEqual(getGndOwnerChain("GW"), ["AGW"])
    __setGndOwnerChainsForTest({ GN: ["AGN", "AGW"] })
    assert.deepEqual(getGndOwnerChain("GN"), ["AGN", "AGW"])
})

check("getTwrOwnerChain defaults / ESE", () => {
    __setTwrOwnerChainsForTest({})
    assert.deepEqual(getTwrOwnerChain("TE"), ["TE", "TS", "TW"])
    assert.deepEqual(getTwrOwnerChain("TS"), ["TS", "TE", "TW"])
    assert.deepEqual(getTwrOwnerChain("TW"), ["TW", "TE", "TS"])
    __setTwrOwnerChainsForTest({ TE: ["TE", "TW"] })
    assert.deepEqual(getTwrOwnerChain("TE"), ["TE", "TW"])
})

console.log(`\n${passed} passed`)

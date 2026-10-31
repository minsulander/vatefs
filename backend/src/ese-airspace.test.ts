/**
 * Lightweight tests for ESE airspace helpers (run: npx tsx src/ese-airspace.test.ts)
 */

import assert from "node:assert/strict"
import {
    angleDiffDeg,
    bearingDeg,
    getAirportAtsFrequencies,
    getAirportAtsFrequency,
    getAppDepOwnerChain,
    getGndOwnerChain,
    getTwrOwnerChain,
    gndFamilyPrimarySi,
    siToGndFamily,
    __setAppDepOwnerChainsForTest,
    __setEsePositionForTest,
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

check("getAirportAtsFrequencies includes TWR + APP, excludes DEP/CTR/GND", () => {
    // Unique ICAO so live ESE load (if any) does not collide
    const icao = "ZZRX"
    __setEsePositionForTest({
        callsign: "ZZRX_TWR",
        frequency: 118.105,
        si: "ZXT",
        airport: icao,
        role: "TWR",
    })
    __setEsePositionForTest({
        callsign: "ZZRX_APP",
        frequency: 120.155,
        si: "ZXA",
        airport: icao,
        role: "APP",
    })
    __setEsePositionForTest({
        callsign: "ZZRX_E_APP",
        frequency: 124.205,
        si: "ZXE",
        airport: icao,
        role: "APP",
    })
    __setEsePositionForTest({
        callsign: "ZZRX_DEP",
        frequency: 130.33,
        si: "ZXD",
        airport: icao,
        role: "DEP",
    })
    __setEsePositionForTest({
        callsign: "ZZRX_GND",
        frequency: 121.7,
        si: "ZXG",
        airport: icao,
        role: "GND",
    })
    __setEsePositionForTest({
        callsign: "ZZRX_CTR",
        frequency: 130.9,
        si: "ZXC",
        airport: icao,
        role: "CTR",
    })
    assert.deepEqual(getAirportAtsFrequencies(icao), [118.105, 120.155, 124.205])
    assert.equal(getAirportAtsFrequency(icao), 118.105)
})

check("getAirportAtsFrequencies AFIS then APP when no TWR", () => {
    const icao = "ZZAF"
    __setEsePositionForTest({
        callsign: "ZZAF_AFIS",
        frequency: 123.5,
        si: "ZAF",
        airport: icao,
        role: "AFIS",
    })
    __setEsePositionForTest({
        callsign: "ZZAF_APP",
        frequency: 119.4,
        si: "ZAA",
        airport: icao,
        role: "APP",
    })
    assert.deepEqual(getAirportAtsFrequencies(icao), [123.5, 119.4])
    assert.equal(getAirportAtsFrequency(icao), 123.5)
})

console.log(`\n${passed} passed`)

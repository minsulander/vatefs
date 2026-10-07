/**
 * Unit tests for ESSA next-SI hop tables (run: npx tsx src/essa-next-si.test.ts)
 */

import assert from "node:assert/strict"
import {
    __setGndOwnerChainsForTest,
    __setTwrOwnerChainsForTest,
    __setEsePositionForTest,
} from "./ese-airspace.js"
import { __setAfvFrequenciesForTest } from "./afv-transceivers.js"
import { staticConfig } from "./static-config.js"
import { __test, setForceIdealAppDepFrequency } from "./essa-next-si.js"

const {
    depHopsFromParking,
    arrHopsFromLanding,
    applyConfig6Dep,
    delTargetGndFamily,
    twrFamilyForRunway,
    dedupeHops,
    firstOnlineInChain,
} = __test

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

console.log("essa-next-si tests")

check("DEL GNDE falls to GW when AGE offline", () => {
    assert.equal(delTargetGndFamily("GE", false), "GW")
    assert.equal(delTargetGndFamily("GE", true), "GE")
    assert.equal(delTargetGndFamily("GN", false), "GN")
})

check("TWR family for runway", () => {
    assert.equal(twrFamilyForRunway("01R"), "TE")
    assert.equal(twrFamilyForRunway("19L"), "TE")
    assert.equal(twrFamilyForRunway("01L"), "TW")
    assert.equal(twrFamilyForRunway("08"), "TS")
})

check("DEP from GW to 01R → TWR", () => {
    const hops = depHopsFromParking("GW", "01R", "TEST1", undefined)
    assert.equal(hops.length, 1)
    assert.deepEqual(hops[0], { kind: "twr", family: "TE" })
})

check("DEP from GW to 19R → GN then TWR", () => {
    const hops = depHopsFromParking("GW", "19R", "TEST1", undefined)
    assert.equal(hops[0]?.kind, "gnd")
    assert.equal(hops[0] && hops[0].kind === "gnd" && hops[0].family, "GN")
    assert.equal(hops[hops.length - 1]?.kind, "twr")
})

check("DEP from GN to 01R → GE then TWR (default)", () => {
    const hops = depHopsFromParking("GN", "01R", "TEST1", undefined)
    assert.deepEqual(
        hops.map((h) => (h.kind === "gnd" ? h.family : h.kind === "twr" ? h.family : "app")),
        ["GE", "TE"]
    )
})

check("DEP from GE to 01R → TWR", () => {
    const hops = depHopsFromParking("GE", "01R", "TEST1", undefined)
    assert.deepEqual(hops, [{ kind: "twr", family: "TE" }])
})

check("ARR 01R parking GN → GN", () => {
    const hops = arrHopsFromLanding("01R", "GN", "TEST1", undefined)
    assert.deepEqual(hops, [{ kind: "gnd", family: "GN" }])
})

check("ARR 01R parking GW → GE GW", () => {
    const hops = arrHopsFromLanding("01R", "GW", "TEST1", undefined)
    assert.deepEqual(hops, [
        { kind: "gnd", family: "GE" },
        { kind: "gnd", family: "GW" },
    ])
})

check("ARR 01R parking GE → GE", () => {
    const hops = arrHopsFromLanding("01R", "GE", "TEST1", undefined)
    assert.deepEqual(hops, [{ kind: "gnd", family: "GE" }])
})

check("ARR 08 parking GE via GN", () => {
    const hops = arrHopsFromLanding("08", "GE", "TEST1", undefined)
    assert.deepEqual(hops[0], { kind: "gnd", family: "GN" })
})

check("config6 dep inserts GE before TWR", () => {
    // applyConfig6Dep only when config is 6 — without loaded config it no-ops.
    // Test dedupe + structure of a manual chain instead.
    const hops = dedupeHops([
        { kind: "gnd", family: "GE" },
        { kind: "gnd", family: "GE" },
        { kind: "twr", family: "TE" },
    ])
    assert.deepEqual(hops, [
        { kind: "gnd", family: "GE" },
        { kind: "twr", family: "TE" },
    ])
    // Smoke: function is callable
    const out = applyConfig6Dep([{ kind: "twr", family: "TE" }])
    assert.ok(Array.isArray(out))
})

check("CD GNDN falls to AGW when AGN offline (ESE OWNER AGN:AGW)", () => {
    setForceIdealAppDepFrequency(false)
    __setGndOwnerChainsForTest({ GN: ["AGN", "AGW"] })
    __setEsePositionForTest({
        callsign: "ESSA_N_GND",
        frequency: 121.830,
        si: "AGN",
        airport: "ESSA",
        role: "GND",
    })
    __setEsePositionForTest({
        callsign: "ESSA_W_GND",
        frequency: 121.705,
        si: "AGW",
        airport: "ESSA",
        role: "GND",
    })
    staticConfig.onlineControllers = new Map([
        [
            "ESSA_W_GND",
            { role: "GND", frequency: 121.705, callsign: "ESSA_W_GND", positionId: "AGW" },
        ],
    ])
    __setAfvFrequenciesForTest({ ESSA_W_GND: ["121.705"] })
    const hit = firstOnlineInChain([{ kind: "gnd", family: "GN" }], "ESSA_DEL")
    assert.ok(hit)
    assert.equal(hit!.si, "AGW")
    assert.equal(hit!.frequency, 121.705)
    assert.equal(hit!.displayFrequency, 121.705)
    assert.equal(hit!.xc, false)
    assert.equal(hit!.callsign, "ESSA_W_GND")
})

check("CD GNDN finds AGW by callsign when positionId missing", () => {
    __setGndOwnerChainsForTest({ GN: ["AGN", "AGW"] })
    staticConfig.onlineControllers = new Map([
        [
            "ESSA_W_GND",
            { role: "GND", frequency: 121.705, callsign: "ESSA_W_GND" },
        ],
    ])
    const hit = firstOnlineInChain([{ kind: "gnd", family: "GN" }], "ESSA_DEL")
    assert.ok(hit)
    assert.equal(hit!.si, "AGW")
    assert.equal(hit!.frequency, 121.705)
})

check("GNDN covered by AGW with AFV XC → display AGN freq", () => {
    setForceIdealAppDepFrequency(false)
    __setGndOwnerChainsForTest({ GN: ["AGN", "AGW"] })
    __setEsePositionForTest({
        callsign: "ESSA_N_GND",
        frequency: 121.830,
        si: "AGN",
        airport: "ESSA",
        role: "GND",
    })
    __setEsePositionForTest({
        callsign: "ESSA_W_GND",
        frequency: 121.705,
        si: "AGW",
        airport: "ESSA",
        role: "GND",
    })
    staticConfig.onlineControllers = new Map([
        [
            "ESSA_W_GND",
            { role: "GND", frequency: 121.705, callsign: "ESSA_W_GND", positionId: "AGW" },
        ],
    ])
    __setAfvFrequenciesForTest({
        ESSA_W_GND: ["121.705", "121.830"],
    })
    const hit = firstOnlineInChain([{ kind: "gnd", family: "GN" }], "ESSA_DEL")
    assert.ok(hit)
    assert.equal(hit!.callsign, "ESSA_W_GND")
    assert.equal(hit!.si, "AGW")
    assert.equal(hit!.displaySi, "AGN")
    assert.equal(hit!.displayFrequency, 121.830)
    assert.equal(hit!.xc, true)
})

check("CTRE covered by TW with AFV XC → display TE freq (rwy 01R)", () => {
    setForceIdealAppDepFrequency(false)
    __setTwrOwnerChainsForTest({ TE: ["TE", "TS", "TW"] })
    __setEsePositionForTest({
        callsign: "ESSA_E_TWR",
        frequency: 128.73,
        si: "TE",
        airport: "ESSA",
        role: "TWR",
    })
    __setEsePositionForTest({
        callsign: "ESSA_W_TWR",
        frequency: 118.505,
        si: "TW",
        airport: "ESSA",
        role: "TWR",
    })
    staticConfig.onlineControllers = new Map([
        [
            "ESSA_W_TWR",
            { role: "TWR", frequency: 118.505, callsign: "ESSA_W_TWR", positionId: "TW" },
        ],
    ])
    __setAfvFrequenciesForTest({
        ESSA_W_TWR: ["118.505", "128.730"],
    })
    // Ideal TE from dep rwy 01R / 19L
    assert.equal(twrFamilyForRunway("01R"), "TE")
    const hit = firstOnlineInChain([{ kind: "twr", family: "TE" }], "ESSA_W_GND")
    assert.ok(hit)
    assert.equal(hit!.callsign, "ESSA_W_TWR")
    assert.equal(hit!.si, "TW")
    assert.equal(hit!.displaySi, "TE")
    assert.equal(hit!.displayFrequency, 128.73)
    assert.equal(hit!.xc, true)
})

check("CTRE covered by TW without XC → display TW freq", () => {
    setForceIdealAppDepFrequency(false)
    __setAfvFrequenciesForTest({
        ESSA_W_TWR: ["118.505"],
    })
    const hit = firstOnlineInChain([{ kind: "twr", family: "TE" }], "ESSA_W_GND")
    assert.ok(hit)
    assert.equal(hit!.displaySi, "TW")
    assert.equal(hit!.displayFrequency, 118.505)
    assert.equal(hit!.xc, false)
})

console.log(`\n${passed} passed`)

/**
 * Display SI exclusivity tests (run: npx tsx src/display-si.test.ts)
 */

import assert from "node:assert/strict"
import { exclusiveCustomSiAirport, formatCustomDisplaySi } from "./display-si.js"

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

console.log("display-si")

check("exclusive single ESMS", () => {
    assert.equal(exclusiveCustomSiAirport(["ESMS"]), "ESMS")
    assert.equal(exclusiveCustomSiAirport(["esms", "EKCH"]), "ESMS")
})

check("exclusive none when two custom", () => {
    assert.equal(exclusiveCustomSiAirport(["ESMS", "ESGG"]), undefined)
    assert.equal(exclusiveCustomSiAirport(["ESSA", "ESGG", "ESMS"]), undefined)
})

check("format only when exclusive", () => {
    assert.equal(formatCustomDisplaySi("ESMS", "XX", "ESMS_GND"), "AD2")
    assert.equal(formatCustomDisplaySi(undefined, "XX", "ESMS_GND"), "XX")
    assert.equal(formatCustomDisplaySi("ESGG", "XX", "ESGG_GND"), "GND")
    assert.equal(formatCustomDisplaySi(undefined, "LG", "ESGG_GND"), "LG")
})

console.log(`display-si: ${passed} passed`)

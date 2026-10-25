/**
 * SID display formatting (run: npx tsx src/sid-format.test.ts)
 */

import assert from "node:assert/strict"
import { formatSidForDisplay, formatVectorSidDisplay } from "./sid-format.js"

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

console.log("sid-format tests")

check("ARS6E·KOGAV keeps ve exit", () => {
    assert.equal(formatVectorSidDisplay("ARS6E·KOGAV"), "ARS 6E veKOGAV")
    assert.equal(formatSidForDisplay("ARS6E·KOGAV"), "ARS 6E veKOGAV")
})

check("ARS6E·ARS drops redundant veARS (SID goes to ARS)", () => {
    assert.equal(formatVectorSidDisplay("ARS6E·ARS"), "ARS 6E")
    assert.equal(formatSidForDisplay("ARS6E·ARS"), "ARS 6E")
    assert.equal(formatSidForDisplay("ARS6E·ARS", "ARS"), "ARS 6E")
})

check("plain ARS6E stays ARS 6E", () => {
    assert.equal(formatSidForDisplay("ARS6E"), "ARS 6E")
})

check("KOGAV4L·ARS still shows veARS", () => {
    assert.equal(formatVectorSidDisplay("KOGAV4L·ARS"), "KOGAV 4L veARS")
})

console.log(`${passed} passed`)

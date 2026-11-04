/**
 * SID display formatting (run: npx tsx src/sid-format.test.ts)
 */

import assert from "node:assert/strict"
import {
    extractTmaEntryPoint,
    extractTmaExitPoint,
    formatSidForDisplay,
    formatVectorSidDisplay,
    isOffExitVectorSid,
    isVectorSidName,
} from "./sid-format.js"

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

check("ARS6E·RESNA keeps veRESNA even when FPL tmaExit is ARS", () => {
    assert.equal(formatVectorSidDisplay("ARS6E·RESNA", "ARS"), "ARS 6E veRESNA")
    assert.equal(formatSidForDisplay("ARS6E*RESNA", "ARS"), "ARS 6E veRESNA")
    assert.equal(isOffExitVectorSid("ARS6E·RESNA"), true)
})

check("plain ARS6E stays ARS 6E", () => {
    assert.equal(formatSidForDisplay("ARS6E"), "ARS 6E")
})

check("KOGAV4L·ARS still shows veARS", () => {
    assert.equal(formatVectorSidDisplay("KOGAV4L·ARS"), "KOGAV 4L veARS")
})

check("isOffExitVectorSid: ARS6E·KOGAV yes, ARS6E·ARS no, plain ARS6E no", () => {
    assert.equal(isVectorSidName("ARS6E·ARS"), true)
    assert.equal(isOffExitVectorSid("ARS6E·ARS"), false)
    assert.equal(isOffExitVectorSid("ARS6E·KOGAV"), true)
    assert.equal(isOffExitVectorSid("KOGAV4L·ARS"), true)
    assert.equal(isOffExitVectorSid("ARS6E"), false)
    assert.equal(isOffExitVectorSid(""), false)
})

check("TMA exit is first fix, entry is last filed before STAR", () => {
    const route = "N850 ARS DCT NOSLI DCT ELTOK"
    assert.equal(extractTmaExitPoint(undefined, route), "ARS")
    assert.equal(extractTmaEntryPoint(route), "ELTOK")
})

check("TMA entry ignores STAR legs after IAF (OBCIV)", () => {
    const expanded = "ARS NOSLI ELTOK OBCIV SA865 ERXEC"
    assert.equal(extractTmaEntryPoint(expanded, "ELTOK1G"), "ELTOK")
    assert.equal(extractTmaEntryPoint("ARS DCT NOSLI ELTOK1G", "ELTOK1G"), "ELTOK")
})

check("TMA entry falls back to STAR name", () => {
    assert.equal(extractTmaEntryPoint("", "ELTOK1G"), "ELTOK")
    assert.equal(extractTmaEntryPoint(undefined, "ALJAC RNP Y"), "ALJAC")
})

console.log(`${passed} passed`)

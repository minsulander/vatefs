/**
 * HHMM / ETA gate helpers (run: npx tsx src/hhmm-utils.test.ts)
 */

import assert from "node:assert/strict"
import {
    eobtInsertIndexAmong,
    flightEtaHhmm,
    minutesUntilFlightEta,
    minutesUntilHhmm,
    parseHhmmMinutes,
    utcNowMinutes,
} from "./hhmm-utils.js"

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

console.log("hhmm-utils")

check("parseHhmmMinutes", () => {
    assert.equal(parseHhmmMinutes("0915"), 9 * 60 + 15)
    assert.equal(parseHhmmMinutes("915"), 9 * 60 + 15)
    assert.equal(parseHhmmMinutes(undefined), null)
    assert.equal(parseHhmmMinutes("99"), null)
})

check("midnight wrap: 2350 before 0010", () => {
    // now = 00:05 UTC → 5 min past midnight
    const nowMs = Date.UTC(2026, 0, 2, 0, 5, 0)
    assert.equal(utcNowMinutes(nowMs), 5)
    assert.equal(minutesUntilHhmm("0010", nowMs), 5)
    assert.equal(minutesUntilHhmm("2350", nowMs), -15)
})

check("flightEtaHhmm from ete + lastUpdate", () => {
    const lastUpdate = Date.UTC(2026, 0, 1, 12, 0, 0)
    assert.equal(flightEtaHhmm({ ete: 20, lastUpdate }), "1220")
    assert.equal(flightEtaHhmm({ ete: 0, lastUpdate }), undefined)
    assert.equal(flightEtaHhmm({}), undefined)
})

check("minutesUntilFlightEta within 15 min gate", () => {
    const lastUpdate = Date.UTC(2026, 0, 1, 12, 0, 0)
    const nowMs = Date.UTC(2026, 0, 1, 12, 5, 0) // 5 min later
    // ETA was 12:20 → 15 min remaining
    assert.equal(minutesUntilFlightEta({ ete: 20, lastUpdate }, nowMs), 15)
    // 16 min remaining → outside gate
    assert.equal(minutesUntilFlightEta({ ete: 21, lastUpdate }, nowMs), 16)
    // missing ETA
    assert.equal(minutesUntilFlightEta({}, nowMs), null)
})

check("overdue ETA still within wrap (negative minutes)", () => {
    const lastUpdate = Date.UTC(2026, 0, 1, 12, 0, 0)
    const nowMs = Date.UTC(2026, 0, 1, 12, 25, 0)
    // ETA 12:20 → −5
    assert.equal(minutesUntilFlightEta({ ete: 20, lastUpdate }, nowMs), -5)
})

check("eobtInsertIndexAmong: earliest toward bottom", () => {
    // now midday so 1000/1100/1200 are unambiguous
    const nowMin = 12 * 60
    const existing = [
        { callsign: "A", eobt: "1200" },
        { callsign: "B", eobt: "1100" },
        { callsign: "C", eobt: "1000" },
    ]
    // 1130 sorts between 1200 and 1100
    assert.equal(
        eobtInsertIndexAmong(existing, { callsign: "N", eobt: "1130" }, nowMin),
        1,
    )
    // later than all → top
    assert.equal(
        eobtInsertIndexAmong(existing, { callsign: "N", eobt: "1300" }, nowMin),
        0,
    )
    // earlier than all → bottom
    assert.equal(
        eobtInsertIndexAmong(existing, { callsign: "N", eobt: "0900" }, nowMin),
        3,
    )
})

check("eobtInsertIndexAmong: does not re-sort manual order", () => {
    const nowMin = 12 * 60
    // Manually shuffled: earliest on top (wrong vs auto EOBT)
    const existing = [
        { callsign: "C", eobt: "1000" },
        { callsign: "A", eobt: "1200" },
        { callsign: "B", eobt: "1100" },
    ]
    const idx = eobtInsertIndexAmong(existing, { callsign: "N", eobt: "1130" }, nowMin)
    // Insert only — existing relative order unchanged by the helper
    assert.ok(idx >= 0 && idx <= existing.length)
    const after = [...existing]
    after.splice(idx, 0, { callsign: "N", eobt: "1130" })
    assert.deepEqual(
        after.filter((x) => x.callsign !== "N").map((x) => x.callsign),
        ["C", "A", "B"],
    )
})

check("eobtInsertIndexAmong: CLR-read stays below new print", () => {
    const nowMin = 12 * 60
    const existing = [
        { callsign: "A", eobt: "1200" },
        { callsign: "R", eobt: "1100", clearanceRead: true },
    ]
    // New print (no CLR read) inserts among non-CLR by EOBT, above CLR-read tier
    assert.equal(
        eobtInsertIndexAmong(existing, { callsign: "N", eobt: "1000" }, nowMin),
        1,
    )
})

console.log(`\n${passed} passed`)

/**
 * HHMM / ETA gate helpers (run: npx tsx src/hhmm-utils.test.ts)
 */

import assert from "node:assert/strict"
import {
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

console.log(`\n${passed} passed`)

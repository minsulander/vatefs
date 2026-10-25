/**
 * Unit tests for log timestamps (run: npx tsx src/log-time.test.ts)
 */

import assert from "node:assert/strict"
import { logTimestamp, prefixLogLines } from "./log-time.js"

const at = new Date(2026, 9, 25, 18, 28, 7)

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

console.log("log-time tests")

check("local HH:MM:SS matches EuroScope", () => {
    assert.equal(logTimestamp(at), "[18:28:07] ")
})

check("single line is prefixed", () => {
    assert.equal(prefixLogLines("Stand 63 detected for SAS485", at), "[18:28:07] Stand 63 detected for SAS485")
})

check("each line of a multi-line message is prefixed", () => {
    assert.equal(prefixLogLines("one\ntwo", at), "[18:28:07] one\n[18:28:07] two")
})

console.log(`${passed} passed`)

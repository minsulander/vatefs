/**
 * CD ALL → TSAT → PUSH sticky vs clearance / groundstate.
 * Run: npx tsx src/dep-bay-sticky.test.ts
 */
import assert from "node:assert/strict"
import { isDepBayFlowStickyInvalid } from "./dep-bay-sticky.js"

let passed = 0
function check(name: string, fn: () => void) {
    try {
        fn()
        passed++
        console.log(`ok - ${name}`)
    } catch (e) {
        console.error(`FAIL - ${name}`)
        throw e
    }
}

check("ACK CLR stuck in CD ALL → invalid sticky", () => {
    assert.equal(
        isDepBayFlowStickyInvalid({ clearance: true, groundstate: "" }, "pending_dep", "saab"),
        true,
    )
})

check("uncleared in TSAT → invalid sticky", () => {
    assert.equal(
        isDepBayFlowStickyInvalid({ clearance: false, groundstate: "" }, "cleared", "saab"),
        true,
    )
})

check("PUSH GS stuck in TSAT → invalid sticky", () => {
    assert.equal(
        isDepBayFlowStickyInvalid({ clearance: true, groundstate: "PUSH" }, "cleared", "saab"),
        true,
    )
})

check("STUP GS stuck in CD ALL → invalid sticky", () => {
    assert.equal(
        isDepBayFlowStickyInvalid({ clearance: true, groundstate: "STUP" }, "pending_dep", "saab"),
        true,
    )
})

check("PUSH GS in push_start → sticky OK", () => {
    assert.equal(
        isDepBayFlowStickyInvalid({ clearance: true, groundstate: "PUSH" }, "push_start", "saab"),
        false,
    )
})

check("cleared IFR in TSAT → sticky OK", () => {
    assert.equal(
        isDepBayFlowStickyInvalid({ clearance: true, groundstate: "" }, "cleared", "saab"),
        false,
    )
})

check("uncleared in CD ALL → sticky OK", () => {
    assert.equal(
        isDepBayFlowStickyInvalid({ clearance: false, groundstate: "" }, "pending_dep", "saab"),
        false,
    )
})

check("empty GS in PUSH bay → invalid sticky", () => {
    assert.equal(
        isDepBayFlowStickyInvalid({ clearance: true, groundstate: "" }, "push_start", "saab"),
        true,
    )
})

check("paper: readback counts as clearance for CD ALL", () => {
    assert.equal(
        isDepBayFlowStickyInvalid(
            { clearance: false, clearanceReadback: true, groundstate: "" },
            "pending_dep",
            "paper",
        ),
        true,
    )
})

console.log(`\n${passed} passed`)

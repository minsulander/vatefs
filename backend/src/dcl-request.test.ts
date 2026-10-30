/**
 * DCL PREDEP telex parse tests (run: npx tsx src/dcl-request.test.ts)
 */
import assert from "node:assert/strict"
import { parseDclRequestTelex } from "./dcl-request.ts"

function check(name: string, fn: () => void) {
    try {
        fn()
        console.log(`ok - ${name}`)
    } catch (e) {
        console.error(`fail - ${name}`)
        throw e
    }
}

check("plain PREDEP without remarks", () => {
    const p = parseDclRequestTelex(
        "REQUEST PREDEP CLEARANCE SAS026 A320 TO ESNU AT ESSA STAND 8 ATIS I",
    )
    assert.ok(p)
    assert.equal(p!.callsign, "SAS026")
    assert.equal(p!.airport, "ESSA")
    assert.equal(p!.atis, "I")
    assert.equal(p!.remarks, undefined)
})

check("PREDEP with trailing remarks (SAS62Y)", () => {
    const p = parseDclRequestTelex(
        "REQUEST PREDEP CLEARANCE SAS62Y A320 TO ESNQ AT ESSA STAND F29R ATIS A KUUUHLE",
    )
    assert.ok(p)
    assert.equal(p!.callsign, "SAS62Y")
    assert.equal(p!.stand, "F29R")
    assert.equal(p!.atis, "A")
    assert.equal(p!.remarks, "KUUUHLE")
})

check("PREDEP with multi-word remarks", () => {
    const p = parseDclRequestTelex(
        "REQUEST PREDEP CLEARANCE SAS708 A320 TO EFHK AT ESSA STAND 10 ATIS I GOOD EVENING",
    )
    assert.ok(p)
    assert.equal(p!.remarks, "GOOD EVENING")
})

check("rejects non-PREDEP", () => {
    assert.equal(parseDclRequestTelex("HELLO WORLD"), null)
})

console.log("All dcl-request tests passed")

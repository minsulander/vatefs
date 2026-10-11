/**
 * Ground-state dual-mode tests (run: npx tsx src/groundstate.test.ts)
 */

import assert from "node:assert/strict"
import {
    groundstateFromScratch,
    isGroundstateToken,
    normalizeGroundstate,
    resolveIncomingGroundstate,
    toSwedishGroundstateToken,
} from "./groundstate.js"

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

console.log("groundstate")

check("GRP xLU / TXO / xTO → canonical", () => {
    assert.equal(normalizeGroundstate("xLU"), "LINEUP")
    assert.equal(normalizeGroundstate("XLU"), "LINEUP")
    assert.equal(normalizeGroundstate("TXO"), "TAXI")
    assert.equal(normalizeGroundstate("xTO"), "DEPA")
    assert.equal(normalizeGroundstate("TXI"), "TXIN")
    assert.equal(normalizeGroundstate("FRQ"), "ONFREQ")
    assert.equal(normalizeGroundstate("RDY"), "DE-ICE")
    assert.equal(normalizeGroundstate("S/U"), "STUP")
    assert.equal(normalizeGroundstate("S/P"), "PUSH")
    assert.equal(normalizeGroundstate("PRK"), "PARK")
})

check("canonical identity", () => {
    assert.equal(normalizeGroundstate("LINEUP"), "LINEUP")
    assert.equal(normalizeGroundstate("TAXI"), "TAXI")
    assert.equal(normalizeGroundstate("DEPA"), "DEPA")
})

check("canonical → native ES write tokens", () => {
    assert.equal(toSwedishGroundstateToken("LINEUP"), "LINEUP")
    assert.equal(toSwedishGroundstateToken("TAXI"), "TAXI")
    assert.equal(toSwedishGroundstateToken("DEPA"), "DEPA")
    assert.equal(toSwedishGroundstateToken("TXIN"), "TXIN")
    assert.equal(toSwedishGroundstateToken("PUSH"), "PUSH")
    assert.equal(toSwedishGroundstateToken("STUP"), "STUP")
})

check("scratch recognises both modes", () => {
    assert.equal(isGroundstateToken("xLU"), true)
    assert.equal(isGroundstateToken("LINEUP"), true)
    assert.equal(isGroundstateToken("TXO"), true)
    assert.equal(groundstateFromScratch("xLU"), "LINEUP")
    assert.equal(groundstateFromScratch("LINEUP"), "LINEUP")
    assert.equal(groundstateFromScratch(".URNAV"), undefined)
})

check("resolve: scratch xLU wins over coarse GetGroundState TAXI", () => {
    assert.equal(
        resolveIncomingGroundstate({ scratch: "xLU", groundstate: "TAXI" }),
        "LINEUP",
    )
})

check("resolve: live ES xLU wins", () => {
    assert.equal(
        resolveIncomingGroundstate({ scratch: "TAXI", groundstate: "xLU" }),
        "LINEUP",
    )
})

check("resolve: coarse TAXI does not wipe current LINEUP", () => {
    assert.equal(
        resolveIncomingGroundstate({
            groundstate: "TAXI",
            current: "LINEUP",
        }),
        undefined,
    )
})

check("resolve: scratch TXO allows TAXI", () => {
    assert.equal(
        resolveIncomingGroundstate({ scratch: "TXO", groundstate: "TAXI" }),
        "TAXI",
    )
})

console.log(`groundstate: ${passed} passed`)

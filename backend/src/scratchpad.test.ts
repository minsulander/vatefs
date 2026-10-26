/**
 * Scratchpad remarks/HP parse tests (run: npx tsx src/scratchpad.test.ts)
 */

import assert from "node:assert/strict"
import {
    buildCombinedScratch,
    groundstateFromScratch,
    isProtocolScratch,
    isHandoverAssistantScratch,
    parseCombinedScratch,
    shouldClearHandoverScratch,
    standFromGrpScratch,
} from "./scratchpad.js"

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

console.log("scratchpad")

check("HP only", () => {
    assert.deepEqual(parseCombinedScratch("/Y2"), { remarks: undefined, hp: "Y2" })
    assert.deepEqual(parseCombinedScratch("/A1"), { remarks: undefined, hp: "A1" })
})

check("remarks only", () => {
    assert.deepEqual(parseCombinedScratch(".URNAV"), { remarks: "URNAV", hp: undefined })
})

check("remarks + HP", () => {
    assert.deepEqual(parseCombinedScratch(".URNAV /Y2"), { remarks: "URNAV", hp: "Y2" })
})

check("SLOW", () => {
    assert.deepEqual(parseCombinedScratch("SLOW"), { remarks: "SLOW", hp: undefined })
    assert.deepEqual(parseCombinedScratch(".SLOW"), { remarks: "SLOW", hp: undefined })

    // ESSA OP-TEXT2 RNP markers (no leading dot)
    assert.deepEqual(parseCombinedScratch("RNPX 19R"), {
        remarks: "RNPX 19R",
        hp: undefined,
    })
    assert.deepEqual(parseCombinedScratch("RNP Y"), { remarks: "RNP Y", hp: undefined })
    assert.deepEqual(parseCombinedScratch("RQ RNP"), { remarks: "RQ RNP", hp: undefined })
    assert.deepEqual(parseCombinedScratch(".RNP X 01L"), {
        remarks: "RNP X 01L",
        hp: undefined,
    })
})

check("EST is ordinary remarks (coo uses ann 6)", () => {
    // `.EST` is no longer a coordination token — treated as ordinary remarks
    assert.deepEqual(parseCombinedScratch(".EST"), { remarks: "EST", hp: undefined })
    assert.deepEqual(parseCombinedScratch(".EST SLOW /Y2"), {
        remarks: "EST SLOW",
        hp: "Y2",
    })
})

check("COO is ordinary remarks", () => {
    assert.deepEqual(parseCombinedScratch(".COO"), { remarks: "COO", hp: undefined })
    assert.deepEqual(parseCombinedScratch(".COO SLOW /Y2"), {
        remarks: "COO SLOW",
        hp: "Y2",
    })
})

check("empty clears", () => {
    assert.deepEqual(parseCombinedScratch(""), {
        remarks: undefined,
        hp: undefined,
    })
})

check("ROF does not touch HP", () => {
    assert.deepEqual(parseCombinedScratch("/ROF/TAY7RN/ESSA_W_TWR"), {
        remarks: null,
        hp: null,
    })
    assert.equal(isProtocolScratch("/ROF/TAY7RN/ESSA_W_TWR"), true)
})

check("LAM ROF does not touch HP", () => {
    assert.deepEqual(parseCombinedScratch("/LAM/ROF/ESSA_W_TWR"), {
        remarks: null,
        hp: null,
    })
})

check("EFS ROF does not touch HP", () => {
    assert.deepEqual(parseCombinedScratch("/EFSROF/SAS926/ESSA_G_GND"), {
        remarks: null,
        hp: null,
    })
    assert.equal(isProtocolScratch("/EFSROF/SAS926/ESSA_G_GND"), true)
})

check("other TopSky protocol does not become HP", () => {
    assert.deepEqual(parseCombinedScratch("/RJC/S/ROF/ESSA_W_TWR"), {
        remarks: null,
        hp: null,
    })
    assert.deepEqual(parseCombinedScratch("/ASP-/"), { remarks: null, hp: null })
    assert.deepEqual(parseCombinedScratch("/SBY/RTI/ESMM_2_CTR"), {
        remarks: null,
        hp: null,
    })
})

check("EFSHO is protocol and stays off remarks", () => {
    assert.equal(isProtocolScratch("EFSHO"), true)
    assert.equal(isProtocolScratch("/EFSHO/"), true)
    assert.equal(isHandoverAssistantScratch(" efsho "), true)
    assert.deepEqual(parseCombinedScratch("EFSHO"), { remarks: null, hp: null })
})

check("relieving controller clears EFSHO; the writer does not", () => {
    assert.equal(
        shouldClearHandoverScratch({
            efshoOnScratch: true,
            efshoSetByMe: false,
            trackedByMe: true,
        }),
        true,
    )
    assert.equal(
        shouldClearHandoverScratch({
            efshoOnScratch: true,
            efshoSetByMe: true,
            trackedByMe: true,
        }),
        false,
    )
    assert.equal(
        shouldClearHandoverScratch({
            efshoOnScratch: true,
            efshoSetByMe: false,
            trackedByMe: false,
        }),
        false,
    )
})

check("NOSTATE / MISAP / WX_ leave fields", () => {
    assert.deepEqual(parseCombinedScratch("NOSTATE"), { remarks: null, hp: null })
    assert.deepEqual(parseCombinedScratch("MISAP_"), { remarks: null, hp: null })
    assert.deepEqual(parseCombinedScratch("WX_"), { remarks: null, hp: null })
    assert.equal(isProtocolScratch("WX_"), true)
    assert.equal(isProtocolScratch("EST_"), true)
    assert.equal(isProtocolScratch("IRREG_"), true)
})

check("GS scratch both modes (LINEUP / xLU) is not remarks", () => {
    assert.deepEqual(parseCombinedScratch("LINEUP"), { remarks: null, hp: null })
    assert.deepEqual(parseCombinedScratch("xLU"), { remarks: null, hp: null })
    assert.deepEqual(parseCombinedScratch("TXO"), { remarks: null, hp: null })
    assert.equal(isProtocolScratch("LINEUP"), true)
    assert.equal(isProtocolScratch("xLU"), true)
    assert.equal(groundstateFromScratch("LINEUP"), "LINEUP")
    assert.equal(groundstateFromScratch("xLU"), "LINEUP")
    assert.equal(groundstateFromScratch("TXO"), "TAXI")
    assert.equal(groundstateFromScratch(".URNAV"), undefined)
})

check("GRP/S stand broadcast is not remarks", () => {
    assert.equal(standFromGrpScratch("GRP/S/F36L"), "F36L")
    assert.equal(standFromGrpScratch("GRP/S/16"), "16")
    assert.equal(standFromGrpScratch(".URNAV /Y2"), undefined)
    assert.deepEqual(parseCombinedScratch("GRP/S/F38"), { remarks: null, hp: null })
    assert.equal(isProtocolScratch("GRP/S/F38"), false)
})

check("GRP/M move-to-stand extracts stand and is not remarks", () => {
    assert.equal(standFromGrpScratch("GRP/M/ESSA/F34"), "F34")
    assert.equal(standFromGrpScratch("GRP/M/ESGG/16"), "16")
    assert.equal(standFromGrpScratch("GRP/M/ESSA"), undefined)
    assert.deepEqual(parseCombinedScratch("GRP/M/ESSA/F34"), { remarks: null, hp: null })
})

check("build roundtrip (no EST)", () => {
    assert.equal(buildCombinedScratch("URNAV", "Y2"), ".URNAV /Y2")
    assert.equal(buildCombinedScratch(undefined, "Y2"), "/Y2")
    assert.equal(buildCombinedScratch("SLOW", undefined), ".SLOW")
    assert.equal(buildCombinedScratch(undefined, undefined), "")
})

console.log(`scratchpad: ${passed} passed`)

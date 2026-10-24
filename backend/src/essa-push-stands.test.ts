/**
 * Unit tests for ESSA push vs startup stand rules.
 * Run: npx tsx src/essa-push-stands.test.ts
 */

import assert from "node:assert/strict"
import {
    groundstateForEssaPushDrop,
    remapPushActionForStand,
    standRequiresStartupInsteadOfPush,
} from "./essa-push-stands.js"

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

console.log("essa-push-stands tests")

check("terminal / always-push stands use PUSH", () => {
    assert.equal(standRequiresStartupInsteadOfPush("31", "A320", "J"), false)
    assert.equal(standRequiresStartupInsteadOfPush("62", "B738", "J"), false)
    assert.equal(remapPushActionForStand("PUSH", "31", "A320", "J"), "PUSH")
    assert.equal(standRequiresStartupInsteadOfPush("31", "AT76", "T"), false)
})

check("G149, S4–S6, apron M always START UP", () => {
    assert.equal(standRequiresStartupInsteadOfPush("G149", "A320", "J"), true)
    assert.equal(standRequiresStartupInsteadOfPush("S4", "B738", "J"), true)
    assert.equal(standRequiresStartupInsteadOfPush("S5", "A320", "J"), true)
    assert.equal(standRequiresStartupInsteadOfPush("S6", "AT76", "T"), true)
    assert.equal(standRequiresStartupInsteadOfPush("M6", "A320", "J"), true)
    assert.equal(remapPushActionForStand("PUSH", "S4", "A320", "J"), "STUP")
})

check("R9C is START UP for every type", () => {
    assert.equal(standRequiresStartupInsteadOfPush("R9C", "A388", "J"), true)
    assert.equal(standRequiresStartupInsteadOfPush("R9C", "A320", "J"), true)
    assert.equal(standRequiresStartupInsteadOfPush("R9C", "AT76", "T"), true)
})

check("apron G: CRJ9 startup, E190 push, unapproved majority by engine", () => {
    assert.equal(standRequiresStartupInsteadOfPush("G141", "CRJ9", "J"), true)
    assert.equal(standRequiresStartupInsteadOfPush("G141", "E190", "J"), false)
    assert.equal(standRequiresStartupInsteadOfPush("G141", "B77W", "J"), false)
    assert.equal(standRequiresStartupInsteadOfPush("G141", "DH8C", "T"), true)
    assert.equal(standRequiresStartupInsteadOfPush("141", "CRJ9", "J"), true)
})

check("terminal 3 south: Not from D → START UP only on 57", () => {
    assert.equal(standRequiresStartupInsteadOfPush("57", "AT76", "T"), true)
    assert.equal(standRequiresStartupInsteadOfPush("60A", "AT76", "T"), false)
    assert.equal(standRequiresStartupInsteadOfPush("53", "DH8D", "T"), false)
    assert.equal(standRequiresStartupInsteadOfPush("57", "A320", "J"), false)
})

check("terminal 3 north: props START UP, CRJ/F100 PUSH", () => {
    assert.equal(standRequiresStartupInsteadOfPush("52", "AT76", "T"), true)
    assert.equal(standRequiresStartupInsteadOfPush("54", "SF34", "T"), true)
    assert.equal(standRequiresStartupInsteadOfPush("56", "CRJ9", "J"), false)
    assert.equal(standRequiresStartupInsteadOfPush("58", "F100", "J"), false)
    assert.equal(remapPushActionForStand("PUSH", "54", "AT76", "T"), "STUP")
})

check("apron R: R3/R4 all START UP; R5 ATR/F50 START UP else PUSH", () => {
    assert.equal(standRequiresStartupInsteadOfPush("R3", "AT76", "T"), true)
    assert.equal(standRequiresStartupInsteadOfPush("R4", "E170", "J"), true)
    assert.equal(standRequiresStartupInsteadOfPush("R5", "AT76", "T"), true)
    assert.equal(standRequiresStartupInsteadOfPush("R5", "F50", "T"), true)
    assert.equal(standRequiresStartupInsteadOfPush("R5", "SF34", "T"), false)
    assert.equal(standRequiresStartupInsteadOfPush("R5", "A320", "J"), false)
})

check("apron S1–S3 and S71–S82", () => {
    assert.equal(standRequiresStartupInsteadOfPush("S1", "AT76", "T"), true)
    assert.equal(standRequiresStartupInsteadOfPush("S1", "A320", "J"), false)
    assert.equal(standRequiresStartupInsteadOfPush("S75", "A320", "J"), true)
    assert.equal(standRequiresStartupInsteadOfPush("S75", "BE20", "P"), true)
})

check("missing stand → PUSH; leaves non-PUSH actions alone", () => {
    assert.equal(standRequiresStartupInsteadOfPush("", "A320", "J"), false)
    assert.equal(standRequiresStartupInsteadOfPush(undefined, "A320", "J"), false)
    assert.equal(standRequiresStartupInsteadOfPush("Z99", "A320", "J"), false)
    assert.equal(remapPushActionForStand("TAXI", "R9C", "A320", "J"), "TAXI")
    assert.equal(remapPushActionForStand(undefined, "R9C", "A320", "J"), undefined)
})

check("normalizes stand spacing", () => {
    assert.equal(standRequiresStartupInsteadOfPush("F 40", "A320", "J"), false)
    assert.equal(standRequiresStartupInsteadOfPush("G 149", "A320", "J"), true)
})

check("drop PUSH BACK / START UP / merged sets GS", () => {
    assert.equal(groundstateForEssaPushDrop("push_back", "S4", "A320", "J"), "PUSH")
    assert.equal(groundstateForEssaPushDrop("start_up", "31", "A320", "J"), "STUP")
    // Merged: same as action-key stand logic
    assert.equal(groundstateForEssaPushDrop("push_start", "31", "A320", "J"), "PUSH")
    assert.equal(groundstateForEssaPushDrop("push_start", "S4", "A320", "J"), "STUP")
    assert.equal(groundstateForEssaPushDrop("push_start", "R9C", "A320", "J"), "STUP")
    assert.equal(groundstateForEssaPushDrop("cleared", "31", "A320", "J"), undefined)
})

console.log(`\n${passed} passed`)

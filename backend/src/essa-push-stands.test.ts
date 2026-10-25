/**
 * Unit tests for ESSA push vs startup stand rules.
 * Run: npx tsx src/essa-push-stands.test.ts
 */

import assert from "node:assert/strict"
import {
    classifyEssaPushStandCoverage,
    groundstateForEssaPushDrop,
    normalizeStandName,
    remapPushActionForStand,
    standRequiresStartupInsteadOfPush,
} from "./essa-push-stands.js"

/** All STAND:ESSA: names from ESAA GRpluginStands.txt (2026-10). */
const GRPLUGIN_ESSA_STANDS = [
    "01", "03", "04", "05", "06", "07", "08", "09", "10",
    "101", "102", "103", "104", "105", "106", "107", "108", "109",
    "11", "110", "111", "112", "113", "115", "117", "119",
    "12", "13", "14", "15", "16", "17", "18", "19", "20",
    "31", "32", "33", "34", "35", "36", "37", "38", "39", "40",
    "41", "42", "43", "44",
    "52", "53", "54", "55", "56", "57", "58", "60A",
    "62", "63", "64", "65", "66", "67", "68",
    "APK1", "APK2", "APNH", "APNJ", "APNK", "APNL", "APNP",
    "F28L", "F28R", "F29L", "F29R", "F30", "F31", "F32L", "F32R",
    "F33", "F34", "F35", "F36L", "F36R", "F37", "F38", "F39L", "F39R",
    "F40", "F42", "F44",
    "G141", "G142", "G143", "G144", "G145", "G146", "G148",
    "K3A", "K3B", "K3C", "K3D", "K3E", "K5", "K5L", "K5R",
    "M5", "M6", "M7", "M8", "M9",
    "R10", "R10A", "R10B", "R10C", "R3", "R4", "R5", "R6", "R7", "R8", "R9", "R9C",
    "S1", "S2", "S3", "S4", "S6",
    "S71", "S72", "S73", "S74", "S75", "S77", "S78", "S79", "S80", "S81", "S82",
] as const

/**
 * Stands present in GRplugin but with no Swedavia push/start row (default PUSH).
 * Area markers (APNH/J/K/L/P) and non-contact pier/terminal positions.
 */
const GRPLUGIN_ESSA_NO_TABLE = new Set([
    "APNH", "APNJ", "APNK", "APNL", "APNP",
    "11", "13", "15", "17", "19",
    "32", "34", "36", "38", "40", "42", "44",
])

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

check("GRplugin APK / APN / zero-pad naming", () => {
    assert.equal(normalizeStandName("APK2"), "K2")
    assert.equal(normalizeStandName("APK1"), "K1")
    assert.equal(normalizeStandName("APNK2"), "K2")
    assert.equal(normalizeStandName("01"), "1")
    assert.equal(normalizeStandName("10"), "10")
    // Real GRplugin name APK2 + GLEX → START UP
    assert.equal(standRequiresStartupInsteadOfPush("APK2", "GLEX", "J"), true)
    assert.equal(remapPushActionForStand("PUSH", "APK2", "GLEX", "J"), "STUP")
    assert.equal(standRequiresStartupInsteadOfPush("APNK2", "GLEX", "J"), true)
    assert.equal(standRequiresStartupInsteadOfPush("APK2", "A320", "J"), false)
    assert.equal(classifyEssaPushStandCoverage("APK2"), "typed-rule")
    assert.equal(classifyEssaPushStandCoverage("01"), "always-push")
    assert.equal(classifyEssaPushStandCoverage("K3D"), "typed-rule")
    assert.equal(classifyEssaPushStandCoverage("F29R"), "always-push")
    assert.equal(classifyEssaPushStandCoverage("R10A"), "typed-rule")
})

check("every GRplugin ESSA stand is covered or explicitly no-table", () => {
    const unexpected: string[] = []
    for (const raw of GRPLUGIN_ESSA_STANDS) {
        const cov = classifyEssaPushStandCoverage(raw)
        if (cov === "unknown" && !GRPLUGIN_ESSA_NO_TABLE.has(raw)) unexpected.push(`${raw}→unknown`)
        if (cov !== "unknown" && GRPLUGIN_ESSA_NO_TABLE.has(raw)) unexpected.push(`${raw}→${cov} (expected unknown)`)
    }
    assert.equal(unexpected.length, 0, unexpected.join(", "))
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

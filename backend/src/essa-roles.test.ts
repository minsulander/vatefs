/**
 * Unit tests for ESSA auto roles / OWNER GND coverage
 * Run: npx tsx src/essa-roles.test.ts
 */

import assert from "node:assert/strict"
import { __setGndOwnerChainsForTest } from "./ese-airspace.js"
import {
    computeAutoEssaRoles,
    resolveGndRolesFromOwnerCoverage,
} from "./essa-roles.js"

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

console.log("essa-roles tests")

__setGndOwnerChainsForTest({
    GE: ["AGE", "AGW"],
    GN: ["AGN", "AGW"],
    GW: ["AGW"],
})

check("OWNER: GW alone covers all families (AGW on every chain)", () => {
    const roles = resolveGndRolesFromOwnerCoverage("ESSA_W_GND", ["ESSA_W_GND"])
    assert.deepEqual(roles, ["GND-E", "GND-N", "GND-W"])
})

check("OWNER: GN alone only GN via chain — auto solo still gives all", () => {
    const ownerOnly = resolveGndRolesFromOwnerCoverage("ESSA_N_GND", ["ESSA_N_GND"])
    assert.deepEqual(ownerOnly, ["GND-N"])
    const auto = computeAutoEssaRoles("ESSA_N_GND", ["GND"], ["ESSA_N_GND"])
    assert.deepEqual(auto, ["GND-E", "GND-N", "GND-W"])
})

check("GW + GN open → GW gets E+W, not N", () => {
    const gw = resolveGndRolesFromOwnerCoverage("ESSA_W_GND", ["ESSA_W_GND", "ESSA_N_GND", "ESSA_DEL"])
    assert.deepEqual(gw, ["GND-E", "GND-W"])
    const gn = resolveGndRolesFromOwnerCoverage("ESSA_N_GND", ["ESSA_W_GND", "ESSA_N_GND", "ESSA_DEL"])
    assert.deepEqual(gn, ["GND-N"])
})

check("computeAutoEssaRoles GW+GN+CD → GW has GND-E+W, no CD", () => {
    const roles = computeAutoEssaRoles(
        "ESSA_W_GND",
        ["GND"],
        ["ESSA_W_GND", "ESSA_N_GND", "ESSA_DEL"]
    )
    assert.deepEqual(roles, ["GND-E", "GND-W"])
})

check("computeAutoEssaRoles GN+GW → GN only GND-N", () => {
    const roles = computeAutoEssaRoles(
        "ESSA_N_GND",
        ["GND"],
        ["ESSA_W_GND", "ESSA_N_GND", "ESSA_DEL"]
    )
    assert.deepEqual(roles, ["GND-N"])
})

check("computeAutoEssaRoles GE opens → GW loses GND-E", () => {
    const before = computeAutoEssaRoles(
        "ESSA_W_GND",
        ["GND"],
        ["ESSA_W_GND", "ESSA_N_GND"]
    )
    assert.deepEqual(before, ["GND-E", "GND-W"])
    const after = computeAutoEssaRoles(
        "ESSA_W_GND",
        ["GND"],
        ["ESSA_W_GND", "ESSA_N_GND", "ESSA_E_GND"]
    )
    assert.deepEqual(after, ["GND-W"])
})

console.log(`\n${passed} passed`)

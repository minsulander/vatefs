/**
 * parseControllerRole must not throw on missing owner (printed / unowned strips).
 * Run: npx tsx src/parse-controller-role.test.ts
 */
import assert from "node:assert/strict"
import { parseControllerRole, controllerCallsignsEqual } from "./static-config.js"

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

console.log("parse-controller-role tests")

check("undefined callsign → TWR", () => {
    assert.equal(parseControllerRole(undefined, ["ESGG"]), "TWR")
})

check("null callsign → TWR", () => {
    assert.equal(parseControllerRole(null, ["ESGG"]), "TWR")
})

check("empty callsign → TWR", () => {
    assert.equal(parseControllerRole("", ["ESGG"]), "TWR")
})

check("GND / APP / CTR suffixes", () => {
    assert.equal(parseControllerRole("ESGG_GND", []), "GND")
    assert.equal(parseControllerRole("ESGG_APP", []), "APP")
    assert.equal(parseControllerRole("ESAA_CTR", []), "CTR")
    assert.equal(parseControllerRole("ESGG_TWR", []), "TWR")
    assert.equal(parseControllerRole("ESGG_R_APP", []), "TWR")
})

check("ESSA APP with flexible underscores → APP", () => {
    assert.equal(parseControllerRole("ESSA_APP", []), "APP")
    assert.equal(parseControllerRole("ESSA__APP", []), "APP")
    assert.equal(parseControllerRole("ESSA_E_APP", []), "APP")
    assert.equal(parseControllerRole("ESSA__E_APP", []), "APP")
    assert.equal(parseControllerRole("ESSA_E__APP", []), "APP")
    assert.equal(parseControllerRole("ESSA_R_APP", []), "TWR")
})

check("controllerCallsignsEqual collapses underscores", () => {
    assert.equal(controllerCallsignsEqual("ESGG__TWR", "ESGG_TWR"), true)
    assert.equal(controllerCallsignsEqual("ESGG_TWR", "ESGG__TWR"), true)
    assert.equal(controllerCallsignsEqual("ESGG_E_TWR", "ESGG__TWR"), false)
    assert.equal(controllerCallsignsEqual("ESGG_TWR", "ESGG_GND"), false)
    assert.equal(controllerCallsignsEqual(undefined, "ESGG_TWR"), false)
})

console.log(`${passed} passed`)

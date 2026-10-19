/**
 * Unit tests for startup callsign → config mapping.
 * Run: npx tsx src/config-autoselect.test.ts
 */

import assert from "node:assert/strict"
import { configFileForLoginCallsign } from "./config-autoselect.js"

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

console.log("config-autoselect tests")

check("ESSA_TWR → essa.yml", () => {
    assert.equal(configFileForLoginCallsign("ESSA_TWR"), "essa.yml")
})

check("ESSA_R_TWR → essa.yml", () => {
    assert.equal(configFileForLoginCallsign("ESSA_R_TWR"), "essa.yml")
})

check("lowercase essa_gnd → essa.yml", () => {
    assert.equal(configFileForLoginCallsign("essa_gnd"), "essa.yml")
})

check("ESGG_APP → esgg.yml", () => {
    assert.equal(configFileForLoginCallsign("ESGG_APP"), "esgg.yml")
})

check("ESSR_CTR → RTC", () => {
    assert.equal(configFileForLoginCallsign("ESSR_CTR"), "multiairport.yml")
})

check("ESOS_CTR → RTC", () => {
    assert.equal(configFileForLoginCallsign("ESOS_CTR"), "multiairport.yml")
})

check("ESMM_APP → RTC", () => {
    assert.equal(configFileForLoginCallsign("ESMM_APP"), "multiairport.yml")
})

check("ESMS_TWR and ESMS_GND → 1RWY3BAY", () => {
    assert.equal(configFileForLoginCallsign("ESMS_TWR"), "singlerwy3bays.yml")
    assert.equal(configFileForLoginCallsign("ESMS_GND"), "singlerwy3bays.yml")
    assert.equal(configFileForLoginCallsign("ESMS__TWR"), "singlerwy3bays.yml")
})

check("other ESMS positions do not auto-select", () => {
    assert.equal(configFileForLoginCallsign("ESMS_DEL"), undefined)
    assert.equal(configFileForLoginCallsign("ESMS_APP"), undefined)
})

check("prefix without underscore does not match", () => {
    assert.equal(configFileForLoginCallsign("ESSA"), undefined)
    assert.equal(configFileForLoginCallsign("ESSR"), undefined)
})

check("empty callsign does not auto-select", () => {
    assert.equal(configFileForLoginCallsign(""), undefined)
    assert.equal(configFileForLoginCallsign(null), undefined)
})

console.log(`\n${passed} passed`)

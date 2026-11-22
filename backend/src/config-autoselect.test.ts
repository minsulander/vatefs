import assert from "node:assert/strict"
import { configFileForLoginCallsign, configForLoginCallsign } from "./config-autoselect.js"

function check(name: string, fn: () => void) {
    try {
        fn()
        console.log(`  ok  ${name}`)
    } catch (err) {
        console.error(`  FAIL  ${name}`)
        throw err
    }
}

console.log("config-autoselect")

check("ESSA_TWR → essa.yml", () => {
    assert.equal(configFileForLoginCallsign("ESSA_TWR"), "essa.yml")
})

check("ESSA_R_TWR → essa.yml", () => {
    assert.equal(configFileForLoginCallsign("ESSA_R_TWR"), "essa.yml")
})

check("essa_gnd → essa.yml", () => {
    assert.equal(configFileForLoginCallsign("essa_gnd"), "essa.yml")
})

check("ESGG_* → paper.yml (unified paper board)", () => {
    assert.equal(configFileForLoginCallsign("ESGG_APP"), "paper.yml")
    assert.equal(configFileForLoginCallsign("ESGG_TWR"), "paper.yml")
    assert.equal(configFileForLoginCallsign("ESGG_F_APP"), "paper.yml")
})

check("ESSR_CTR → multiairport.yml", () => {
    assert.equal(configFileForLoginCallsign("ESSR_CTR"), "multiairport.yml")
})

check("ESOS_CTR → multiairport.yml", () => {
    assert.equal(configFileForLoginCallsign("ESOS_CTR"), "multiairport.yml")
})

check("ESMM_APP → multiairport.yml", () => {
    assert.equal(configFileForLoginCallsign("ESMM_APP"), "multiairport.yml")
})

check("ESMS_* → paper.yml (Sturup via PAPER overlay)", () => {
    assert.equal(configFileForLoginCallsign("ESMS_TWR"), "paper.yml")
    assert.equal(configFileForLoginCallsign("ESMS_GND"), "paper.yml")
    assert.equal(configFileForLoginCallsign("ESMS_DEL"), "paper.yml")
    assert.equal(configFileForLoginCallsign("ESMS_APP"), "paper.yml")
    assert.equal(configFileForLoginCallsign("ESMS__TWR"), "paper.yml")
    assert.deepEqual(configForLoginCallsign("ESMS_TWR"), {
        file: "paper.yml",
    })
})

check("ESSB_* → paper.yml (Bromma via PAPER overlay)", () => {
    assert.equal(configFileForLoginCallsign("ESSB_TWR"), "paper.yml")
    assert.equal(configFileForLoginCallsign("ESSB_GND"), "paper.yml")
    assert.equal(configFileForLoginCallsign("ESSB_DEL"), "paper.yml")
    assert.equal(configFileForLoginCallsign("ESSB_APP"), "paper.yml")
    assert.deepEqual(configForLoginCallsign("ESSB_TWR"), {
        file: "paper.yml",
    })
})

check("ESPA_* → paper.yml", () => {
    assert.equal(configFileForLoginCallsign("ESPA_APP"), "paper.yml")
    assert.equal(configFileForLoginCallsign("ESPA_TWR"), "paper.yml")
    assert.equal(configFileForLoginCallsign("ESPA_F_APP"), "paper.yml")
})

check("bare ESSA / ESSR → no autoselect", () => {
    assert.equal(configFileForLoginCallsign("ESSA"), undefined)
    assert.equal(configFileForLoginCallsign("ESSR"), undefined)
})

check("empty / null → no autoselect", () => {
    assert.equal(configFileForLoginCallsign(""), undefined)
    assert.equal(configFileForLoginCallsign(null), undefined)
})

console.log("config-autoselect: all passed")

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

check("ESGG_APP → esgg.yml", () => {
    assert.equal(configFileForLoginCallsign("ESGG_APP"), "esgg.yml")
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

check("ESMS_TWR and ESMS_GND → saab.yml / 1rwy3", () => {
    assert.equal(configFileForLoginCallsign("ESMS_TWR"), "saab.yml")
    assert.equal(configFileForLoginCallsign("ESMS_GND"), "saab.yml")
    assert.equal(configFileForLoginCallsign("ESMS__TWR"), "saab.yml")
    assert.deepEqual(configForLoginCallsign("ESMS_TWR"), {
        file: "saab.yml",
        saabLayoutId: "1rwy3",
    })
})

check("ESMS_DEL / ESMS_APP → no autoselect", () => {
    assert.equal(configFileForLoginCallsign("ESMS_DEL"), undefined)
    assert.equal(configFileForLoginCallsign("ESMS_APP"), undefined)
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

/**
 * Unit tests for TMA/CTR ESE OWNER coverage helpers.
 * Run: npx tsx src/airport-coverage.test.ts
 */

import assert from "node:assert/strict"
import {
    __setCtrOwnerChainForTest,
    __setTmaOwnerChainForTest,
    coversCtr,
    coversTma,
    firstOnlineInOwnerChain,
} from "./ese-airspace.js"
import { isAreaCtrLogin } from "./airport-coverage.js"

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

console.log("airport-coverage tests")

__setTmaOwnerChainForTest("ESPA", ["PAA", "PA", "RTC"])
__setCtrOwnerChainForTest("ESPA", ["PA", "PAA", "RTC"])
__setTmaOwnerChainForTest("ESSA", ["E", "W", "OS"])
__setCtrOwnerChainForTest("ESSA", ["TE", "TW", "TS"])

check("firstOnlineInOwnerChain returns first hit", () => {
    assert.equal(
        firstOnlineInOwnerChain(["PAA", "PA", "RTC"], new Set(["PA", "RTC"])),
        "PA"
    )
})

check("APP SI covers TMA when first online; TWR covers CTR", () => {
    const online = new Set(["PAA", "PA"])
    assert.equal(coversTma("ESPA", "PAA", online), true)
    assert.equal(coversTma("ESPA", "PA", online), false)
    assert.equal(coversCtr("ESPA", "PA", online), true)
    assert.equal(coversCtr("ESPA", "PAA", online), false)
})

check("combined-service TWR covers TMA when APP offline", () => {
    const online = new Set(["PA"])
    assert.equal(coversTma("ESPA", "PA", online), true)
    assert.equal(coversCtr("ESPA", "PA", online), true)
})

check("ESSA tower SI not on TMA chain → no TMA coverage", () => {
    const online = new Set(["TE", "E"])
    assert.equal(coversTma("ESSA", "TE", online), false)
    assert.equal(coversTma("ESSA", "E", online), true)
    assert.equal(coversCtr("ESSA", "TE", online), true)
})

check("isAreaCtrLogin detects FIR / area CTR", () => {
    assert.equal(isAreaCtrLogin("ESAA_CTR"), true)
    assert.equal(isAreaCtrLogin("ESOS_W_CTR"), true)
    assert.equal(isAreaCtrLogin("ESMM_CTR"), true)
    assert.equal(isAreaCtrLogin("ESSR_CTR"), false)
    assert.equal(isAreaCtrLogin("ESPA_APP"), false)
})

console.log(`\n${passed} passed`)

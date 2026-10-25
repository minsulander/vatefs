/**
 * VatFSP integration helpers (run: npx tsx src/fsp-api.test.ts)
 */

import assert from "node:assert/strict"
import {
    blankPaperInfoKind,
    externalStripType,
    fspPrintSuccessBody,
    listFspServerBaseUrls,
    parseExternalRflFeet,
    pickExternalField,
} from "./fsp-api.js"

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

console.log("fsp-api")

check("pickExternalField aliases", () => {
    assert.equal(pickExternalField({ origin: "ESGG" }, "departure", "origin"), "ESGG")
    assert.equal(pickExternalField({ departure: "ESSA" }, "departure", "origin"), "ESSA")
    assert.equal(pickExternalField({}, "callsign"), undefined)
})

check("externalStripType / blank kind", () => {
    assert.equal(externalStripType({}), "departure")
    assert.equal(externalStripType({ type: "arrival" }), "arrival")
    assert.equal(blankPaperInfoKind({}), "empty_dep")
    assert.equal(blankPaperInfoKind({ type: "arrival" }), "empty_arr")
})

check("parseExternalRflFeet", () => {
    assert.equal(parseExternalRflFeet("FL370"), 37000)
    assert.equal(parseExternalRflFeet("370"), 37000)
    assert.equal(parseExternalRflFeet("37000"), 37000)
    assert.equal(parseExternalRflFeet("A050"), 5000)
    assert.equal(parseExternalRflFeet(""), undefined)
})

check("listFspServerBaseUrls prefers 127.0.0.1 for VatIRIS browser", () => {
    const urls = listFspServerBaseUrls(17770)
    assert.ok(urls.length >= 1)
    assert.equal(urls[0], "http://127.0.0.1:17770")
    for (const u of urls) {
        assert.match(u, /^http:\/\/.+:17770$/)
    }
})

check("fspPrintSuccessBody matches VatFSP so IRIS marks printed", () => {
    const ok = fspPrintSuccessBody("SAS123", "departure", false)
    assert.equal(ok.success, true)
    assert.equal(ok.callsign, "SAS123")
    assert.equal(ok.type, "departure")
    assert.equal(ok.blank, false)
    assert.match(ok.message, /SAS123/)
    const blank = fspPrintSuccessBody(null, "arrival", true)
    assert.equal(blank.success, true)
    assert.equal(blank.callsign, null)
    assert.equal(blank.blank, true)
})

console.log(`\n${passed} passed`)

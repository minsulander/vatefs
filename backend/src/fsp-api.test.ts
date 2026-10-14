/**
 * VatFSP integration helpers (run: npx tsx src/fsp-api.test.ts)
 */

import assert from "node:assert/strict"
import {
    blankPaperInfoKind,
    externalStripType,
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

check("listFspServerBaseUrls returns http URLs", () => {
    const urls = listFspServerBaseUrls(17770)
    assert.ok(urls.length >= 1)
    for (const u of urls) {
        assert.match(u, /^http:\/\/.+:17770$/)
    }
})

console.log(`\n${passed} passed`)

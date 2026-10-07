/**
 * ESMS preferred SID tests (run: npx tsx src/esms-sid.test.ts)
 */

import assert from "node:assert/strict"
import {
    esmsSidLetter,
    findEsmsSidInNames,
    formatEsmsDisplaySi,
    isEkchRwy30Active,
    normalizeEsmsDepRwy,
    resolveEsmsPreferredSidFromNames,
} from "./esms-sid.js"

const NAMES_17 = [
    "BABSI1K",
    "DISGO1K",
    "EKRAL1K",
    "ERNOV1K",
    "NEXIL1K",
    "SALLO1K",
    "TELMO1K",
    "BABSI1G",
    "ERNOV1G",
]

const NAMES_35 = [
    "BABSI1L",
    "DISGO1L",
    "EKRAL1L",
    "ERNOV1L",
    "NEXIL1L",
    "SALLO1L",
    "TELMO1L",
    "DISGO1H",
    "SALLO1H",
]

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

console.log("esms-sid")

check("normalize dep rwy", () => {
    assert.equal(normalizeEsmsDepRwy("17"), "17")
    assert.equal(normalizeEsmsDepRwy("35"), "35")
    assert.equal(normalizeEsmsDepRwy("11"), undefined)
})

check("letters normal", () => {
    assert.equal(esmsSidLetter("BABSI", "17", false), "K")
    assert.equal(esmsSidLetter("TELMO", "35", false), "L")
})

check("letters ekch30", () => {
    assert.equal(esmsSidLetter("BABSI", "17", true), "G")
    assert.equal(esmsSidLetter("ERNOV", "17", true), "G")
    assert.equal(esmsSidLetter("DISGO", "17", true), "K")
    assert.equal(esmsSidLetter("DISGO", "35", true), "H")
    assert.equal(esmsSidLetter("SALLO", "35", true), "H")
    assert.equal(esmsSidLetter("BABSI", "35", true), "L")
})

check("find named sid", () => {
    assert.equal(findEsmsSidInNames(NAMES_17, "BABSI", "K"), "BABSI1K")
    assert.equal(findEsmsSidInNames(NAMES_17, "BABSI", "G"), "BABSI1G")
})

check("preferred normal 17", () => {
    const r = resolveEsmsPreferredSidFromNames(NAMES_17, {
        runway: "17",
        route: "DCT BABSI DCT",
        ekch30: false,
    })
    assert.equal(r.sid, "BABSI1K")
    assert.equal(r.exit, "BABSI")
    assert.ok(r.sortGroup.includes("BABSI1K"))
    assert.ok(!r.sortGroup.includes("BABSI1G"))
})

check("preferred ekch30 17 BABSI", () => {
    const r = resolveEsmsPreferredSidFromNames(NAMES_17, {
        runway: "17",
        route: "BABSI NEXIL",
        ekch30: true,
    })
    assert.equal(r.sid, "BABSI1G")
    assert.ok(r.sortGroup.includes("BABSI1G"))
    assert.ok(r.sortGroup.includes("DISGO1K"))
})

check("preferred ekch30 35 DISGO", () => {
    const r = resolveEsmsPreferredSidFromNames(NAMES_35, {
        runway: "35",
        route: "DCT DISGO",
        ekch30: true,
    })
    assert.equal(r.sid, "DISGO1H")
})

check("preferred no exit", () => {
    const r = resolveEsmsPreferredSidFromNames(NAMES_17, {
        runway: "17",
        route: "DCT SOMEX",
        ekch30: false,
    })
    assert.equal(r.sid, null)
    assert.ok(r.sortGroup.length > 0)
})

check("formatEsmsDisplaySi", () => {
    assert.equal(formatEsmsDisplaySi("ESMS_TWR"), "TWR")
    assert.equal(formatEsmsDisplaySi("ESMS_GND"), "AD2")
    assert.equal(formatEsmsDisplaySi("ESMS_DEL"), "AD2")
    assert.equal(formatEsmsDisplaySi("ESGG_GND"), undefined)
    assert.equal(formatEsmsDisplaySi(undefined, "AD2"), "AD2")
    assert.equal(formatEsmsDisplaySi(undefined, "AD1"), "TWR")
})

check("isEkchRwy30Active from ES rwyconfig", () => {
    assert.equal(isEkchRwy30Active(undefined), false)
    assert.equal(isEkchRwy30Active({ EKCH: { dep: ["22L"], arr: ["22L"] } }), false)
    assert.equal(isEkchRwy30Active({ EKCH: { dep: ["30"], arr: ["22L"] } }), true)
    assert.equal(isEkchRwy30Active({ EKCH: { arr: ["30"], dep: [] } }), true)
})

console.log(`esms-sid: ${passed} passed`)

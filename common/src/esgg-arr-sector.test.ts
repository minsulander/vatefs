/**
 * ESGG ARR sector box tests (run: npx tsx src/esgg-arr-sector.test.ts)
 */

import assert from "node:assert/strict"
import {
    esggArrAppSide,
    esggArrSectorCode,
    esggStarEntryFix,
    normalizeEsggArrRwy,
} from "./esgg-arr-sector.js"

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

console.log("esgg-arr-sector")

check("normalize rwy", () => {
    assert.equal(normalizeEsggArrRwy("3"), "03")
    assert.equal(normalizeEsggArrRwy("03"), "03")
    assert.equal(normalizeEsggArrRwy("21"), "21")
})

check("STAR entry fix from designator", () => {
    assert.equal(esggStarEntryFix("NEGIL3L"), "NEGIL")
    assert.equal(esggStarEntryFix("ARQUS1S"), "ARQUS")
    assert.equal(esggStarEntryFix("RISMA 4L"), "RISMA")
})

check("fixed COPX entries → APPE/APPW", () => {
    assert.equal(esggArrAppSide({ star: "KELIN3L" }), "E")
    assert.equal(esggArrAppSide({ star: "MOXAM3L" }), "E")
    assert.equal(esggArrAppSide({ star: "NEGIL3S" }), "E")
    assert.equal(esggArrAppSide({ tmaEntry: "GG550" }), "E")
    assert.equal(esggArrAppSide({ star: "RISMA4L" }), "W")
    assert.equal(esggArrAppSide({ star: "MAKUR5L" }), "W")
    assert.equal(esggArrAppSide({ star: "LOBBI4S" }), "W")
    assert.equal(esggArrAppSide({ tmaEntry: "GG630" }), "W")
})

check("ARQUS runway-dependent south split (ESE APPS03/21)", () => {
    assert.equal(esggArrAppSide({ star: "ARQUS1L", arrRwy: "03" }), "W")
    assert.equal(esggArrAppSide({ star: "ARQUS1S", arrRwy: "21" }), "E")
    assert.equal(esggArrAppSide({ star: "ARQUS1L" }), undefined)
})

check("sector code: no ETN → ZZGG", () => {
    assert.equal(esggArrSectorCode({ star: "NEGIL3L", arrRwy: "03" }), "ZZGG")
    assert.equal(
        esggArrSectorCode({ star: "NEGIL3L", arrRwy: "03", sectorEntryMin: undefined }),
        "ZZGG",
    )
})

check("sector code: ETN + AoR → ZZGE/ZZGW", () => {
    assert.equal(
        esggArrSectorCode({ star: "NEGIL3L", arrRwy: "03", sectorEntryMin: 12 }),
        "ZZGE",
    )
    assert.equal(
        esggArrSectorCode({ star: "RISMA4L", arrRwy: "03", sectorEntryMin: 8 }),
        "ZZGW",
    )
    assert.equal(
        esggArrSectorCode({ star: "ARQUS1L", arrRwy: "03", sectorEntryMin: 10 }),
        "ZZGW",
    )
    assert.equal(
        esggArrSectorCode({ star: "ARQUS1S", arrRwy: "21", sectorEntryMin: 10 }),
        "ZZGE",
    )
})

check("sector code: ETN but unknown entry → ZZGG", () => {
    assert.equal(
        esggArrSectorCode({ star: "SOPAM1A", arrRwy: "03", sectorEntryMin: 14 }),
        "ZZGG",
    )
})

console.log(`\n${passed} passed`)

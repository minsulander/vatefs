/**
 * ESGG APP-E/W handoff tests (run: npx tsx src/esgg-app.test.ts)
 */

import assert from "node:assert/strict"
import {
    esggDepAppSide,
    esggMisapAppSide,
    esggSidPrefix,
    formatEsggAppSi,
    formatEsggDisplaySi,
    namedEsggSidRegex,
    normalizeEsggRwy,
    resolveEsggDepApp,
    resolveEsggMapDelivery,
    resolveEsggMisapApp,
} from "./esgg-app.js"

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

console.log("esgg-app")

check("normalize rwy 3/03/21", () => {
    assert.equal(normalizeEsggRwy("3"), "03")
    assert.equal(normalizeEsggRwy("03"), "03")
    assert.equal(normalizeEsggRwy("21"), "21")
})

check("sid prefix", () => {
    assert.equal(esggSidPrefix("DETNA3M"), "DETNA")
    assert.equal(esggSidPrefix("DETNA 3M"), "DETNA")
    assert.equal(esggSidPrefix("SOJWI1P"), "SOJWI")
})

check("AIRAC-independent designator regex (LABAN 3M family)", () => {
    const re = namedEsggSidRegex("LABAN", "M")
    assert.equal(re.test("LABAN3M"), true)
    assert.equal(re.test("LABAN4M"), true)
    assert.equal(re.test("LABAN99M"), true)
    assert.equal(re.test("LABAN3J"), false)
    assert.equal(re.test("LABAN"), false)
})

check("LABAN 3M / AIRAC variants → APP-E on RWY 03", () => {
    assert.equal(esggDepAppSide("03", "LABAN3M"), "E")
    assert.equal(esggDepAppSide("03", "LABAN 3M"), "E")
    assert.equal(esggDepAppSide("03", "LABAN4M"), "E")
    assert.equal(esggDepAppSide("03", "LABAN"), "E")
    assert.equal(esggDepAppSide("03", undefined, "LABAN N0450F350 DETNA"), "E")
})

check("RWY 03 DEP SID → APP", () => {
    assert.equal(esggDepAppSide("03", "DETNA3M"), "E")
    assert.equal(esggDepAppSide("03", "LUKAX3M"), "E")
    assert.equal(esggDepAppSide("03", "NEGIL3M"), "E")
    assert.equal(esggDepAppSide("03", "SABAK3M"), "E")
    assert.equal(esggDepAppSide("03", "TOPLA3M"), "W")
    assert.equal(esggDepAppSide("03", "VADIN3M"), "W")
    assert.equal(esggDepAppSide("03", "SOJWI1P"), "W")
    assert.equal(esggDepAppSide("03", "TAKOV3R"), "E")
    assert.equal(esggDepAppSide("03", "TISAB3R"), "E")
})

check("RWY 21 DEP SID → APP (AIRAC-flexible number)", () => {
    assert.equal(esggDepAppSide("21", "DETNA3J"), "W")
    assert.equal(esggDepAppSide("21", "DETNA5J"), "W")
    assert.equal(esggDepAppSide("21", "LABAN4J"), "E")
    assert.equal(esggDepAppSide("21", "LABAN5J"), "E")
    assert.equal(esggDepAppSide("21", "LUKAX4J"), "E")
    assert.equal(esggDepAppSide("21", "SABAK3J"), "W")
    assert.equal(esggDepAppSide("21", "SULIX3J"), "E")
    assert.equal(esggDepAppSide("21", "TOPLA3J"), "W")
    assert.equal(esggDepAppSide("21", "VADIN3J"), "W")
    assert.equal(esggDepAppSide("21", "NEGIL2G"), "E")
    assert.equal(esggDepAppSide("21", "PEVAK2G"), "E")
    assert.equal(esggDepAppSide("21", "MISVI3P"), "E")
})

check("wrong letter for runway does not false-match via designator", () => {
    // LABAN3M is RWY 03 family — on 21 only J matches designator; prefix-only still E
    assert.equal(esggDepAppSide("21", "LABAN3M"), "E") // prefix fallback, same side
    assert.equal(esggDepAppSide("03", "LABAN4J"), "E")
})

check("unknown SID/rwy → undefined", () => {
    assert.equal(esggDepAppSide("03", "XXXXX1A"), undefined)
    assert.equal(esggDepAppSide("08", "DETNA3M"), undefined)
    assert.equal(esggDepAppSide("03", undefined), undefined)
})

check("MISAP sides", () => {
    assert.equal(esggMisapAppSide("03"), "W")
    assert.equal(esggMisapAppSide("21"), "E")
    assert.equal(resolveEsggMapDelivery("03").heading, 20)
    assert.equal(resolveEsggMapDelivery("21").heading, 200)
})

check("formatEsggDisplaySi DEL/GND/TWR/A/W", () => {
    assert.equal(formatEsggDisplaySi("XX", "ESGG_DEL"), "DEL")
    assert.equal(formatEsggDisplaySi("XX", "ESGG_GND"), "GND")
    assert.equal(formatEsggDisplaySi("XX", "ESGG_TWR"), "TWR")
    assert.equal(formatEsggDisplaySi("XX", "ESGG_A_APP"), "A")
    assert.equal(formatEsggDisplaySi(undefined, "ESGG_A_APP"), "A")
    assert.equal(formatEsggDisplaySi("XX", "ESGG_W_APP"), "W")
    assert.equal(formatEsggDisplaySi("XX", "ESGG_E_APP"), "E")
    assert.equal(formatEsggDisplaySi("AW"), "W")
    assert.equal(formatEsggDisplaySi("LT"), "TWR")
})

check("resolve online APP by side (A = east)", () => {
    const online = [
        { callsign: "ESGG_A_APP", frequency: 124.68, role: "APP" as const },
        { callsign: "ESGG_W_APP", frequency: 124.205, role: "APP" as const },
        { callsign: "ESGG_DEL", frequency: 121.68, role: "DEL" as const },
    ]
    const dep = resolveEsggDepApp("03", "TOPLA3M", online)
    assert.equal(dep?.callsign, "ESGG_W_APP")
    assert.equal(dep?.side, "W")

    const laban = resolveEsggDepApp("03", "LABAN4M", online, "ESGG", "N0450F350")
    assert.equal(laban?.callsign, "ESGG_A_APP")

    const east = resolveEsggDepApp("03", "DETNA3M", online)
    assert.equal(east?.callsign, "ESGG_A_APP")

    const misap = resolveEsggMisapApp("03", online)
    assert.equal(misap?.callsign, "ESGG_W_APP")

    assert.equal(formatEsggAppSi("ESGG_W_APP", "W"), "W")
    assert.equal(formatEsggAppSi("ESGG_A_APP", "E"), "A")
})

console.log(`\n${passed} passed`)

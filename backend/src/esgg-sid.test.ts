/**
 * ESGG preferred SID tests (run: npx tsx src/esgg-sid.test.ts)
 */

import assert from "node:assert/strict"
import {
    findEsggSidInNames,
    isEsggNightSidHours,
    isEsggPropLowClimbSid,
    normalizeEsggDepRwy,
    resolveEsggPreferredSidFromNames,
    resolveEsggSidDesignator,
} from "./esgg-sid.js"

const NAMES_03 = [
    "DETNA3M",
    "LABAN3M",
    "LUKAX3M",
    "NEGIL3M",
    "SABAK3M",
    "TOPLA3M",
    "VADIN3M",
    "SOJWI1P",
    "TAKOV3R",
    "TISAB3R",
]

const NAMES_21 = [
    "DETNA3J",
    "LABAN3J",
    "LUKAX3J",
    "SABAK3J",
    "SULIX3J",
    "TOPLA3J",
    "VADIN3J",
    "NEGIL2G",
    "PEVAK2G",
    "MISVI3P",
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

console.log("esgg-sid")

check("normalize dep rwy", () => {
    assert.equal(normalizeEsggDepRwy("03"), "03")
    assert.equal(normalizeEsggDepRwy("3"), "03")
    assert.equal(normalizeEsggDepRwy("21"), "21")
    assert.equal(normalizeEsggDepRwy("08"), undefined)
})

check("designator jet day 03", () => {
    assert.deepEqual(resolveEsggSidDesignator({ runway: "03", exit: "LABAN", prop: false, night: false }), {
        prefix: "LABAN",
        letter: "M",
    })
})

check("designator prop TOPLA → SOJWI#P", () => {
    assert.deepEqual(resolveEsggSidDesignator({ runway: "03", exit: "TOPLA", prop: true, night: false }), {
        prefix: "SOJWI",
        letter: "P",
    })
})

check("designator prop 21 LABAN/NEGIL/SABAK", () => {
    assert.deepEqual(resolveEsggSidDesignator({ runway: "21", exit: "LABAN", prop: true, night: false }), {
        prefix: "MISVI",
        letter: "P",
    })
    assert.deepEqual(resolveEsggSidDesignator({ runway: "21", exit: "NEGIL", prop: true, night: false }), {
        prefix: "NEGIL",
        letter: "G",
    })
    assert.deepEqual(resolveEsggSidDesignator({ runway: "21", exit: "SABAK", prop: true, night: false }), {
        prefix: "PEVAK",
        letter: "G",
    })
})

check("designator jet 21 NEGIL → SULIX", () => {
    assert.deepEqual(resolveEsggSidDesignator({ runway: "21", exit: "NEGIL", prop: false, night: false }), {
        prefix: "SULIX",
        letter: "J",
    })
})

check("designator night DETNA/SABAK → TAKOV/TISAB", () => {
    assert.deepEqual(resolveEsggSidDesignator({ runway: "03", exit: "DETNA", prop: false, night: true }), {
        prefix: "TAKOV",
        letter: "R",
    })
    assert.deepEqual(resolveEsggSidDesignator({ runway: "03", exit: "SABAK", prop: false, night: true }), {
        prefix: "TISAB",
        letter: "R",
    })
    // Other exits stay #M at night
    assert.deepEqual(resolveEsggSidDesignator({ runway: "03", exit: "LABAN", prop: false, night: true }), {
        prefix: "LABAN",
        letter: "M",
    })
})

check("prop without dedicated SID → normal", () => {
    assert.deepEqual(resolveEsggSidDesignator({ runway: "03", exit: "DETNA", prop: true, night: false }), {
        prefix: "DETNA",
        letter: "M",
    })
    assert.deepEqual(resolveEsggSidDesignator({ runway: "21", exit: "TOPLA", prop: true, night: false }), {
        prefix: "TOPLA",
        letter: "J",
    })
})

check("find named sid", () => {
    assert.equal(findEsggSidInNames(NAMES_03, "SOJWI", "P"), "SOJWI1P")
    assert.equal(findEsggSidInNames(NAMES_21, "SULIX", "J"), "SULIX3J")
})

check("preferred jet 21 NEGIL → SULIX", () => {
    const r = resolveEsggPreferredSidFromNames(NAMES_21, {
        runway: "21",
        route: "DCT NEGIL DCT",
        prop: false,
        night: false,
    })
    assert.equal(r.sid, "SULIX3J")
    assert.equal(r.exit, "NEGIL")
})

check("preferred prop 03 TOPLA → SOJWI", () => {
    const r = resolveEsggPreferredSidFromNames(NAMES_03, {
        runway: "03",
        route: "TOPLA N0450F350",
        prop: true,
        night: false,
    })
    assert.equal(r.sid, "SOJWI1P")
})

check("preferred prop 21 LABAN → MISVI", () => {
    const r = resolveEsggPreferredSidFromNames(NAMES_21, {
        runway: "21",
        route: "LABAN",
        prop: true,
        night: false,
    })
    assert.equal(r.sid, "MISVI3P")
})

check("preferred night DETNA → TAKOV", () => {
    const r = resolveEsggPreferredSidFromNames(NAMES_03, {
        runway: "03",
        route: "DETNA",
        prop: false,
        night: true,
    })
    assert.equal(r.sid, "TAKOV3R")
})

check("preferred night SABAK → TISAB", () => {
    const r = resolveEsggPreferredSidFromNames(NAMES_03, {
        runway: "03",
        route: "SABAK",
        prop: false,
        night: true,
    })
    assert.equal(r.sid, "TISAB3R")
})

check("preferred no exit", () => {
    const r = resolveEsggPreferredSidFromNames(NAMES_03, {
        runway: "03",
        route: "DCT SOMEX",
        prop: false,
        night: false,
    })
    assert.equal(r.sid, null)
    assert.ok(r.sortGroup.length > 0)
})

check("prop low climb SIDs", () => {
    assert.equal(isEsggPropLowClimbSid("MISVI3P"), true)
    assert.equal(isEsggPropLowClimbSid("SOJWI1P"), true)
    assert.equal(isEsggPropLowClimbSid("LABAN3M"), false)
})

check("night hours helper shape", () => {
    // Smoke: function returns boolean for "now"
    assert.equal(typeof isEsggNightSidHours(), "boolean")
    // Fixed: 23:00 Stockholm → night
    const night = new Date("2026-01-15T22:00:00.000Z") // 23:00 CET
    assert.equal(isEsggNightSidHours(night), true)
    // Fixed: 12:00 Stockholm → day
    const day = new Date("2026-06-15T10:00:00.000Z") // 12:00 CEST
    assert.equal(isEsggNightSidHours(day), false)
})

console.log(`esgg-sid: ${passed} passed`)

/**
 * Quick node checks: npx tsx src/auto-direct.test.ts
 */
import {
    parseRflToFeet,
    fprDepDisplayFix,
    hasExplicitDepRunway,
    resolveLopAutoDirect,
    resolveLopSuggestDirects,
} from "./auto-direct.js"

function assert(cond: unknown, msg: string) {
    if (!cond) throw new Error(msg)
}

assert(parseRflToFeet("FL285") === 28500, "FL285")
assert(parseRflToFeet(34000) === 34000, "feet")
assert(parseRflToFeet("A050") === 5000, "A050")

const esmtLow = resolveLopAutoDirect({
    adep: "ESMT",
    route: "ESMT/01 N0440F280 MIKNA DCT",
    rflFeet: 28000,
})
assert(esmtLow?.point === "MIKNA" && esmtLow.mode === "auto", "ESMT RFL285-")

const esmtHigh = resolveLopAutoDirect({
    adep: "ESMT",
    route: "N0450F340 BEDOS DCT",
    rflFeet: 34000,
})
assert(esmtHigh?.point === "BEDOS", "ESMT RFL285+")

const esmk = resolveLopAutoDirect({
    adep: "ESMK",
    route: "N0440F240 BEDOS DCT NILUG",
    rflFeet: 24000,
})
assert(esmk?.point === "BEDOS", "ESMK BEDOS")

const esmx = resolveLopAutoDirect({
    adep: "ESMX",
    route: "N0450F300 N851 BEDOS",
    rflFeet: 30000,
})
assert(esmx?.point === "BEDOS", "ESMX N851")

const esno = resolveLopAutoDirect({
    adep: "ESNO",
    route: "N0440F280 SIPRI DCT",
    rflFeet: 28000,
})
assert(esno?.point === "SIPRI", "ESNO SIPRI")

const soft = resolveLopSuggestDirects({
    adep: "ESDF",
    ades: "ESSA",
    route: "N0440F280 DCT",
})
assert(soft.some((s) => s.point === "NILUG" && s.mode === "suggest"), "ESDF soft NILUG")

const esnz = resolveLopSuggestDirects({
    adep: "ESNZ",
    runway: "30",
    isProp: true,
    route: "N0440F200 ABCDE DCT FGHIJ",
})
assert(esnz.some((s) => s.point === "ABCDE"), "ESNZ prop first fix")

assert(hasExplicitDepRunway("32", "N0445F340 DEDIT") === true, "ES depRwy")
assert(hasExplicitDepRunway(undefined, "ESGJ/01 N0445F340 DEVNI") === true, "FPL ADEP/rwy")
assert(hasExplicitDepRunway(undefined, "N0445F340 DEVNI") === false, "no RWY")
assert(
    fprDepDisplayFix("ESGJ", "ESGJ/01 N0445F340 DEVNI DCT", undefined) === "DEVNI",
    "FPR first fix with FPL RWY",
)
assert(
    fprDepDisplayFix("ESGJ", "N0445F340 DEVNI DCT", undefined) === undefined,
    "FPR blank without RWY",
)
assert(
    fprDepDisplayFix("ESGJ", "N0445F340 DEVNI DCT", "01") === "DEVNI",
    "FPR first fix with ES RWY",
)

console.log("auto-direct.test.ts: OK")

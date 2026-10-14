/**
 * Quick node checks: npx tsx src/essa-sep-indicators.test.ts
 */
import {
    computeEssaSepIndicators,
    essaSccLookupDesignator,
    isEssaImcFromMetar,
    isEssaSingleRwyConfig,
    mergeEssaSepIndicators,
    nextEssaSepCycleValue,
    parseEssaSccFromWxText,
    resolveEssaDepGapNm,
    resolveEssaDlvNm,
    resolveEssaSepNm,
} from "./essa-sep-indicators.js"

function assert(cond: unknown, msg: string) {
    if (!cond) throw new Error(msg)
}

// Opposite ends
assert(essaSccLookupDesignator("19R") === "01L", "19R→01L")
assert(essaSccLookupDesignator("19L") === "01R", "19L→01R")
assert(essaSccLookupDesignator("26") === "08", "26→08")
assert(essaSccLookupDesignator("01L") === "01L", "01L")
assert(essaSccLookupDesignator("08") === "08", "08")

const wx = `
01L: SCC 5 5 5 ISSUED AT 1128 RWY 100 PCT WET
08: CLOSED
01R: SCC 5 4 5 ISSUED AT 1110 RWY 100 PCT WET
`
const scc = parseEssaSccFromWxText(wx)
assert(scc.get("01L")?.join("") === "555", "parse 01L")
assert(scc.get("01R")?.join("") === "545", "parse 01R with 4")
assert(!scc.has("08"), "CLOSED has no SCC")

// SEP: ARR only; opposite end; any third ≤ 4 → 3
assert(resolveEssaSepNm(["19R"], ["01L"], scc) === 2.5, "ARR 19R→01L 555 → 2.5")
assert(resolveEssaSepNm(["19L"], ["19R"], scc) === 3, "ARR 19L→01R with 4 → 3")
assert(resolveEssaSepNm(["01R"], ["08"], scc) === 3, "ARR 01R SCC 545 → 3")
// DEP SCC must not affect SEP (DEP would be 01R with 4, ARR is 01L 555)
assert(resolveEssaSepNm(["01L"], ["01R"], scc) === 2.5, "ARR-only ignores DEP SCC")
assert(resolveEssaSepNm(["26"], ["26"], new Map()) === 2.5, "no SCC → 2.5")
const sccLow = new Map<string, [number, number, number]>([["01L", [5, 3, 5]]])
assert(resolveEssaSepNm(["01L"], [], sccLow) === 3, "third ≤ 4 (3) → 3")

// DLV
assert(resolveEssaDlvNm("1") === 2.5, "dlv default")
assert(resolveEssaDlvNm("5") === 3.5, "dlv 5")
assert(resolveEssaDlvNm("8") === 4, "dlv 8")
assert(resolveEssaDlvNm("14") === 4, "dlv 14")

// Single RWY
assert(isEssaSingleRwyConfig("3"), "3 single")
assert(isEssaSingleRwyConfig("7"), "7 single")
assert(isEssaSingleRwyConfig("9B"), "9B single")
assert(!isEssaSingleRwyConfig("1"), "1 not single")
assert(!isEssaSingleRwyConfig("14"), "14 not single")

assert(resolveEssaDepGapNm("7", false) === 8, "enbana 08")
assert(resolveEssaDepGapNm("3", false) === 6, "vmc 6")
assert(resolveEssaDepGapNm("3", true) === 7, "imc 7")
assert(resolveEssaDepGapNm("1", false) === null, "no gap dual")

// METAR IMC
assert(!isEssaImcFromMetar("METAR ESSA 142020Z 29007KT CAVOK 05/04 Q1018 NOSIG"), "cavok vmc")
assert(
    !isEssaImcFromMetar("METAR ESSA 142020Z 29007KT 9999 NSC 05/04 Q1018"),
    "9999 nsc vmc"
)
assert(
    isEssaImcFromMetar("METAR ESSA 142020Z 29007KT 2000 BR BKN008 05/04 Q1018"),
    "low vis+ceiling imc"
)
assert(
    isEssaImcFromMetar("METAR ESSA 142020Z 29007KT 9999 BKN010 05/04 Q1018"),
    "bkn010 imc"
)
assert(
    !isEssaImcFromMetar("METAR ESSA 142020Z 29007KT 9999 BKN020 05/04 Q1018"),
    "bkn020 vmc"
)

const ind = computeEssaSepIndicators({
    configId: "3",
    arrRunways: ["01L"],
    depRunways: ["01L"],
    sccByDesignator: scc,
    metar: "METAR ESSA 142020Z 29007KT CAVOK 05/04 Q1018",
})
assert(ind.sep === "2.5 nm", "ind sep")
assert(ind.dlv === "2.5 nm", "ind dlv")
assert(ind.depGap === "6 nm", "ind gap vmc")

const ind5 = computeEssaSepIndicators({
    configId: "5",
    arrRunways: ["01R"],
    depRunways: ["08"],
    sccByDesignator: scc,
    metar: "METAR ESSA 142020Z 29007KT 2000 BR BKN008 05/04 Q1018",
})
assert(ind5.dlv === "3.5 nm", "ind5 dlv")
assert(ind5.depGap === "", "ind5 no gap")
assert(ind5.sep === "3 nm", "ind5 sep from ARR 01R SCC ≤4")

// Overrides merge
const merged = mergeEssaSepIndicators(ind, { sep: "3 nm", depGap: "" })
assert(merged.sep === "3 nm", "merge sep override")
assert(merged.dlv === ind.dlv, "merge keeps auto dlv")
assert(merged.depGap === "", "merge depGap blank override")
assert(
    mergeEssaSepIndicators(ind, undefined).sep === ind.sep,
    "merge no overrides"
)

// Click cycle: auto matching 2.5 → next preset; last step null = clear
assert(nextEssaSepCycleValue("sep", "2.5 nm", false) === "3 nm", "cycle sep from auto 2.5")
assert(nextEssaSepCycleValue("sep", "3 nm", true) === null, "cycle sep clear")
assert(nextEssaSepCycleValue("dlv", "2.5 nm", false) === "3.5 nm", "cycle dlv")
assert(nextEssaSepCycleValue("depGap", "", false) === "6 nm", "cycle gap from blank auto")
assert(nextEssaSepCycleValue("depGap", "", true) === null, "cycle gap blank override → clear")

console.log("essa-sep-indicators.test.ts: ok")

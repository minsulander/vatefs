import assert from "node:assert/strict"
import {
    buildEssaStripviewColumns,
    formatStripviewSep,
    isStripviewEligibleStrip,
    isStripviewOrderSectionId,
    stripNmSuffix,
} from "./essa-stripview-layout.js"
import type { FlightStrip } from "@vatefs/common"

let passed = 0
function check(name: string, fn: () => void) {
    try {
        fn()
        passed++
        console.log(`ok - ${name}`)
    } catch (e) {
        console.error(`FAIL - ${name}`)
        throw e
    }
}

function strip(partial: Partial<FlightStrip> & Pick<FlightStrip, "callsign" | "sectionId">): FlightStrip {
    return {
        id: partial.id || partial.callsign,
        callsign: partial.callsign,
        aircraftType: "A320",
        flightRules: "I",
        adep: "ESSA",
        ades: "EKCH",
        stripType: partial.stripType || "departure",
        bayId: partial.bayId || "bay3",
        sectionId: partial.sectionId,
        position: partial.position ?? 0,
        bottom: false,
        airport: partial.airport || "ESSA",
        groundstate: partial.groundstate,
        clearedForTakeoff: partial.clearedForTakeoff,
        runway: partial.runway,
    }
}

check("strip nm suffix", () => {
    assert.equal(stripNmSuffix("2.5 nm"), "2.5")
    assert.equal(stripNmSuffix("6 nm"), "6")
    assert.equal(stripNmSuffix(""), "")
    assert.deepEqual(formatStripviewSep({ sep: "2.5 nm", dlv: "3.5 nm", depGap: "" }), {
        sep: "2.5",
        dlv: "3.5",
        depGap: "",
        info: "",
    })
})

check("section filter: taxi/runway in, ctr_dep out", () => {
    assert.equal(isStripviewOrderSectionId("taxi_dep"), true)
    assert.equal(isStripviewOrderSectionId("runway_01L_19R"), true)
    assert.equal(isStripviewOrderSectionId("ctr_dep"), false)
    assert.equal(isStripviewOrderSectionId("taxi_arr"), false)
    assert.equal(isStripviewOrderSectionId("inbound"), false)
})

check("eligible: taxi+ on bay; transferred ctr_dep excluded", () => {
    assert.equal(
        isStripviewEligibleStrip(
            strip({ callsign: "SAS1", sectionId: "taxi_dep", groundstate: "TAXI" }),
        ),
        true,
    )
    assert.equal(
        isStripviewEligibleStrip(
            strip({ callsign: "SAS2", sectionId: "ctr_dep", groundstate: "DEPA" }),
        ),
        false,
    )
    assert.equal(
        isStripviewEligibleStrip(
            strip({ callsign: "SAS3", sectionId: "runway_01R_19L", groundstate: "LINEUP" }),
        ),
        true,
    )
})

check("columns: TWR-W/E by runway; transferred omitted", () => {
    const cols = buildEssaStripviewColumns([
        strip({
            callsign: "SASW",
            sectionId: "taxi_dep",
            groundstate: "TAXI",
            runway: "01L",
            position: 1,
        }),
        strip({
            callsign: "SASE",
            sectionId: "runway_01R_19L",
            groundstate: "LINEUP",
            runway: "01R",
            position: 0,
        }),
        strip({
            callsign: "APP1",
            sectionId: "ctr_dep",
            groundstate: "DEPA",
            runway: "01L",
            position: 0,
        }),
    ])
    const west = cols.find((c) => c.id === "TWR-W")!
    const east = cols.find((c) => c.id === "TWR-E")!
    assert.deepEqual(west.callsigns, ["SASW"])
    assert.deepEqual(east.callsigns, ["SASE"])
    assert.ok(!west.callsigns.includes("APP1"))
    assert.ok(!east.callsigns.includes("APP1"))
})

check("runway CFTO above taxi in same column", () => {
    const cols = buildEssaStripviewColumns([
        strip({
            callsign: "TAXI1",
            sectionId: "taxi_dep",
            groundstate: "TAXI",
            runway: "19R",
            position: 0,
        }),
        strip({
            callsign: "CFTO1",
            sectionId: "runway_01L_19R",
            groundstate: "DEPA",
            clearedForTakeoff: true,
            runway: "19R",
            position: 2,
        }),
    ])
    assert.deepEqual(cols.find((c) => c.id === "TWR-W")!.callsigns, ["CFTO1", "TAXI1"])
})

console.log(`\n${passed} passed`)

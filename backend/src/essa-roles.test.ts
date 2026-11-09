/**
 * Unit tests for ESSA auto roles / OWNER GND coverage
 * Run: npx tsx src/essa-roles.test.ts
 */

import assert from "node:assert/strict"
import { __setGndOwnerChainsForTest } from "./ese-airspace.js"
import {
    applyEssaRunwayPairLayout,
    collectEssaRunwayPairs,
    computeAutoEssaRoles,
    filterEssaLayout,
    isEssaAppCallsign,
    isEssaSectionVisibleForPicker,
    parseEssaLoginId,
    resolveGndRolesFromOwnerCoverage,
    type EssaFamily,
} from "./essa-roles.js"
import type { EfsLayout } from "@vatefs/common"

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

console.log("essa-roles tests")

__setGndOwnerChainsForTest({
    GE: ["AGE", "AGW"],
    GN: ["AGN", "AGW"],
    GW: ["AGW"],
})

check("OWNER: GW alone covers all families (AGW on every chain)", () => {
    const roles = resolveGndRolesFromOwnerCoverage("ESSA_W_GND", ["ESSA_W_GND"])
    assert.deepEqual(roles, ["GND-E", "GND-N", "GND-W"])
})

check("OWNER: GN alone only GN via chain — auto solo still gives all", () => {
    const ownerOnly = resolveGndRolesFromOwnerCoverage("ESSA_N_GND", ["ESSA_N_GND"])
    assert.deepEqual(ownerOnly, ["GND-N"])
    const auto = computeAutoEssaRoles("ESSA_N_GND", ["GND"], ["ESSA_N_GND"])
    assert.deepEqual(auto, ["GND-E", "GND-N", "GND-W"])
})

check("GW + GN open → GW gets E+W, not N", () => {
    const gw = resolveGndRolesFromOwnerCoverage("ESSA_W_GND", ["ESSA_W_GND", "ESSA_N_GND", "ESSA_DEL"])
    assert.deepEqual(gw, ["GND-E", "GND-W"])
    const gn = resolveGndRolesFromOwnerCoverage("ESSA_N_GND", ["ESSA_W_GND", "ESSA_N_GND", "ESSA_DEL"])
    assert.deepEqual(gn, ["GND-N"])
})

check("computeAutoEssaRoles GW+GN+CD → GW has GND-E+W, no CD", () => {
    const roles = computeAutoEssaRoles(
        "ESSA_W_GND",
        ["GND"],
        ["ESSA_W_GND", "ESSA_N_GND", "ESSA_DEL"]
    )
    assert.deepEqual(roles, ["GND-E", "GND-W"])
})

check("computeAutoEssaRoles GN+GW → GN only GND-N", () => {
    const roles = computeAutoEssaRoles(
        "ESSA_N_GND",
        ["GND"],
        ["ESSA_W_GND", "ESSA_N_GND", "ESSA_DEL"]
    )
    assert.deepEqual(roles, ["GND-N"])
})

check("computeAutoEssaRoles GE opens → GW loses GND-E", () => {
    const before = computeAutoEssaRoles(
        "ESSA_W_GND",
        ["GND"],
        ["ESSA_W_GND", "ESSA_N_GND"]
    )
    assert.deepEqual(before, ["GND-E", "GND-W"])
    const after = computeAutoEssaRoles(
        "ESSA_W_GND",
        ["GND"],
        ["ESSA_W_GND", "ESSA_N_GND", "ESSA_E_GND"]
    )
    assert.deepEqual(after, ["GND-W"])
})

check("ARR-only active pair stays ARR column even if FPL has dep on that strip", () => {
    const placements = collectEssaRunwayPairs(
        { ESSA: { arr: ["01R"], dep: ["08"] } },
        ["ESSA"],
        { arr: [], dep: ["01R", "19L"] } // FPL wrongly/also assigns ARR strip as dep
    )
    const arr = placements.find(p => p.pair.id === "01R_19L")
    const dep = placements.find(p => p.pair.id === "08_26")
    assert.ok(arr)
    assert.ok(dep)
    assert.equal(arr!.preferDepColumn, false)
    assert.equal(dep!.preferDepColumn, true)
})

check("active 01L alone → only 01L/19R header (no FPL assigned)", () => {
    const placements = collectEssaRunwayPairs(
        { ESSA: { arr: ["01L"], dep: ["01L"] } },
        ["ESSA"],
        { arr: [], dep: [] },
    )
    assert.deepEqual(
        placements.map((p) => p.pair.id),
        ["01L_19R"],
    )
})

check("stale FPL dep 19L still opens 01R/19L when passed as assigned", () => {
    // collectEssaRunwayPairs itself still honours assigned; flightStore gates what is passed in.
    const placements = collectEssaRunwayPairs(
        { ESSA: { arr: ["01L"], dep: ["01L"] } },
        ["ESSA"],
        { arr: [], dep: ["19L"] },
    )
    assert.deepEqual(
        placements.map((p) => p.pair.id).sort(),
        ["01L_19R", "01R_19L"],
    )
})

check("ARR-only header inserts between CTR ARR and TAXI ARR in bay1", () => {
    const layout: EfsLayout = {
        bays: [
            {
                id: "bay1",
                sections: [
                    { id: "ctr_arr", title: "CTR ARR" },
                    { id: "arr_runway", title: "RUNWAY" },
                    { id: "taxi_arr", title: "TAXI ARR" },
                ],
            },
            {
                id: "bay2",
                sections: [
                    { id: "ctr_dep", title: "CTR DEP" },
                    { id: "dep_runway", title: "RUNWAY" },
                ],
            },
        ],
    }
    const placements = collectEssaRunwayPairs(
        { ESSA: { arr: ["01R"], dep: ["08"] } },
        ["ESSA"]
    )
    const { layout: out, sectionToBay } = applyEssaRunwayPairLayout(layout, placements)
    const bay1Ids = out.bays.find(b => b.id === "bay1")!.sections.map(s => s.id)
    const bay2Ids = out.bays.find(b => b.id === "bay2")!.sections.map(s => s.id)
    assert.deepEqual(bay1Ids, ["ctr_arr", "runway_01R_19L", "taxi_arr"])
    assert.deepEqual(bay2Ids, ["ctr_dep", "runway_08_26"])
    assert.equal(sectionToBay.get("runway_01R_19L"), "bay1")
    assert.equal(sectionToBay.get("runway_08_26"), "bay2")
    const rwySec = out.bays.find(b => b.id === "bay2")!.sections.find(s => s.id === "runway_08_26")
    // ESSA mirrored boards: newestTop everywhere (since 0.13)
    assert.equal(rwySec?.addFromTop, true)
})

check("TWR-only shows INBOUND GND-E, GND-N, GND-W above TAXIWAY DEP", () => {
    const layout: EfsLayout = {
        bays: [
            {
                id: "bay3",
                sections: [
                    { id: "inbound_gnd", title: "INBOUND GND" },
                    { id: "taxi_dep", title: "TAXIWAY DEP" },
                    { id: "push_start", title: "PUSH BACK / START-UP" },
                ],
            },
        ],
    }
    const visibleFor = new Map<string, EssaFamily[]>([
        ["inbound_gnd", ["TWR"]],
        ["taxi_dep", ["GND", "TWR"]],
        ["push_start", ["GND"]],
    ])
    // No GND peers detected — bay still shows for TWR-only
    const out = filterEssaLayout(layout, ["TWR-W"], visibleFor, ["TWR-W"], [])
    const ids = out.bays[0]!.sections.map((s) => s.id)
    assert.deepEqual(ids, ["inbound_gnd", "taxi_dep"])
    assert.equal(out.bays[0]!.sections[0]!.title, "INBOUND GND-E, GND-N, GND-W")
    assert.equal(out.bays[0]!.sections[1]!.title, "TAXIWAY DEP")
})

check("TWR+GND hides INBOUND GND when no peer GND (solo combined)", () => {
    const layout: EfsLayout = {
        bays: [
            {
                id: "bay3",
                sections: [
                    { id: "inbound_gnd", title: "INBOUND GND" },
                    { id: "taxi_dep", title: "TAXIWAY DEP" },
                ],
            },
        ],
    }
    const visibleFor = new Map<string, EssaFamily[]>([
        ["inbound_gnd", ["TWR", "GND"]],
        ["taxi_dep", ["GND", "TWR"]],
    ])
    // No peer GND online → not split; taxi-out stays in TAXI DEP
    const out = filterEssaLayout(
        layout,
        ["TWR-E", "GND-E"],
        visibleFor,
        ["TWR-E"],
        []
    )
    assert.deepEqual(
        out.bays[0]!.sections.map((s) => s.id),
        ["taxi_dep"]
    )
})

check("GND-only with peer GND shows INBOUND GND (split)", () => {
    const layout: EfsLayout = {
        bays: [
            {
                id: "bay3",
                sections: [
                    { id: "inbound_gnd", title: "INBOUND GND" },
                    { id: "taxi_dep", title: "TAXIWAY DEP" },
                ],
            },
        ],
    }
    const visibleFor = new Map<string, EssaFamily[]>([
        ["inbound_gnd", ["TWR", "GND"]],
        ["taxi_dep", ["GND", "TWR"]],
    ])
    const out = filterEssaLayout(
        layout,
        ["GND-N"],
        visibleFor,
        [],
        ["GND-W"]
    )
    assert.deepEqual(
        out.bays[0]!.sections.map((s) => s.id),
        ["inbound_gnd", "taxi_dep"]
    )
})

check("TWR-only with separate GND hides TAXIWAY ARR, keeps CTR ARR+DEP and TAXIWAY DEP", () => {
    const layout: EfsLayout = {
        bays: [
            {
                id: "bay1",
                sections: [
                    { id: "ctr_arr", title: "CTR ARR" },
                    { id: "taxi_arr", title: "TAXIWAY ARR" },
                ],
            },
            {
                id: "bay2",
                sections: [
                    { id: "ctr_dep", title: "CTR DEP" },
                    { id: "taxi_dep", title: "TAXIWAY DEP" },
                ],
            },
        ],
    }
    const visibleFor = new Map<string, EssaFamily[]>([
        ["ctr_arr", ["TWR", "APP"]],
        ["taxi_arr", ["GND", "TWR"]],
        ["ctr_dep", ["TWR", "APP"]],
        ["taxi_dep", ["GND", "TWR"]],
    ])
    const out = filterEssaLayout(layout, ["TWR-W"], visibleFor, ["TWR-W"], ["GND-W"])
    assert.deepEqual(
        out.bays.map((b) => b.sections.map((s) => s.id)),
        [["ctr_arr"], ["ctr_dep", "taxi_dep"]]
    )
})

check("TWR-only solo (no GND peer) keeps TAXIWAY ARR", () => {
    const layout: EfsLayout = {
        bays: [
            {
                id: "bay1",
                sections: [
                    { id: "ctr_arr", title: "CTR ARR" },
                    { id: "taxi_arr", title: "TAXIWAY ARR" },
                ],
            },
        ],
    }
    const visibleFor = new Map<string, EssaFamily[]>([
        ["ctr_arr", ["TWR", "APP"]],
        ["taxi_arr", ["GND", "TWR"]],
    ])
    const out = filterEssaLayout(layout, ["TWR-W"], visibleFor, ["TWR-W"], [])
    assert.deepEqual(
        out.bays[0]!.sections.map((s) => s.id),
        ["ctr_arr", "taxi_arr"]
    )
})

check("computeAutoEssaRoles APP login selects APP family", () => {
    const roles = computeAutoEssaRoles("ESSA_APP", ["APP"], ["ESSA_APP", "ESSA_E_TWR"])
    assert.ok(roles.includes("APP"))
})

check("ESSA*APP allows flexible underscores", () => {
    for (const cs of [
        "ESSA_APP",
        "ESSA__APP",
        "ESSA_E_APP",
        "ESSA__E_APP",
        "ESSA_E__APP",
        "ESSAAPP",
        "ESSA___E___APP",
    ]) {
        assert.equal(parseEssaLoginId(cs), "APP", cs)
        assert.equal(isEssaAppCallsign(cs), true, cs)
    }
    assert.equal(isEssaAppCallsign("ESSA_R_APP"), false)
    assert.equal(parseEssaLoginId("ESSA_R_APP"), undefined)
})

check("computeAutoEssaRoles CTR covering approach selects APP", () => {
    const roles = computeAutoEssaRoles("ESAA_CTR", ["APP", "CTR"], ["ESAA_CTR"])
    assert.ok(roles.includes("APP"))
})

check("APP+TWR hides INBOUND APP and titles ctr as TMA", () => {
    const layout: EfsLayout = {
        bays: [
            {
                id: "bay1",
                sections: [
                    { id: "inbound_acc", title: "INBOUND ACC" },
                    { id: "inbound", title: "INBOUND" },
                    { id: "ctr_arr", title: "CTR ARR" },
                    { id: "ctr_dep", title: "CTR DEP" },
                ],
            },
        ],
    }
    const visibleFor = new Map<string, EssaFamily[]>([
        ["inbound_acc", ["APP"]],
        ["inbound", ["GND", "TWR"]],
        ["ctr_arr", ["TWR", "APP"]],
        ["ctr_dep", ["TWR", "APP"]],
    ])
    const out = filterEssaLayout(
        layout,
        ["APP", "TWR-E", "TWR-W"],
        visibleFor,
        ["TWR-E", "TWR-W"],
        []
    )
    const secs = out.bays[0]!.sections
    assert.deepEqual(
        secs.map((s) => s.id),
        ["inbound_acc", "ctr_arr", "ctr_dep"]
    )
    assert.equal(secs.find((s) => s.id === "ctr_arr")!.title, "TMA ARR")
    assert.equal(secs.find((s) => s.id === "ctr_dep")!.title, "TMA DEP")
})

check("TWR without APP keeps CTR ARR title and INBOUND APP", () => {
    const layout: EfsLayout = {
        bays: [
            {
                id: "bay1",
                sections: [
                    { id: "inbound", title: "INBOUND" },
                    { id: "ctr_arr", title: "CTR ARR" },
                ],
            },
        ],
    }
    const visibleFor = new Map<string, EssaFamily[]>([
        ["inbound", ["GND", "TWR"]],
        ["ctr_arr", ["TWR", "APP"]],
    ])
    const out = filterEssaLayout(layout, ["TWR-E"], visibleFor, ["TWR-E"], [])
    assert.equal(out.bays[0]!.sections[0]!.title, "INBOUND APP")
    assert.equal(out.bays[0]!.sections[1]!.title, "CTR ARR")
})

check("ctr_dep visible for TWR/APP picker only", () => {
    const visibleFor = new Map<string, EssaFamily[]>([
        ["ctr_dep", ["TWR", "APP"]],
        ["dep_runway", ["TWR"]],
    ])
    assert.equal(isEssaSectionVisibleForPicker("ctr_dep", ["TWR-E"], visibleFor, []), true)
    assert.equal(isEssaSectionVisibleForPicker("ctr_dep", ["TWR-E"], visibleFor, ["GND-E"]), true)
    assert.equal(isEssaSectionVisibleForPicker("ctr_dep", ["APP"], visibleFor, ["GND-E"]), true)
    assert.equal(isEssaSectionVisibleForPicker("ctr_dep", ["GND-E"], visibleFor), false)
    assert.equal(isEssaSectionVisibleForPicker("dep_runway", ["GND-E"], visibleFor), false)
})

check("FATO 07/25 only when assigned, never from active config alone", () => {
    const none = collectEssaRunwayPairs({ ESSA: { arr: ["01L"], dep: ["01R"] } }, ["ESSA"])
    assert.equal(none.some((p) => p.pair.id === "07_25"), false)

    const activeOnly = collectEssaRunwayPairs(
        { ESSA: { arr: ["07"], dep: ["25"] } },
        ["ESSA"],
    )
    assert.equal(activeOnly.some((p) => p.pair.id === "07_25"), false)

    const assigned = collectEssaRunwayPairs(
        { ESSA: { arr: ["01L"], dep: ["01R"] } },
        ["ESSA"],
        { arr: ["07"], dep: [] },
    )
    const fato = assigned.find((p) => p.pair.id === "07_25")
    assert.ok(fato)
    assert.equal(fato!.title, "FATO")
    assert.equal(fato!.sectionId, "runway_07_25")
    assert.equal(fato!.fromAssigned, true)
    assert.equal(fato!.preferDepColumn, false)
})

console.log(`\n${passed} passed`)

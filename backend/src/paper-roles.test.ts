/**
 * Generic paper AD/T/P covering + layout (run: npx tsx src/paper-roles.test.ts)
 */

import assert from "node:assert/strict"
import type { EfsLayout } from "@vatefs/common"
import { isEseDirectorCallsign } from "./ese-airspace.js"
import {
    applyPaperApproachDivider,
    applyPaperCoveringLayout,
    applyPaperDualRunwayLayout,
    applyPaperOptionalSections,
    applyPaperRoleLayout,
    callsignToPaperRole,
    computeAutoPaperRoles,
    computePaperStaffedRoles,
    isEsggTowerCallsign,
    isEsmsTowerCallsign,
    isEssbTowerCallsign,
    isAdStripTowerCallsign,
    isPaperTmaAssumeCross,
    isPaperTpPinSectionId,
    PAPER_OPTIONAL_SECTION_PUSHBACK,
    paperAvailableForAirports,
    paperIsExclusiveP,
    paperIsTowerWithoutAd,
    paperShowsApproachDivider,
    paperTpPinSectionId,
    primaryPaperAirport,
    resolveAdStripTowerOverlay,
    resolvePaperConfigFile,
    resolvePaperPositionRole,
    resolvePaperTpPinSectionId,
    resolvePaperStripFamily,
    paperFamilyStripId,
    parsePaperFamilyStripId,
    callsignFromPaperStripId,
    ensurePaperCoveringSectionToBay,
    PAPER_CONFIG_FILE,
} from "./paper-roles.js"
import { loadPaperPositionsCatalog } from "./paper-positions.js"
import path from "node:path"
import { fileURLToPath } from "node:url"

const configDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data/config")
loadPaperPositionsCatalog(configDir)

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

console.log("paper-roles")

check("callsign mapping AD/T/P", () => {
    assert.equal(callsignToPaperRole("ESPA_TWR"), "AD")
    assert.equal(callsignToPaperRole("ESPA_GND"), "AD")
    assert.equal(callsignToPaperRole("ESPA_DEL"), "AD")
    assert.equal(callsignToPaperRole("ESPA_R_APP"), "AD")
    assert.equal(callsignToPaperRole("ESPA_APP"), "T")
    assert.equal(callsignToPaperRole("ESPA_F_APP"), "P")
})

check("primary paper airport prefers callsign over ESNP sibling", () => {
    assert.equal(primaryPaperAirport(["ESNP", "ESPA"], "ESPA_APP"), "ESPA")
    assert.equal(primaryPaperAirport(["ESNP", "ESPA"], "ESNP_TWR"), "ESNP")
    assert.equal(primaryPaperAirport([], "ESPA_APP"), "ESPA")
    assert.deepEqual(paperAvailableForAirports(["ESNP", "ESPA"], "ESPA_APP"), [
        "AD",
        "T",
        "P",
    ])
    assert.deepEqual(paperAvailableForAirports([], "ESPA_APP"), ["AD", "T", "P"])
    assert.deepEqual(paperAvailableForAirports(["ESNP", "ESPA"], "ESNP_TWR"), ["AD"])
    // No callsign → richest catalog (ESPA AD+T+P over ESNP AD)
    assert.equal(primaryPaperAirport(["ESNP", "ESPA"]), "ESPA")
})

check("director is ESE _F_APP, not _DIR", () => {
    assert.equal(isEseDirectorCallsign("ESPA_F_APP"), true)
    assert.equal(isEseDirectorCallsign("ESPA_APP"), false)
    assert.equal(isEseDirectorCallsign("ESPA_DIR"), false)
    assert.equal(resolvePaperPositionRole({ callsign: "ESPA_APP" }), "T")
    assert.equal(resolvePaperPositionRole({ callsign: "ESPA_F_APP" }), "P")
    assert.equal(
        resolvePaperPositionRole({ callsign: "ESPA_APP", positionId: "PAF" }),
        "T",
    )
})

check("ESGG DEL/GND/TWR → Landvetter AD strips; APP → generic", () => {
    assert.equal(isEsggTowerCallsign("ESGG_TWR"), true)
    assert.equal(isEsggTowerCallsign("ESGG_GND"), true)
    assert.equal(isEsggTowerCallsign("ESGG_DEL"), true)
    assert.equal(isEsggTowerCallsign("ESGG_APP"), false)
    assert.equal(isEsggTowerCallsign("ESPA_TWR"), false)
})

check("Only MS/SB tower-side → AD-strip overlays (else generic AD+T)", () => {
    assert.equal(isEsmsTowerCallsign("ESMS_TWR"), true)
    assert.equal(isEsmsTowerCallsign("ESMS_GND"), true)
    assert.equal(isEsmsTowerCallsign("ESMS_DEL"), true)
    assert.equal(isEsmsTowerCallsign("ESMS__TWR"), true)
    assert.equal(isEsmsTowerCallsign("ESMS_APP"), false)
    assert.equal(isEssbTowerCallsign("ESSB_TWR"), true)
    assert.equal(isEssbTowerCallsign("ESSB_GND"), true)
    assert.equal(isEssbTowerCallsign("ESSB_DEL"), true)
    assert.equal(isEssbTowerCallsign("ESSB_APP"), false)
    assert.equal(isAdStripTowerCallsign("ESMS_TWR"), true)
    assert.equal(isAdStripTowerCallsign("ESSB_TWR"), true)
    assert.equal(isAdStripTowerCallsign("ESGG_TWR"), false)
    assert.equal(resolveAdStripTowerOverlay({ callsign: "ESMS_TWR" }), "esms.yml")
    assert.equal(resolveAdStripTowerOverlay({ callsign: "ESSB_GND" }), "essb.yml")
    assert.equal(resolveAdStripTowerOverlay({ airports: ["ESMS"] }), undefined)
    assert.equal(resolveAdStripTowerOverlay({ callsign: "ESMS_APP" }), undefined)
    assert.equal(resolveAdStripTowerOverlay({ callsign: "ESPA_TWR" }), undefined)
    assert.equal(resolveAdStripTowerOverlay({ callsign: "ESGG_APP" }), undefined)
    assert.equal(resolvePaperConfigFile("esms.yml"), PAPER_CONFIG_FILE)
    assert.equal(resolvePaperConfigFile("essb.yml"), PAPER_CONFIG_FILE)
})

const availableAll = ["AD", "T", "P"] as const

check("solo AD covers all available", () => {
    const staffed = computePaperStaffedRoles("AD", [], [...availableAll])
    assert.deepEqual(staffed, ["AD"])
    assert.deepEqual(computeAutoPaperRoles("AD", staffed, [...availableAll]), ["AD", "T", "P"])
})

check("solo T covers AD+T+P (top-down when no TWR)", () => {
    const staffed = computePaperStaffedRoles("T", [], [...availableAll])
    assert.deepEqual(staffed, ["T"])
    assert.deepEqual(computeAutoPaperRoles("T", staffed, [...availableAll]), ["AD", "T", "P"])
})

check("AD + T online: AD covers only AD; T covers T+P (not AD)", () => {
    const staffed = computePaperStaffedRoles("AD", ["T"], [...availableAll])
    assert.deepEqual(staffed, ["AD", "T"])
    assert.deepEqual(computeAutoPaperRoles("AD", staffed, [...availableAll]), ["AD"])
    assert.deepEqual(computeAutoPaperRoles("T", staffed, [...availableAll]), ["T", "P"])
})

check("AD + T + P: each covers self only (T loses P)", () => {
    const staffed = computePaperStaffedRoles("T", ["AD", "P"], [...availableAll])
    assert.deepEqual(staffed, ["AD", "T", "P"])
    assert.deepEqual(computeAutoPaperRoles("AD", staffed, [...availableAll]), ["AD"])
    assert.deepEqual(computeAutoPaperRoles("T", staffed, [...availableAll]), ["T"])
    assert.deepEqual(computeAutoPaperRoles("P", staffed, [...availableAll]), ["P"])
})

check("T covers AD when AD offline; not when AD online", () => {
    const avail = ["AD", "T"] as const
    const soloT = computePaperStaffedRoles("T", [], [...avail])
    assert.deepEqual(computeAutoPaperRoles("T", soloT, [...avail]), ["AD", "T"])
    const withAd = computePaperStaffedRoles("T", ["AD"], [...avail])
    assert.deepEqual(computeAutoPaperRoles("T", withAd, [...avail]), ["T"])
    assert.deepEqual(computeAutoPaperRoles("AD", withAd, [...avail]), ["AD"])
})

check("unknown airport catalog cut: only AD staffed", () => {
    const staffed = computePaperStaffedRoles("AD", ["T", "P"], ["AD"])
    assert.deepEqual(staffed, ["AD"])
})

const stdLayout: EfsLayout = {
    bays: [
        {
            id: "bay1",
            sections: [
                { id: "pending_dep", title: "", hideHeader: true },
                { id: "clearance", title: "CLEARANCE" },
                { id: "taxi", title: "TAXI" },
            ],
        },
        {
            id: "bay2",
            sections: [
                { id: "sequence", title: "", hideHeader: true },
                { id: "runway", title: "RWY <drwy>" },
            ],
        },
        {
            id: "bay3",
            sections: [
                { id: "pending_arr", title: "", hideHeader: true },
                { id: "tma_ctr", title: "TMA CTR" },
            ],
        },
    ],
}

check("dual runway expands board", () => {
    const dual = applyPaperDualRunwayLayout(stdLayout, true)
    assert.ok(dual.bays.some((b) => b.sections.some((s) => s.id === "runway_b")))
    assert.ok(dual.bays.some((b) => b.sections.some((s) => s.id === "sequence_b")))
})

check("P on single RWY leaves sequence above runway (no 4th column)", () => {
    const withP = applyPaperRoleLayout(stdLayout, ["AD", "P"])
    assert.equal(withP, stdLayout)
    assert.equal(withP.bays.length, 3)
})

check("P on dual RWY pulls sequence into its own column", () => {
    const dual = applyPaperDualRunwayLayout(stdLayout, true)
    const withP = applyPaperRoleLayout(dual, ["AD", "P"])
    assert.equal(withP.bays.length, 4)
    const seqBay = withP.bays.find((b) => b.sections.some((s) => s.id === "sequence"))
    assert.ok(seqBay)
    assert.equal(
        seqBay!.sections.every((s) => s.id === "sequence" || s.id === "sequence_b"),
        true,
    )
    const rwyBay = withP.bays.find((b) => b.sections.some((s) => s.id === "runway"))
    assert.ok(rwyBay)
    assert.equal(rwyBay!.sections.some((s) => s.id === "sequence"), false)
    assert.ok(rwyBay!.sections.some((s) => s.id === "runway_b"))
})

check("P not staffed leaves sequence above runway", () => {
    const layout = applyPaperRoleLayout(stdLayout, ["AD", "T"])
    assert.equal(layout, stdLayout)
})

check("exclusive P → 3 bays with APP mid divider", () => {
    assert.equal(paperIsExclusiveP(["P"]), true)
    assert.equal(paperIsExclusiveP(["T", "P"]), false)
    assert.equal(paperShowsApproachDivider(["P"]), true)
    assert.equal(paperShowsApproachDivider(["T", "P"]), false)
    assert.equal(paperShowsApproachDivider(["AD", "T", "P"]), false)

    const withP = applyPaperApproachDivider(stdLayout, ["P"])
    assert.equal(withP.bays.length, 3)
    const dep = withP.bays[0]!.sections.find((s) => s.id === "tma_dep")
    const arr = withP.bays[2]!.sections.find(
        (s) => s.id === "tma_arr" || s.id === "tma_ctr",
    )
    assert.ok(dep)
    assert.ok(arr)
    assert.equal(dep!.hideHeader, true)
    assert.equal(dep!.title, "")
    assert.equal(arr!.hideHeader, true)
    assert.equal(arr!.title, "")
    const app = withP.bays[1]!.sections.find((s) => s.id === "app")
    assert.ok(app)
    assert.equal(app!.title, "APP <rwy1>")
    assert.equal(
        withP.bays[1]!.sections.every((s) => s.id === "app_above" || s.id === "app"),
        true,
    )
})

check("T / T+P without AD → 4 bays, APP below ARR", () => {
    assert.equal(paperIsTowerWithoutAd(["T"]), true)
    assert.equal(paperIsTowerWithoutAd(["T", "P"]), true)
    assert.equal(paperIsTowerWithoutAd(["P"]), false)

    for (const covering of [["T"], ["T", "P"]] as const) {
        const layout = applyPaperCoveringLayout(stdLayout, [...covering])
        assert.equal(layout.bays.length, 4)
        assert.equal(layout.bays[1]!.sections[1]!.title, "DEP")
        const arrBay = layout.bays[2]!
        const ids = arrBay.sections.map((s) => s.id)
        assert.ok(ids.includes("tma_arr_above"))
        assert.ok(ids.some((id) => id === "tma_arr" || id === "tma_ctr"))
        assert.ok(ids.includes("app"))
        assert.ok(ids.indexOf("app") > ids.findIndex((id) => id === "tma_arr" || id === "tma_ctr"))
        const app = arrBay.sections.find((s) => s.id === "app")
        assert.equal(app!.title, "APP <rwy1>")
        // Mid-bay APP board is exclusive P only
        assert.equal(applyPaperApproachDivider(stdLayout, [...covering]), stdLayout)
    }
    assert.equal(applyPaperCoveringLayout(stdLayout, ["P"]), stdLayout)
})

check("optional PUSHBACK injects before taxi", () => {
    const withPb = applyPaperOptionalSections(
        stdLayout,
        [PAPER_OPTIONAL_SECTION_PUSHBACK],
        ["AD"],
    )
    const bay1 = withPb.bays[0]!
    const ids = bay1.sections.map((s) => s.id)
    assert.ok(ids.includes(PAPER_OPTIONAL_SECTION_PUSHBACK))
    assert.ok(ids.indexOf(PAPER_OPTIONAL_SECTION_PUSHBACK) < ids.indexOf("taxi"))
    assert.equal(applyPaperOptionalSections(stdLayout, []), stdLayout)
})

check("optional PUSHBACK skipped for T/P covering", () => {
    const tLayout = applyPaperCoveringLayout(stdLayout, ["T"])
    assert.equal(
        applyPaperOptionalSections(tLayout, [PAPER_OPTIONAL_SECTION_PUSHBACK], ["T"]),
        tLayout,
    )
    assert.equal(
        applyPaperOptionalSections(stdLayout, [PAPER_OPTIONAL_SECTION_PUSHBACK], ["P"]),
        stdLayout,
    )
    assert.equal(
        applyPaperOptionalSections(stdLayout, [PAPER_OPTIONAL_SECTION_PUSHBACK], ["T", "P"]),
        stdLayout,
    )
})

check("TMA assume cross + TP pin helpers", () => {
    assert.equal(isPaperTmaAssumeCross("tma_dep_above", "tma_dep"), true)
    assert.equal(isPaperTmaAssumeCross("tma_arr_above", "tma_ctr"), true)
    assert.equal(isPaperTmaAssumeCross("tma_arr_above", "app"), false)
    assert.equal(paperTpPinSectionId("arrival"), "tma_arr")
    assert.equal(paperTpPinSectionId("departure"), "tma_dep")
    assert.equal(isPaperTpPinSectionId("tma_dep"), true)
    const tLayout = applyPaperCoveringLayout(stdLayout, ["T"])
    assert.equal(resolvePaperTpPinSectionId(tLayout, "arrival"), "tma_ctr")
    assert.equal(resolvePaperTpPinSectionId(tLayout, "departure"), "tma_dep")
})

check("paper strip family from covering", () => {
    assert.equal(resolvePaperStripFamily(["AD", "T"]), "unified")
    assert.equal(resolvePaperStripFamily(["AD", "T", "P"]), "unified")
    assert.equal(resolvePaperStripFamily(["AD"]), "ad")
    assert.equal(resolvePaperStripFamily(["AD", "P"]), "ad")
    assert.equal(resolvePaperStripFamily(["T"]), "tma")
    assert.equal(resolvePaperStripFamily(["P"]), "tma")
    assert.equal(resolvePaperStripFamily(["T", "P"]), "tma")
    assert.equal(resolvePaperStripFamily([]), "unified")
})

check("paper family strip id helpers", () => {
    assert.equal(paperFamilyStripId("SAS123", "unified"), "SAS123")
    assert.equal(paperFamilyStripId("SAS123", "ad"), "SAS123#ad")
    assert.equal(paperFamilyStripId("SAS123", "tma"), "SAS123#tma")
    assert.deepEqual(parsePaperFamilyStripId("SAS123#tma"), {
        callsign: "SAS123",
        family: "tma",
    })
    assert.deepEqual(parsePaperFamilyStripId("SAS123#ad"), {
        callsign: "SAS123",
        family: "ad",
    })
    assert.deepEqual(parsePaperFamilyStripId("SAS123"), {
        callsign: "SAS123",
        family: "unified",
    })
    assert.equal(callsignFromPaperStripId("SAS123#tma"), "SAS123")
    assert.equal(callsignFromPaperStripId("SAS123@ESGG"), "SAS123")
    assert.equal(callsignFromPaperStripId("SAS123"), "SAS123")
})

check("T+P covering maps inactive DEP/ARR into sectionToBay", () => {
    const map = new Map<string, string>()
    // Seed only YAML sections (no runtime TMA above zones)
    map.set("pending_dep", "bay1")
    map.set("pending_arr", "bay3")
    map.set("tma_ctr", "bay3")
    ensurePaperCoveringSectionToBay(map, stdLayout, ["T", "P"])
    assert.equal(map.get("tma_dep_above"), "bay2")
    assert.equal(map.get("tma_arr_above"), "bay3")
    assert.ok(map.get("tma_dep"))
    assert.ok(map.get("tma_arr") || map.get("tma_ctr"))
})

console.log(`\n${passed} passed`)

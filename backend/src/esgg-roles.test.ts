import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { EfsLayout } from "@vatefs/common"
import {
    applyEsggRoleLayout,
    computeEsggStaffedRoles,
    esggDefaultPanHideInbound,
    isEsggGndCdLayout,
    syncSectionToBayFromLayout,
    type EsggPositionRole,
} from "./esgg-roles.js"

const baseLayout: EfsLayout = {
    bays: [
        { id: "bay1", sections: [{ id: "inbound", title: "INBOUND", hideHeader: true }] },
        {
            id: "bay2",
            sections: [
                { id: "ctr_arr", title: "CTR ARR", hideHeader: true },
                { id: "runway", title: "PÅ BANAN" },
                { id: "ctr_dep", title: "UTFLYGNING" },
            ],
        },
        { id: "bay3", sections: [{ id: "taxi", title: "PÅ TAXI" }] },
        {
            id: "bay4",
            sections: [
                { id: "pending_dep", title: "KLARERING", hideHeader: true },
                { id: "cleared", title: "KLARERING" },
                { id: "push_start", title: "START-UP & PUSH-BACK" },
            ],
        },
    ],
}

function bayIds(roles: EsggPositionRole[]) {
    return applyEsggRoleLayout(baseLayout, roles).bays.map((b) => ({
        id: b.id,
        sections: b.sections.map((s) => s.id),
    }))
}

const fiveCol = [
    { id: "bay1", sections: ["inbound"] },
    { id: "bay2", sections: ["ctr_arr", "runway", "ctr_dep"] },
    { id: "bay3", sections: ["taxi"] },
    { id: "bay4", sections: ["above_push", "push_start"] },
    { id: "bay5", sections: ["pending_dep", "cleared"] },
]

describe("isEsggGndCdLayout", () => {
    it("true when GND or CD staffed (5-col trigger)", () => {
        assert.equal(isEsggGndCdLayout(["CD", "GND"]), true)
        assert.equal(isEsggGndCdLayout(["CD"]), true)
        assert.equal(isEsggGndCdLayout(["GND"]), true)
        assert.equal(isEsggGndCdLayout(["CD", "GND", "TWR"]), true)
        assert.equal(isEsggGndCdLayout(["TWR", "GND"]), true)
    })
    it("false for TWR-only or empty", () => {
        assert.equal(isEsggGndCdLayout(["TWR"]), false)
        assert.equal(isEsggGndCdLayout([]), false)
    })
})

describe("esggDefaultPanHideInbound", () => {
    it("true only when GND + TWR both selected", () => {
        assert.equal(esggDefaultPanHideInbound(["TWR", "GND"]), true)
        assert.equal(esggDefaultPanHideInbound(["TWR", "GND", "CD"]), true)
        assert.equal(esggDefaultPanHideInbound(["TWR", "CD"]), false)
        assert.equal(esggDefaultPanHideInbound(["GND"]), false)
        assert.equal(esggDefaultPanHideInbound(["TWR"]), false)
        assert.equal(esggDefaultPanHideInbound(["CD"]), false)
    })
})

describe("computeEsggStaffedRoles", () => {
    it("TWR alone: staffed TWR only (not covering CD+GND)", () => {
        assert.deepEqual(computeEsggStaffedRoles("TWR", []), ["TWR"])
    })
    it("TWR + online DEL: staffed CD+TWR", () => {
        assert.deepEqual(computeEsggStaffedRoles("TWR", ["DEL"]), ["CD", "TWR"])
    })
    it("TWR + online GND: staffed GND+TWR", () => {
        assert.deepEqual(computeEsggStaffedRoles("TWR", ["GND"]), ["GND", "TWR"])
    })
    it("GND alone: staffed GND", () => {
        assert.deepEqual(computeEsggStaffedRoles("GND", []), ["GND"])
    })
})

describe("applyEsggRoleLayout — all role combinations", () => {
    it("TWR only: YAML unchanged (packed KLARERING+S/P)", () => {
        assert.equal(applyEsggRoleLayout(baseLayout, ["TWR"]), baseLayout)
    })

    it("solo TWR covering all roles must NOT use covering list for layout", () => {
        // Layout uses staffed [TWR], not covering [CD,GND,TWR]
        assert.equal(applyEsggRoleLayout(baseLayout, ["TWR"]), baseLayout)
        assert.notDeepEqual(bayIds(["CD", "GND", "TWR"]), bayIds(["TWR"]))
    })

    it("GND only: same 5-col board as everyone else", () => {
        assert.deepEqual(bayIds(["GND"]), fiveCol)
    })

    it("CD only: same 5-col board", () => {
        assert.deepEqual(bayIds(["CD"]), fiveCol)
    })

    it("GND+CD: same 5-col board", () => {
        assert.deepEqual(bayIds(["GND", "CD"]), fiveCol)
    })

    it("TWR+GND: same 5-col board", () => {
        assert.deepEqual(bayIds(["TWR", "GND"]), fiveCol)
    })

    it("TWR+CD: same 5-col board", () => {
        assert.deepEqual(bayIds(["TWR", "CD"]), fiveCol)
    })

    it("TWR+GND+CD: same 5-col board", () => {
        assert.deepEqual(bayIds(["TWR", "GND", "CD"]), fiveCol)
    })

    it("empty roles: YAML unchanged", () => {
        assert.equal(applyEsggRoleLayout(baseLayout, []), baseLayout)
    })
})

describe("syncSectionToBayFromLayout", () => {
    it("updates sectionToBay for remapped layouts", () => {
        const map = new Map<string, string>()
        syncSectionToBayFromLayout(map, baseLayout)
        assert.equal(map.get("inbound"), "bay1")
        assert.equal(map.get("push_start"), "bay4")

        syncSectionToBayFromLayout(map, applyEsggRoleLayout(baseLayout, ["GND", "CD"]))
        assert.equal(map.get("inbound"), "bay1")
        assert.equal(map.get("push_start"), "bay4")
        assert.equal(map.get("pending_dep"), "bay5")
        assert.equal(map.get("ctr_arr"), "bay2")

        syncSectionToBayFromLayout(map, applyEsggRoleLayout(baseLayout, ["TWR", "GND"]))
        assert.equal(map.get("inbound"), "bay1")
        assert.equal(map.get("pending_dep"), "bay5")
        assert.equal(map.get("push_start"), "bay4")
    })
})

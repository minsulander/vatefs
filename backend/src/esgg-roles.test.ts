import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { EfsLayout } from "@vatefs/common"
import {
    applyEsggRoleLayout,
    isEsggGndCdLayout,
    syncSectionToBayFromLayout,
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

describe("isEsggGndCdLayout", () => {
    it("true for GND+CD without TWR", () => {
        assert.equal(isEsggGndCdLayout(["CD", "GND"]), true)
    })
    it("true for CD-only or GND-only", () => {
        assert.equal(isEsggGndCdLayout(["CD"]), true)
        assert.equal(isEsggGndCdLayout(["GND"]), true)
    })
    it("false when TWR selected", () => {
        assert.equal(isEsggGndCdLayout(["CD", "GND", "TWR"]), false)
        assert.equal(isEsggGndCdLayout(["TWR"]), false)
    })
})

describe("applyEsggRoleLayout", () => {
    it("shifts ops left; KLARERING keeps cleared; above_push over START-UP", () => {
        const out = applyEsggRoleLayout(baseLayout, ["CD", "GND"])
        assert.deepEqual(
            out.bays.map((b) => ({ id: b.id, sections: b.sections.map((s) => s.id) })),
            [
                { id: "bay1", sections: ["ctr_arr", "runway", "ctr_dep"] },
                { id: "bay2", sections: ["taxi"] },
                { id: "bay3", sections: ["above_push", "push_start"] },
                { id: "bay4", sections: ["pending_dep", "cleared"] },
            ]
        )
        assert.ok(!out.bays.some((b) => b.sections.some((s) => s.id === "inbound")))
        const above = out.bays[2]?.sections[0]
        assert.equal(above?.hideHeader, true)
    })

    it("leaves layout unchanged when TWR is selected", () => {
        const out = applyEsggRoleLayout(baseLayout, ["TWR", "GND", "CD"])
        assert.equal(out, baseLayout)
    })
})

describe("syncSectionToBayFromLayout", () => {
    it("updates sectionToBay for remapped layout", () => {
        const map = new Map<string, string>()
        syncSectionToBayFromLayout(map, baseLayout)
        assert.equal(map.get("inbound"), "bay1")
        assert.equal(map.get("push_start"), "bay4")

        const remapped = applyEsggRoleLayout(baseLayout, ["GND", "CD"])
        syncSectionToBayFromLayout(map, remapped)
        assert.equal(map.get("push_start"), "bay3")
        assert.equal(map.get("pending_dep"), "bay4")
        assert.equal(map.get("ctr_arr"), "bay1")
    })
})

/**
 * ESGG covering roles from online controllers (run: npx tsx src/esgg-covering.test.ts)
 */

import assert from "node:assert/strict"
import {
    computeEffectiveRolesForAirport,
    clearOnlineControllers,
    removeOnlineController,
    setMyAirports,
    setMyCallsign,
    setMyRole,
    staticConfig,
    updateOnlineController,
} from "./static-config.js"
import { applyEsggRoleLayout, computeAutoEsggRoles, computeEsggStaffedRoles } from "./esgg-roles.js"
import type { EfsLayout } from "@vatefs/common"

const tinyLayout: EfsLayout = {
    bays: [
        { id: "bay1", sections: [{ id: "inbound", title: "IN" }] },
        {
            id: "bay2",
            sections: [
                { id: "ctr_arr", title: "CTR ARR" },
                { id: "runway", title: "RWY" },
                { id: "ctr_dep", title: "DEP" },
            ],
        },
        { id: "bay3", sections: [{ id: "taxi", title: "TAXI" }] },
        {
            id: "bay4",
            sections: [
                { id: "pending_dep", title: "KLARERING" },
                { id: "cleared", title: "KLARERING" },
                { id: "push_start", title: "S/P" },
            ],
        },
    ],
}

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

console.log("esgg-covering")

check("TWR alone covers DEL+GND+TWR → CD,GND,TWR", () => {
    const roles = computeEffectiveRolesForAirport("TWR", [])
    assert.deepEqual(roles, ["DEL", "GND", "TWR"])
    assert.deepEqual(computeAutoEsggRoles(roles), ["CD", "GND", "TWR"])
})

check("TWR alone: layout stays packed (no bay5) despite covering all roles", () => {
    const covering = computeAutoEsggRoles(computeEffectiveRolesForAirport("TWR", []))
    assert.deepEqual(covering, ["CD", "GND", "TWR"])
    const staffed = computeEsggStaffedRoles("TWR", [])
    assert.deepEqual(staffed, ["TWR"])
    const layout = applyEsggRoleLayout(tinyLayout, staffed)
    assert.equal(layout, tinyLayout)
    assert.equal(layout.bays.some((b) => b.id === "bay5"), false)
})

check("TWR + DEL open: KLARERING on bay5", () => {
    const staffed = computeEsggStaffedRoles("TWR", ["DEL"])
    assert.deepEqual(staffed, ["CD", "TWR"])
    const layout = applyEsggRoleLayout(tinyLayout, staffed)
    assert.ok(layout.bays.some((b) => b.id === "bay5"))
    assert.equal(layout.bays.length, 5)
})

check("TWR + GND open: KLARERING on bay5", () => {
    const staffed = computeEsggStaffedRoles("TWR", ["GND"])
    assert.deepEqual(staffed, ["GND", "TWR"])
    const layout = applyEsggRoleLayout(tinyLayout, staffed)
    assert.ok(layout.bays.some((b) => b.id === "bay5"))
    assert.equal(layout.bays.length, 5)
})

check("GND alone: same 5-col board (not a shorter layout)", () => {
    const staffed = computeEsggStaffedRoles("GND", [])
    assert.deepEqual(staffed, ["GND"])
    const layout = applyEsggRoleLayout(tinyLayout, staffed)
    assert.equal(layout.bays.length, 5)
    assert.ok(layout.bays.some((b) => b.id === "bay5"))
})

check("CD alone: same 5-col board as TWR+CD", () => {
    const asCd = applyEsggRoleLayout(tinyLayout, computeEsggStaffedRoles("DEL", []))
    const asTwrWithCd = applyEsggRoleLayout(tinyLayout, computeEsggStaffedRoles("TWR", ["DEL"]))
    assert.deepEqual(
        asCd.bays.map((b) => b.id),
        asTwrWithCd.bays.map((b) => b.id),
    )
})

check("TWR with DEL online covers GND+TWR (no CD)", () => {
    const roles = computeEffectiveRolesForAirport("TWR", ["DEL"])
    assert.deepEqual(roles, ["GND", "TWR"])
    assert.deepEqual(computeAutoEsggRoles(roles), ["GND", "TWR"])
})

check("TWR with GND online covers TWR only", () => {
    const roles = computeEffectiveRolesForAirport("TWR", ["GND"])
    assert.deepEqual(roles, ["TWR"])
})

check("unprimed 199.998 removes ghost DEL so CD covering returns", () => {
    clearOnlineControllers()
    staticConfig.look = "paper"
    setMyAirports(["ESGG"])
    setMyCallsign("ESGG_TWR")
    setMyRole("TWR")

    updateOnlineController("ESGG_DEL", 121.9, ["ESGG"], "CD")
    assert.deepEqual(
        [...(staticConfig.esggRoles ?? [])].sort(),
        ["GND", "TWR"].sort(),
        "with CD online: no CD covering",
    )

    // Logoff path: unprimed frequency must drop ghost (not ignore)
    const changed = updateOnlineController("ESGG_DEL", 199.998, ["ESGG"])
    assert.equal(changed, true)
    assert.deepEqual(
        [...(staticConfig.esggRoles ?? [])].sort(),
        ["CD", "GND", "TWR"].sort(),
        "after CD unprimed: full covering again",
    )

    clearOnlineControllers()
    staticConfig.look = undefined
})

check("removeOnlineController is case-insensitive", () => {
    clearOnlineControllers()
    staticConfig.look = "paper"
    setMyAirports(["ESGG"])
    setMyCallsign("ESGG_TWR")
    setMyRole("TWR")

    updateOnlineController("ESGG_DEL", 121.9, ["ESGG"])
    assert.ok(staticConfig.onlineControllers?.has("ESGG_DEL"))

    const changed = removeOnlineController("esgg_del")
    assert.equal(changed, true)
    assert.equal(staticConfig.onlineControllers?.has("ESGG_DEL"), false)
    assert.deepEqual(
        [...(staticConfig.esggRoles ?? [])].sort(),
        ["CD", "GND", "TWR"].sort(),
    )

    clearOnlineControllers()
    staticConfig.look = undefined
})

console.log(`\n${passed} passed`)

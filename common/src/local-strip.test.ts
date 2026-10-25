import assert from "node:assert/strict"
import {
    isLocalArrSideSection,
    isLocalDepSideSection,
    isLocalInboundPresentation,
} from "./local-strip.js"

function check(name: string, fn: () => void) {
    try {
        fn()
        console.log(`  ok  ${name}`)
    } catch (err) {
        console.error(`  FAIL ${name}`)
        throw err
    }
}

check("non-local never inbound presentation", () => {
    assert.equal(isLocalInboundPresentation({ stripType: "departure", airborne: true }), false)
    assert.equal(isLocalInboundPresentation({ stripType: "arrival", airborne: true }), false)
    assert.equal(
        isLocalInboundPresentation({
            stripType: "arrival",
            sectionId: "ctr_arr",
            clearedToLand: true,
        }),
        false,
    )
})

check("departing local ground flow → DEP layout", () => {
    for (const gs of ["", "NSTS", "ONFREQ", "STUP", "PUSH", "TAXI", "LINEUP", "DEPA"]) {
        assert.equal(
            isLocalInboundPresentation({ stripType: "local", groundstate: gs }),
            false,
            `gs=${gs || "(empty)"}`,
        )
    }
    assert.equal(
        isLocalInboundPresentation({
            stripType: "local",
            groundstate: "TAXI",
            sectionId: "taxi_dep",
        }),
        false,
    )
    assert.equal(
        isLocalInboundPresentation({
            stripType: "local",
            groundstate: "PUSH",
            sectionId: "push_start",
        }),
        false,
    )
})

check("outbound airborne local (CTR DEP) → DEP layout", () => {
    assert.equal(
        isLocalInboundPresentation({
            stripType: "local",
            airborne: true,
            sectionId: "ctr_dep",
        }),
        false,
    )
    assert.equal(
        isLocalInboundPresentation({
            stripType: "local",
            airborne: true,
            sectionId: "bay1_ctr_dep",
        }),
        false,
    )
    // Airborne alone — no ARR cues — still DEP (manual drag to CTR ARR)
    assert.equal(isLocalInboundPresentation({ stripType: "local", airborne: true }), false)
})

check("returning / inbound local → ARR layout", () => {
    assert.equal(isLocalInboundPresentation({ stripType: "local", groundstate: "ARR" }), true)
    assert.equal(isLocalInboundPresentation({ stripType: "local", groundstate: "TXIN" }), true)
    assert.equal(isLocalInboundPresentation({ stripType: "local", groundstate: "PARK" }), true)
    assert.equal(isLocalInboundPresentation({ stripType: "local", clearedToLand: true }), true)
    assert.equal(isLocalInboundPresentation({ stripType: "local", ata: "1812" }), true)
    assert.equal(
        isLocalInboundPresentation({
            stripType: "local",
            airborne: true,
            clearedToLand: true,
            sectionId: "ctr_dep",
        }),
        true,
        "CTL overrides CTR DEP section",
    )
})

check("ARR-side section flips airborne local to ARR layout", () => {
    assert.equal(
        isLocalInboundPresentation({
            stripType: "local",
            airborne: true,
            sectionId: "ctr_arr",
        }),
        true,
    )
    assert.equal(
        isLocalInboundPresentation({
            stripType: "local",
            airborne: true,
            sectionId: "bay2_ctr_arr",
        }),
        true,
    )
    assert.equal(
        isLocalInboundPresentation({
            stripType: "local",
            airborne: true,
            sectionId: "inbound",
        }),
        true,
    )
    assert.equal(
        isLocalInboundPresentation({
            stripType: "local",
            groundstate: "TXIN",
            sectionId: "taxi_arr",
        }),
        true,
    )
    assert.equal(
        isLocalInboundPresentation({
            stripType: "local",
            sectionId: "arr_runway",
            airborne: false,
        }),
        true,
    )
})

check("state flip: outbound airborne → inbound CTL → taxi-in", () => {
    const outbound = {
        stripType: "local" as const,
        airborne: true,
        sectionId: "ctr_dep",
        groundstate: "",
    }
    assert.equal(isLocalInboundPresentation(outbound), false)

    const inboundCtl = { ...outbound, clearedToLand: true, sectionId: "ctr_arr" }
    assert.equal(isLocalInboundPresentation(inboundCtl), true)

    const taxiIn = {
        stripType: "local" as const,
        airborne: false,
        clearedToLand: false,
        groundstate: "TXIN",
        sectionId: "taxi_arr",
    }
    assert.equal(isLocalInboundPresentation(taxiIn), true)

    const parked = { ...taxiIn, groundstate: "PARK" }
    assert.equal(isLocalInboundPresentation(parked), true)
})

check("section classifiers", () => {
    assert.equal(isLocalArrSideSection("ctr_arr"), true)
    assert.equal(isLocalArrSideSection("bay1_ctr_arr"), true)
    assert.equal(isLocalArrSideSection("inbound_gnd"), true)
    assert.equal(isLocalArrSideSection("ctr_dep"), false)
    assert.equal(isLocalDepSideSection("ctr_dep"), true)
    assert.equal(isLocalDepSideSection("bay1_ctr_dep"), true)
    assert.equal(isLocalDepSideSection("pending_dep"), true)
    assert.equal(isLocalDepSideSection("taxi_arr"), false)
})

console.log("local-strip: ok")

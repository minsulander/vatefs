import assert from "node:assert/strict"
import type { FlightStrip } from "@vatefs/common"
import {
    assertNoForbiddenSyncKeys,
    buildEssaIrisOrder,
    buildStripEfsFields,
    formatIrisSep,
    irisStripKey,
    isAppOrDepCallsign,
    isEssaAerodromeCallsign,
    isLeavingAerodromeForStripview,
    isReleasedOrUnicomLabel,
    mergeEssaIrisOrderForSplitPublish,
    stripMatchesRemoteKey,
    isEssaStripviewOrderStrip,
    isIrisStripviewPlacement,
} from "./iris-efs-order.js"

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

function strip(
    partial: Partial<FlightStrip> & Pick<FlightStrip, "callsign" | "sectionId">,
): FlightStrip {
    return {
        id: partial.id || partial.callsign || "id",
        syncKey: partial.syncKey,
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
        isAssumed: partial.isAssumed,
        transferPending: partial.transferPending,
        ownerCallsign: partial.ownerCallsign,
        ownerSi: partial.ownerSi,
        transferCallsign: partial.transferCallsign,
        transferSi: partial.transferSi,
        runway: partial.runway,
        clearanceRead: partial.clearanceRead,
        clearance: partial.clearance,
        clearanceReadback: partial.clearanceReadback,
        clearedToLand: partial.clearedToLand,
        dclStatus: partial.dclStatus,
        dclDismissed: partial.dclDismissed,
        paperClrReadSuppressed: partial.paperClrReadSuppressed,
        qnhGiven: partial.qnhGiven,
        noteText: partial.noteText,
        atd: partial.atd,
    }
}

check("stripKey uppercase callsign", () => {
    assert.equal(irisStripKey(strip({ callsign: "sas123", sectionId: "taxi_dep" })), "SAS123")
})

check("synthetic stripKey matches VatIRIS uppercase echo", () => {
    const note = strip({
        callsign: "",
        id: "note:abc-def",
        syncKey: "note:abc-def",
        sectionId: "inbound",
        stripType: "note",
    })
    assert.equal(stripMatchesRemoteKey(note, "NOTE:ABC-DEF"), true)
    assert.equal(stripMatchesRemoteKey(note, "note:abc-def"), true)
    const vehicle = strip({
        callsign: "",
        id: "veh:123",
        syncKey: "veh:123",
        sectionId: "taxi_dep",
        stripType: "vehicle",
    })
    assert.equal(stripMatchesRemoteKey(vehicle, "VEH:123"), true)
    const named = strip({
        callsign: "FOL",
        id: "veh:123",
        syncKey: "veh:123",
        sectionId: "taxi_dep",
        stripType: "vehicle",
    })
    assert.equal(stripMatchesRemoteKey(named, "FOL"), true)
    assert.equal(stripMatchesRemoteKey(named, "VEH:123"), true)
    assert.equal(stripMatchesRemoteKey(named, "OTHER"), false)
})

check("sep bare values", () => {
    assert.deepEqual(formatIrisSep({ sep: "2.5 nm", dlv: "3.5 nm", depGap: "6 nm" }), {
        sep: "2.5",
        dlv: "3.5",
        depGap: "6",
    })
})

check("callsign classifiers: APP/DEP vs aerodrome vs released", () => {
    assert.equal(isAppOrDepCallsign("ESSA_E_APP"), true)
    assert.equal(isAppOrDepCallsign("ESSA_W_DEP"), true)
    assert.equal(isAppOrDepCallsign("ESSA_R_APP"), false)
    assert.equal(isAppOrDepCallsign("ESSA_W_TWR"), false)
    assert.equal(isEssaAerodromeCallsign("ESSA_E_GND"), true)
    assert.equal(isEssaAerodromeCallsign("ESSA_W_TWR"), true)
    assert.equal(isEssaAerodromeCallsign("ESSA_S_TWR"), true)
    assert.equal(isEssaAerodromeCallsign("ESSA_DEL"), true)
    assert.equal(isEssaAerodromeCallsign("ESSA_E_APP"), false)
    assert.equal(isEssaAerodromeCallsign("ESSA_W_DEP"), false)
    assert.equal(isEssaAerodromeCallsign("ESOS_3_CTR"), false)
    assert.equal(isReleasedOrUnicomLabel("released"), true)
    assert.equal(isReleasedOrUnicomLabel(undefined, "released"), true)
    assert.equal(isReleasedOrUnicomLabel("UNICOM"), true)
})

check("reorder: TWR-W/E + TAXI|LINEUP|DEPA", () => {
    const order = buildEssaIrisOrder(
        [
            strip({
                callsign: "SASW",
                sectionId: "taxi_dep",
                groundstate: "TAXI",
                runway: "01L",
                position: 2,
            }),
            strip({
                callsign: "SASE",
                sectionId: "runway_01R_19L",
                groundstate: "LINEUP",
                runway: "01R",
                position: 0,
            }),
            strip({
                callsign: "CFTOW",
                sectionId: "runway_01L_19R",
                groundstate: "DEPA",
                clearedForTakeoff: true,
                runway: "19R",
                position: 1,
            }),
        ],
        7,
    )
    assert.equal(order.revision, 7)
    const keys = order.entries.map((e) => `${e.bayId}/${e.sectionId}/${e.stripKey}`)
    assert.ok(keys.includes("TWR-W/TAXI/SASW"))
    assert.ok(keys.includes("TWR-E/LINEUP/SASE"))
    assert.ok(keys.includes("TWR-W/DEPA/CFTOW"))
    console.log("DRY-RUN reorder payload:\n", JSON.stringify(order, null, 2))
    assert.equal(assertNoForbiddenSyncKeys(order).length, 0)
})

check("ctr_dep stays for TWR owner; drops on APP/DEP handoff and release", () => {
    const order = buildEssaIrisOrder(
        [
            strip({
                callsign: "STAY",
                sectionId: "taxi_dep",
                groundstate: "TAXI",
                runway: "01L",
                ownerCallsign: "ESSA_W_TWR",
            }),
            strip({
                callsign: "AIR",
                sectionId: "ctr_dep",
                groundstate: "DEPA",
                runway: "01L",
                ownerCallsign: "ESSA_W_TWR",
                isAssumed: true,
            }),
            strip({
                callsign: "XFER",
                sectionId: "ctr_dep",
                groundstate: "DEPA",
                runway: "01L",
                ownerCallsign: "ESSA_W_TWR",
                isAssumed: true,
                transferPending: "out",
                transferCallsign: "ESSA_E_APP",
            }),
            strip({
                callsign: "DEPX",
                sectionId: "ctr_dep",
                groundstate: "DEPA",
                runway: "01L",
                ownerCallsign: "ESSA_W_TWR",
                transferPending: "out",
                transferCallsign: "ESSA_W_DEP",
            }),
            strip({
                callsign: "REL",
                sectionId: "ctr_dep",
                groundstate: "DEPA",
                runway: "01L",
                ownerCallsign: undefined,
                isAssumed: false,
            }),
            strip({
                callsign: "APP",
                sectionId: "ctr_dep",
                groundstate: "DEPA",
                runway: "01L",
                ownerCallsign: "ESSA_E_APP",
                isAssumed: true,
            }),
        ],
        1,
    )
    const keys = order.entries.map((e) => `${e.bayId}/${e.sectionId}/${e.stripKey}`)
    assert.ok(keys.includes("TWR-W/TAXI/STAY"))
    assert.ok(keys.includes("TWR-W/DEPA/AIR"))
    assert.ok(!keys.some((k) => k.endsWith("/XFER")))
    assert.ok(!keys.some((k) => k.endsWith("/DEPX")))
    assert.ok(!keys.some((k) => k.endsWith("/REL")))
    assert.ok(!keys.some((k) => k.endsWith("/APP")))
    assert.equal(
        isEssaStripviewOrderStrip(
            strip({
                callsign: "AIR",
                sectionId: "ctr_dep",
                ownerCallsign: "ESSA_W_TWR",
                isAssumed: true,
            }),
        ),
        true,
    )
    assert.equal(
        isEssaStripviewOrderStrip(
            strip({
                callsign: "XFER",
                sectionId: "taxi_dep",
                groundstate: "TAXI",
                transferPending: "out",
                transferCallsign: "ESSA_E_APP",
            }),
        ),
        false,
    )
    console.log("DRY-RUN ctr-dep payload:\n", JSON.stringify(order, null, 2))
})

check("TWR→Unicom (released) drops from stripview", () => {
    assert.equal(
        isLeavingAerodromeForStripview({
            transferPending: "out",
            transferCallsign: "released",
            ownerCallsign: "ESSA_W_TWR",
        }),
        true,
    )
    assert.equal(
        isEssaStripviewOrderStrip(
            strip({
                callsign: "U1",
                sectionId: "ctr_dep",
                ownerCallsign: "ESSA_W_TWR",
                transferPending: "out",
                transferCallsign: "released",
                transferSi: "released",
            }),
        ),
        false,
    )
    assert.equal(
        isEssaStripviewOrderStrip(
            strip({
                callsign: "U2",
                sectionId: "taxi_dep",
                groundstate: "TAXI",
                ownerCallsign: "ESSA_W_TWR",
                transferPending: "out",
                transferCallsign: "UNICOM",
            }),
        ),
        false,
    )
})

check("split TWR↔TWR and GND↔GND handoffs stay on stripview", () => {
    assert.equal(
        isEssaStripviewOrderStrip(
            strip({
                callsign: "TW2TW",
                sectionId: "ctr_dep",
                ownerCallsign: "ESSA_W_TWR",
                transferPending: "out",
                transferCallsign: "ESSA_E_TWR",
            }),
        ),
        true,
    )
    assert.equal(
        isEssaStripviewOrderStrip(
            strip({
                callsign: "G2G",
                sectionId: "taxi_dep",
                groundstate: "TAXI",
                runway: "01L",
                ownerCallsign: "ESSA_W_GND",
                transferPending: "out",
                transferCallsign: "ESSA_E_GND",
            }),
        ),
        true,
    )
    assert.equal(
        isEssaStripviewOrderStrip(
            strip({
                callsign: "G2T",
                sectionId: "taxi_dep",
                groundstate: "TAXI",
                runway: "01L",
                ownerCallsign: "ESSA_W_GND",
                transferPending: "out",
                transferCallsign: "ESSA_W_TWR",
            }),
        ),
        true,
    )
    const order = buildEssaIrisOrder(
        [
            strip({
                callsign: "TW2TW",
                sectionId: "ctr_dep",
                groundstate: "DEPA",
                runway: "01L",
                ownerCallsign: "ESSA_W_TWR",
                transferPending: "out",
                transferCallsign: "ESSA_E_TWR",
            }),
            strip({
                callsign: "G2G",
                sectionId: "taxi_dep",
                groundstate: "TAXI",
                runway: "19R",
                ownerCallsign: "ESSA_W_GND",
                transferPending: "out",
                transferCallsign: "ESSA_N_GND",
            }),
        ],
        3,
    )
    const keys = order.entries.map((e) => e.stripKey)
    assert.ok(keys.includes("TW2TW"))
    assert.ok(keys.includes("G2G"))
})

check("top-down TWR cover keeps assumed ctr_dep until APP handoff", () => {
    const assumed = strip({
        callsign: "TOP",
        sectionId: "ctr_dep",
        groundstate: "DEPA",
        runway: "01L",
        isAssumed: true,
        // no ownerCallsign — covering APP acting as TWR
    })
    assert.equal(isEssaStripviewOrderStrip(assumed), false)
    assert.equal(isEssaStripviewOrderStrip(assumed, { sessionCoversEssaTower: true }), true)
    assert.equal(
        isEssaStripviewOrderStrip(
            strip({
                ...assumed,
                transferPending: "out",
                transferCallsign: "ESSA_E_APP",
            }),
            { sessionCoversEssaTower: true },
        ),
        false,
    )
})

check("APP assume/release does not keep strip on stripview without TWR owner", () => {
    // APP assumed after accepting TWR handoff — already left aerodrome ownership
    assert.equal(
        isEssaStripviewOrderStrip(
            strip({
                callsign: "SAS722",
                sectionId: "ctr_dep",
                ownerCallsign: "ESSA_E_APP",
                isAssumed: true,
            }),
        ),
        false,
    )
    // APP release → cleared owner
    assert.equal(
        isEssaStripviewOrderStrip(
            strip({
                callsign: "SAS2669",
                sectionId: "ctr_dep",
                ownerCallsign: undefined,
                isAssumed: false,
            }),
        ),
        false,
    )
})

check("split-order merge keeps peer strips and drops local leavers", () => {
    const westLocal = buildEssaIrisOrder(
        [
            strip({
                callsign: "WEST1",
                sectionId: "taxi_dep",
                groundstate: "TAXI",
                runway: "01L",
                ownerCallsign: "ESSA_W_TWR",
            }),
            strip({
                callsign: "GONE",
                sectionId: "ctr_dep",
                groundstate: "DEPA",
                runway: "01L",
                ownerCallsign: "ESSA_W_TWR",
                transferPending: "out",
                transferCallsign: "ESSA_E_APP",
            }),
        ],
        5,
    )
    // GONE left — not in local order
    assert.ok(!westLocal.entries.some((e) => e.stripKey === "GONE"))
    assert.ok(westLocal.entries.some((e) => e.stripKey === "WEST1"))

    const remote = [
        {
            stripKey: "WEST1",
            bayId: "TWR-W",
            sectionId: "TAXI",
            position: 0,
            cfto: false,
            atd: null,
        },
        {
            stripKey: "EAST1",
            bayId: "TWR-E",
            sectionId: "LINEUP",
            position: 0,
            cfto: false,
            atd: null,
        },
        {
            stripKey: "GONE",
            bayId: "TWR-W",
            sectionId: "DEPA",
            position: 0,
            cfto: true,
            atd: "1012",
        },
    ]

    const merged = mergeEssaIrisOrderForSplitPublish(
        westLocal,
        remote,
        [
            strip({
                callsign: "WEST1",
                sectionId: "taxi_dep",
                groundstate: "TAXI",
                runway: "01L",
                ownerCallsign: "ESSA_W_TWR",
            }),
            strip({
                callsign: "GONE",
                sectionId: "ctr_dep",
                groundstate: "DEPA",
                runway: "01L",
                ownerCallsign: "ESSA_W_TWR",
                transferPending: "out",
                transferCallsign: "ESSA_E_APP",
            }),
            // EAST1 not in local strips — peer ownership
        ],
    )
    const keys = merged.entries.map((e) => e.stripKey).sort()
    assert.deepEqual(keys, ["EAST1", "WEST1"])
    assert.ok(!keys.includes("GONE"))
})

check("disconnect / soft-delete drops previously published stripview keys", () => {
    const local = buildEssaIrisOrder(
        [
            strip({
                callsign: "STILL",
                sectionId: "taxi_dep",
                groundstate: "TAXI",
                runway: "01L",
                ownerCallsign: "ESSA_W_TWR",
            }),
        ],
        1,
    )
    const remote = [
        {
            stripKey: "STILL",
            bayId: "TWR-W" as const,
            sectionId: "TAXI" as const,
            position: 0,
            cfto: false,
            atd: null,
        },
        {
            stripKey: "GONE",
            bayId: "TWR-W" as const,
            sectionId: "DEPA" as const,
            position: 0,
            cfto: true,
            atd: "1012",
        },
        {
            stripKey: "PEER",
            bayId: "TWR-E" as const,
            sectionId: "LINEUP" as const,
            position: 0,
            cfto: false,
            atd: null,
        },
    ]
    const merged = mergeEssaIrisOrderForSplitPublish(
        local,
        remote,
        [
            strip({
                callsign: "STILL",
                sectionId: "taxi_dep",
                groundstate: "TAXI",
                runway: "01L",
                ownerCallsign: "ESSA_W_TWR",
            }),
            // GONE no longer in local strips (disconnect) — was previously published
        ],
        { previouslyPublishedKeys: new Set(["STILL", "GONE"]) },
    )
    const keys = merged.entries.map((e) => e.stripKey).sort()
    assert.deepEqual(keys, ["PEER", "STILL"])
    assert.ok(!keys.includes("GONE"))
})

check("StripEfsFields: bayId TWR-W/E from dep RWY role", () => {
    const west = buildStripEfsFields(
        strip({
            callsign: "SAS1",
            sectionId: "taxi_dep",
            groundstate: "TAXI",
            runway: "01L",
            clearanceRead: true,
            qnhGiven: 1013,
        }),
    )
    const east = buildStripEfsFields(
        strip({
            callsign: "SAS2",
            sectionId: "runway_01R_19L",
            groundstate: "LINEUP",
            runway: "01R",
        }),
    )
    assert.equal(west.bayId, "TWR-W") // 01L → TWR-W
    assert.equal(east.bayId, "TWR-E") // 01R → TWR-E
    assert.equal(west.sectionId, "TAXI")
    assert.equal(east.sectionId, "LINEUP")
    assert.equal(isIrisStripviewPlacement(west.bayId, west.sectionId), true)
    assert.equal(isIrisStripviewPlacement("bay3", "taxi_dep"), false)
    assert.equal(assertNoForbiddenSyncKeys(west).length, 0)
    assert.equal("groundstate" in west, false)
})

check("TAXI order puts EFS top at the bottom of Stripview taxiing", () => {
    const order = buildEssaIrisOrder(
        [
            strip({
                callsign: "BOT",
                sectionId: "taxi_dep",
                groundstate: "TAXI",
                runway: "01L",
                position: 5,
            }),
            strip({
                callsign: "ZZZ",
                sectionId: "taxi_dep",
                groundstate: "TAXI",
                runway: "01L",
                position: 2,
            }),
            strip({
                callsign: "AAA",
                sectionId: "taxi_dep",
                groundstate: "TAXI",
                runway: "01L",
                position: 2,
            }),
            strip({
                callsign: "TOP",
                sectionId: "taxi_dep",
                groundstate: "TAXI",
                runway: "01L",
                position: 0,
            }),
        ],
        4,
    )
    const taxi = order.entries.filter((e) => e.bayId === "TWR-W" && e.sectionId === "TAXI")
    assert.deepEqual(
        taxi.map((e) => e.stripKey),
        ["BOT", "ZZZ", "AAA", "TOP"],
    )
    assert.deepEqual(
        taxi.map((e) => e.position),
        [0, 1, 2, 3],
    )
    assert.equal(taxi[0]?.stripKey, "BOT")
    assert.equal(taxi[taxi.length - 1]?.stripKey, "TOP")
    assert.equal(taxi[taxi.length - 1]?.position, taxi.length - 1)
})

check("LINEUP/DEPA invert so EFS top sits closest to Stripview DEPA end", () => {
    // Stripview SECTION_ORDER = TAXI → LINEUP → DEPA (takeoff toward column bottom).
    // EFS RWY: first L/U on top (pos 0). Publish inverted so first L/U has higher
    // IRIS position within LINEUP (= closer to DEPA). Same for CFTO in DEPA.
    const order = buildEssaIrisOrder(
        [
            strip({
                callsign: "RYR27G",
                sectionId: "runway_01L_19R",
                groundstate: "LINEUP",
                runway: "01L",
                position: 0,
            }),
            strip({
                callsign: "SAS1042",
                sectionId: "runway_01L_19R",
                groundstate: "LINEUP",
                runway: "01L",
                position: 1,
            }),
            strip({
                callsign: "CFTO1",
                sectionId: "runway_01L_19R",
                groundstate: "DEPA",
                clearedForTakeoff: true,
                runway: "01L",
                position: 0,
            }),
            strip({
                callsign: "CFTO2",
                sectionId: "runway_01L_19R",
                groundstate: "DEPA",
                clearedForTakeoff: true,
                runway: "01L",
                position: 1,
            }),
        ],
        5,
    )
    const lineup = order.entries.filter((e) => e.sectionId === "LINEUP")
    assert.deepEqual(
        lineup.map((e) => e.stripKey),
        ["SAS1042", "RYR27G"],
    )
    assert.deepEqual(
        lineup.map((e) => e.position),
        [0, 1],
    )
    const depa = order.entries.filter((e) => e.sectionId === "DEPA")
    assert.deepEqual(
        depa.map((e) => e.stripKey),
        ["CFTO2", "CFTO1"],
    )
    assert.deepEqual(
        depa.map((e) => e.position),
        [0, 1],
    )
})

check("cfto and atd on order entries and strip bodies", () => {
    const cfto = strip({
        callsign: "CFTO",
        sectionId: "runway_01L_19R",
        groundstate: "DEPA",
        clearedForTakeoff: true,
        atd: "1012",
        runway: "01L",
        position: 0,
    })
    const taxi = strip({
        callsign: "TAXI1",
        sectionId: "taxi_dep",
        groundstate: "TAXI",
        runway: "01L",
        position: 1,
    })
    const rto = strip({
        callsign: "RTO1",
        sectionId: "taxi_dep",
        groundstate: "TAXI",
        clearedForTakeoff: false,
        runway: "01L",
        position: 4,
    })
    const order = buildEssaIrisOrder([cfto, taxi, rto], 2)
    const byKey = new Map(order.entries.map((e) => [e.stripKey, e]))
    assert.equal(byKey.get("CFTO")?.cfto, true)
    assert.equal(byKey.get("CFTO")?.atd, "1012")
    assert.equal(byKey.get("TAXI1")?.cfto, false)
    assert.equal(byKey.get("TAXI1")?.atd, null)
    assert.equal(byKey.get("RTO1")?.cfto, false)
    assert.equal(byKey.get("RTO1")?.atd, null)
    const taxiKeys = order.entries
        .filter((e) => e.sectionId === "TAXI")
        .map((e) => e.stripKey)
    assert.deepEqual(taxiKeys, ["RTO1", "TAXI1"])

    const fields = buildStripEfsFields(cfto)
    assert.equal(fields.cfto, true)
    assert.equal(fields.atd, "1012")
    const rtoFields = buildStripEfsFields(rto)
    assert.equal(rtoFields.cfto, false)
    assert.equal(rtoFields.atd, null)
    assert.equal(assertNoForbiddenSyncKeys(order).length, 0)
    assert.equal(assertNoForbiddenSyncKeys(fields).length, 0)
    assert.equal(assertNoForbiddenSyncKeys(rtoFields).length, 0)

    const note = buildStripEfsFields(
        strip({
            callsign: "",
            sectionId: "taxi_dep",
            stripType: "note",
            noteText: "hi",
        }),
    )
    assert.equal("cfto" in note, false)
    assert.equal("atd" in note, false)
    const vehicle = buildStripEfsFields(
        strip({
            callsign: "FOL",
            sectionId: "taxi_dep",
            stripType: "vehicle",
        }),
    )
    assert.equal("cfto" in vehicle, false)
    assert.equal("atd" in vehicle, false)
})

check("paper CTL and DCL marks are EFS sync fields", () => {
    const ctl = buildStripEfsFields(
        strip({
            callsign: "ARR1",
            sectionId: "runway",
            stripType: "arrival",
            clearedToLand: true,
        }),
    )
    assert.equal(ctl.ctl, true)
    assert.equal(ctl.dclMark, false)
    const dcl = buildStripEfsFields(
        strip({
            callsign: "DEP1",
            sectionId: "cleared",
            dclStatus: "DONE",
            clearanceReadback: true,
        }),
    )
    assert.equal(dcl.dclMark, true)
    assert.equal(dcl.clearanceReadback, true)
    assert.equal(dcl.clrReadSuppressed, false)
    const dismissed = buildStripEfsFields(
        strip({
            callsign: "DEP2",
            sectionId: "cleared",
            dclStatus: "DONE",
            dclDismissed: true,
            paperClrReadSuppressed: true,
        }),
    )
    assert.equal(dismissed.dclMark, false)
    assert.equal(dismissed.clrReadSuppressed, true)
    assert.equal(assertNoForbiddenSyncKeys(ctl).length, 0)
    assert.equal(assertNoForbiddenSyncKeys(dcl).length, 0)
})

console.log(`\n${passed} passed`)

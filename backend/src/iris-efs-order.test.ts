import assert from "node:assert/strict"
import type { FlightStrip } from "@vatefs/common"
import {
    assertNoForbiddenSyncKeys,
    buildEssaIrisOrder,
    buildStripEfsFields,
    formatIrisSep,
    irisStripKey,
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
        runway: partial.runway,
        clearanceRead: partial.clearanceRead,
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
    // Dry-run print
    console.log("DRY-RUN reorder payload:\n", JSON.stringify(order, null, 2))
    assert.equal(assertNoForbiddenSyncKeys(order).length, 0)
})

check("ctr_dep stays until transfer or release", () => {
    const order = buildEssaIrisOrder(
        [
            strip({
                callsign: "STAY",
                sectionId: "taxi_dep",
                groundstate: "TAXI",
                runway: "01L",
            }),
            strip({
                callsign: "AIR",
                sectionId: "ctr_dep",
                groundstate: "DEPA",
                runway: "01L",
                isAssumed: true,
            }),
            strip({
                callsign: "XFER",
                sectionId: "ctr_dep",
                groundstate: "DEPA",
                runway: "01L",
                isAssumed: true,
                transferPending: "out",
            }),
            strip({
                callsign: "REL",
                sectionId: "ctr_dep",
                groundstate: "DEPA",
                runway: "01L",
                isAssumed: false,
            }),
        ],
        1,
    )
    const keys = order.entries.map((e) => `${e.bayId}/${e.sectionId}/${e.stripKey}`)
    assert.ok(keys.includes("TWR-W/TAXI/STAY"))
    assert.ok(keys.includes("TWR-W/DEPA/AIR"))
    assert.ok(!keys.some((k) => k.endsWith("/XFER")))
    assert.ok(!keys.some((k) => k.endsWith("/REL")))
    assert.equal(
        isEssaStripviewOrderStrip(
            strip({ callsign: "AIR", sectionId: "ctr_dep", isAssumed: true }),
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
            }),
        ),
        false,
    )
    console.log("DRY-RUN ctr-dep payload:\n", JSON.stringify(order, null, 2))
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

check("TAXI order matches EFS top to bottom", () => {
    // taxi_dep addFromTop inserts at position 0. EfsSection renders ascending
    // position under the header, so 0 is the visual top and the highest
    // position is the visual bottom. Published TAXI position follows that.
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
        ["TOP", "AAA", "ZZZ", "BOT"],
    )
    assert.deepEqual(
        taxi.map((e) => e.position),
        [0, 1, 2, 3],
    )
    assert.equal(taxi[0]?.stripKey, "TOP")
    assert.equal(taxi[taxi.length - 1]?.stripKey, "BOT")
    assert.equal(taxi[taxi.length - 1]?.position, taxi.length - 1)
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
    // Same bay: EFS top (TAXI1 pos 1) before EFS bottom (RTO1 pos 4)
    const taxiKeys = order.entries
        .filter((e) => e.sectionId === "TAXI")
        .map((e) => e.stripKey)
    assert.deepEqual(taxiKeys, ["TAXI1", "RTO1"])

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

console.log(`\n${passed} passed`)

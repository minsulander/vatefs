/**
 * ESSA stand assign / menu classification tests.
 * Run: npx tsx src/essa-stand-assign.test.ts
 */

import assert from "node:assert/strict"
import {
    parseEssaStandsContent,
    buildEssaStandMenu,
    normalizeApronTitle,
    resolveAircraftDims,
    isSchengenOrigin,
    _testReset,
    _testSetAircraft,
    _testMarkLoaded,
} from "./essa-stand-assign.js"

let passed = 0
function check(name: string, fn: () => void) {
    try {
        fn()
        passed++
        console.log(`  ok  ${name}`)
    } catch (err) {
        console.error(`  FAIL ${name}`)
        throw err
    }
}

const FIXTURE = `
GROUP:Scandi:SAS:SZS:SVS
GROUP:T5A:01:03:04

//STAND ASSIGNMENT
STANDLIST:ESSA:GROUP_Scandi:100:GROUP_T5A
STANDLIST:ESSA:GROUP_Scandi:10:F34

//TERMINAL 5 PIER A

STAND:ESSA:01
COORD:N059.39.07.320:E017.55.50.403
COORD:N059.39.07.693:E017.55.50.728
COORD:N059.39.08.261:E017.55.50.575
COORD:N059.39.07.430:E017.55.45.877
USE:A
BLOCKS:3:C
ATYP:A320,A20N,B738
SCHENGEN
COPY
ATYP:*
PRIORITY:-1
CODE:B:C
SCHENGEN

STAND:ESSA:03
COORD:N059.39.07.430:E017.55.45.869
COORD:N059.39.08.248:E017.55.50.573
COORD:N059.39.10.000:E017.55.49.307
COORD:N059.39.09.101:E017.55.44.246
USE:A
BLOCKS:1,5:D
ATYP:A320,A20N,B738,A333
SCHENGEN
COPY
PRIORITY:-1
NON-SCHENGEN
COPY
ATYP:*
PRIORITY:-1
CODE:B:D
SCHENGEN

STAND:ESSA:05
COORD:N059.39.08.000:E017.55.44.000
COORD:N059.39.08.100:E017.55.44.100
COORD:N059.39.08.200:E017.55.44.000
COORD:N059.39.08.100:E017.55.43.900
USE:A
ATYP:*
CODE:C

//TERMINAL 5 PIER F

STAND:ESSA:F34
COORD:N059.39.20.000:E017.56.00.000
COORD:N059.39.20.100:E017.56.00.100
COORD:N059.39.20.200:E017.56.00.000
COORD:N059.39.20.100:E017.55.59.900
USE:A
ATYP:*
CODE:C
WINGSPAN:36

//APRON H
STAND:ESSA:APNH
COORD:N059.39.10.000:E017.57.00.000
COORD:N059.39.11.000:E017.57.00.000
COORD:N059.39.11.000:E017.57.01.000
COORD:N059.39.10.000:E017.57.01.000
AREA
MANUAL

----------------------------------------------------------------------------ESSB
STAND:ESSB:1
COORD:N059.21.00.000:E017.56.00.000
COORD:N059.21.01.000:E017.56.00.000
COORD:N059.21.01.000:E017.56.01.000
COORD:N059.21.00.000:E017.56.01.000
`

console.log("essa-stand-assign")

check("normalize apron titles", () => {
    assert.equal(normalizeApronTitle("TERMINAL 5 PIER A"), "T5 PIER A")
    assert.equal(normalizeApronTitle("TERMINAL 4"), "T4")
    assert.equal(normalizeApronTitle("APRON D/E"), "APRON D/E")
    assert.equal(normalizeApronTitle("APRON G"), "G")
})

check("Schengen origin prefixes", () => {
    assert.equal(isSchengenOrigin("ESGG"), true)
    assert.equal(isSchengenOrigin("EKCH"), true)
    assert.equal(isSchengenOrigin("EGLL"), false)
    assert.equal(isSchengenOrigin("EIDW"), false)
})

_testReset()
parseEssaStandsContent(FIXTURE)
_testSetAircraft([
    { ICAO: "A320", Description: "L2J", WTC: "M", Wingspan: 34.1, Length: 37.6, Use: "A" },
    { ICAO: "A333", Description: "L2J", WTC: "H", Wingspan: 60.3, Length: 63.7, Use: "A" },
    { ICAO: "B744", Description: "L4J", WTC: "H", Wingspan: 64.4, Length: 70.7, Use: "A" },
])
_testMarkLoaded()

check("apron order and stand slots fixed", () => {
    const menu = buildEssaStandMenu({
        stripId: "SAS123",
        callsign: "SAS123",
        origin: "ENGM",
        destination: "ESSA",
        aircraftType: "A320",
        wakeTurbulence: "M",
        traffic: [],
    })
    assert.ok(menu)
    assert.deepEqual(
        menu!.aprons.map((a) => a.title),
        ["T5 PIER A", "T5 PIER F", "H"],
    )
    assert.deepEqual(
        menu!.aprons[0]!.stands.map((s) => s.name),
        ["01", "03", "05"],
    )
})

check("SAS A320 Schengen → preferred on T5A", () => {
    const menu = buildEssaStandMenu({
        stripId: "SAS123",
        callsign: "SAS123",
        origin: "EKCH",
        destination: "ESSA",
        aircraftType: "A320",
        wakeTurbulence: "M",
        traffic: [],
    })
    assert.ok(menu)
    const s01 = menu!.aprons[0]!.stands.find((s) => s.name === "01")!
    const s03 = menu!.aprons[0]!.stands.find((s) => s.name === "03")!
    const f34 = menu!.aprons[1]!.stands.find((s) => s.name === "F34")!
    assert.equal(s01.fit, "preferred")
    assert.equal(s03.fit, "preferred")
    assert.equal(f34.fit, "allowed") // lower STANDLIST tier
    assert.equal(s01.selectable, true)
})

check("non-Schengen does not dim; preferred uses Non-Schengen variant", () => {
    const menu = buildEssaStandMenu({
        stripId: "SAS456",
        callsign: "SAS456",
        origin: "EGLL",
        destination: "ESSA",
        aircraftType: "A320",
        wakeTurbulence: "M",
        traffic: [],
    })
    assert.ok(menu)
    const s01 = menu!.aprons[0]!.stands.find((s) => s.name === "01")!
    const s03 = menu!.aprons[0]!.stands.find((s) => s.name === "03")!
    // 01 only has SCHENGEN variants → not preferred, still allowed (physical fit)
    assert.equal(s01.fit, "allowed")
    assert.equal(s01.selectable, true)
    // 03 has NON-SCHENGEN copy → preferred
    assert.equal(s03.fit, "preferred")
})

check("oversized aircraft → notAllowed by CODE/wingspan", () => {
    const menu = buildEssaStandMenu({
        stripId: "SAS789",
        callsign: "SAS789",
        origin: "EKCH",
        destination: "ESSA",
        aircraftType: "B744",
        wakeTurbulence: "H",
        traffic: [],
    })
    assert.ok(menu)
    const s01 = menu!.aprons[0]!.stands.find((s) => s.name === "01")!
    // 01 max CODE C (35.999) — B744 64m does not fit; still selectable
    assert.equal(s01.fit, "notAllowed")
    assert.equal(s01.selectable, true)
    assert.ok(s01.reason && /wingspan/i.test(s01.reason), s01.reason)
    const s03 = menu!.aprons[0]!.stands.find((s) => s.name === "03")!
    // 03 COPY with CODE:B:D allows up to ~52m — still too small for 64m
    assert.equal(s03.fit, "notAllowed")
    assert.equal(s03.selectable, true)
    assert.ok(s03.reason && /wingspan/i.test(s03.reason), s03.reason)
})

check("occupied stand stays in place, selectable, grey label", () => {
    const menu = buildEssaStandMenu({
        stripId: "SAS123",
        callsign: "SAS123",
        origin: "EKCH",
        destination: "ESSA",
        aircraftType: "A320",
        wakeTurbulence: "M",
        traffic: [
            {
                callsign: "NAX12A",
                latitude: 59.652132, // centroid of 01 polygon
                longitude: 17.930388,
                dims: resolveAircraftDims("A320", "M", "NAX12A"),
                assigned: false,
            },
        ],
    })
    assert.ok(menu)
    const s01 = menu!.aprons[0]!.stands.find((s) => s.name === "01")!
    assert.equal(s01.fit, "preferred")
    assert.ok(s01.occupied)
    assert.equal(s01.occupied!.kind, "occupied")
    assert.equal(s01.occupied!.label, "NAX12A")
    assert.equal(s01.selectable, true)
})

check("AREA stand selectable", () => {
    const menu = buildEssaStandMenu({
        stripId: "SAS123",
        callsign: "SAS123",
        origin: "EKCH",
        destination: "ESSA",
        aircraftType: "A320",
        wakeTurbulence: "M",
        traffic: [],
    })
    const apnh = menu!.aprons.find((a) => a.title === "H")!.stands[0]!
    assert.equal(apnh.name, "APNH")
    assert.equal(apnh.area, true)
    assert.equal(apnh.selectable, true)
})

check("APNH multi-assign shows count, not occupied/planned style", () => {
    const menu = buildEssaStandMenu({
        stripId: "SAS123",
        callsign: "SAS123",
        origin: "EKCH",
        destination: "ESSA",
        aircraftType: "A320",
        wakeTurbulence: "M",
        traffic: [
            {
                callsign: "HCA1",
                stand: "APNH",
                dims: resolveAircraftDims("A320", "M", "HCA1"),
                assigned: true,
            },
            {
                callsign: "HCA2",
                stand: "APNH",
                dims: resolveAircraftDims("A320", "M", "HCA2"),
                assigned: true,
            },
            {
                callsign: "HCA3",
                stand: "APNH",
                groundstate: "PARK",
                dims: resolveAircraftDims("B738", "M", "HCA3"),
                assigned: true,
            },
        ],
    })
    const apnh = menu!.aprons.find((a) => a.title === "H")!.stands[0]!
    assert.equal(apnh.name, "APNH")
    assert.equal(apnh.assignedCount, 3)
    assert.equal(apnh.occupied, undefined)
})

check("assigned stand marks occupancy without moving slot", () => {
    const menu = buildEssaStandMenu({
        stripId: "SAS123",
        callsign: "SAS123",
        origin: "EKCH",
        destination: "ESSA",
        aircraftType: "A320",
        wakeTurbulence: "M",
        traffic: [
            {
                callsign: "DLH400",
                stand: "F34",
                dims: resolveAircraftDims("A320", "M", "DLH400"),
                assigned: true,
            },
        ],
    })
    const f34 = menu!.aprons[1]!.stands.find((s) => s.name === "F34")!
    assert.equal(f34.occupied?.kind, "assigned")
    assert.equal(f34.occupied?.label, "DLH400")
    assert.equal(f34.occupied?.airborne, false)
    assert.equal(f34.selectable, true)
})

check("departure planned stand does not carry TS/TB/EB (only occupied)", () => {
    const menu = buildEssaStandMenu({
        stripId: "SAS123",
        callsign: "SAS123",
        origin: "EKCH",
        destination: "ESSA",
        aircraftType: "A320",
        wakeTurbulence: "M",
        traffic: [
            {
                callsign: "SAS462",
                stand: "03",
                departure: true,
                tsat: "1240",
                tobt: "1235",
                eobt: "1234",
                dims: resolveAircraftDims("A320", "M", "SAS462"),
                assigned: true,
            },
        ],
    })
    const s03 = menu!.aprons[0]!.stands.find((s) => s.name === "03")!
    assert.equal(s03.occupied?.kind, "assigned")
    assert.equal(s03.occupied?.tsat, undefined)
    assert.equal(s03.occupied?.eobt, undefined)
})

check("occupied departure stand carries TS/TB/EB", () => {
    const menu = buildEssaStandMenu({
        stripId: "SAS123",
        callsign: "SAS123",
        origin: "EKCH",
        destination: "ESSA",
        aircraftType: "A320",
        wakeTurbulence: "M",
        traffic: [
            {
                callsign: "SAS999",
                stand: "F34",
                groundstate: "PARK",
                departure: true,
                tsat: "1230",
                eobt: "1220",
                dims: resolveAircraftDims("CRJ9", "M", "SAS999"),
                assigned: true,
            },
        ],
    })
    const f34 = menu!.aprons[1]!.stands.find((s) => s.name === "F34")!
    assert.equal(f34.occupied?.kind, "occupied")
    assert.equal(f34.occupied?.departure, true)
    assert.equal(f34.occupied?.tsat, "1230")
    assert.equal(f34.occupied?.eobt, "1220")
})

check("occupied arrival stand is not marked departure", () => {
    const menu = buildEssaStandMenu({
        stripId: "SAS123",
        callsign: "SAS123",
        origin: "EKCH",
        destination: "ESSA",
        aircraftType: "A320",
        wakeTurbulence: "M",
        traffic: [
            {
                callsign: "BAW100",
                stand: "F34",
                groundstate: "PARK",
                departure: false,
                dims: resolveAircraftDims("A320", "M", "BAW100"),
                assigned: true,
            },
        ],
    })
    const f34 = menu!.aprons[1]!.stands.find((s) => s.name === "F34")!
    assert.equal(f34.occupied?.kind, "occupied")
    assert.equal(f34.occupied?.departure, false)
})

check("airborne planned (+ blocked) sets airborne for softer shade", () => {
    const menu = buildEssaStandMenu({
        stripId: "SAS123",
        callsign: "SAS123",
        origin: "EKCH",
        destination: "ESSA",
        aircraftType: "A320",
        wakeTurbulence: "M",
        traffic: [
            {
                callsign: "BAW791G",
                stand: "01",
                airborne: true,
                dims: resolveAircraftDims("B744", "H", "BAW791G"),
                assigned: true,
            },
        ],
    })
    assert.ok(menu)
    const s01 = menu!.aprons[0]!.stands.find((s) => s.name === "01")!
    assert.equal(s01.occupied?.kind, "assigned")
    assert.equal(s01.occupied?.airborne, true)
    const s03 = menu!.aprons[0]!.stands.find((s) => s.name === "03")!
    assert.equal(s03.occupied?.kind, "blocked")
    assert.equal(s03.occupied?.blockFrom, "assigned")
    assert.equal(s03.occupied?.airborne, true)
})

check("departure on stand occupies and BLOCKS neighbour", () => {
    // DEPARTURE on 01 (BLOCKS:3:C — unpadded GRP ref) — widebody exceeds C → 03 blocked
    const menu = buildEssaStandMenu({
        stripId: "SAS123",
        callsign: "SAS123",
        origin: "EKCH",
        destination: "ESSA",
        aircraftType: "A320",
        wakeTurbulence: "M",
        traffic: [
            {
                callsign: "BAW791G",
                stand: "01",
                dims: resolveAircraftDims("B744", "H", "BAW791G"),
                assigned: true,
            },
        ],
    })
    assert.ok(menu)
    const s01 = menu!.aprons[0]!.stands.find((s) => s.name === "01")!
    assert.equal(s01.occupied?.kind, "assigned")
    assert.equal(s01.occupied?.label, "BAW791G")
    const s03 = menu!.aprons[0]!.stands.find((s) => s.name === "03")!
    assert.equal(s03.occupied?.kind, "blocked")
    assert.equal(s03.occupied?.label, "BAW791G")
    assert.equal(s03.occupied?.blockFrom, "assigned")
    assert.equal(s03.occupied?.relatedStand, "01")
})

check("BLOCKS:1,5 from assigned 03 resolves padded stand names", () => {
    // Stand 03 has BLOCKS:1,5:D — A333 wingspan exceeds D → 01 and 05 blocked
    const menu = buildEssaStandMenu({
        stripId: "SAS123",
        callsign: "SAS123",
        origin: "EKCH",
        destination: "ESSA",
        aircraftType: "A320",
        wakeTurbulence: "M",
        traffic: [
            {
                callsign: "DLH400",
                stand: "03",
                dims: resolveAircraftDims("A333", "H", "DLH400"),
                assigned: true,
            },
        ],
    })
    assert.ok(menu)
    const s01 = menu!.aprons[0]!.stands.find((s) => s.name === "01")!
    assert.equal(s01.occupied?.kind, "blocked")
    assert.equal(s01.occupied?.label, "DLH400")
    assert.equal(s01.occupied?.blockFrom, "assigned")
    assert.equal(s01.occupied?.relatedStand, "03")
    const s05 = menu!.aprons[0]!.stands.find((s) => s.name === "05")!
    assert.equal(s05.occupied?.kind, "blocked")
    assert.equal(s05.occupied?.label, "DLH400")
    assert.equal(s05.occupied?.blockFrom, "assigned")
    assert.equal(s05.occupied?.relatedStand, "03")
})

check("BLOCKS from physically occupied stand sets blockFrom occupied", () => {
    const menu = buildEssaStandMenu({
        stripId: "SAS123",
        callsign: "SAS123",
        origin: "EKCH",
        destination: "ESSA",
        aircraftType: "A320",
        wakeTurbulence: "M",
        traffic: [
            {
                callsign: "NAX12A",
                latitude: 59.652132,
                longitude: 17.930388,
                dims: resolveAircraftDims("B744", "H", "NAX12A"),
                assigned: false,
            },
        ],
    })
    assert.ok(menu)
    const s03 = menu!.aprons[0]!.stands.find((s) => s.name === "03")!
    assert.equal(s03.occupied?.kind, "blocked")
    assert.equal(s03.occupied?.label, "NAX12A")
    assert.equal(s03.occupied?.blockFrom, "occupied")
    assert.equal(s03.occupied?.relatedStand, "01")
})

check("PARK + stand without GPS occupies stand", () => {
    const menu = buildEssaStandMenu({
        stripId: "SAS123",
        callsign: "SAS123",
        origin: "EKCH",
        destination: "ESSA",
        aircraftType: "A320",
        wakeTurbulence: "M",
        traffic: [
            {
                callsign: "FIN842",
                stand: "F34",
                groundstate: "PARK",
                dims: resolveAircraftDims("E190", "M", "FIN842"),
                assigned: true,
            },
        ],
    })
    const f34 = menu!.aprons[1]!.stands.find((s) => s.name === "F34")!
    assert.equal(f34.occupied?.kind, "occupied")
    assert.equal(f34.occupied?.label, "FIN842")
})

check("parked on different stand than assignment: occupy real only", () => {
    // On stand 01 by GPS, still assigned F34 — do not Planned F34
    const menu = buildEssaStandMenu({
        stripId: "SAS123",
        callsign: "SAS123",
        origin: "EKCH",
        destination: "ESSA",
        aircraftType: "A320",
        wakeTurbulence: "M",
        traffic: [
            {
                callsign: "FIN842",
                stand: "F34",
                groundstate: "PARK",
                latitude: 59.652132,
                longitude: 17.930388,
                dims: resolveAircraftDims("E190", "M", "FIN842"),
                assigned: true,
            },
        ],
    })
    const s01 = menu!.aprons[0]!.stands.find((s) => s.name === "01")!
    assert.equal(s01.occupied?.kind, "occupied")
    assert.equal(s01.occupied?.label, "FIN842")
    const f34 = menu!.aprons[1]!.stands.find((s) => s.name === "F34")!
    assert.equal(f34.occupied, undefined)
})

check("unassigned arrival on stand by GPS only occupies that stand", () => {
    const menu = buildEssaStandMenu({
        stripId: "SAS123",
        callsign: "SAS123",
        origin: "EKCH",
        destination: "ESSA",
        aircraftType: "A320",
        wakeTurbulence: "M",
        traffic: [
            {
                callsign: "NAX99",
                latitude: 59.652132,
                longitude: 17.930388,
                dims: resolveAircraftDims("A320", "M", "NAX99"),
                assigned: false,
            },
        ],
    })
    const s01 = menu!.aprons[0]!.stands.find((s) => s.name === "01")!
    assert.equal(s01.occupied?.kind, "occupied")
    assert.equal(s01.occupied?.label, "NAX99")
    const f34 = menu!.aprons[1]!.stands.find((s) => s.name === "F34")!
    assert.equal(f34.occupied, undefined)
})

check("non-ESSA destination returns undefined", () => {
    const menu = buildEssaStandMenu({
        stripId: "SAS123",
        callsign: "SAS123",
        origin: "EKCH",
        destination: "ESGG",
        aircraftType: "A320",
        traffic: [],
    })
    assert.equal(menu, undefined)
})

console.log(`\n${passed} passed`)

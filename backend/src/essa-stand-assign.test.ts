/**
 * ESSA stand assign / menu classification tests.
 * Run: npx tsx src/essa-stand-assign.test.ts
 */

import assert from "node:assert/strict"
import {
    parseEssaStandsContent,
    buildEssaStandMenu,
    pickEssaAutoStand,
    isEssaStandBlocked,
    normalizeApronTitle,
    resolveAircraftDims,
    isSchengenOrigin,
    applyEssaStandMenuGeoLayout,
    GEO_APRON_ORDER,
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

check("apron order is geographic (south→north; M after cargo)", () => {
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
    // Fixture: T5A odds; T5F (F34); H
    assert.deepEqual(
        menu!.aprons.map((a) => a.title),
        ["T5A", "T5F", "H"],
    )
    const idxs = Object.fromEntries(GEO_APRON_ORDER.map((t, i) => [t, i]))
    assert.ok(idxs["T5A"]! < idxs["T5F"]!)
    assert.ok(idxs["T5F"]! < idxs["H"]!)
    assert.ok(idxs["M"]! < idxs["J"]!)
    assert.ok(idxs["J"]! < idxs["K"]!)
    assert.ok(idxs["K"]! < idxs["L"]!)
    assert.ok(idxs["L"]! < idxs["P"]!)
    assert.deepEqual(
        menu!.aprons[0]!.stands.map((s) => s.name),
        ["01", "03", "05"],
    )
})

check("T3 single list: 60A,53,55,57 then 52→58; T2 descending", () => {
    const laid = applyEssaStandMenuGeoLayout([
        {
            title: "T2",
            stands: [
                { name: "62", fit: "allowed", area: false, selectable: true },
                { name: "68", fit: "allowed", area: false, selectable: true },
                { name: "65", fit: "allowed", area: false, selectable: true },
            ],
        },
        {
            title: "T3",
            stands: [
                { name: "58", fit: "allowed", area: false, selectable: true },
                { name: "53", fit: "allowed", area: false, selectable: true },
                { name: "52", fit: "allowed", area: false, selectable: true },
                { name: "57", fit: "allowed", area: false, selectable: true },
                { name: "60A", fit: "allowed", area: false, selectable: true },
                { name: "55", fit: "allowed", area: false, selectable: true },
                { name: "56", fit: "allowed", area: false, selectable: true },
                { name: "54", fit: "allowed", area: false, selectable: true },
            ],
        },
        {
            title: "R",
            stands: [
                { name: "R10", fit: "allowed", area: false, selectable: true },
                { name: "R3", fit: "allowed", area: false, selectable: true },
            ],
        },
        {
            title: "M",
            stands: [{ name: "M5", fit: "allowed", area: false, selectable: true }],
        },
        {
            title: "P",
            stands: [{ name: "APNP", fit: "allowed", area: false, selectable: true }],
        },
    ])
    const titles = laid.map((a) => a.title)
    assert.ok(titles.indexOf("R") < titles.indexOf("T2"))
    assert.ok(titles.indexOf("T2") < titles.indexOf("T3"))
    assert.ok(titles.indexOf("T3") < titles.indexOf("M"))
    assert.ok(titles.indexOf("M") < titles.indexOf("P"))
    assert.deepEqual(
        laid.find((a) => a.title === "T2")!.stands.map((s) => s.name),
        ["68", "65", "62"],
    )
    assert.deepEqual(
        laid.find((a) => a.title === "T3")!.stands.map((s) => s.name),
        ["60A", "53", "55", "57", "52", "54", "56", "58"],
    )
    assert.deepEqual(
        laid.find((a) => a.title === "R")!.stands.map((s) => s.name),
        ["R3", "R10"],
    )
})

check("D/E, T4, T5: odds ascending then evens ascending", () => {
    const de = applyEssaStandMenuGeoLayout([
        {
            title: "APRON D/E",
            stands: [
                { name: "112", fit: "allowed", area: false, selectable: true },
                { name: "101", fit: "allowed", area: false, selectable: true },
                { name: "119", fit: "allowed", area: false, selectable: true },
                { name: "110", fit: "allowed", area: false, selectable: true },
                { name: "108", fit: "allowed", area: false, selectable: true },
                { name: "103", fit: "allowed", area: false, selectable: true },
            ],
        },
    ])
    assert.deepEqual(
        de.map((a) => a.title),
        ["E", "D"],
    )
    assert.deepEqual(
        de[0]!.stands.map((s) => s.name),
        ["101", "103", "119"],
    )
    assert.deepEqual(
        de[1]!.stands.map((s) => s.name),
        ["108", "110", "112"],
    )

    const t4 = applyEssaStandMenuGeoLayout([
        {
            title: "T4",
            stands: [
                { name: "44", fit: "allowed", area: false, selectable: true },
                { name: "31", fit: "allowed", area: false, selectable: true },
                { name: "43", fit: "allowed", area: false, selectable: true },
                { name: "32", fit: "allowed", area: false, selectable: true },
                { name: "40", fit: "allowed", area: false, selectable: true },
                { name: "42", fit: "allowed", area: false, selectable: true },
            ],
        },
    ])
    assert.deepEqual(
        t4.find((a) => a.title === "T4")!.stands.map((s) => s.name),
        ["31", "43", "32", "40", "42", "44"],
    )

    const t5a = applyEssaStandMenuGeoLayout([
        {
            title: "T5 PIER A",
            stands: [
                { name: "04", fit: "allowed", area: false, selectable: true },
                { name: "01", fit: "allowed", area: false, selectable: true },
                { name: "10", fit: "allowed", area: false, selectable: true },
                { name: "03", fit: "allowed", area: false, selectable: true },
            ],
        },
    ])
    assert.deepEqual(
        t5a.find((a) => a.title === "T5A")!.stands.map((s) => s.name),
        ["01", "03", "04", "10"],
    )

    const t5f = applyEssaStandMenuGeoLayout([
        {
            title: "T5 PIER F",
            stands: [
                { name: "F34", fit: "allowed", area: false, selectable: true },
                { name: "F31", fit: "allowed", area: false, selectable: true },
                { name: "F28L", fit: "allowed", area: false, selectable: true },
                { name: "F33", fit: "allowed", area: false, selectable: true },
            ],
        },
    ])
    assert.deepEqual(
        t5f.find((a) => a.title === "T5F")!.stands.map((s) => s.name),
        ["F31", "F33", "F28L", "F34"],
    )

    const remoteF = applyEssaStandMenuGeoLayout([
        {
            title: "APRON F",
            stands: [
                { name: "F44", fit: "allowed", area: false, selectable: true },
                { name: "F40", fit: "allowed", area: false, selectable: true },
                { name: "F42", fit: "allowed", area: false, selectable: true },
            ],
        },
    ])
    assert.deepEqual(
        remoteF.find((a) => a.title === "F")!.stands.map((s) => s.name),
        ["F40", "F42", "F44"],
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

check("departure strip stand without GPS is not Planned", () => {
    // Dep stand on strip is informational — only GPS (or PARK) occupies
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
    assert.equal(s03.occupied, undefined)
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

check("airborne arrival assigned stand is Planned (Inbound)", () => {
    // Inbound with GRP stand — softer Planned; deps freed separately via departure flag
    const menu = buildEssaStandMenu({
        stripId: "EWG8U",
        callsign: "EWG8U",
        origin: "EDDL",
        destination: "ESSA",
        aircraftType: "A320",
        wakeTurbulence: "M",
        traffic: [
            {
                callsign: "FIN1TC",
                stand: "01",
                airborne: true,
                departure: false,
                dims: resolveAircraftDims("A320", "M", "FIN1TC"),
                assigned: true,
            },
        ],
    })
    assert.ok(menu)
    const s01 = menu!.aprons[0]!.stands.find((s) => s.name === "01")!
    assert.equal(s01.occupied?.kind, "assigned")
    assert.equal(s01.occupied?.label, "FIN1TC")
    assert.equal(s01.occupied?.airborne, true)
})

check("airborne departure strip stand is not Planned", () => {
    // SAS246 / SAS491: departed/airborne must not keep gate Planned
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
                departure: true,
                dims: resolveAircraftDims("B744", "H", "BAW791G"),
                assigned: true,
            },
        ],
    })
    assert.ok(menu)
    const s01 = menu!.aprons[0]!.stands.find((s) => s.name === "01")!
    assert.equal(s01.occupied, undefined)
    const s03 = menu!.aprons[0]!.stands.find((s) => s.name === "03")!
    assert.equal(s03.occupied, undefined)
})

check("PUSH still occupies while GPS in polygon (physical, not GS)", () => {
    const menu = buildEssaStandMenu({
        stripId: "EWG5PZ",
        callsign: "EWG5PZ",
        origin: "LKPR",
        destination: "ESSA",
        aircraftType: "A320",
        wakeTurbulence: "M",
        traffic: [
            {
                callsign: "ICE401",
                stand: "01",
                latitude: 59.652132,
                longitude: 17.930388,
                groundstate: "PUSH",
                departure: true,
                dims: resolveAircraftDims("B738", "M", "ICE401"),
                assigned: true,
            },
        ],
    })
    assert.ok(menu)
    const s01 = menu!.aprons[0]!.stands.find((s) => s.name === "01")
    assert.equal(s01?.occupied?.kind, "occupied")
    assert.equal(s01?.occupied?.gsLabel, "PUSH")
})

check("departure strip stand off-stand is not Planned (unlike arrivals)", () => {
    // After leaving footprint, dep stand on strip is informational only
    const menu = buildEssaStandMenu({
        stripId: "EWG5PZ",
        callsign: "EWG5PZ",
        origin: "LKPR",
        destination: "ESSA",
        aircraftType: "A320",
        wakeTurbulence: "M",
        traffic: [
            {
                callsign: "BAW33L",
                stand: "01",
                latitude: 59.66,
                longitude: 17.95,
                groundstate: "PUSH",
                departure: true,
                dims: resolveAircraftDims("B738", "M", "BAW33L"),
                assigned: true,
            },
        ],
    })
    assert.ok(menu)
    const s01 = menu!.aprons[0]!.stands.find((s) => s.name === "01")
    assert.equal(s01?.occupied, undefined)
})

check("arrival assigned stand still Planned when GPS not on stand", () => {
    const menu = buildEssaStandMenu({
        stripId: "EWG5PZ",
        callsign: "EWG5PZ",
        origin: "LKPR",
        destination: "ESSA",
        aircraftType: "A320",
        wakeTurbulence: "M",
        traffic: [
            {
                callsign: "DLH400",
                stand: "01",
                assigned: true,
                departure: false,
                dims: resolveAircraftDims("A320", "M", "DLH400"),
            },
        ],
    })
    assert.ok(menu)
    const s01 = menu!.aprons[0]!.stands.find((s) => s.name === "01")
    assert.equal(s01?.occupied?.kind, "assigned")
    assert.equal(s01?.occupied?.label, "DLH400")
})

check("STUP on stand shows STUP instead of TSAT", () => {
    // Coords are stand 01 polygon (same as BLOCKS occupied fixture)
    const menu = buildEssaStandMenu({
        stripId: "EWG5PZ",
        callsign: "EWG5PZ",
        origin: "LKPR",
        destination: "ESSA",
        aircraftType: "A320",
        wakeTurbulence: "M",
        traffic: [
            {
                callsign: "SAS121",
                stand: "01",
                latitude: 59.652132,
                longitude: 17.930388,
                groundstate: "STUP",
                departure: true,
                tsat: "1200",
                dims: resolveAircraftDims("A320", "M", "SAS121"),
                assigned: true,
            },
        ],
    })
    assert.ok(menu)
    const s01 = menu!.aprons[0]!.stands.find((s) => s.name === "01")
    assert.equal(s01?.occupied?.kind, "occupied")
    assert.equal(s01?.occupied?.gsLabel, "STUP")
    assert.equal(s01?.occupied?.tsat, undefined)
})

check("radar-only (no FPL) still occupies by GPS", () => {
    const menu = buildEssaStandMenu({
        stripId: "EWG5PZ",
        callsign: "EWG5PZ",
        origin: "LKPR",
        destination: "ESSA",
        aircraftType: "A320",
        wakeTurbulence: "M",
        traffic: [
            {
                callsign: "SAS22",
                // no stand assignment / no origin — GPS only
                latitude: 59.652132,
                longitude: 17.930388,
                dims: resolveAircraftDims("A320", "M", "SAS22"),
                assigned: false,
            },
        ],
    })
    assert.ok(menu)
    const s01 = menu!.aprons[0]!.stands.find((s) => s.name === "01")
    assert.equal(s01?.occupied?.kind, "occupied")
    assert.equal(s01?.occupied?.label, "SAS22")
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

check("AUTO picks from highest STANDLIST tier (weighted)", () => {
    const picked = pickEssaAutoStand(
        {
            stripId: "SAS123",
            callsign: "SAS123",
            origin: "EKCH",
            destination: "ESSA",
            aircraftType: "A320",
            wakeTurbulence: "M",
            traffic: [],
        },
        () => 0,
    )
    // T5A @ 100 pts dominates F34 @ 10 — rng 0 → first in weighted walk among 01/03/04
    assert.ok(picked === "01" || picked === "03" || picked === "04")
    assert.equal(picked, "01")
})

check("AUTO weighted random can pick later stand in tier", () => {
    const picked = pickEssaAutoStand(
        {
            stripId: "SAS123",
            callsign: "SAS123",
            origin: "EKCH",
            destination: "ESSA",
            aircraftType: "A320",
            wakeTurbulence: "M",
            traffic: [],
        },
        () => 0.99,
    )
    // Positive STANDLIST weights: 01/03/04 @100 and F34 @10 — high rng → later cand
    assert.ok(picked === "01" || picked === "03" || picked === "04" || picked === "F34")
    assert.notEqual(picked, "01")
})

check("assigned stand blocked by neighbour is flagged", () => {
    // 03 BLOCKS 1,5 — assigned on 03 blocks stand 01
    assert.equal(
        isEssaStandBlocked("01", "SAS123", [
            {
                callsign: "DLH400",
                stand: "03",
                assigned: true,
                departure: false,
                dims: resolveAircraftDims("A333", "H", "DLH400"),
            },
        ]),
        true,
    )
    assert.equal(
        isEssaStandBlocked("01", "SAS123", [
            {
                callsign: "DLH400",
                stand: "F34",
                assigned: true,
                departure: false,
                dims: resolveAircraftDims("A320", "M", "DLH400"),
            },
        ]),
        false,
    )
})

check("AUTO skips occupied preferred and picks another", () => {
    const picked = pickEssaAutoStand(
        {
            stripId: "SAS123",
            callsign: "SAS123",
            origin: "EKCH",
            destination: "ESSA",
            aircraftType: "A320",
            wakeTurbulence: "M",
            traffic: [
                {
                    callsign: "SAS999",
                    stand: "01",
                    latitude: 59.652132,
                    longitude: 17.930388,
                    dims: resolveAircraftDims("A320", "M", "SAS999"),
                    assigned: false,
                    departure: false,
                },
            ],
        },
        () => 0,
    )
    assert.ok(picked === "03" || picked === "04")
})

check("AUTO excludes current stand so re-press changes gate", () => {
    const picked = pickEssaAutoStand(
        {
            stripId: "SAS123",
            callsign: "SAS123",
            origin: "EKCH",
            destination: "ESSA",
            aircraftType: "A320",
            wakeTurbulence: "M",
            currentStand: "01",
            traffic: [],
        },
        () => 0,
    )
    assert.notEqual(picked, "01")
    assert.ok(picked === "03" || picked === "04")
})

check("AUTO skips MANUAL AREA stands", () => {
    const picked = pickEssaAutoStand({
        stripId: "EZY1",
        callsign: "EZY1",
        origin: "EGLL",
        destination: "ESSA",
        aircraftType: "A320",
        wakeTurbulence: "M",
        traffic: [],
    })
    assert.notEqual(picked, "APNH")
    assert.ok(picked)
})

console.log(`\n${passed} passed`)

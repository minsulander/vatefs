/**
 * AFV transceiver XC detection tests (run: npx tsx src/afv-transceivers.test.ts)
 */

import assert from "node:assert/strict"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
    applyTransceiverSnapshot,
    controllerMonitorsFrequency,
    formatFreqMhz,
    __setAfvFrequenciesForTest,
} from "./afv-transceivers.js"
import {
    getAppDepOwnerChain,
    __setAppDepOwnerChainsForTest,
    __setEsePositionForTest,
} from "./ese-airspace.js"
import { resolveAppDepTransfer } from "./essa-next-si.js"
import {
    headingDeltaDeg,
    loadEssaSidPrefs,
    resolveAppDepNextSector,
    resolveMapDelivery,
    resolveOppositeTmaArrSector,
    resolveSlowPrefCflFt,
    tmaSideFromHeading,
} from "./essa-sid-prefs.js"
import { staticConfig } from "./static-config.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

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

console.log("afv / app-dep sector tests")

loadEssaSidPrefs(path.join(__dirname, "..", "..", "data", "essa-sid-prefs.json"))

check("formatFreqMhz from Hz", () => {
    assert.equal(formatFreqMhz(124_105_000), "124.105")
    assert.equal(formatFreqMhz(123.755), "123.755")
})

check("config1 ARS → DEP-W, BABAP → DEP-E", () => {
    assert.equal(
        resolveAppDepNextSector({ configId: "1", route: "ARS N0450F350" }),
        "DEP-W"
    )
    assert.equal(
        resolveAppDepNextSector({ configId: "1", route: "BABAP N0450F350" }),
        "DEP-E"
    )
})

check("config1 slow → per-exit sector (not blanket ARR-W)", () => {
    // slowPrefs: ARS/KOGAV/RESNA → DEP-W; BABAP/TOVRI → DEP-E; PETEV → ARR-W
    assert.equal(
        resolveAppDepNextSector({ configId: "1", route: "ARS", slow: true }),
        "DEP-W"
    )
    assert.equal(
        resolveAppDepNextSector({ configId: "1", route: "BABAP", slow: true }),
        "DEP-E"
    )
    assert.equal(
        resolveAppDepNextSector({ configId: "1", route: "PETEV", slow: true }),
        "ARR-W"
    )
    assert.equal(
        resolveAppDepNextSector({ configId: "1", missedApproach: true }),
        "ARR-E"
    )
})

check("tmaSideFromHeading east/west half-planes", () => {
    assert.equal(tmaSideFromHeading(90), "E")
    assert.equal(tmaSideFromHeading(45), "E")
    assert.equal(tmaSideFromHeading(135), "E")
    assert.equal(tmaSideFromHeading(270), "W")
    assert.equal(tmaSideFromHeading(300), "W")
    assert.equal(tmaSideFromHeading(200), "W")
    assert.equal(tmaSideFromHeading(0), null)
    assert.equal(tmaSideFromHeading(360), null)
    assert.equal(tmaSideFromHeading(180), null)
})

check("headingDeltaDeg shortest arc", () => {
    assert.equal(headingDeltaDeg(90, 90), 0)
    assert.equal(headingDeltaDeg(90, 270), 180)
    assert.equal(headingDeltaDeg(10, 350), 20)
    assert.equal(headingDeltaDeg(0, 90), 90)
})

check("G/A opposite-TMA AHD flips ARR-E ↔ ARR-W only when ≥90° from MAP", () => {
    // Config 1 MAP → ARR-E (H090)
    assert.equal(
        resolveAppDepNextSector({
            configId: "1",
            missedApproach: true,
            arrRwy: "01R",
            assignedHeading: 90,
        }),
        "ARR-E",
    )
    // Small tweak still east of MAP (Δ=30°) — no flip even if... same side
    assert.equal(
        resolveAppDepNextSector({
            configId: "1",
            missedApproach: true,
            arrRwy: "01R",
            assignedHeading: 120,
        }),
        "ARR-E",
    )
    // Opposite half but <90° from MAP? H090 → H160 is Δ=70, east side → no flip
    assert.equal(
        resolveAppDepNextSector({
            configId: "1",
            missedApproach: true,
            arrRwy: "01R",
            assignedHeading: 160,
        }),
        "ARR-E",
    )
    // West half and ≥90° from H090 (Δ=180) → ARR-W
    assert.equal(
        resolveAppDepNextSector({
            configId: "1",
            missedApproach: true,
            arrRwy: "01R",
            assignedHeading: 270,
        }),
        "ARR-W",
    )
    // Exactly 90° and west (H090 → H000 is N ambiguous; H090 → H180 south ambiguous)
    // H090 → H200: Δ=110, west → flip
    assert.equal(
        resolveAppDepNextSector({
            configId: "1",
            missedApproach: true,
            arrRwy: "01R",
            assignedHeading: 200,
        }),
        "ARR-W",
    )
    // Config 3 MAP → ARR-W (H270). East AHD ≥90° → ARR-E
    assert.equal(
        resolveAppDepNextSector({
            configId: "3",
            missedApproach: true,
            arrRwy: "01L",
            assignedHeading: 270,
        }),
        "ARR-W",
    )
    assert.equal(
        resolveAppDepNextSector({
            configId: "3",
            missedApproach: true,
            arrRwy: "01L",
            assignedHeading: 300,
        }),
        "ARR-W",
    )
    assert.equal(
        resolveAppDepNextSector({
            configId: "3",
            missedApproach: true,
            arrRwy: "01L",
            assignedHeading: 90,
        }),
        "ARR-E",
    )
    // 08/26: no flip (parallel-only rule)
    assert.equal(
        resolveOppositeTmaArrSector("ARR-W", 90, "26", 270),
        "ARR-W",
    )
    // No appendix MAP heading → no flip
    assert.equal(
        resolveOppositeTmaArrSector("ARR-E", 270, "01R", undefined),
        "ARR-E",
    )
    // Ambiguous N/S heading: keep base
    assert.equal(
        resolveAppDepNextSector({
            configId: "1",
            missedApproach: true,
            arrRwy: "01R",
            assignedHeading: 180,
        }),
        "ARR-E",
    )
})

check("config1 MAP delivery H090/4000 → ARR-E; config3 H270/4000 → ARR-W", () => {
    const c1 = resolveMapDelivery("1")
    assert.equal(c1.sector, "ARR-E")
    assert.equal(c1.heading, 90)
    assert.equal(c1.altitudeFt, 4000)
    const c3 = resolveMapDelivery("3")
    assert.equal(c3.sector, "ARR-W")
    assert.equal(c3.heading, 270)
    assert.equal(c3.altitudeFt, 4000)
})

check("MAP HDG/CFL: dual-ARR mapByArr for config 1/2", () => {
    const match1 = resolveMapDelivery("1", "01R")
    assert.equal(match1.heading, 90)
    assert.equal(match1.altitudeFt, 4000)
    assert.equal(match1.sector, "ARR-E")

    // Config 1 dual-ARR: 01L → H270/4000 ARR-W
    const other1 = resolveMapDelivery("1", "01L")
    assert.equal(other1.sector, "ARR-W")
    assert.equal(other1.heading, 270)
    assert.equal(other1.altitudeFt, 4000)

    const match2 = resolveMapDelivery("2", "19L")
    assert.equal(match2.heading, 90)
    assert.equal(match2.altitudeFt, 4000)
    assert.equal(match2.sector, "ARR-E")

    // Config 2 dual-ARR: 19R → H270/4000 ARR-W
    const other2 = resolveMapDelivery("2", "19R")
    assert.equal(other2.sector, "ARR-W")
    assert.equal(other2.heading, 270)
    assert.equal(other2.altitudeFt, 4000)
})

check("config2 HAPZI slow exit-specific sectors + BABAP DEP-E", () => {
    assert.equal(
        resolveAppDepNextSector({ configId: "2", route: "KOGAV", slow: true }),
        "ARR-W",
    )
    assert.equal(
        resolveAppDepNextSector({ configId: "2", route: "ARS", slow: true }),
        "DEP-W",
    )
    assert.equal(
        resolveAppDepNextSector({ configId: "2", route: "BABAP", slow: true }),
        "DEP-E",
    )
})

check("config13 slow BABAP/TOVRI → DEP-W; config15C slow CFL prefs", () => {
    assert.equal(
        resolveAppDepNextSector({ configId: "13", route: "BABAP", slow: true }),
        "DEP-W",
    )
    assert.equal(
        resolveAppDepNextSector({ configId: "13", route: "KOGAV", slow: true }),
        "ARR-W",
    )
    assert.equal(
        resolveAppDepNextSector({ configId: "15C", route: "ARS", slow: true }),
        "DEP-W",
    )
    assert.equal(
        resolveAppDepNextSector({ configId: "15C", route: "KOGAV", slow: true }),
        "ARR-W",
    )
    assert.equal(
        resolveAppDepNextSector({ configId: "15C", route: "BABAP", slow: true }),
        "DEP-E",
    )
    assert.equal(resolveSlowPrefCflFt({ configId: "15C", route: "ARS" }), 4000)
    assert.equal(resolveSlowPrefCflFt({ configId: "15C", route: "BABAP" }), 3000)
    assert.equal(resolveSlowPrefCflFt({ configId: "15C", route: "KOGAV" }), 4000)
})

check("config9B/15B slowFollowSid uses normal SID sector", () => {
    assert.equal(
        resolveAppDepNextSector({ configId: "9B", route: "BABAP", slow: true }),
        "DEP-E",
    )
    assert.equal(
        resolveAppDepNextSector({ configId: "15B", route: "ARS", slow: true }),
        "DEP-W",
    )
})

check("OWNER chain DEPW / synthesized DEPE", () => {
    __setAppDepOwnerChainsForTest({
        DW: ["DW", "W", "E", "S9", "S1", "S3", "AA"],
        DE: ["DE", "E", "S9", "S1", "S3", "AA"],
        W: ["W", "E", "S9", "S1", "S3", "AA"],
        E: ["E", "S9", "S1", "S3", "AA"],
    })
    assert.deepEqual(getAppDepOwnerChain("DW").slice(0, 3), ["DW", "W", "E"])
    assert.deepEqual(getAppDepOwnerChain("DE").slice(0, 2), ["DE", "E"])
})

check("AFV monitors frequency", () => {
    __setAfvFrequenciesForTest({
        ESSA_W_APP: ["123.755", "124.105"],
    })
    assert.equal(controllerMonitorsFrequency("ESSA_W_APP", 124.105), true)
    assert.equal(controllerMonitorsFrequency("ESSA_W_APP", 130.33), false)
    assert.equal(controllerMonitorsFrequency("ESSA_E_APP", 124.105), false)
})

check("applyTransceiverSnapshot Hz → MHz", () => {
    applyTransceiverSnapshot([
        {
            callsign: "ESSA_W_APP",
            transceivers: [{ id: 1, frequency: 123_755_000 }, { id: 2, frequency: 124_105_000 }],
        },
    ])
    assert.equal(controllerMonitorsFrequency("ESSA_W_APP", "124.105"), true)
})

check("DW offline + W online + XC → display DW freq, transfer W", () => {
    __setAppDepOwnerChainsForTest({
        DW: ["DW", "W", "E", "S9"],
    })
    __setEsePositionForTest({
        callsign: "ESSA_W_DEP",
        frequency: 124.105,
        si: "DW",
        airport: "ESSA",
        role: "DEP",
    })
    __setEsePositionForTest({
        callsign: "ESSA_W_APP",
        frequency: 123.755,
        si: "W",
        airport: "ESSA",
        role: "APP",
    })
    staticConfig.onlineControllers = new Map([
        [
            "ESSA_W_APP",
            { role: "APP", frequency: 123.755, callsign: "ESSA_W_APP", positionId: "W" },
        ],
    ])
    __setAfvFrequenciesForTest({
        ESSA_W_APP: ["123.755", "124.105"],
    })

    const hit = resolveAppDepTransfer("DEP-W")
    assert.ok(hit)
    assert.equal(hit!.transferCallsign, "ESSA_W_APP")
    assert.equal(hit!.displaySi, "DW")
    assert.equal(hit!.displayFrequency, 124.105)
    assert.equal(hit!.xc, true)
})

check("DW offline + W online without XC → display W freq", () => {
    __setAfvFrequenciesForTest({
        ESSA_W_APP: ["123.755"],
    })
    const hit = resolveAppDepTransfer("DEP-W")
    assert.ok(hit)
    assert.equal(hit!.transferCallsign, "ESSA_W_APP")
    assert.equal(hit!.displaySi, "W")
    assert.equal(hit!.displayFrequency, 123.755)
    assert.equal(hit!.xc, false)
})

check("manual forceIdeal → display DW freq without AFV XC", () => {
    __setAfvFrequenciesForTest({
        ESSA_W_APP: ["123.755"],
    })
    const hit = resolveAppDepTransfer("DEP-W", { forceIdealFrequency: true })
    assert.ok(hit)
    assert.equal(hit!.transferCallsign, "ESSA_W_APP")
    assert.equal(hit!.displaySi, "DW")
    assert.equal(hit!.displayFrequency, 124.105)
    assert.equal(hit!.xc, true)
})

check("APP offline + CTR online without XC → display CTR freq (not ideal DEP)", () => {
    __setAppDepOwnerChainsForTest({
        DW: ["DW", "W", "E", "S9", "AA"],
        W: ["W", "E", "S9", "AA"],
        E: ["E", "S9", "AA"],
    })
    __setEsePositionForTest({
        callsign: "ESSA_W_DEP",
        frequency: 124.105,
        si: "DW",
        airport: "ESSA",
        role: "DEP",
    })
    __setEsePositionForTest({
        callsign: "ESAA_CTR",
        frequency: 118.405,
        si: "AA",
        airport: "ESAA",
        role: "CTR",
    })
    staticConfig.onlineControllers = new Map([
        [
            "ESAA_CTR",
            { role: "CTR", frequency: 118.405, callsign: "ESAA_CTR", positionId: "AA" },
        ],
    ])
    __setAfvFrequenciesForTest({
        ESAA_CTR: ["118.405"],
    })

    const hit = resolveAppDepTransfer("DEP-W")
    assert.ok(hit)
    assert.equal(hit!.transferCallsign, "ESAA_CTR")
    assert.equal(hit!.transferSi, "AA")
    assert.equal(hit!.displaySi, "AA")
    assert.equal(hit!.displayFrequency, 118.405)
    assert.equal(hit!.xc, false)

    // MAP/ARR-E uses the same helper — must not fall back to published APP freq
    const mapHit = resolveAppDepTransfer("ARR-E")
    assert.ok(mapHit)
    assert.equal(mapHit!.transferCallsign, "ESAA_CTR")
    assert.equal(mapHit!.displayFrequency, 118.405)
    assert.equal(mapHit!.xc, false)
})

check("APP offline + CTR online with AFV XC → display ideal DEP freq", () => {
    __setAfvFrequenciesForTest({
        ESAA_CTR: ["118.405", "124.105"],
    })
    const hit = resolveAppDepTransfer("DEP-W")
    assert.ok(hit)
    assert.equal(hit!.transferCallsign, "ESAA_CTR")
    assert.equal(hit!.displaySi, "DW")
    assert.equal(hit!.displayFrequency, 124.105)
    assert.equal(hit!.xc, true)
})

check("APP online prefers APP over CTR further in OWNER chain", () => {
    staticConfig.onlineControllers = new Map([
        [
            "ESSA_E_APP",
            { role: "APP", frequency: 126.655, callsign: "ESSA_E_APP", positionId: "E" },
        ],
        [
            "ESAA_CTR",
            { role: "CTR", frequency: 118.405, callsign: "ESAA_CTR", positionId: "AA" },
        ],
    ])
    __setEsePositionForTest({
        callsign: "ESSA_E_APP",
        frequency: 126.655,
        si: "E",
        airport: "ESSA",
        role: "APP",
    })
    __setAfvFrequenciesForTest({
        ESSA_E_APP: ["126.655"],
        ESAA_CTR: ["118.405"],
    })
    const hit = resolveAppDepTransfer("DEP-W")
    assert.ok(hit)
    assert.equal(hit!.transferCallsign, "ESSA_E_APP")
    assert.equal(hit!.displaySi, "E")
    assert.equal(hit!.displayFrequency, 126.655)
    assert.equal(hit!.xc, false)
})

console.log(`\n${passed} passed`)

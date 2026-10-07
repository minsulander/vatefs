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
import { loadEssaSidPrefs, resolveAppDepNextSector, resolveMapDelivery } from "./essa-sid-prefs.js"
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

check("config1 slow → ARR-W, MAP → ARR-E", () => {
    assert.equal(
        resolveAppDepNextSector({ configId: "1", route: "ARS", slow: true }),
        "ARR-W"
    )
    assert.equal(
        resolveAppDepNextSector({ configId: "1", missedApproach: true }),
        "ARR-E"
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

check("MAP HDG/CFL only when arrRwy matches config ARR", () => {
    const match1 = resolveMapDelivery("1", "01R")
    assert.equal(match1.heading, 90)
    assert.equal(match1.altitudeFt, 4000)
    assert.equal(match1.sector, "ARR-E")

    const other1 = resolveMapDelivery("1", "01L")
    assert.equal(other1.sector, "ARR-E")
    assert.equal(other1.heading, undefined)
    assert.equal(other1.altitudeFt, undefined)

    const match2 = resolveMapDelivery("2", "19L")
    assert.equal(match2.heading, 90)
    assert.equal(match2.altitudeFt, 4000)

    const other2 = resolveMapDelivery("2", "19R")
    assert.equal(other2.heading, undefined)
    assert.equal(other2.altitudeFt, undefined)
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

console.log(`\n${passed} passed`)

/**
 * Quick checks: npx tsx src/icao-airlines.test.ts
 */
import assert from "node:assert/strict"
import { extractRtfFromFplRemarks, getRtfCallsign } from "./icao-airlines.js"

function check(name: string, fn: () => void) {
    try {
        fn()
        console.log(`ok  ${name}`)
    } catch (err) {
        console.error(`FAIL ${name}`)
        throw err
    }
}

check('map variant: CALLSIGN EUS "EUROSCOT" | SCO "…"', () => {
    const rmk =
        'PBN/A1B1 DOF/261022 OPR/S6 PER/C RMK/CALLSIGN EUS "EUROSCOT" | SCO "BRAVEHEART"| SCC "BRAVEHEART CARGO" | VATSIMVA CS=EUROSCOT=EUROSCOT VIRTUAL AIRLINES WEB=CREW.EUROSCOT-VIRTUAL.CO.UK /V/'
    assert.equal(extractRtfFromFplRemarks(rmk, "EUS16UV"), "EUROSCOT")
    assert.equal(extractRtfFromFplRemarks(rmk, "SCO99A"), "BRAVEHEART")
    assert.equal(extractRtfFromFplRemarks(rmk, "SCC1"), "BRAVEHEART CARGO")
    // No callsign → first quoted pair after CALLSIGN
    assert.equal(extractRtfFromFplRemarks(rmk), "EUROSCOT")
    assert.equal(getRtfCallsign("EUS16UV", rmk), "EUROSCOT")
})

check("simple variant: CALLSIGN/TOKEN", () => {
    assert.equal(extractRtfFromFplRemarks("PBN/A1 CALLSIGN/VIKING DOF/260404"), "VIKING")
    assert.equal(getRtfCallsign("EZY123", "CALLSIGN/VIKING"), "VIKING")
})

check('simple variant: CALLSIGN/"QUOTED"', () => {
    assert.equal(extractRtfFromFplRemarks('RMK/CALLSIGN/"BLUESCAN"'), "BLUESCAN")
})

check("simple variant: CALLSIGN IS WORD", () => {
    assert.equal(extractRtfFromFplRemarks("RMK/CALLSIGN IS SCANDINAVIAN"), "SCANDINAVIAN")
})

check("CS= fallback", () => {
    assert.equal(extractRtfFromFplRemarks("RMK/FOO CS=EUROSCOT=BAR"), "EUROSCOT")
})

check("no match", () => {
    assert.equal(extractRtfFromFplRemarks("PBN/A1 DOF/261022"), undefined)
})

console.log("icao-airlines.test.ts: ok")

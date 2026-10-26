/**
 * Display FRUL (Y/Z) from FPL rules + route (run: npx tsx src/flight-rules.test.ts)
 */

import assert from "node:assert/strict"
import { resolveDisplayFlightRules } from "@vatefs/common"

assert.equal(resolveDisplayFlightRules("V", "DCT ABC IFR UL607 DEF"), "Z")
assert.equal(resolveDisplayFlightRules("V", "DCT ABC IFR"), "Z")
assert.equal(resolveDisplayFlightRules("I", "DCT ABC VFR"), "Y")
assert.equal(resolveDisplayFlightRules("I", "DCT ABC VFR SOUTH"), "Y")
assert.equal(resolveDisplayFlightRules("V", "VFR SOUTH DCT ABC"), "V")
assert.equal(resolveDisplayFlightRules("I", "VFR SOUTH DCT ABC"), "I") // leading VFR is not a change
assert.equal(resolveDisplayFlightRules("V", "IFR SOUTH DCT ABC"), "V") // leading IFR is not a change
assert.equal(resolveDisplayFlightRules("I", "VFR·FJUG/ TABUT ARS"), "I") // SID-like, not "VFR "
assert.equal(resolveDisplayFlightRules("V", "N0120F050 DCT ESSA/IFR UL607"), "V") // slash-joined, not "IFR "
assert.equal(resolveDisplayFlightRules("I", "DCT ARS UN867"), "I")
assert.equal(resolveDisplayFlightRules("Y", "DCT ABC"), "Y")
assert.equal(resolveDisplayFlightRules("Z", "DCT ABC"), "Z")
assert.equal(resolveDisplayFlightRules(undefined, "DCT IFR"), "I") // default I; IFR token does not change I
assert.equal(resolveDisplayFlightRules(undefined, "DCT VFR"), "Y")
assert.equal(resolveDisplayFlightRules(undefined, undefined), "I")

console.log("flight-rules: ok")

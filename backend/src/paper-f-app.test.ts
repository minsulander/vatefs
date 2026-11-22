/**
 * Director (P) via ESE _F_APP frequency / SI (run: npx tsx src/paper-f-app.test.ts)
 */
import assert from "node:assert/strict"
import path from "path"
import {
    getEsePositionByFrequency,
    isEseDirectorCallsign,
    loadEseAirspace,
    resolveEsePosition,
} from "./ese-airspace.js"
import { resolvePaperPositionRole } from "./paper-roles.js"

const esDir = path.join(process.env.APPDATA || "", "EuroScope")
loadEseAirspace(esDir, "ESAA")

const byFreq = getEsePositionByFrequency(130.805, "ESPA")
assert.ok(byFreq, "ESPA_F_APP frequency should resolve from ESE")
assert.equal(byFreq!.callsign.toUpperCase(), "ESPA_F_APP")
assert.equal(isEseDirectorCallsign(byFreq!.callsign), true)

assert.equal(
    resolvePaperPositionRole({ callsign: "ESPA_APP", frequency: 130.805, airport: "ESPA" }),
    "P",
    "login ESPA_APP on F_APP freq → P",
)

assert.equal(
    resolvePaperPositionRole({ callsign: "ESPA_APP", positionId: "PAF", airport: "ESPA" }),
    "P",
    "login ESPA_APP with SI PAF → P",
)

const plain = resolveEsePosition({ callsign: "ESPA_APP", airport: "ESPA" })
assert.ok(!plain || !isEseDirectorCallsign(plain.callsign))

console.log("paper-f-app: ok")

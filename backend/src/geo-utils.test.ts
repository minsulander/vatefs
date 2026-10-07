/**
 * Geo / strip-visibility tests (run: npx tsx src/geo-utils.test.ts)
 */

import assert from "node:assert/strict"
import { isWithinStripVisibilityRange } from "./geo-utils.js"

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

// ESGG approx
const ESGG = { latitude: 57.6628, longitude: 12.2798 }
const getAirport = (icao: string) => (icao === "ESGG" ? ESGG : undefined)
const ranges = { radarRangeNm: 25, arrivalRangeNm: 100, arrivalEtaMinutes: 20 }

console.log("geo-utils strip visibility")

check("dep within 25nm", () => {
    assert.equal(
        isWithinStripVisibilityRange(
            { latitude: 57.7, longitude: 12.3, destination: "ESSA" },
            ["ESGG"],
            ranges,
            getAirport
        ),
        true
    )
})

check("arrival within 100nm outside 25nm", () => {
    // ~50nm north of ESGG
    assert.equal(
        isWithinStripVisibilityRange(
            { latitude: 58.5, longitude: 12.3, destination: "ESGG", ete: 45 },
            ["ESGG"],
            ranges,
            getAirport
        ),
        true
    )
})

check("arrival beyond 100nm but ETA ≤ 20", () => {
    assert.equal(
        isWithinStripVisibilityRange(
            { latitude: 60.0, longitude: 12.3, destination: "ESGG", ete: 15 },
            ["ESGG"],
            ranges,
            getAirport
        ),
        true
    )
})

check("arrival beyond 100nm and ETA > 20 → false", () => {
    assert.equal(
        isWithinStripVisibilityRange(
            { latitude: 60.0, longitude: 12.3, destination: "ESGG", ete: 40 },
            ["ESGG"],
            ranges,
            getAirport
        ),
        false
    )
})

check("departure beyond 25nm → false even with short ETE", () => {
    assert.equal(
        isWithinStripVisibilityRange(
            { latitude: 58.5, longitude: 12.3, destination: "ESSA", ete: 5 },
            ["ESGG"],
            ranges,
            getAirport
        ),
        false
    )
})

console.log(`\n${passed} passed`)

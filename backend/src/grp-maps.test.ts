/**
 * GRpluginMaps ACTIVE schedules + AutoAssignDist helpers.
 * Run: npx tsx src/grp-maps.test.ts
 */

import assert from "node:assert/strict"
import {
    _resetGrpMapsForTests,
    _setMapBlocksForTests,
    getActiveMapClosedStands,
    getAutoAssignDistNm,
} from "./grp-maps.js"

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

_resetGrpMapsForTests()

check("default AutoAssignDist is 30 before settings load", () => {
    assert.equal(getAutoAssignDistNm("ESSA"), 30)
})

check("ACTIVE:1 map closes listed stands", () => {
    _setMapBlocksForTests([
        {
            name: "APN BC",
            airport: "ESSA",
            stands: ["11", "13", "52"],
            actives: [{ always: true }],
        },
    ])
    const closed = getActiveMapClosedStands("ESSA", new Date("2026-11-02T12:00:00Z"))
    assert.equal(closed.get("11"), "APN BC")
    assert.equal(closed.get("52"), "APN BC")
    assert.equal(closed.has("99"), false)
})

check("weekdays 0 = continuous from startDate+startTime to endDate+endTime", () => {
    _setMapBlocksForTests([
        {
            name: "STD 52",
            airport: "ESSA",
            stands: ["52"],
            actives: [
                {
                    startDate: "260831",
                    endDate: "261130",
                    weekdays: "0",
                    startHhmm: "0500",
                    endHhmm: "1500",
                },
            ],
        },
    ])
    // Continuous window — still active at 16Z mid-range
    const mid = getActiveMapClosedStands("ESSA", new Date("2026-11-02T16:00:00Z"))
    assert.equal(mid.get("52"), "STD 52")
    const after = getActiveMapClosedStands("ESSA", new Date("2026-12-01T12:00:00Z"))
    assert.equal(after.has("52"), false)
})

check("daily UTC time window when weekdays listed", () => {
    _setMapBlocksForTests([
        {
            name: "STD 52",
            airport: "ESSA",
            stands: ["52"],
            actives: [
                {
                    startDate: "260831",
                    endDate: "261130",
                    weekdays: "1234567",
                    startHhmm: "0500",
                    endHhmm: "1500",
                },
            ],
        },
    ])
    const inside = getActiveMapClosedStands("ESSA", new Date("2026-11-02T10:00:00Z"))
    assert.equal(inside.get("52"), "STD 52")
    const outside = getActiveMapClosedStands("ESSA", new Date("2026-11-02T16:00:00Z"))
    assert.equal(outside.has("52"), false)
})

check("weekday list 1=Mon activates only those days", () => {
    _setMapBlocksForTests([
        {
            name: "APN G",
            airport: "ESSA",
            stands: ["G141"],
            actives: [
                {
                    startDate: "261101",
                    endDate: "261130",
                    weekdays: "1", // Monday only
                    startHhmm: "0600",
                    endHhmm: "1400",
                },
            ],
        },
    ])
    // 2026-11-02 = Monday
    const mon = getActiveMapClosedStands("ESSA", new Date("2026-11-02T10:00:00Z"))
    assert.equal(mon.get("G141"), "APN G")
    // 2026-11-03 = Tuesday
    const tue = getActiveMapClosedStands("ESSA", new Date("2026-11-03T10:00:00Z"))
    assert.equal(tue.has("G141"), false)
})

check("inactive maps do not close stands", () => {
    _setMapBlocksForTests([
        {
            name: "OLD WIP",
            airport: "ESSA",
            stands: ["01"],
            actives: [
                {
                    startDate: "250101",
                    endDate: "250102",
                    weekdays: "0",
                    startHhmm: "0000",
                    endHhmm: "2359",
                },
            ],
        },
    ])
    const closed = getActiveMapClosedStands("ESSA", new Date("2026-11-02T12:00:00Z"))
    assert.equal(closed.size, 0)
})

console.log(`\n${passed} passed`)

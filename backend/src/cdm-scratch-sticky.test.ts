/**
 * ESSA CDM scratch: live CTOT is sticky on ES; SLC is manually removable.
 *
 * Run: npx tsx src/cdm-scratch-sticky.test.ts
 */
import assert from "node:assert/strict"
import { flightStore } from "./flightStore.js"
import { cdmScratchToken } from "./scratchpad.js"
import type { Flight } from "./types.js"

function check(name: string, fn: () => void) {
    try {
        fn()
        console.log(`ok - ${name}`)
    } catch (e) {
        console.error(`FAIL - ${name}`)
        throw e
    }
}

// Mirrors server.ts cdmTokenForFlightScratch (ESSA gating omitted)
flightStore.setCdmScratchTokenProvider((flight) => {
    if (flight.atd) return undefined
    const token = cdmScratchToken(flight)
    const isSlc = token !== undefined && token.startsWith(" ")
    if (!isSlc) {
        flight.slcScratchCleared = undefined
        flight.slcScratchSeen = undefined
        return token
    }
    if (flight.slcScratchCleared) return undefined
    return token
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const store = flightStore as any
const reconcile = (f: Flight, scratch: string): string | undefined =>
    store.reconcileInboundCdmScratch(f, scratch)

function flight(over: Partial<Flight>): Flight {
    return { callsign: `T${Math.random().toString(36).slice(2, 7)}`, ...over } as Flight
}

check("sticky CTOT: removed token is restored with remarks/HP", () => {
    const f = flight({ ctot: "1935", remarks: "URNAV", hp: "Y2" })
    assert.equal(reconcile(f, ".URNAV /Y2"), "1935 .URNAV /Y2")
})

check("sticky CTOT: present token is left alone", () => {
    const f = flight({ ctot: "1935", remarks: "URNAV" })
    assert.equal(reconcile(f, "1935 .URNAV"), undefined)
})

check("sticky CTOT: legacy HH:MM is rewritten to HHMM", () => {
    const f = flight({ ctot: "1935" })
    assert.equal(reconcile(f, "19:35"), "1935")
})

check("sticky CTOT: restores are throttled", () => {
    const f = flight({ ctot: "1935" })
    assert.equal(reconcile(f, ""), "1935")
    assert.equal(reconcile(f, ""), undefined)
})

check("no CTOT: nothing restored", () => {
    const f = flight({ remarks: "URNAV" })
    assert.equal(reconcile(f, ".URNAV"), undefined)
})

check("SLC: removable — latched, never re-added", () => {
    const f = flight({ ctotCancelled: true, remarks: "URNAV" })
    // ES echoes our SLC first
    assert.equal(reconcile(f, " SLC .URNAV"), undefined)
    assert.equal(f.slcScratchSeen, true)
    // Controller removes it
    assert.equal(reconcile(f, ".URNAV"), undefined)
    assert.equal(f.slcScratchCleared, true)
    assert.equal(store.buildScratchForFlight(f), ".URNAV")
})

check("SLC: stale echo before it was ever seen does not latch", () => {
    const f = flight({ ctotCancelled: true })
    assert.equal(reconcile(f, ".URNAV"), undefined)
    assert.equal(f.slcScratchCleared, undefined)
    assert.equal(store.buildScratchForFlight(f), " SLC")
})

check("live CTOT returning resets the SLC latch and resumes sticky", () => {
    const f = flight({ ctotCancelled: true, slcScratchCleared: true })
    f.ctotCancelled = undefined
    f.ctot = "2005"
    assert.equal(store.buildScratchForFlight(f), "2005")
    assert.equal(f.slcScratchCleared, undefined)
    assert.equal(reconcile(f, ""), "2005")
})

check("ATD latched: CTOT/SLC dropped from built scratch; remarks/HP stay", () => {
    const f = flight({ ctot: "1935", remarks: "URNAV", hp: "Y2", atd: "1936" })
    assert.equal(store.buildScratchForFlight(f), ".URNAV /Y2")
    assert.equal(reconcile(f, ".URNAV /Y2"), undefined)
})

console.log("cdm-scratch-sticky: done")

/**
 * ESSA split GND: peer-assume hide, next-SI INBOUND GND, assumed-only TAXIWAY.
 * Run: npx tsx src/essa-gnd-split.test.ts
 */

import assert from "node:assert/strict"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { loadConfig } from "./config-loader.js"
import {
    applyConfig,
    staticConfig,
    setEssaRoles,
    setMyCallsign,
    setMyRole,
    setMyAirports,
} from "./static-config.js"
import { __setGndOwnerChainsForTest } from "./ese-airspace.js"
import {
    amIEssaNextGndHop,
    isEssaGndSplitOnline,
} from "./essa-next-si.js"
import {
    determineSectionForFlight,
    shouldDeleteFlight,
} from "./rules-engine.js"
import type { Flight } from "./types.js"

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

const cfg = loadConfig(path.resolve(__dirname, "../../data/config/essa.yml"))
applyConfig(cfg)
setMyAirports(["ESSA"])

__setGndOwnerChainsForTest({
    GE: ["AGE"],
    GN: ["AGN"],
    GW: ["AGW"],
})

function setSplitGndSession(me: string, peer: string) {
    setMyCallsign(me)
    setMyRole("GND")
    const myLogin = me.includes("_N_") ? "GND-N" : me.includes("_W_") ? "GND-W" : "GND-E"
    setEssaRoles([myLogin], true)
    staticConfig.layoutMode = "essaRoles"
    staticConfig.onlineControllers = new Map([
        [peer, { callsign: peer, frequency: 121.7, role: "GND" }],
    ])
    // Position ids for OWNER chain
    staticConfig.myPositionId = me.includes("_N_") ? "AGN" : me.includes("_W_") ? "AGW" : "AGE"
    const peerSi = peer.includes("_N_") ? "AGN" : peer.includes("_W_") ? "AGW" : "AGE"
    staticConfig.onlineControllers.set(peer, {
        callsign: peer,
        frequency: 121.7,
        role: "GND",
        positionId: peerSi,
    })
}

function setSoloGndSession(me: string) {
    setMyCallsign(me)
    setMyRole("GND")
    setEssaRoles(["GND-E", "GND-N", "GND-W"], true)
    staticConfig.layoutMode = "essaRoles"
    staticConfig.onlineControllers = new Map()
    staticConfig.myPositionId = me.includes("_N_") ? "AGN" : me.includes("_W_") ? "AGW" : "AGE"
}

console.log("essa-gnd-split tests")

check("split gate: N+W online (self inclusive)", () => {
    setSplitGndSession("ESSA_N_GND", "ESSA_W_GND")
    assert.equal(isEssaGndSplitOnline(), true)
})

check("solo GND: not split", () => {
    setSoloGndSession("ESSA_N_GND")
    assert.equal(isEssaGndSplitOnline(), false)
})

check("SAS489: W is next GND hop after N taxi GN→01L", () => {
    setSplitGndSession("ESSA_W_GND", "ESSA_N_GND")
    const flight: Flight = {
        callsign: "SAS489",
        origin: "ESSA",
        destination: "ESGG",
        airborne: false,
        groundstate: "TAXI",
        depRwy: "01L",
        controller: "ESSA_N_GND",
        firstSeen: Date.now(),
        lastUpdate: Date.now(),
    }
    assert.equal(amIEssaNextGndHop(flight, "departure"), true)
})

check("SAS489: N is not next hop for own taxi", () => {
    setSplitGndSession("ESSA_N_GND", "ESSA_W_GND")
    const flight: Flight = {
        callsign: "SAS489",
        origin: "ESSA",
        destination: "ESGG",
        airborne: false,
        groundstate: "TAXI",
        depRwy: "01L",
        controller: "ESSA_N_GND",
        firstSeen: Date.now(),
        lastUpdate: Date.now(),
    }
    assert.equal(amIEssaNextGndHop(flight, "departure"), false)
})

check("Viktor (W): peer N taxi → inbound_gnd (SAS489)", () => {
    setSplitGndSession("ESSA_W_GND", "ESSA_N_GND")
    const flight: Flight = {
        callsign: "SAS489",
        origin: "ESSA",
        destination: "ESGG",
        airborne: false,
        groundstate: "TAXI",
        depRwy: "01L",
        controller: "ESSA_N_GND",
        firstSeen: Date.now(),
        lastUpdate: Date.now(),
    }
    const section = determineSectionForFlight(flight, staticConfig)
    assert.equal(section?.sectionId, "inbound_gnd", section?.ruleId)
})

check("Max (N): own taxi stays taxi_dep when split", () => {
    setSplitGndSession("ESSA_N_GND", "ESSA_W_GND")
    const flight: Flight = {
        callsign: "SAS489",
        origin: "ESSA",
        destination: "ESGG",
        airborne: false,
        groundstate: "TAXI",
        depRwy: "01L",
        controller: "ESSA_N_GND",
        firstSeen: Date.now(),
        lastUpdate: Date.now(),
    }
    const section = determineSectionForFlight(flight, staticConfig)
    assert.equal(section?.sectionId, "taxi_dep", section?.ruleId)
})

check("TAY7RN: peer GND assume → soft-delete from other GND INBOUND TWR", () => {
    setSplitGndSession("ESSA_N_GND", "ESSA_W_GND")
    const flight: Flight = {
        callsign: "TAY7RN",
        origin: "ENGM",
        destination: "ESSA",
        airborne: false,
        groundstate: "ARR",
        controller: "ESSA_W_GND",
        firstSeen: Date.now(),
        lastUpdate: Date.now(),
    }
    const r = shouldDeleteFlight(flight, staticConfig)
    assert.equal(r.shouldDelete, true)
    assert.equal(r.ruleId, "delete_arr_peer_gnd_assumed_split")
})

check("SAS489: after W assumes, gone from Max TAXIWAY (peer delete)", () => {
    setSplitGndSession("ESSA_N_GND", "ESSA_W_GND")
    const flight: Flight = {
        callsign: "SAS489",
        origin: "ESSA",
        destination: "ESGG",
        airborne: false,
        groundstate: "TAXI",
        depRwy: "01L",
        controller: "ESSA_W_GND",
        firstSeen: Date.now(),
        lastUpdate: Date.now(),
    }
    // Max is not next (sequence after W is TWR) → hide
    assert.equal(amIEssaNextGndHop(flight, "departure"), false)
    const r = shouldDeleteFlight(flight, staticConfig)
    assert.equal(r.shouldDelete, true)
    assert.equal(r.ruleId, "delete_dep_peer_gnd_assumed_split")
})

check("solo GND: ownership-blind taxi_dep still matches", () => {
    setSoloGndSession("ESSA_N_GND")
    const flight: Flight = {
        callsign: "SAS489",
        origin: "ESSA",
        destination: "ESGG",
        airborne: false,
        groundstate: "TAXI",
        depRwy: "01L",
        controller: "ESSA_E_GND",
        firstSeen: Date.now(),
        lastUpdate: Date.now(),
    }
    const section = determineSectionForFlight(flight, staticConfig)
    assert.equal(section?.sectionId, "taxi_dep", section?.ruleId)
    const r = shouldDeleteFlight(flight, staticConfig)
    assert.equal(r.shouldDelete, false)
})

check("BLX431: peer PUSH hidden for next GND-W until TAXI", () => {
    // Tim (W) is next SI for Max (N) traffic, but PUSH must not show on PUSH/START
    setSplitGndSession("ESSA_W_GND", "ESSA_N_GND")
    const pushFlight: Flight = {
        callsign: "BLX431",
        origin: "ESSA",
        destination: "ESGG",
        airborne: false,
        groundstate: "PUSH",
        depRwy: "01L",
        clearance: true,
        controller: "ESSA_N_GND",
        firstSeen: Date.now(),
        lastUpdate: Date.now(),
    }
    assert.equal(amIEssaNextGndHop(pushFlight, "departure"), true)
    const hide = shouldDeleteFlight(pushFlight, staticConfig)
    assert.equal(hide.shouldDelete, true)
    assert.equal(hide.ruleId, "delete_dep_peer_gnd_pre_taxi_split")
    // Soft-delete hides the strip; must not land on PUSH/START for the peer
    assert.notEqual(
        determineSectionForFlight(pushFlight, staticConfig)?.sectionId,
        "push_start",
    )

    const taxiFlight: Flight = { ...pushFlight, groundstate: "TAXI" }
    assert.equal(shouldDeleteFlight(taxiFlight, staticConfig).shouldDelete, false)
    const section = determineSectionForFlight(taxiFlight, staticConfig)
    assert.equal(section?.sectionId, "inbound_gnd", section?.ruleId)
})

console.log(`\n${passed} passed`)

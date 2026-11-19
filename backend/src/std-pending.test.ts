/**
 * Printed paper strips land in pending dep/arr and stay there.
 * Run: npx tsx src/std-pending.test.ts
 */
import assert from "node:assert/strict"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { loadConfig } from "./config-loader.js"
import { applyConfig, setMyAirports, setMyCallsign, setMyRole } from "./static-config.js"
import { flightStore } from "./flightStore.js"
import { store } from "./store.js"

const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data/config")

async function check(name: string, fn: () => void | Promise<void>) {
    try {
        await fn()
        console.log(`ok - ${name}`)
    } catch (e) {
        console.error(`FAIL - ${name}`)
        throw e
    }
}

function load(file: string, airports: string[]) {
    store.loadMockData(false)
    flightStore.clear()
    applyConfig(loadConfig(path.join(dataDir, file)))
    setMyAirports(airports)
    setMyCallsign(`${airports[0]}_TWR`)
    setMyRole("TWR")
}

async function main() {
await check("std print drops dep into pending_dep and arr into pending_arr", async () => {
    load("std.yml", ["ESMS"])
    const dep = await flightStore.printStripFromExternal("SAS658", {
        origin: "ESMS",
        destination: "ESSA",
        aircraftType: "B738",
        stripKind: "departure",
    })
    assert.equal(dep?.strip.sectionId, "pending_dep")
    const arr = await flightStore.printStripFromExternal("SAS101", {
        origin: "ENGM",
        destination: "ESMS",
        aircraftType: "B738",
        stripKind: "arrival",
    })
    assert.equal(arr?.strip.sectionId, "pending_arr")
    const flags = flightStore.setBackendFlags("SAS658", { groundstate: "TAXI" })
    assert.equal(flags.strip?.sectionId, "pending_dep")
    assert.equal(flags.sectionChanged, false)
})

await check("esgg print drops dep into pending_dep and arr into inbound", async () => {
    load("esgg.yml", ["ESGG"])
    const dep = await flightStore.printStripFromExternal("SAS123", {
        origin: "ESGG",
        destination: "ESSA",
        aircraftType: "B738",
        stripKind: "departure",
    })
    assert.equal(dep?.strip.sectionId, "pending_dep")
    const arr = await flightStore.printStripFromExternal("SAS456", {
        origin: "ENGM",
        destination: "ESGG",
        aircraftType: "B738",
        stripKind: "arrival",
    })
    assert.equal(arr?.strip.sectionId, "inbound")
    const flags = flightStore.setBackendFlags("SAS123", { groundstate: "TAXI" })
    assert.equal(flags.strip?.sectionId, "pending_dep")
})

await check("created vfr strips use the pending piles", () => {
    load("std.yml", ["ESMS"])
    const dep = flightStore.createSpecialStrip("vfrDep", "SEABC", "C172", "ESMS")
    assert.equal(dep?.strip.sectionId, "pending_dep")
    const arr = flightStore.createSpecialStrip("vfrArr", "SEDEF", "C172", "ESMS")
    assert.equal(arr?.strip.sectionId, "pending_arr")
})
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})

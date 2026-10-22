/**
 * Quick node checks: npx tsx src/airport-meta.test.ts
 */
import { initDb, upsertAirportMeta, getAirportMeta, validateAirportMeta } from "./db.js"
import fs from "fs"
import os from "os"
import path from "path"

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

const bad = validateAirportMeta({})
assert(!bad.ok, "empty body rejected")

const bad2 = validateAirportMeta({ essaSep: { sep: 1 } })
assert(!bad2.ok, "non-string rejected")

const ok = validateAirportMeta({
  essaSep: { sep: "2.5 nm", dlv: "3.5 nm", depGap: "6 nm" },
})
assert(ok.ok, "valid essaSep")
if (!ok.ok) throw new Error("unreachable")

const okCfg = validateAirportMeta({
  essaSep: { sep: "2.5", dlv: "3.5", depGap: "6" },
  essaConfig: "9A",
})
assert(okCfg.ok, "valid essaConfig")
if (!okCfg.ok) throw new Error("unreachable")
assert(okCfg.meta.essaConfig === "9A", "essaConfig kept")

const okOv = validateAirportMeta({
  essaSep: { sep: "2.5", dlv: "3.5", depGap: "6" },
  essaSepOverrides: { sep: "3 nm" },
})
assert(okOv.ok, "valid with essaSepOverrides")
if (!okOv.ok) throw new Error("unreachable")
assert(okOv.meta.essaSepOverrides?.sep === "3 nm", "overrides sep kept")
assert(okOv.meta.essaSepOverrides?.dlv === undefined, "overrides dlv absent")

const badCfg = validateAirportMeta({
  essaSep: { sep: "2.5", dlv: "3.5", depGap: "6" },
  essaConfig: "99",
})
assert(!badCfg.ok, "unknown essaConfig rejected")

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vatefs-meta-"))
initDb(dir)
const row = upsertAirportMeta("live", "ESSA", okCfg.meta, 1157125)
assert(row.meta.essaSep?.sep === "2.5", "upsert sep")
assert(row.meta.essaConfig === "9A", "upsert essaConfig")
assert(row.updatedByCid === 1157125, "cid")
const got = getAirportMeta("live", "ESSA")
assert(got?.meta.essaSep?.dlv === "3.5", "get dlv")
assert(got?.meta.essaConfig === "9A", "get essaConfig")
assert(getAirportMeta("live", "ESGG") == null, "other airport empty")

fs.rmSync(dir, { recursive: true, force: true })
console.log("airport-meta.test.ts: ok")

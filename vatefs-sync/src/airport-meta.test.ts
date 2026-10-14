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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vatefs-meta-"))
initDb(dir)
const row = upsertAirportMeta("live", "ESSA", ok.meta, 1157125)
assert(row.meta.essaSep?.sep === "2.5 nm", "upsert sep")
assert(row.updatedByCid === 1157125, "cid")
const got = getAirportMeta("live", "ESSA")
assert(got?.meta.essaSep?.dlv === "3.5 nm", "get dlv")
assert(getAirportMeta("live", "ESGG") == null, "other airport empty")

fs.rmSync(dir, { recursive: true, force: true })
console.log("airport-meta.test.ts: ok")

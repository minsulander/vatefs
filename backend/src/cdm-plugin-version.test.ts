/**
 * Run: npx tsx src/cdm-plugin-version.test.ts
 */
import assert from "node:assert/strict"
import {
    parseCdmPluginVersion,
    compareCdmPluginVersions,
    cdmPluginVersionAtLeast,
    CDM_MASTER_CLICK_MIN_VERSION,
} from "./cdm-plugin-version.js"

console.log("cdm-plugin-version")

assert.deepEqual(parseCdmPluginVersion("2.31b"), [2, 31, 0])
assert.deepEqual(parseCdmPluginVersion("2.30.2b"), [2, 30, 2])
assert.deepEqual(parseCdmPluginVersion("2.28"), [2, 28, 0])
assert.equal(parseCdmPluginVersion("nope"), null)

assert.equal(compareCdmPluginVersions([2, 31, 0], [2, 30, 2]), 1)
assert.equal(compareCdmPluginVersions([2, 30, 2], [2, 31, 0]), -1)
assert.equal(compareCdmPluginVersions([2, 31, 0], [2, 31, 0]), 0)

assert.ok(cdmPluginVersionAtLeast("2.31b", CDM_MASTER_CLICK_MIN_VERSION))
assert.ok(cdmPluginVersionAtLeast("2.31", CDM_MASTER_CLICK_MIN_VERSION))
assert.ok(cdmPluginVersionAtLeast("2.32"))
assert.ok(!cdmPluginVersionAtLeast("2.30.2b"))
assert.ok(!cdmPluginVersionAtLeast("2.28"))
assert.ok(!cdmPluginVersionAtLeast(undefined))
assert.ok(!cdmPluginVersionAtLeast(""))

console.log("ok")

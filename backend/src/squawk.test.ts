/**
 * Assigned SSR / ASSR helpers — guards against reload re-allocation races.
 */
import { hasValidAssignedSquawk, normalizeAssignedSquawk } from "./flightStore.js"

function assert(cond: boolean, msg: string) {
    if (!cond) throw new Error(msg)
}

assert(normalizeAssignedSquawk("1234") === "1234", "valid octal kept")
assert(normalizeAssignedSquawk("0000") === "", "0000 clears")
assert(normalizeAssignedSquawk("----") === "", "---- clears")
assert(normalizeAssignedSquawk("") === "", "empty clears")
assert(normalizeAssignedSquawk(undefined) === undefined, "undefined ignored")
assert(normalizeAssignedSquawk("9875") === undefined, "non-octal ignored")

assert(hasValidAssignedSquawk("1234") === true, "valid ASSR")
assert(hasValidAssignedSquawk("7701") === true, "valid ASSR high digits")
assert(hasValidAssignedSquawk("0000") === false, "0000 not valid ASSR")
assert(hasValidAssignedSquawk("") === false, "empty not valid ASSR")
assert(hasValidAssignedSquawk(undefined) === false, "undefined not valid ASSR")
assert(hasValidAssignedSquawk("9875") === false, "junk not valid ASSR")

console.log("squawk.test.ts: all assertions passed")

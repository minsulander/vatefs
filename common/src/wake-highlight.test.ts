/**
 * Quick node checks: npx tsx src/wake-highlight.test.ts
 */
import {
    isHeavyAsLeaderAircraftType,
    isThickAtypBorderAircraftType,
    normalizeAircraftTypeDesignator,
} from './wake-highlight.js'

function assert(cond: unknown, msg: string) {
    if (!cond) throw new Error(msg)
}

assert(normalizeAircraftTypeDesignator('b752') === 'B752', 'normalize case')
assert(normalizeAircraftTypeDesignator('B752/M-SDE1FGHIJ1RWXYZ/LB1') === 'B752', 'normalize ICAO field')
assert(normalizeAircraftTypeDesignator('  T204 ') === 'T204', 'normalize trim')

assert(isHeavyAsLeaderAircraftType('B752'), 'B752')
assert(isHeavyAsLeaderAircraftType('B753'), 'B753')
assert(isHeavyAsLeaderAircraftType('B757'), 'B757')
assert(isHeavyAsLeaderAircraftType('B75B'), 'B75B')
assert(isHeavyAsLeaderAircraftType('b752/m-s'), 'B752 with equip')
assert(isHeavyAsLeaderAircraftType('T204'), 'T204')
assert(isHeavyAsLeaderAircraftType('T214'), 'T214')
assert(isHeavyAsLeaderAircraftType('TU204'), 'TU204')
assert(isHeavyAsLeaderAircraftType('TU214'), 'TU214')

assert(!isHeavyAsLeaderAircraftType('B738'), 'not B738')
assert(!isHeavyAsLeaderAircraftType('B748'), 'not B748')
assert(!isHeavyAsLeaderAircraftType('B77W'), 'not B77W')
assert(!isHeavyAsLeaderAircraftType('A320'), 'not A320')
assert(!isHeavyAsLeaderAircraftType('T206'), 'not T206')
assert(!isHeavyAsLeaderAircraftType('TBM9'), 'not TBM9')
assert(!isHeavyAsLeaderAircraftType(''), 'empty')
assert(!isHeavyAsLeaderAircraftType(undefined), 'undefined')

assert(isThickAtypBorderAircraftType('A388'), 'A388 thick')
assert(isThickAtypBorderAircraftType('a380/h'), 'A380 alias thick')
assert(isThickAtypBorderAircraftType('A124'), 'A124 thick')
assert(isThickAtypBorderAircraftType('A225'), 'A225 thick')
assert(isThickAtypBorderAircraftType('B748'), 'B748 thick')
assert(isThickAtypBorderAircraftType('A345'), 'A345 thick')
assert(isThickAtypBorderAircraftType('A346'), 'A346 thick')
assert(isThickAtypBorderAircraftType('B779'), 'B779 thick')
assert(isThickAtypBorderAircraftType('C5'), 'C5 thick')
assert(isThickAtypBorderAircraftType('C5M'), 'C5M thick')
assert(!isThickAtypBorderAircraftType('B752'), 'B752 not thick border')
assert(!isThickAtypBorderAircraftType('B744'), 'B744 not thick border')
assert(!isThickAtypBorderAircraftType('A320'), 'A320 not thick')
assert(!isThickAtypBorderAircraftType(''), 'empty not thick')

console.log('wake-highlight.test.ts: ok')

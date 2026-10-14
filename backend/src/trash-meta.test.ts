/**
 * Trash meta / retention tests (run: npx tsx src/trash-meta.test.ts)
 */

import assert from 'node:assert/strict'
import {
    TRASH_MAX_ENTRIES,
    TRASH_TTL_MS,
    buildTrashMeta,
    pruneTrashMap,
} from './trash-meta.js'

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

console.log('trash-meta')

check('retention constants documented', () => {
    assert.equal(TRASH_MAX_ENTRIES, 100)
    assert.equal(TRASH_TTL_MS, 24 * 60 * 60 * 1000)
})

check('buildTrashMeta manual', () => {
    const m = buildTrashMeta('manual')
    assert.equal(m.reason, 'Manually deleted')
    assert.equal(m.ruleId, 'manual')
    assert.equal(m.ruleName, 'manual')
    assert.equal(m.pilotDisconnected, undefined)
})

check('buildTrashMeta delete_parked', () => {
    const m = buildTrashMeta('delete_parked')
    assert.equal(m.reason, 'Arrival parked')
    assert.equal(m.ruleId, 'delete_parked')
})

check('buildTrashMeta pilot_disconnect', () => {
    const m = buildTrashMeta('pilot_disconnect')
    assert.equal(m.reason, 'Pilot disconnected')
    assert.equal(m.pilotDisconnected, true)
    assert.equal(m.disconnectKind, 'pilot')
})

check('buildTrashMeta beyond range marks radar', () => {
    const m = buildTrashMeta('delete_beyond_range')
    assert.equal(m.disconnectKind, 'radar')
    assert.match(m.reason, /radar/i)
})

check('buildTrashMeta unknown rule fallback', () => {
    const m = buildTrashMeta('delete_custom_xyz')
    assert.equal(m.ruleId, 'delete_custom_xyz')
    assert.match(m.reason, /delete_custom_xyz/)
})

check('buildTrashMeta empty → Removed', () => {
    assert.equal(buildTrashMeta().reason, 'Removed')
    assert.equal(buildTrashMeta(null).reason, 'Removed')
})

check('pruneTrashMap drops expired', () => {
    const now = Date.now()
    const map = new Map([
        ['old', { deletedAt: now - TRASH_TTL_MS - 1000 }],
        ['new', { deletedAt: now - 1000 }],
    ])
    pruneTrashMap(map, now)
    assert.equal(map.has('old'), false)
    assert.equal(map.has('new'), true)
})

check('pruneTrashMap trims to max (newest kept)', () => {
    const now = Date.now()
    const map = new Map<string, { deletedAt: number }>()
    for (let i = 0; i < TRASH_MAX_ENTRIES + 5; i++) {
        map.set(`s${i}`, { deletedAt: now - (TRASH_MAX_ENTRIES + 5 - i) * 1000 })
    }
    pruneTrashMap(map, now)
    assert.equal(map.size, TRASH_MAX_ENTRIES)
    assert.equal(map.has('s0'), false)
    assert.equal(map.has(`s${TRASH_MAX_ENTRIES + 4}`), true)
})

console.log(`\n${passed} passed`)

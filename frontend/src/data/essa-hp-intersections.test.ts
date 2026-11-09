/**
 * HP prefs / GND-split ZH·ZK (run: npx tsx src/data/essa-hp-intersections.test.ts)
 */
import assert from 'node:assert/strict'
import {
  countEssaOnlineGndPositions,
  essaHpPreferencesForStrip,
  isEssaGndSplit,
} from './essa-hp-intersections'

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

console.log('essa-hp-intersections tests')

check('controllers list excluding self → count 1 (not split)', () => {
  // Max is ESSA_N_GND; WS controllers only has Viktor
  const peers = [{ callsign: 'ESSA_W_GND' }]
  assert.equal(countEssaOnlineGndPositions(peers), 1)
  assert.equal(isEssaGndSplit(peers), false)
})

check('explicit gndSplit opts offers ZH/ZK even with one peer in list', () => {
  const prefs = essaHpPreferencesForStrip(
    { runway: '01L', stripType: 'departure' },
    [{ callsign: 'ESSA_W_GND' }],
    { gndSplit: true },
  )
  assert.ok(prefs.includes('ZH'))
  assert.ok(prefs.includes('ZK'))
  assert.ok(prefs.includes('Y2'))
})

check('solo gndSplit false → no ZH/ZK', () => {
  const prefs = essaHpPreferencesForStrip(
    { runway: '01L', stripType: 'departure' },
    [],
    { gndSplit: false },
  )
  assert.equal(prefs.includes('ZH'), false)
  assert.equal(prefs.includes('ZK'), false)
})

check('two peers in list still counts as split without opts', () => {
  const peers = [{ callsign: 'ESSA_W_GND' }, { callsign: 'ESSA_E_GND' }]
  assert.equal(isEssaGndSplit(peers), true)
})

console.log(`\n${passed} passed`)

/**
 * Run: npx tsx src/workspace/roleLabel.test.ts
 */
import assert from 'node:assert/strict'
import { compactEssaRolesLabel, formatEssaRolesLabel } from './roleLabel'

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

console.log('roleLabel compact tests')

check('level 0 keeps full tokens', () => {
  assert.equal(
    compactEssaRolesLabel(['GND-W', 'GND-E', 'TWR-E'], 0),
    'GND-E, GND-W, TWR-E',
  )
})

check('level 1 slash-suffixes partial families', () => {
  assert.equal(
    compactEssaRolesLabel(['GND-E', 'GND-N', 'TWR-W'], 1),
    'GND-E/N, TWR-W',
  )
})

check('level 1 collapses complete families', () => {
  assert.equal(
    compactEssaRolesLabel(['CD', 'GND-E', 'GND-N', 'GND-W', 'TWR-E', 'TWR-W', 'APP'], 1),
    'C, GND, TWR, APP',
  )
})

check('formatEssaRolesLabel still uses menu wording', () => {
  assert.equal(
    formatEssaRolesLabel(['CD', 'GND-E', 'GND-N', 'GND-W', 'TWR-E', 'TWR-W']),
    'CD, GND, TWR',
  )
  assert.equal(
    formatEssaRolesLabel(['GND-E', 'GND-N']),
    'GND-E, GND-N',
  )
})

check('level 2 shortens family letters', () => {
  assert.equal(
    compactEssaRolesLabel(['GND-E', 'GND-W', 'TWR-E'], 2),
    'G-E/W, T-E',
  )
  assert.equal(
    compactEssaRolesLabel(['GND-E', 'GND-N', 'GND-W', 'TWR-E', 'TWR-W'], 2),
    'G, T',
  )
})

check('level 3 tightest', () => {
  assert.equal(
    compactEssaRolesLabel(['CD', 'GND-E', 'GND-N', 'TWR-W', 'APP'], 3),
    'C GE/N TW A',
  )
})

check('each densify level shortens (or equals) prior for long covering set', () => {
  const roles = ['CD', 'GND-E', 'GND-N', 'GND-W', 'TWR-E', 'TWR-W', 'APP']
  const lengths = ([0, 1, 2, 3] as const).map((lvl) => compactEssaRolesLabel(roles, lvl).length)
  assert.ok(lengths[0]! > lengths[1]!, `0→1: ${lengths[0]} → ${lengths[1]}`)
  assert.ok(lengths[1]! > lengths[2]!, `1→2: ${lengths[1]} → ${lengths[2]}`)
  assert.ok(lengths[2]! >= lengths[3]!, `2→3: ${lengths[2]} → ${lengths[3]}`)
})

check('partial covering set also shortens by level', () => {
  const roles = ['GND-E', 'GND-W', 'TWR-E']
  const l0 = compactEssaRolesLabel(roles, 0)
  const l1 = compactEssaRolesLabel(roles, 1)
  const l2 = compactEssaRolesLabel(roles, 2)
  const l3 = compactEssaRolesLabel(roles, 3)
  assert.equal(l0, 'GND-E, GND-W, TWR-E')
  assert.equal(l1, 'GND-E/W, TWR-E')
  assert.equal(l2, 'G-E/W, T-E')
  assert.equal(l3, 'GE/W TE')
  assert.ok(l0.length > l1.length && l1.length > l2.length && l2.length > l3.length)
})

console.log(`${passed} passed`)

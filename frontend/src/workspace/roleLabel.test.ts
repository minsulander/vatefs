/**
 * Run: npx tsx src/workspace/roleLabel.test.ts
 */
import assert from 'node:assert/strict'
import {
  compactEssaRolesLabel,
  compactEsggRolesLabel,
  formatEssaRolesLabel,
} from './roleLabel'

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

check('level 0 shows position suffixes when partial (split)', () => {
  assert.equal(
    compactEssaRolesLabel(['GND-W', 'GND-E', 'TWR-E'], 0),
    'GND-E, GND-W, TWR-E',
  )
  assert.equal(compactEssaRolesLabel(['GND-N'], 0), 'GND-N')
  assert.equal(compactEssaRolesLabel(['TWR-W'], 0), 'TWR-W')
})

check('level 0 collapses full families (solo covering all)', () => {
  assert.equal(
    compactEssaRolesLabel(['CD', 'GND-E', 'GND-N', 'GND-W', 'TWR-E', 'TWR-W', 'APP'], 0),
    'CD, GND, TWR, APP',
  )
})

check('level 1 collapses suffixes to family tokens', () => {
  assert.equal(
    compactEssaRolesLabel(['GND-W', 'GND-E', 'TWR-E'], 1),
    'GND, TWR',
  )
  assert.equal(
    compactEssaRolesLabel(['CD', 'GND-E', 'GND-N', 'GND-W', 'TWR-E', 'TWR-W', 'APP'], 1),
    'CD, GND, TWR, APP',
  )
})

check('level 0→1 shortens when split partial', () => {
  const roles = ['GND-N', 'TWR-W']
  const l0 = compactEssaRolesLabel(roles, 0)
  const l1 = compactEssaRolesLabel(roles, 1)
  assert.equal(l0, 'GND-N, TWR-W')
  assert.equal(l1, 'GND, TWR')
  assert.ok(l0.length > l1.length)
})

check('level 2 single letters', () => {
  assert.equal(
    compactEssaRolesLabel(['CD', 'GND-E', 'GND-N', 'GND-W', 'TWR-E', 'TWR-W', 'APP'], 2),
    'C, G, T, A',
  )
  assert.equal(compactEssaRolesLabel(['GND-E', 'TWR-W'], 2), 'G, T')
})

check('level 3 empty for Roles-only UI', () => {
  assert.equal(
    compactEssaRolesLabel(['CD', 'GND-E', 'GND-N', 'GND-W', 'TWR-E', 'TWR-W'], 3),
    '',
  )
})

check('formatEssaRolesLabel still uses menu wording with partial suffixes', () => {
  assert.equal(
    formatEssaRolesLabel(['CD', 'GND-E', 'GND-N', 'GND-W', 'TWR-E', 'TWR-W']),
    'CD, GND, TWR',
  )
  assert.equal(formatEssaRolesLabel(['GND-E', 'GND-N']), 'GND-E, GND-N')
})

check('ESGG densify ladder', () => {
  assert.equal(compactEsggRolesLabel(['TWR', 'GND', 'CD'], 0), 'CD, GND, TWR')
  assert.equal(compactEsggRolesLabel(['TWR', 'GND', 'CD'], 1), 'CD, GND, TWR')
  assert.equal(compactEsggRolesLabel(['TWR', 'GND', 'CD'], 2), 'C, G, T')
  assert.equal(compactEsggRolesLabel(['TWR', 'GND', 'CD'], 3), '')
})

check('each densify level shortens (or equals) prior for long covering set', () => {
  const roles = ['CD', 'GND-E', 'GND-N', 'GND-W', 'TWR-E', 'TWR-W', 'APP']
  const lengths = ([0, 1, 2, 3] as const).map((lvl) => compactEssaRolesLabel(roles, lvl).length)
  assert.ok(lengths[0]! >= lengths[1]!, `0→1: ${lengths[0]} → ${lengths[1]}`)
  assert.ok(lengths[1]! > lengths[2]!, `1→2: ${lengths[1]} → ${lengths[2]}`)
  assert.ok(lengths[2]! > lengths[3]!, `2→3: ${lengths[2]} → ${lengths[3]}`)
})

console.log(`${passed} passed`)

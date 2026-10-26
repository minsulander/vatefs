/**
 * Run: npx tsx src/essa-rnp.test.ts
 */
import assert from 'node:assert/strict'
import {
    isEssaRnpStar,
    parseEssaRnpOpText,
    isEssaRnpOpTextScratch,
    essaParallelBreakoutPair,
    essaRnpBreakoutRunways,
    normalizeEssaProcText,
    essaRnpCflLabel,
} from './essa-rnp.js'

console.log('essa-rnp')

assert.equal(normalizeEssaProcText('ALJAC·RNP·Y'), 'ALJAC RNP Y')
assert.ok(isEssaRnpStar('ALJAC RNP Y'))
assert.ok(isEssaRnpStar('ALJAC·RNP·Y'))
assert.ok(isEssaRnpStar('INLUX RNP X'))
assert.ok(isEssaRnpStar('RNP Z'))
assert.ok(isEssaRnpStar('RNP'))
assert.ok(!isEssaRnpStar('ELTOK1G'))
assert.ok(!isEssaRnpStar(''))
assert.ok(!isEssaRnpStar(undefined))

assert.deepEqual(parseEssaRnpOpText('RNPX 19R'), {
    detected: true,
    letter: 'X',
    runway: '19R',
})
assert.deepEqual(parseEssaRnpOpText('RNP X 19R'), {
    detected: true,
    letter: 'X',
    runway: '19R',
})
assert.deepEqual(parseEssaRnpOpText('RNP-Y'), { detected: true, letter: 'Y' })
assert.deepEqual(parseEssaRnpOpText('RNP Y RWY 01L'), {
    detected: true,
    letter: 'Y',
    runway: '01L',
})
assert.deepEqual(parseEssaRnpOpText('RQ RNP'), { detected: true, request: true })
assert.deepEqual(parseEssaRnpOpText('REQ RNP'), { detected: true, request: true })
assert.deepEqual(parseEssaRnpOpText('REQUEST RNP'), { detected: true, request: true })
assert.deepEqual(parseEssaRnpOpText('RNP'), { detected: true })
assert.equal(parseEssaRnpOpText('SLOW'), null)
assert.equal(parseEssaRnpOpText('.URNAV'), null)

assert.ok(isEssaRnpOpTextScratch('RNPX 19R'))
assert.ok(isEssaRnpOpTextScratch('.RNP Y'))
assert.ok(!isEssaRnpOpTextScratch('URNAV'))

assert.deepEqual(essaParallelBreakoutPair('01L'), ['01L', '01R'])
assert.deepEqual(essaParallelBreakoutPair('19R'), ['19L', '19R'])
assert.equal(essaParallelBreakoutPair('26'), null)

assert.deepEqual(
    essaRnpBreakoutRunways({ hintRunway: '19R' }),
    ['19L', '19R'],
)
assert.deepEqual(
    essaRnpBreakoutRunways({ configArr: '01R', configDep: '01L' }),
    ['01L', '01R'],
)

assert.equal(essaRnpCflLabel('ALJAC RNP Y', undefined), 'RNPY')
assert.equal(essaRnpCflLabel(undefined, 'RNPX 19R'), 'RNPX')
assert.equal(essaRnpCflLabel('RNP Z', undefined), 'RNPZ')
assert.equal(essaRnpCflLabel('RNP', undefined), 'RNP')
assert.equal(essaRnpCflLabel(undefined, 'RQ RNP'), undefined)
assert.equal(essaRnpCflLabel(undefined, 'REQ RNP'), undefined)
assert.equal(essaRnpCflLabel(undefined, 'REQUEST RNP'), undefined)
assert.equal(essaRnpCflLabel(undefined, 'SLOW'), undefined)

console.log('ok')

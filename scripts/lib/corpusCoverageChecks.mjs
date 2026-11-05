import test from 'node:test'
import assert from 'node:assert/strict'
import { coverageVerdict } from './corpusCoverage.mjs'

test('a full corpus passes', () =>
  assert.equal(coverageVerdict({ expected: 2, scored: ['a', 'b'], skipped: [] }).ok, true))

test('a shortfall is not ok and names what was skipped', () => {
  const v = coverageVerdict({ expected: 2, scored: ['a'], skipped: [{ id: 'b', reason: 'audio absent' }] })
  assert.equal(v.ok, false)
  assert.equal(v.shortfall, 1)
  assert.deepEqual(v.skipped.map(s => s.id), ['b'])
})

test('scoring nothing at all is the loudest failure, never a pass', () =>
  assert.equal(coverageVerdict({ expected: 30, scored: [], skipped: [] }).ok, false))

test('a line-count mismatch is a counted skip, not a thrown report', () => {
  const v = coverageVerdict({ expected: 1, scored: [], skipped: [{ id: 'a', reason: 'annotation line count 18 != sheet 19' }] })
  assert.equal(v.ok, false)
  assert.match(v.skipped[0].reason, /line count/)
})

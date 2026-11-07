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

import { songCoverage, safeSkipReason } from './corpusCoverage.mjs'

test('an errored or UNSCORED attempt is not a scored song', () => {
  const r = songCoverage([{ status: 'UNSCORED', scoredLines: 0 }, { status: 'timeout', scoredLines: 0 }])
  assert.equal(r.scored, false)
  assert.match(r.reason, /statuses: UNSCORED, timeout/)
})
test('a SCORED attempt with lines counts; SCORED with 0 lines does not', () => {
  assert.equal(songCoverage([{ status: 'SCORED', scoredLines: 5 }]).scored, true)
  assert.equal(songCoverage([{ status: 'SCORED', scoredLines: 0 }]).scored, false)
})
test('no attempts is a skip', () => assert.equal(songCoverage([]).scored, false))
test('a JSON parse failure never leaks file contents', () => {
  let err; try { JSON.parse('{"text":"SECRET LYRIC",}') } catch (e) { err = e }
  assert.doesNotMatch(safeSkipReason(err), /SECRET|LYRIC/)
})
test('a count mismatch reason survives sanitising', () =>
  assert.match(safeSkipReason(new Error('annotation line count 18 != sheet 19')), /line count/))

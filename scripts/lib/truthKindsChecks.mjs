import test from 'node:test'
import assert from 'node:assert/strict'
import { TRUTH_KINDS, canScore, canCertify, isKnownKind } from './truthKinds.mjs'

test('every kind that certifies also scores', () => {
  for (const [k, v] of Object.entries(TRUTH_KINDS)) if (v.certifies) assert.equal(v.scores, true, k)
})
test('human-onsets certifies', () => assert.equal(canCertify('human-onsets'), true))
test('corpus-derived onsets certify', () => assert.equal(canCertify('corpus-onsets'), true))
test('lrc-derived scores but never certifies', () => {
  assert.equal(canScore('lrc-derived'), true); assert.equal(canCertify('lrc-derived'), false)
})
test('coarse captions score but never certify', () => {
  assert.equal(canScore('coarse-captions'), true); assert.equal(canCertify('coarse-captions'), false)
})
test('an unverified reference neither scores nor certifies', () => {
  assert.equal(canScore('unverified-lrc'), false); assert.equal(canCertify('unverified-lrc'), false)
  assert.equal(isKnownKind('unverified-lrc'), true)
})
test('an unknown kind is not silently tolerated', () => {
  assert.equal(isKnownKind('invented'), false); assert.equal(canScore('invented'), false); assert.equal(canCertify('invented'), false)
})
test('inherited object keys are not kinds', () => {
  assert.equal(isKnownKind('toString'), false); assert.equal(canScore('constructor'), false)
})
test('the table is frozen', () => assert.equal(Object.isFrozen(TRUTH_KINDS), true))

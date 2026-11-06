import test from 'node:test'
import assert from 'node:assert/strict'
import { annotationViolations } from './annotationShape.mjs'
import { LYRIC_HASH_VERSION } from './lyricHash.mjs'

const h = 'a'.repeat(64)
const ok = kind => ({ kind, lineHashVersion: LYRIC_HASH_VERSION, audioSha256: h, lyricsSha256: h, lines: [{ onset: 1, textHash: h }] })

test('a well-formed annotation of a known kind has no violations', () =>
  assert.deepEqual(annotationViolations(ok('human-onsets')), []))

test('corpus-onsets and lrc-derived are accepted kinds', () => {
  assert.deepEqual(annotationViolations(ok('corpus-onsets')), [])
  assert.deepEqual(annotationViolations(ok('lrc-derived')), [])
})

test('an unknown kind is rejected and named', () => {
  const v = annotationViolations(ok('invented'))
  assert.equal(v.length, 1)
  assert.match(v[0], /unknown kind "invented"/)
})

test('a missing kind is rejected', () => {
  const { kind, ...a } = ok('human-onsets')
  assert.match(annotationViolations(a).join('\n'), /unknown kind/)
})

test('unverified-lrc stays a known kind, not an unknown-kind violation', () =>
  assert.deepEqual(annotationViolations(ok('unverified-lrc')), []))

test('shape violations are still reported alongside kind', () => {
  const v = annotationViolations({ ...ok('human-onsets'), lines: [{ text: 'x', textHash: h }] })
  assert.equal(v.length, 1)
  assert.match(v[0], /carries a text field/)
  assert.match(annotationViolations({ ...ok('human-onsets'), lines: [] })[0], /lines is empty/)
})

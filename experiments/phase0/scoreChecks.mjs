import test from 'node:test'
import assert from 'node:assert/strict'
import { assertAnnotationDescribesSheet } from '../../scripts/lib/syncBenchmark.mjs'
import { hashLyricLine, LYRIC_HASH_VERSION } from '../../scripts/lib/lyricHash.mjs'

const ann = (texts) => ({ lineHashVersion: LYRIC_HASH_VERSION, lines: texts.map((t, i) => ({ textHash: hashLyricLine(t), onset: i + 1 })) })

test('a hashed annotation matching the sheet is accepted', () =>
  assert.doesNotThrow(() => assertAnnotationDescribesSheet(ann(['a', 'b']), ['a', 'b'], 'song')))

test('a re-split sheet is rejected by line count, naming the song', () =>
  assert.throws(() => assertAnnotationDescribesSheet(ann(['a', 'b']), ['a'], 'pjs-medley-01'), /pjs-medley-01/))

test('a changed line is rejected by index, and the message carries no text', () => {
  try { assertAnnotationDescribesSheet(ann(['a', 'b']), ['a', 'CHANGED'], 'song'); assert.fail('should throw') }
  catch (e) { assert.match(e.message, /line 2/); assert.ok(!e.message.includes('CHANGED')) }
})

test('repeated identical lines stay matched by index', () => {
  assert.doesNotThrow(() => assertAnnotationDescribesSheet(ann(['x', 'x']), ['x', 'x'], 'song'))
  assert.throws(() => assertAnnotationDescribesSheet(ann(['x', 'x', 'y']), ['x', 'y', 'x'], 'song'), /line 2/)
})

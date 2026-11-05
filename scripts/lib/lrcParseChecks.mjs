import test from 'node:test'
import assert from 'node:assert/strict'
import { parseLrc } from './lrcParse.mjs'

test('metadata and blank lines are not lyrics', () => {
  const rows = parseLrc('[ar:Someone]\n[by:Someone]\n\n[00:10.00]a\n[00:12.50]b\n')
  assert.equal(rows.length, 2)
  assert.deepEqual(rows.map(r => r.timeSeconds), [10, 12.5])
})

test('timestamps parse to seconds', () =>
  assert.equal(parseLrc('[01:02.30]a\n')[0].timeSeconds, 62.3))

test('out-of-order timestamps are rejected', () =>
  assert.throws(() => parseLrc('[00:20.00]a\n[00:10.00]b\n'), /order/))

test('duplicate timestamps are rejected', () =>
  assert.throws(() => parseLrc('[00:10.00]a\n[00:10.00]b\n'), /duplicate/i))

test('a timestamp with no text is not a lyric line', () =>
  assert.equal(parseLrc('[00:10.00]\n[00:12.00]a\n').length, 1))

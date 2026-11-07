import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeLyricLine, hashLyricLine, LYRIC_HASH_VERSION } from './lyricHash.mjs'

test('full-width and half-width forms normalise together', () =>
  assert.equal(normalizeLyricLine('ＡＢＣ　１２３'), normalizeLyricLine('ABC 123')))

test('punctuation and bracketed annotations are removed', () =>
  assert.equal(normalizeLyricLine('ああ、（コーラス）そうか！'), normalizeLyricLine('ああそうか')))

test('whitespace runs collapse and edges trim', () =>
  assert.equal(normalizeLyricLine('  a　　 b  '), 'a b'))

test('different lines keep different hashes', () =>
  assert.notEqual(hashLyricLine('あおいそら'), hashLyricLine('とおいこえ')))

test('a line that normalises to nothing is still hashable and stable', () =>
  assert.equal(hashLyricLine('（間奏）'), hashLyricLine('')))

test('the version is declared', () => assert.equal(typeof LYRIC_HASH_VERSION, 'string'))

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildAnnotation, assertSafeToWrite, annotationFileToCheck, UNCERTAINTY } from './annotation.mjs'
import { hashLyricLine, LYRIC_HASH_VERSION } from '../../../scripts/lib/lyricHash.mjs'
import { annotationViolations } from '../../../scripts/lib/annotationShape.mjs'

const sha = c => c.repeat(64)
const build = lines => buildAnnotation({ lines, audioSha256: sha('a'), lyricsSha256: sha('b') })

test('a built annotation carries hashes and no text', () => {
  const a = build([{ text: 'a', onset: 1 }, { text: 'b', onset: 3 }])
  assert.equal(a.kind, 'corpus-onsets')
  assert.equal(a.lineHashVersion, LYRIC_HASH_VERSION)
  assert.deepEqual(a.lines.map(l => l.textHash), [hashLyricLine('a'), hashLyricLine('b')])
  assert.ok(a.lines.every(l => !('text' in l)))
  assert.ok(a.lines.every(l => l.excluded === false && Number.isFinite(l.uncertainty)))
})

test('a built annotation passes the CI shape validator', () =>
  assert.deepEqual(annotationViolations(build([{ text: 'a', onset: 1 }])), []))

test('uncertainty follows the onset method: label 0.02 s, energy 0.05 s', () => {
  const a = build([{ text: 'a', onset: 1, method: 'phoneme-label' }, { text: 'b', onset: 2, method: 'energy' }])
  assert.deepEqual(a.lines.map(l => l.uncertainty), [UNCERTAINTY['phoneme-label'], UNCERTAINTY.energy])
  assert.equal(UNCERTAINTY['phoneme-label'], 0.02)
  assert.equal(UNCERTAINTY.energy, 0.05)
})

test('an unknown method is refused rather than given an invented uncertainty', () =>
  assert.throws(() => build([{ text: 'a', onset: 1, method: 'guess' }]), /method/))

test('hashes cover the sheet line as the scorer sees it', () => {
  const a = build([{ text: '  a  ', onset: 1 }])
  assert.equal(a.lines[0].textHash, hashLyricLine('a'))
})

test('a line that would vanish from the sheet is refused, not silently misaligned', () =>
  assert.throws(() => build([{ text: 'a', onset: 1 }, { text: '  ', onset: 2 }]), /sheet/))

test('it refuses to overwrite an annotation that is not corpus-onsets', () =>
  assert.throws(() => assertSafeToWrite({ kind: 'human-onsets' }), /human-onsets/))

test('it refuses a lrc-derived and a kindless existing annotation too', () => {
  assert.throws(() => assertSafeToWrite({ kind: 'lrc-derived' }), /lrc-derived/)
  assert.throws(() => assertSafeToWrite({}), /refusing/)
})

test('it allows replacing a corpus-onsets annotation', () =>
  assert.doesNotThrow(() => assertSafeToWrite({ kind: 'corpus-onsets' })))

test('annotationFileToCheck: absent is writable, human-marked file is refused, unreadable is refused', () => {
  const d = mkdtempSync(join(tmpdir(), 'pjs-ann-'))
  assert.doesNotThrow(() => annotationFileToCheck(join(d, 'none.json')))
  writeFileSync(join(d, 'human.json'), JSON.stringify({ kind: 'human-onsets' }))
  assert.throws(() => annotationFileToCheck(join(d, 'human.json')), /human-onsets/)
  writeFileSync(join(d, 'bad.json'), '{not json')
  assert.throws(() => annotationFileToCheck(join(d, 'bad.json')), /not readable/)
  writeFileSync(join(d, 'ok.json'), JSON.stringify({ kind: 'corpus-onsets' }))
  assert.doesNotThrow(() => annotationFileToCheck(join(d, 'ok.json')))
})

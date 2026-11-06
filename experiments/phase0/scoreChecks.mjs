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

// ---- wiring: score.mjs must turn a mismatch into a visible skip line, never silence ----
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const scorer = resolve(dirname(fileURLToPath(import.meta.url)), 'score.mjs')
const GATE = '**The gate cannot be evaluated from this report.**'
const HEADING = 'Skipped, not scored'

function report(songs) { // songs: [{ id, sheet|null, annotation, audioSha?, lyricsPath? }]
  const dir = mkdtempSync(join(tmpdir(), 'phase0-score-'))
  const entries = songs.map((s) => {
    const annPath = join(dir, `${s.id}.json`)
    writeFileSync(annPath, JSON.stringify({ kind: 'human-onsets', audioSha256: s.annAudio ?? 'A', lyricsSha256: 'L', ...s.annotation }))
    const lyrics = join(dir, `${s.id}.txt`)
    if (s.sheet != null) writeFileSync(lyrics, s.sheet)
    const e = { id: s.id, audioSha256: 'A', lyricsSha256: 'L', reference: { annotationPath: annPath } }
    if (!s.noLyricsPath) e.lyrics = lyrics
    return e
  })
  const manifest = join(dir, 'manifest.json')
  writeFileSync(manifest, JSON.stringify({ songs: entries }))
  const r = spawnSync('node', [scorer, '--manifest', manifest], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  return r.stdout
}
const hashedAnn = (texts) => ({ lineHashVersion: LYRIC_HASH_VERSION, lines: texts.map((t, i) => ({ textHash: hashLyricLine(t), onset: i + 1 })) })
const textAnn = (texts) => ({ lines: texts.map((t, i) => ({ text: t, onset: i + 1 })) })

test('score.mjs: a re-split sheet is a visible skip naming song and line, with no sheet text', () => {
  const out = report([{ id: 'resplit', sheet: 'zqxalpha\nzqxCHANGED\n', annotation: hashedAnn(['zqxalpha', 'zqxbeta']) }])
  assert.ok(out.includes(HEADING))
  assert.match(out, /- resplit: .*line 2/)
  assert.ok(!out.includes('zqx'))
  assert.ok(!out.includes('Error:') && !out.includes('resplit: resplit'))
})

test('score.mjs: a plain-text annotation mismatch never prints either side text', () => {
  const out = report([{ id: 'plain', sheet: 'zqxone\nzqxSHEET\n', annotation: textAnn(['zqxone', 'zqxANN']) }])
  assert.match(out, /- plain: .*line 2/)
  assert.ok(!out.includes('zqx'))
})

test('score.mjs: a missing lyrics file is a visible skip, path withheld', () => {
  const out = report([{ id: 'nosheet', sheet: null, annotation: hashedAnn(['a']) }])
  assert.match(out, /- nosheet: ENOENT/)
  assert.ok(!out.includes(tmpdir()))
})

test('score.mjs: a manifest entry without a lyrics path says so', () => {
  const out = report([{ id: 'nopath', noLyricsPath: true, annotation: hashedAnn(['a']) }])
  assert.match(out, /- nopath: manifest has no lyrics path/)
})

test('score.mjs: a differing audioSha256 is a visible skip naming the hash', () => {
  const out = report([{ id: 'rebuilt', sheet: 'a\n', annAudio: 'OTHER', annotation: hashedAnn(['a']) }])
  assert.match(out, /- rebuilt: annotation audioSha256 differs/)
})

test('score.mjs: when everything is skipped the gate sentence is still printed beside the list', () => {
  const out = report([{ id: 'one', sheet: 'a\nb\n', annotation: hashedAnn(['a']) }])
  assert.ok(out.includes(GATE))
  assert.ok(out.includes(HEADING))
})

test('score.mjs: a matching annotation is not in the skip list', () => {
  const out = report([{ id: 'healthy', sheet: 'a\nb\n', annotation: hashedAnn(['a', 'b']) }])
  assert.ok(!out.includes(HEADING))
  assert.ok(!out.includes('healthy'))
})

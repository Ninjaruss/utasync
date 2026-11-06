import test from 'node:test'
import assert from 'node:assert/strict'
import { scoreRun, requireAccess } from './syncBenchmark.mjs'
import { LYRIC_HASH_VERSION, hashLyricLine } from './lyricHash.mjs'
const song = { id: 'test', split: 'development', audioSha256: 'a', lyricsSha256: 'b' }
const run = { ...song, song: 'test', runId: 'test', workflow: 'AutoAlignFlow', status: 'completed', lines: [{ original: 'line', startTime: 10 }] }
const annotation = { kind: 'human-onsets', status: 'adjudicated', reviewer: 'independent listener', predictionsShown: false, priorPredictionExposure: 'none', audioSha256: 'a', lyricsSha256: 'b', lines: [{ text: 'line', onset: 10, uncertainty: .2 }] }
const score = (r = run, a = annotation) => scoreRun(song, ['line'], r, a)

test('corpus-derived onsets score and can certify in scoreRun', () => {
  const s = score(run, { ...annotation, kind: 'corpus-onsets' })
  assert.equal(s.status, 'SCORED')
  assert.equal(s.scoredLines, 1)
})
test('complete independent marks can pass', () => assert.equal(score().pass, true))
test('no truth is unscored, never a zero-error pass', () => assert.equal(score(run, null).pass, null))
test('missing prediction stays in denominator and fails', () => { const s = score({ ...run, lines: [] }); assert.equal(s.scoredLines, 1); assert.equal(s.missingPredictions, 1); assert.equal(s.pass, false) })
test('absolute offset is never fitted away', () => { const s = score({ ...run, lines: [{ original: 'line', startTime: 14 }] }); assert.equal(s.worstAbsoluteError, 4); assert.equal(s.pass, false) })
test('coarse caption cannot pass precise criterion', () => assert.equal(score(run, { ...annotation, kind: 'coarse-captions' }).pass, null))
test('partial or draft annotations cannot certify a song', () => { assert.equal(score(run, { ...annotation, status: 'draft' }).pass, null); assert.equal(score(run, { ...annotation, lines: [{ text: 'line', onset: null }] }).pass, null) })
test('wrong audio, lyrics or workflow is rejected', () => { for (const change of [{ audioSha256: 'x' }, { lyricsSha256: 'x' }, { workflow: 'node-mirror' }]) assert.throws(() => score({ ...run, ...change })) })
test('failed runtime remains failure, not accuracy result', () => assert.equal(score({ ...run, status: 'timeout' }).status, 'timeout'))
test('heldout access requires deliberate flag', () => { assert.throws(() => requireAccess({ split: 'heldout' })); assert.doesNotThrow(() => requireAccess({ split: 'heldout' }, true)) })

test('extra predicted lines cannot produce a passing song', () => { const s = score({ ...run, lines: [...run.lines, { original: 'phantom', startTime: 20 }] }); assert.equal(s.unexpectedPredictions, 1); assert.equal(s.pass, false) })

test('pre-input-loading failure stays reportable without hashes', () => {
  const s = scoreRun(song, ['line'], { song: song.id, workflow: 'AutoAlignFlow', runId: 'missing-assets', status: 'failed' }, annotation)
  assert.equal(s.status, 'failed'); assert.equal(s.inputVerified, false); assert.equal(s.pass, null)
})
test('worksheet ignores an older file hash resolving after the current selection', async () => {
  const { readFileSync } = await import('node:fs')
  const { runInNewContext } = await import('node:vm')
  const source = readFileSync(new URL('./syncBenchmarkReview.html', import.meta.url), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1]
    .replace('__LYRICS__', '["line"]').replace('__HASH__', '"02"').replace('__LYRIC_HASH__', '"lyrics"')
  const nodes = new Map(); const node = id => { if (!nodes.has(id)) nodes.set(id, { value: '.25', files: [], duration: 100, paused: true, replaceChildren() {} }); return nodes.get(id) }
  let exported, finishOld
  const old = { name: 'old.mp3', arrayBuffer: () => new Promise(resolve => { finishOld = resolve }) }
  const current = { name: 'current.mp3', arrayBuffer: async () => Uint8Array.of(2).buffer }
  runInNewContext(source, { document: { getElementById: node, createElement: () => ({ click() {} }) }, crypto: { subtle: { digest: async (_, data) => data } }, TextEncoder, URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} }, Blob: class { constructor(parts) { exported = JSON.parse(parts[0]) } }, Uint8Array, setTimeout() {} })
  node('file').files = [old]; const oldJob = node('file').onchange()
  node('file').files = [current]; await node('file').onchange()
  finishOld(Uint8Array.of(1).buffer); await oldJob
  await node('save').onclick()
  assert.equal(exported.audioSha256, '02'); assert.equal(exported.audio.filename, 'current.mp3')
})

test('unknown prior prediction exposure cannot certify blind accuracy', () => assert.equal(score(run, { ...annotation, priorPredictionExposure: 'unknown' }).pass, null))

test('hashed annotations score exactly like text ones', () => {
  const hashed = { ...annotation, lineHashVersion: LYRIC_HASH_VERSION, lines: [{ textHash: hashLyricLine('line'), onset: 10, uncertainty: .2 }] }
  assert.equal(score(run, hashed).pass, true)
})

test('repeated identical lines stay matched by index', () => {
  const twoSong = { ...song }
  const texts = ['same', 'same']
  const twoRun = { ...run, lines: [{ original: 'same', startTime: 10 }, { original: 'same', startTime: 40 }] }
  const h = hashLyricLine('same')
  const a = { ...annotation, lineHashVersion: LYRIC_HASH_VERSION, lines: [{ textHash: h, onset: 10, uncertainty: .2 }, { textHash: h, onset: 40, uncertainty: .2 }] }
  const s = scoreRun(twoSong, texts, twoRun, a)
  assert.equal(s.scoredLines, 2)
  assert.equal(s.worstAbsoluteError, 0)
})

test('a stale normalisation version is a loud failure, not a skip', () => {
  const stale = { ...annotation, lineHashVersion: '0', lines: [{ textHash: 'x', onset: 10, uncertainty: .2 }] }
  assert.throws(() => score(run, stale), /lineHashVersion/)
})

test('normalisation differences do not break matching', () => {
  const a = { ...annotation, lineHashVersion: LYRIC_HASH_VERSION, lines: [{ textHash: hashLyricLine('line'), onset: 10, uncertainty: .2 }] }
  assert.equal(scoreRun(song, ['  line、 '], run, a).scoredLines, 1)
})

test('run-side match stays exact even though the annotation side is normalised', () => {
  const a = { ...annotation, lineHashVersion: LYRIC_HASH_VERSION, lines: [{ textHash: hashLyricLine('line'), onset: 10, uncertainty: .2 }] }
  const s = scoreRun(song, ['  line、 '], run, a)
  assert.equal(s.scoredLines, 1) // loose annotation match succeeded
  assert.equal(s.missingPredictions, 1) // exact run match still fails: run echoed 'line', sheet was '  line、 '
})

test('mixing text and hash lines is rejected', () => {
  const mixed = { ...annotation, lineHashVersion: LYRIC_HASH_VERSION, lines: [{ text: 'line', textHash: hashLyricLine('line'), onset: 10, uncertainty: .2 }] }
  assert.throws(() => score(run, mixed))
})

test('lrc-derived truth produces metrics', () => {
  const s = score({ ...run, lines: [{ original: 'line', startTime: 10.4 }] }, { ...annotation, kind: 'lrc-derived' })
  assert.equal(s.status, 'SCORED')
  assert.equal(s.scoredLines, 1)
  assert.ok(Math.abs(s.worstAbsoluteError - 0.4) < 1e-9)
})

test('lrc-derived truth can never certify accuracy', () => {
  const s = score(run, { ...annotation, kind: 'lrc-derived' })
  assert.equal(s.eligibleForAccuracyClaim, false)
  assert.equal(s.pass, null)
})

test('an unverified reference is still refused outright', () =>
  assert.throws(() => score(run, { ...annotation, kind: 'unverified-lrc' })))

test('worksheet exports textHash equal to hashLyricLine, with lineHashVersion and no text', async () => {
  const { readFileSync } = await import('node:fs')
  const { runInNewContext } = await import('node:vm')
  const sheet = ['  line、 ', '\uFF4C\uFF49\uFF4E\uFF45\uFF01 (x) [y]', 'a  b\u3000c']
  const source = readFileSync(new URL('./syncBenchmarkReview.html', import.meta.url), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1]
    .replace('__LYRICS__', JSON.stringify(sheet)).replace('__HASH__', '"02"').replace('__LYRIC_HASH__', '"lyrics"')
  const nodes = new Map(); const node = id => { if (!nodes.has(id)) nodes.set(id, { value: '.25', files: [], duration: 100, paused: true, replaceChildren() {} }); return nodes.get(id) }
  let exported
  runInNewContext(source, { document: { getElementById: node, createElement: () => ({ click() {} }) }, crypto: globalThis.crypto, TextEncoder, URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} }, Blob: class { constructor(parts) { exported = JSON.parse(parts[0]) } }, Uint8Array, setTimeout() {} })
  node('file').files = [{ name: 'a.mp3', arrayBuffer: async () => Uint8Array.of(2).buffer }]; await node('file').onchange()
  await node('save').onclick()
  assert.equal(exported.lineHashVersion, LYRIC_HASH_VERSION)
  assert.deepEqual(exported.lines.map(l => l.textHash), sheet.map(hashLyricLine))
  assert.ok(exported.lines.every(l => !('text' in l)))
})

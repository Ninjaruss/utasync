import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_MANIFEST, loadManifests, manifestPathsFrom, shownPath, withoutManifestFlags } from './manifestArgs.mjs'
import { hash } from './syncBenchmark.mjs'
import { LYRIC_HASH_VERSION, hashLyricLine } from './lyricHash.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

test('no --manifest means the real-song manifest', () => assert.deepEqual(manifestPathsFrom(['inventory']), [DEFAULT_MANIFEST]))

test('--manifest repeats and takes comma lists, in order', () =>
  assert.deepEqual(manifestPathsFrom(['--manifest', 'a.json,b.json', 'x', '--manifest', 'c.json']), ['a.json', 'b.json', 'c.json']))

test('withoutManifestFlags leaves positional arguments where they were', () => {
  assert.deepEqual(withoutManifestFlags(['--manifest', 'a.json', 'score', 'song', '--manifest', 'b.json', 'run.json', '--heldout']), ['score', 'song', 'run.json', '--heldout'])
  assert.deepEqual(withoutManifestFlags(['stage-pilot', '--mix']), ['stage-pilot', '--mix'])
})

test('a path outside the repository is shown without its directory', () => {
  assert.equal(shownPath(repoRoot, 'benchmarks/sync/manifest.json'), 'benchmarks/sync/manifest.json')
  assert.equal(shownPath(repoRoot, '/some/private/dir/m.json'), 'm.json (outside the repository)')
})

function manifests(...lists) {
  const dir = mkdtempSync(join(tmpdir(), 'manifest-args-'))
  return lists.map((songs, i) => { const p = join(dir, `m${i}.json`); writeFileSync(p, JSON.stringify({ target: { n: i, fractionWithinHalfSecond: 0.9, maxErrorSeconds: 2 }, songs })); return p })
}

test('a manifest without a target does not hide a later manifest\'s', () => {
  const dir = mkdtempSync(join(tmpdir(), 'manifest-args-'))
  const a = join(dir, 'a.json'), b = join(dir, 'b.json')
  writeFileSync(a, JSON.stringify({ songs: [] })); writeFileSync(b, JSON.stringify({ target: { n: 9 }, songs: [] }))
  assert.equal(loadManifests(repoRoot, [a, b]).target.n, 9)
})

test('songs from every manifest are merged, and a duplicate id keeps the first and warns', () => {
  const [a, b] = manifests([{ id: 'x', from: 'a' }, { id: 'y' }], [{ id: 'x', from: 'b' }, { id: 'z' }])
  const m = loadManifests(repoRoot, [a, b])
  assert.deepEqual(m.songs.map((s) => s.id), ['x', 'y', 'z'])
  assert.equal(m.songs[0].from, 'a')
  assert.equal(m.target.n, 0, 'target comes from the first manifest that has one')
  assert.equal(m.warnings.length, 1)
  assert.match(m.warnings[0], /^x: duplicate song id in m1\.json \(outside the repository\)/)
})

// ---- wiring: scripts/sync-benchmark.mjs itself reads every manifest it is given ----
// `score` prints and writes nothing, so it can run against absolute temp paths without touching the repo.
const bench = join(repoRoot, 'scripts/sync-benchmark.mjs')
function medley(id) {
  const dir = mkdtempSync(join(tmpdir(), 'pjs-medley-'))
  const audio = join(dir, `${id}.wav`), lyrics = join(dir, `${id}.lyrics.txt`), ann = join(dir, `${id}.json`)
  const sheet = `${id}-one\n${id}-two\n`
  writeFileSync(audio, 'not really audio'); writeFileSync(lyrics, sheet)
  const audioSha256 = hash(Buffer.from('not really audio')), lyricsSha256 = hash(Buffer.from(sheet))
  const texts = sheet.trim().split('\n')
  writeFileSync(ann, JSON.stringify({ kind: 'corpus-onsets', audioSha256, lyricsSha256, lineHashVersion: LYRIC_HASH_VERSION, lines: texts.map((t, i) => ({ textHash: hashLyricLine(t), onset: i + 1, uncertainty: 0.02 })) }))
  const song = { id, split: 'development', audio, lyrics, audioSha256, lyricsSha256, reference: { kind: 'corpus-onsets', annotationPath: ann } }
  const run = join(dir, 'run.json'); writeFileSync(run, JSON.stringify({ song: id, workflow: 'AutoAlignFlow', status: 'completed', audioSha256, lyricsSha256, lines: texts.map((original, i) => ({ original, startTime: i + 1.1 })) }))
  return { song, run }
}
const bench_ = (...args) => spawnSync(process.execPath, [bench, ...args], { cwd: repoRoot, encoding: 'utf8' })

test('sync-benchmark: a medley that only a second --manifest knows is found, flags in any position', () => {
  const { song, run } = medley('pjs-medley-77')
  const [pjs] = manifests([song])
  // Unknown without the flag...
  const without = bench_('score', song.id, run)
  assert.notEqual(without.status, 0)
  assert.match(without.stderr, /Unknown song/)
  // ...found with it, whether the flag leads, trails or sits between the positionals, and on top
  // of the default manifest (a repeated flag, as score.mjs takes).
  for (const args of [
    ['--manifest', DEFAULT_MANIFEST, '--manifest', pjs, 'score', song.id, run],
    ['score', song.id, run, '--manifest', pjs],
    ['score', '--manifest', pjs, song.id, run],
    ['score', song.id, run, '--manifest', `${DEFAULT_MANIFEST},${pjs}`],
  ]) {
    const r = bench_(...args)
    assert.equal(r.status, 0, `${args.join(' ')}\n${r.stderr}`)
    const scored = JSON.parse(r.stdout)
    assert.equal(scored.song, song.id)
    assert.equal(scored.reference, 'corpus-onsets')
    assert.equal(scored.scoredLines, 2)
  }
})

test('sync-benchmark: a duplicate id across manifests is a stderr warning, not a second song', () => {
  const { song, run } = medley('pjs-medley-78')
  const [a, b] = manifests([song], [song])
  const r = bench_('score', song.id, run, '--manifest', a, '--manifest', b)
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stderr, /manifest warning: pjs-medley-78: duplicate song id in m1\.json/)
})

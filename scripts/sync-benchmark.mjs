import { readFileSync, writeFileSync, existsSync, mkdirSync, symlinkSync, rmSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { coverageVerdict, songCoverage, safeSkipReason } from './lib/corpusCoverage.mjs'
import { LYRIC_HASH_VERSION, hashLyricLine } from './lib/lyricHash.mjs'
import { hash, lyricLines, requireAccess, scoreRun } from './lib/syncBenchmark.mjs'
import { canCertify } from './lib/truthKinds.mjs'
import { DEFAULT_MANIFEST, loadManifests, manifestPathsFrom, withoutManifestFlags } from './lib/manifestArgs.mjs'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// --manifest may be repeated or comma-separated, exactly as in experiments/phase0/score.mjs, so the
// PJS medleys (.cache/pjs/manifest.json) can be staged, collected and reported beside the real songs.
// A duplicate song id is reported on stderr and the first manifest listing it wins.
const rawArgs = process.argv.slice(2)
const manifestPaths = manifestPathsFrom(rawArgs)
const { warnings: manifestWarnings, ...manifest } = loadManifests(root, manifestPaths)
// A medley-only invocation has no target of its own; judge it by the real-song manifest's.
manifest.target ??= loadManifests(root, [DEFAULT_MANIFEST]).target
for (const w of manifestWarnings) console.error(`manifest warning: ${w}`)
const [command = 'inventory', id, runPath] = withoutManifestFlags(rawArgs)
const file = p => resolve(root, p)
const save = (p, obj) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(obj, null, 2) + '\n') }
function inputs(song) {
  const audio = file(song.audio), lyrics = file(song.lyrics)
  const audioMatch = existsSync(audio) && hash(readFileSync(audio)) === song.audioSha256
  const lyricsMatch = existsSync(lyrics) && hash(readFileSync(lyrics)) === song.lyricsSha256
  return { audio, lyrics, audioMatch, lyricsMatch }
}
if (command === 'stage-pilot') {
  const songs = manifest.songs.filter(s => s.split === 'development')
  for (const song of songs) execFileSync(process.execPath, [file('scripts/sync-benchmark.mjs'), 'stage', song.id, ...manifestPaths.flatMap(p => ['--manifest', p]), ...(process.argv.includes('--mix') ? ['--mix'] : [])], { cwd: root, stdio: 'inherit' })
  save(file('public/e2e/benchmark/pilot.json'), songs.map(s => s.id))
  console.log('Open /?benchmark=pilot; runs sequentially and stops on timeout or cancellation.')
} else if (command === 'inventory') {
  // The kind alone reads as a verdict: 'human-onsets' looks like certified truth even when the
  // annotation behind it is a single-pass draft. Print whether it actually certifies beside it.
  const certifies = s => {
    const p = file(s.reference.annotationPath ?? '')
    if (!s.reference.annotationPath || !existsSync(p)) return { certifies: false, why: 'no annotation file' }
    if (!canCertify(s.reference.kind)) return { certifies: false, why: `kind ${s.reference.kind} cannot certify (ADR-0006)` }
    let a
    try { a = JSON.parse(readFileSync(p, 'utf8')) } catch (e) { return { certifies: false, why: safeSkipReason(e) } }
    if (a.status !== 'adjudicated') return { certifies: false, why: `status ${JSON.stringify(a.status ?? null)}, not "adjudicated"` }
    return { certifies: true, why: null }
  }
  const songs = manifest.songs.map(s => ({ id: s.id, split: s.split, ...inputs(s), reference: s.reference.kind, referenceCertifies: certifies(s), annotationExists: existsSync(file(s.reference.annotationPath)), baseline: 'not inferred from transcript fixtures' }))
  const report = { generatedAt: new Date().toISOString(), pilotSongs: songs.length, heldoutSongs: songs.filter(s => s.split === 'heldout').length, targetSongs: manifest.targetSongs, representativeClaim: false, songs }
  save(file('.cache/sync-benchmark/inventory.json'), report); console.log(JSON.stringify(report, null, 2))
} else if (command === 'report') {
  const { readdirSync } = await import('node:fs')
  const runsDir = file('.cache/sync-benchmark/runs')
  const runs = existsSync(runsDir) ? readdirSync(runsDir).filter(p => p.endsWith('.json')).flatMap(p => { try { return [JSON.parse(readFileSync(resolve(runsDir, p)))] } catch { console.error(`skipped unreadable run file ${p}`); return [] } }).filter(r => r && typeof r.startedAt === 'string').sort((a, b) => a.startedAt.localeCompare(b.startedAt)) : []
  const unfinishedPath = file('.cache/sync-benchmark/unfinished.json')
  const unfinished = existsSync(unfinishedPath) ? JSON.parse(readFileSync(unfinishedPath)) : []
  const scored = [], skipped = []
  const songs = manifest.songs.map(song => {
    const counted = song.split !== 'heldout'
    let attempts, failure = null
    try {
      const annotationPath = file(song.reference.annotationPath)
      const annotation = existsSync(annotationPath) ? JSON.parse(readFileSync(annotationPath)) : null
      const texts = lyricLines(readFileSync(file(song.lyrics), 'utf8'))
      attempts = runs.filter(r => r.song === song.id).map(run => ({ ...scoreRun(song, texts, run, annotation, manifest.target), isolation: run.isolation, elapsedSeconds: run.elapsedSeconds, error: run.error ?? null }))
    } catch (e) { failure = safeSkipReason(e) }
    if (failure) {
      if (counted) skipped.push({ id: song.id, reason: failure })
      return { id: song.id, split: song.split, status: 'SKIPPED', attempts: [], skipReason: failure }
    }
    const cov = songCoverage(attempts)
    if (counted) { if (cov.scored) scored.push(song.id); else skipped.push({ id: song.id, reason: cov.reason }) }
    return { id: song.id, split: song.split, status: attempts.length ? 'attempted' : unfinished.some(r => r.song === song.id) ? 'INCOMPLETE' : 'NOT_RUN', attempts }
  })
  const coverage = coverageVerdict({ expected: manifest.songs.filter(s => s.split !== 'heldout').length, scored, skipped })
  const report = { generatedAt: new Date().toISOString(), pilotSongs: songs.length, heldoutSongs: manifest.songs.filter(s => s.split === 'heldout').length, representativeClaim: false, coverage, songs }
  save(file('.cache/sync-benchmark/report.json'), report)
  console.log(JSON.stringify(report, null, 2))
  if (!coverage.ok) {
    console.error(`COVERAGE FAILURE: scored ${coverage.scoredCount} of ${coverage.expected} expected songs (shortfall ${coverage.shortfall}). A run that measured nothing is not a pass.`)
    for (const k of coverage.skipped) console.error(`  skipped ${k.id}: ${k.reason}`)
    process.exitCode = 1
  }
} else if (command === 'collect') {
  const log = file('node_modules/.e2e-status.log')
  let count = 0
  const started = new Map(), finished = new Set()
  for (const line of readFileSync(log, 'utf8').split('\n')) {
    let row; try { row = JSON.parse(line.slice(line.indexOf('{'))) } catch { continue }
    if (row.benchmark === 1 && row.status === 'started') started.set(row.runId, row)
    if (row.benchmark === 1 && row.final && row.report?.runId) {
      const run = row.report
      finished.add(run.runId)
      if (!/^[a-zA-Z0-9_-]+$/.test(run.runId)) throw new Error('Invalid run ID')
      const destination = file('.cache/sync-benchmark/runs/' + run.runId + '.json')
      if (!existsSync(destination)) { save(destination, run); count++ }
    }
  }
  save(file('.cache/sync-benchmark/unfinished.json'), [...started.values()].filter(r => !finished.has(r.runId)))
  console.log(`Collected ${count} new complete/failed/timeout records; old runs preserved.`)
} else {
  const song = manifest.songs.find(s => s.id === id)
  if (!song) throw new Error('Unknown song; use inventory')
  requireAccess(song, process.argv.includes('--heldout'))
  const input = inputs(song)
  if (!input.audioMatch || !input.lyricsMatch) throw new Error('Missing or changed inputs; resolve hashes before running')
  const texts = lyricLines(readFileSync(input.lyrics, 'utf8'))
  if (command === 'review') {
    const html = readFileSync(file('scripts/lib/syncBenchmarkReview.html'), 'utf8')
      .replaceAll('__SONG__', song.id).replace('__LYRICS__', JSON.stringify(texts).replaceAll('<', '\\u003c'))
      .replace('__HASH__', JSON.stringify(song.audioSha256)).replace('__LYRIC_HASH__', JSON.stringify(song.lyricsSha256))
    const destination = file('.cache/sync-benchmark/review/' + id + '.html')
    mkdirSync(dirname(destination), { recursive: true }); writeFileSync(destination, html); console.log(destination)
  } else if (command === 'template') {
    const p = file('.cache/sync-benchmark/annotations/' + id + '.json')
    if (existsSync(p)) throw new Error('Template already exists; refusing to overwrite human work')
    save(p, { schemaVersion: 1, kind: 'human-onsets', status: 'draft', reviewer: '', predictionsShown: false, priorPredictionExposure: 'unknown', audioSha256: song.audioSha256, lyricsSha256: song.lyricsSha256, lineHashVersion: LYRIC_HASH_VERSION, convention: 'First audible sung syllable; seconds; null is unscored. Adjudicate independently before changing status.', lines: texts.map(text => ({ textHash: hashLyricLine(text), onset: null, uncertainty: null })) }); console.log(p)
  } else if (command === 'stage') {
    const dest = file('public/e2e/benchmark/' + id); mkdirSync(dest, { recursive: true })
    const audio = resolve(dest, 'audio.mp3'); if (existsSync(audio)) rmSync(audio); symlinkSync(input.audio, audio)
    const isolation = process.argv.includes('--mix') ? false : null
    save(resolve(dest, 'input.json'), { song: id, audioSha256: song.audioSha256, lyricsSha256: song.lyricsSha256, lyricsText: readFileSync(input.lyrics, 'utf8'), isolation, gitRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), workingTreeDiffSha256: hash(execFileSync('git', ['diff', 'HEAD'], { cwd: root })), harnessSha256: hash(readFileSync(file('src/dev/syncBenchmarkHarness.tsx'))), harnessVersion: 1 })
    console.log(`Staged verified inputs (no truth supplied to app). Open /?benchmark=${id} on the local dev server. Settings: ${isolation === false ? 'mix-only' : 'default isolation policy'}.`)
  } else if (command === 'score') {
    if (!runPath) throw new Error('Usage: score <song> <run.json> [--heldout]')
    const annotationPath = file(song.reference.annotationPath)
    const annotation = existsSync(annotationPath) ? JSON.parse(readFileSync(annotationPath)) : null
    console.log(JSON.stringify(scoreRun(song, texts, JSON.parse(readFileSync(file(runPath))), annotation, manifest.target), null, 2))
  } else throw new Error('Commands: stage-pilot [--mix], inventory, review <song>, template <song>, stage <song> [--mix], collect, report, score <song> <run.json>')
}

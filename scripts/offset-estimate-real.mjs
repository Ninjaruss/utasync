/**
 * Validate the global-offset screen on REAL SINGING (plan W1.2 Layer 1).
 *
 * WHY THIS IS THE GATE. `offsetEstimate` decides whether a song's existing timings are
 * consistent with the audio and, if not, by how much they are out. Wiring it to correct
 * already-timed lyrics automatically is the single highest-leverage change left: it applies
 * to the most common path (upload audio -> LRCLIB returns synced lyrics), it needs no Whisper
 * so it works on the Manual tier where the app today offers nothing, and reconciling against a
 * prior measured 8/8 better than aligning from scratch (mean absP90 5.47s -> 1.44s, ledger L12).
 *
 * Its only validation so far is on SYNTHESIZED carriers in Tier A, which have onsets but no
 * words and no instrumentation. That is not enough to mutate a user's stored timings on. This
 * script plants known offsets in real sung audio — the isolated vocal stems and the mixes in
 * `public/e2e/` — and measures whether the screen recovers them.
 *
 * It is DEVELOPER-RUN, not CI: that audio is copyrighted and uncommitted (see the Tier B
 * manifest). Anyone holding the same files reproduces these numbers exactly.
 *
 * Run: npx tsx scripts/offset-estimate-real.mjs
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const FIXTURES = join(root, 'tests/ai-pipeline/fixtures')

const { computeVocalActivity } = await import(pathToFileURL(join(root, 'src/ai-pipeline/vocalActivity.ts')).href)
const { estimateGlobalOffset } = await import(pathToFileURL(join(root, 'src/ai-pipeline/offsetEstimate.ts')).href)
const { parseLrc, matchSheetToLrc } = await import(pathToFileURL(join(root, 'scripts/lib/lrcTruth.mjs')).href)
const { decodeMp3ToMono } = await import(pathToFileURL(join(root, 'scripts/lib/nodeAudio.mjs')).href)

/** Songs with both real audio and an LRC entry, so TRUE line starts are known. */
const CASES = [
  {
    name: 'veil',
    lyrics: 'veil/lyrics.ja.txt',
    truth: 'lrc-truth/veil.json',
    mix: 'veil.mp3',
    stem: 'veil.mp3.vocals44k.f32',
  },
  {
    name: 'stranger-than-heaven',
    lyrics: 'stranger-than-heaven/lyrics.txt',
    truth: 'lrc-truth/stranger-than-heaven.json',
    mix: 'stranger.mp3',
    stem: 'stranger.mp3.vocals44k.f32',
  },
  {
    name: 'guitar-loneliness',
    lyrics: 'guitar-loneliness/lyrics.ja.txt',
    truth: 'lrc-truth/guitar-loneliness.json',
    mix: 'guitar.mp3',
    stem: null,
  },
]

/** Offsets planted in the claimed starts. The C1 contract is 100ms; these bracket it. */
const DELTAS = [0, 0.15, 0.3, 0.5, 0.7]
/** A recovery this close to the planted offset is a pass. */
const TOLERANCE_S = 0.1

const f = (x, w = 6) => (x == null ? '   n/a' : x.toFixed(2).padStart(w))

const cache = new Map()
async function envelope(file, source) {
  const key = `${source}:${file}`
  if (cache.has(key)) return cache.get(key)
  const path = join(root, 'public/e2e', file)
  if (!existsSync(path)) { cache.set(key, null); return null }
  let sig
  if (file.endsWith('.f32')) {
    const buf = readFileSync(path)
    const data = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4))
    sig = computeVocalActivity(data, 44100, { source: 'stem' })
  } else {
    const { data, sampleRate } = await decodeMp3ToMono(path)
    sig = computeVocalActivity(data, sampleRate, { source: 'mix' })
  }
  cache.set(key, sig)
  return sig
}

const rows = []
let anyMissing = false
for (const c of CASES) {
  const lineTexts = readFileSync(join(FIXTURES, c.lyrics), 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)
  const lrc = JSON.parse(readFileSync(join(FIXTURES, c.truth), 'utf8'))
  const truthTime = matchSheetToLrc(lineTexts, parseLrc(lrc.syncedLyrics))
  const trueStarts = truthTime.filter((t) => t != null)
  console.log(`\n=== ${c.name}  (${trueStarts.length} lines with LRC truth)`)
  for (const [label, file, source] of [['stem', c.stem, 'stem'], ['mix', c.mix, 'mix']]) {
    if (!file) continue
    const sig = await envelope(file, source)
    if (!sig) { console.log(`  ${label}: audio not present`); anyMissing = true; continue }
    const durSec = sig.activity.length * sig.hopSec
    for (const delta of DELTAS) {
      const est = estimateGlobalOffset({
        claimedStarts: trueStarts.map((t) => t + delta),
        sig,
        durationSec: durSec,
      })
      // The estimator reports the shift that should be APPLIED to the claimed starts, so a
      // planted +delta must come back as about -delta.
      const expected = -delta
      const err = est ? Math.abs(est.shiftSec - expected) : null
      let verdict
      if (delta === 0) {
        // Nothing to fix: the only correct outcome is a refusal.
        verdict = est === null ? 'REFUSED ✓ (correct: nothing to fix)' : `*** returned ${est.shiftSec}s on already-correct timings ***`
      } else if (est === null) {
        verdict = 'REFUSED (no shift claimed)'
      } else if (err != null && err <= TOLERANCE_S) {
        verdict = `recovered ✓ (err ${err.toFixed(3)}s)`
      } else {
        verdict = `*** WRONG: applied ${est.shiftSec}s, expected ${expected.toFixed(2)}s (err ${err?.toFixed(2)}s) ***`
      }
      rows.push({ name: c.name, label, source, delta, est, err, refused: est === null })
      console.log(`  ${label.padEnd(4)} planted ${delta.toFixed(2)}s → ${f(est?.shiftSec)}s  ${verdict}`)
    }
  }
}

console.log('\n=== SUMMARY')
const withDelta = rows.filter((r) => r.delta > 0)
const recovered = withDelta.filter((r) => !r.refused && (r.err ?? 9) <= TOLERANCE_S)
const wrong = withDelta.filter((r) => !r.refused && (r.err ?? 9) > TOLERANCE_S)
const refused = withDelta.filter((r) => r.refused)
const zeroDelta = rows.filter((r) => r.delta === 0)
const falseAlarm = zeroDelta.filter((r) => !r.refused)
console.log(`  recoverable cases (planted > 0):  ${withDelta.length}`)
console.log(`    recovered within ${TOLERANCE_S * 1000}ms:     ${recovered.length}`)
console.log(`    wrong (returned a bad shift):   ${wrong.length}   <-- these are the dangerous ones`)
console.log(`    refused (declined to guess):    ${refused.length}`)
console.log(`  already-correct cases (planted 0): ${zeroDelta.length}`)
console.log(`    correctly refused:              ${zeroDelta.length - falseAlarm.length}`)
console.log(`    FALSE ALARM (invented a shift): ${falseAlarm.length}   <-- these would move correct lyrics`)
if (anyMissing) console.log('\n  (some audio was absent — numbers cover only what is present)')
for (const r of wrong) console.log(`  WRONG: ${r.name} ${r.label} planted ${r.delta}s → ${r.est?.shiftSec}s`)
for (const r of falseAlarm) console.log(`  FALSE ALARM: ${r.name} ${r.label} → ${r.est?.shiftSec}s`)
console.log('\n  A screen that is wrong or raises false alarms on real singing must NOT be allowed to')
console.log('  mutate stored timings. Refusals are acceptable here; wrong answers are not.')

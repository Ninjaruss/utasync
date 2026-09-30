/**
 * DOES IT LINE UP? — asked of the AUDIO, not of the LRC.
 *
 * Every accuracy number in this project so far compares our line starts against LRCLIB
 * timestamps. That is a fair, sourced, independent truth … for the question "do we agree with
 * another transcription of this song". It cannot answer the question a listener actually has,
 * because the LRC is one more opinion about where a line begins, and where a line begins is
 * partly a convention (first syllable? breath? downbeat?). If human tappers disagree with us by
 * 250ms, that number can mean "we are wrong" or "the two of us define the start differently",
 * and the LRC audit cannot tell those apart — the ledger records this as the reason C1-C4 was
 * left unratified by ear.
 *
 * This instrument breaks that deadlock without an ear, by using the ONE source that is not an
 * opinion: the recording. `src/ai-pipeline/vocalActivity.ts` computes a per-frame onset curve
 * (half-wave-rectified spectral flux) from an isolated vocal stem, which is the app's own
 * trusted DSP. For each claimed line start we take the nearest acoustic onset in the stem and
 * report the signed distance. Then we do the SAME for the LRC's timestamps through the same
 * code.
 *
 *     ours -> audio    vs    LRC -> audio
 *
 * If our distances are no worse than the LRC's, then "we disagree with the LRC" is a statement
 * about the definition of a line start, not about our alignment. If ours are clearly worse, the
 * error is ours and the LRC audit's absolute numbers were right. That is a decision the audio
 * makes, and it is the missing half of every accuracy claim in the ledger.
 *
 * HONEST LIMITS, stated up front rather than discovered later:
 *   - The flux peak lands on the ATTACK, typically a few tens of ms AFTER the true onset, and
 *     frames are quantised by `hopSec`. That lag is a constant bias applied to BOTH columns, so
 *     the comparison is sound while absolute distances carry the caveat.
 *   - "Nearest onset within a window" can pair a line with a neighbouring syllable's onset, which
 *     pulls both columns toward zero by the same amount. The relative reading survives.
 *   - A MIX envelope (`source: 'mix'`) cannot separate vocal onsets from guitars or drums. Where
 *     no stem exists the column is labelled `mix(weak)` and must not be read as an arbiter; only
 *     the ours-vs-LRC comparison on that same weak arbiter means anything.
 *   - The peak floor is a threshold set to an observation, so `--sensitivity` re-runs the key
 *     numbers at three floors. If the conclusion moves with the floor, it is not a conclusion.
 *
 * Run: npx tsx scripts/align-acoustic-onsets.mjs [--sensitivity]
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const FIXTURES = join(root, 'tests/ai-pipeline/fixtures')
const OUT = join(root, '.cache/align-acoustic-onsets.json')

const { refineAlignmentWithPhrases } = await import(pathToFileURL(join(root, 'src/lyrics/phraseAlignment.ts')).href)
const { refineMixedLanguageAlignment } = await import(pathToFileURL(join(root, 'src/ai-pipeline/mixedLanguageAlign.ts')).href)
const { computeVocalActivity } = await import(pathToFileURL(join(root, 'src/ai-pipeline/vocalActivity.ts')).href)
const { decodeMp3ToMono } = await import(pathToFileURL(join(root, 'scripts/lib/nodeAudio.mjs')).href)
const { parseLrc, matchSheetToLrc } = await import(pathToFileURL(join(root, 'scripts/lib/lrcTruth.mjs')).href)

const readLines = (p) => readFileSync(p, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }
const pct = (xs, p) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))] }
const fmt = (x, w = 7) => (x == null ? '    n/a' : x.toFixed(3).padStart(w))
const share = (xs, bound) => (xs.length === 0 ? null : xs.filter((d) => Math.abs(d) <= bound).length / xs.length)

/**
 * One config per song. `stem` is the pre-separated vocal isolate (trustworthy arbiter); when it
 * is absent the mix is used and clearly labelled.
 */
const CONFIGS = [
  {
    name: 'veil',
    lyrics: 'veil/lyrics.ja.txt',
    truth: 'lrc-truth/veil.json',
    lang: 'ja',
    transcript: 'veil/transcript.words.json',
    stem: 'veil.mp3.vocals44k.f32',
    mix: 'veil.mp3',
    note: 'clean: LRC agrees with the audio timeline to -0.02s, and a stem exists',
  },
  {
    name: 'stranger',
    lyrics: 'stranger-than-heaven/lyrics.txt',
    truth: 'lrc-truth/stranger-than-heaven.json',
    lang: 'mixed',
    transcript: 'stranger-than-heaven/transcript.segment.json',
    en: 'stranger-than-heaven/transcript.segment.forced-en.json',
    stem: 'stranger.mp3.vocals44k.f32',
    mix: 'stranger.mp3',
    note: 'LRC is a DIFFERENT TAKE (237s vs 233.6s), so its column is one-sided by construction',
  },
  {
    name: 'guitar',
    lyrics: 'guitar-loneliness/lyrics.ja.txt',
    truth: 'lrc-truth/guitar-loneliness.json',
    lang: 'ja',
    transcript: 'guitar-loneliness/transcript.segment.json',
    mix: 'guitar.mp3',
    note: 'NO stem available — arbiter is the mix, so read ours-vs-LRC only, never the absolute column',
  },
]

const cache = new Map()
function stemSignal(file) {
  const key = `stem:${file}`
  if (cache.has(key)) return cache.get(key)
  const path = join(root, 'public/e2e', file)
  if (!existsSync(path)) { cache.set(key, null); return null }
  const buf = readFileSync(path)
  const data = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4))
  const sig = computeVocalActivity(data, 44100, { source: 'stem' })
  cache.set(key, sig)
  return sig
}
async function mixSignal(file) {
  const key = `mix:${file}`
  if (cache.has(key)) return cache.get(key)
  const path = join(root, 'public/e2e', file)
  if (!existsSync(path)) { cache.set(key, null); return null }
  const { data, sampleRate } = await decodeMp3ToMono(path)
  const sig = computeVocalActivity(data, sampleRate, { source: 'mix' })
  cache.set(key, sig)
  return sig
}

/** Local maxima of the flux curve, thinned so one syllable cannot contribute two peaks. */
function onsetPeaks(sig, floor) {
  const { onset, hopSec } = sig
  const minGap = Math.max(1, Math.round(0.08 / hopSec))
  const frames = []
  for (let f = 1; f < onset.length - 1; f++) {
    if (onset[f] < floor) continue
    if (onset[f] < onset[f - 1] || onset[f] <= onset[f + 1]) continue
    const last = frames[frames.length - 1]
    if (last != null && f - last < minGap) {
      if (onset[f] > onset[last]) frames[frames.length - 1] = f
      continue
    }
    frames.push(f)
  }
  return frames.map((f) => f * hopSec)
}

/**
 * CHANCE LEVEL for the same metric. With ~5 flux peaks per second, "nearest peak within 1s" is
 * satisfied almost everywhere by construction — the first version of this script reported
 * p50 0.042s for the app and 0.063s for the LRC and a verdict that the app beat a human
 * transcription, when the peak spacing alone (0.19s) predicts a p50 of about 0.05s for ANY
 * timestamp, correct or not. That is a saturated metric: it measures the peak density.
 *
 * So every metric here is reported against its own chance level, computed by sampling random
 * times in the same track. A claim only means something when it beats the null it is drawn
 * from. `nullGap` is the ratio (null p50 / observed p50): 1.0 or below means no information.
 */
function chanceLevel(sample, n = 4000, seed = 12345) {
  // Deterministic LCG: this must be reproducible, not merely random.
  let x = seed
  const rand = () => (x = (1103515245 * x + 12345) % 2147483648) / 2147483648
  const deltas = []
  for (let i = 0; i < n; i++) {
    const d = sample(rand())
    if (d != null) deltas.push(d)
  }
  const abs = deltas.map(Math.abs)
  return { n: deltas.length, p50: pct(abs, 0.5), p90: pct(abs, 0.9), within250: share(deltas, 0.25) }
}

/**
 * Where singing actually RESUMES. Flux peaks are ~0.19s apart in sung Japanese (one per mora
 * onset), so they cannot locate a line start; the boundary of a voiced RUN can, because runs are
 * seconds long and their starts are seconds apart. This is the metric with resolution to answer
 * the question, and it applies only to the lines that begin a new sung stretch — a line starting
 * mid-stretch has no boundary to be near and is reported as unjudgeable rather than scored.
 */
function voicedRuns(sig, on = 0.04, off = 0.028, minRunSec = 0.6, bridgeSec = 0.35) {
  const { activity, hopSec } = sig
  const runs = []
  let start = -1
  for (let f = 0; f < activity.length; f++) {
    if (start < 0) {
      if (activity[f] > on) start = f
      continue
    }
    if (activity[f] >= off) continue
    // Close only if the dip lasts: a consonant closure must not split one sung phrase.
    let g = f
    const limit = Math.round(bridgeSec / hopSec)
    while (g < activity.length && activity[g] < on && g - f < limit) g++
    if (g - f >= limit || g >= activity.length) { runs.push([start * hopSec, f * hopSec]); start = -1 }
    else f = g - 1
  }
  if (start >= 0) runs.push([start * hopSec, activity.length * hopSec])
  return runs.filter(([a, b]) => b - a >= minRunSec)
}

/** Signed distance from `t` to the nearest voiced-run START within `windowSec`. */
function toNearestRunStart(runs, t, windowSec) {
  let best = null
  let bestD = Infinity
  for (const [rs] of runs) {
    const d = Math.abs(rs - t)
    if (d < bestD) { bestD = d; best = rs }
  }
  return bestD <= windowSec ? t - best : null
}

/** Signed distance from `t` to the nearest onset peak inside `windowSec`; null when none. */
function toNearestOnset(peaks, t, windowSec) {
  let best = null
  let bestD = Infinity
  for (const p of peaks) {
    const d = Math.abs(p - t)
    if (d < bestD) { bestD = d; best = p }
  }
  return bestD <= windowSec ? t - best : null
}

function summarise(deltas) {
  const abs = deltas.map((d) => Math.abs(d))
  return {
    n: deltas.length,
    signedMedian: median(deltas),
    p50: pct(abs, 0.5),
    p90: pct(abs, 0.9),
    within100: share(deltas, 0.1),
    within250: share(deltas, 0.25),
    within500: share(deltas, 0.5),
  }
}

const WINDOW_SEC = 1.0
const results = []

for (const c of CONFIGS) {
  const lineTexts = readLines(join(FIXTURES, c.lyrics))
  const lrc = JSON.parse(readFileSync(join(FIXTURES, c.truth), 'utf8'))
  const truthTime = matchSheetToLrc(lineTexts, parseLrc(lrc.syncedLyrics))
  const rows = lineTexts.map((original) => ({ original, translation: '', startTime: 0, endTime: 0 }))
  const loadWords = (p) => {
    const raw = JSON.parse(readFileSync(p, 'utf8'))
    const arr = Array.isArray(raw)
      ? raw.map((w) => ({ word: (w.word ?? '').trim(), startTime: w.startTime, endTime: w.endTime }))
      : (raw.chunks ?? []).map((ch) => ({ word: ch.text?.trim(), startTime: ch.timestamp?.[0], endTime: ch.timestamp?.[1] }))
    return arr.filter((w) => w.word && Number.isFinite(w.startTime) && Number.isFinite(w.endTime))
  }
  const ja = loadWords(join(FIXTURES, c.transcript))
  const refined = c.en && existsSync(join(FIXTURES, c.en))
    ? refineMixedLanguageAlignment(rows, ja, loadWords(join(FIXTURES, c.en))).refined
    : refineAlignmentWithPhrases(rows, ja, c.lang)
  const ours = refined.lines.map((l) => l.startTime)

  const sig = c.stem ? stemSignal(c.stem) : null
  const useStem = !!sig
  const usedSig = sig ?? (c.mix ? await mixSignal(c.mix) : null)
  if (!usedSig) { console.log(`\n=== ${c.name}: no audio available (skipped) ===`); continue }

  const onsetValues = Array.from(usedSig.onset).filter((v) => v > 0)
  const p90onset = pct(onsetValues, 0.9)
  const floor = Math.max(0.02, 0.2 * p90onset)
  const peaks = onsetPeaks(usedSig, floor)
  const runs = voicedRuns(usedSig)
  const duration = usedSig.activity.length * usedSig.hopSec
  const arbiter = useStem ? 'stem' : 'mix(weak)'

  const pairs = []
  for (let i = 0; i < lineTexts.length; i++) {
    const t = truthTime[i]
    if (t == null) continue
    const dOurs = toNearestOnset(peaks, ours[i], WINDOW_SEC)
    const dLrc = toNearestOnset(peaks, t, WINDOW_SEC)
    const rOurs = toNearestRunStart(runs, ours[i], WINDOW_SEC)
    const rLrc = toNearestRunStart(runs, t, WINDOW_SEC)
    pairs.push({ i, lrc: t, ours: ours[i], dOurs, dLrc, rOurs, rLrc })
  }
  const both = pairs.filter((p) => p.dOurs != null && p.dLrc != null)
  const sOurs = summarise(both.map((p) => p.dOurs))
  const sLrc = summarise(both.map((p) => p.dLrc))
  const runPairs = pairs.filter((p) => p.rOurs != null && p.rLrc != null)
  const rOurs = summarise(runPairs.map((p) => p.rOurs))
  const rLrc = summarise(runPairs.map((p) => p.rLrc))
  const lrcMinusOurs = pairs.map((p) => p.lrc - p.ours)

  const nullPeak = chanceLevel((u) => toNearestOnset(peaks, u * duration, WINDOW_SEC))
  const nullRun = chanceLevel((u) => toNearestRunStart(runs, u * duration, WINDOW_SEC))

  console.log(`\n=== ${c.name} — arbiter: ${arbiter}, hop=${(usedSig.hopSec * 1000).toFixed(0)}ms, ${peaks.length} flux peaks (floor ${floor.toFixed(3)}), ${runs.length} voiced runs (peak spacing ${(duration / Math.max(1, peaks.length)).toFixed(2)}s, run length p50 ${fmt(median(runs.map(([a, b]) => b - a)), 6)}s) ===`)
  console.log(`    ${c.note}`)
  console.log('                        signedMed     p50     p90    <=100ms  <=250ms  <=500ms')
  const row = (label, s) => console.log(`    ${label.padEnd(18)}${fmt(s.signedMedian)}${fmt(s.p50)}${fmt(s.p90)}   ${s.within100 == null ? 'n/a' : (s.within100 * 100).toFixed(0).padStart(4) + '%'}   ${s.within250 == null ? 'n/a' : (s.within250 * 100).toFixed(0).padStart(4) + '%'}   ${s.within500 == null ? 'n/a' : (s.within500 * 100).toFixed(0).padStart(4) + '%'}`)
  console.log(`    METRIC A — nearest flux peak (${both.length} lines paired)`)
  row('  app -> audio', sOurs)
  row('  LRC -> audio', sLrc)
  row('  CHANCE (any time)', nullPeak)
  console.log(`    METRIC B — nearest voiced-run start (${runPairs.length} of ${pairs.length} lines paired)`)
  row('  app -> audio', rOurs)
  row('  LRC -> audio', rLrc)
  row('  CHANCE (any time)', nullRun)
  console.log(`    app vs LRC (signed): median ${fmt(median(lrcMinusOurs), 6)}s  |.median| ${fmt(median(lrcMinusOurs.map(Math.abs)), 6)}s`)

  const appBeatsA = sOurs.p50 != null && nullPeak.p50 != null && sOurs.p50 < nullPeak.p50 * 0.75
  const lrcBeatsA = sLrc.p50 != null && nullPeak.p50 != null && sLrc.p50 < nullPeak.p50 * 0.75
  const appBeatsB = rOurs.p50 != null && nullRun.p50 != null && rOurs.p50 < nullRun.p50 * 0.75
  const lrcBeatsB = rLrc.p50 != null && nullRun.p50 != null && rLrc.p50 < nullRun.p50 * 0.75
  console.log(`    VERDICT A (flux peak): ${appBeatsA || lrcBeatsA ? `app ${appBeatsA ? 'beats' : 'does NOT beat'} chance, LRC ${lrcBeatsA ? 'beats' : 'does NOT beat'} chance` : 'SATURATED — neither the app nor the LRC beats chance, so this metric answers nothing'}`)
  console.log(`    VERDICT B (voiced runs): ${appBeatsB || lrcBeatsB ? `app ${appBeatsB ? 'beats' : 'does NOT beat'} chance (p50 ${rOurs.p50?.toFixed(3)} vs null ${nullRun.p50?.toFixed(3)}), LRC ${lrcBeatsB ? 'beats' : 'does NOT beat'} chance (p50 ${rLrc.p50?.toFixed(3)})` : `SATURATED — neither beats chance (app ${rOurs.p50?.toFixed(3)}, LRC ${rLrc.p50?.toFixed(3)}, null ${nullRun.p50?.toFixed(3)})`}`)

  results.push({
    config: c.name, arbiter, note: c.note, hopSec: usedSig.hopSec, floor,
    peaks: peaks.length, runs: runs.length, pairedFlux: both.length, pairedRuns: runPairs.length,
    linesWithTruth: pairs.length,
    flux: { app: sOurs, lrc: sLrc, chance: nullPeak, appBeatsChance: appBeatsA, lrcBeatsChance: lrcBeatsA },
    runsMetric: { app: rOurs, lrc: rLrc, chance: nullRun, appBeatsChance: appBeatsB, lrcBeatsChance: lrcBeatsB },
    appVsLrcSignedMedian: median(lrcMinusOurs),
  })
}

// ---- sensitivity: the floor is an observation, so move it --------------------------------
if (process.argv.includes('--sensitivity')) {
  console.log('\n=== FLOOR SENSITIVITY (does the conclusion depend on the threshold?) ===')
  for (const c of CONFIGS) {
    const sig = c.stem ? stemSignal(c.stem) : (c.mix ? await mixSignal(c.mix) : null)
    if (!sig) continue
    const lineTexts = readLines(join(FIXTURES, c.lyrics))
    const lrc = JSON.parse(readFileSync(join(FIXTURES, c.truth), 'utf8'))
    const truthTime = matchSheetToLrc(lineTexts, parseLrc(lrc.syncedLyrics))
    const rows = lineTexts.map((original) => ({ original, translation: '', startTime: 0, endTime: 0 }))
    const loadWords = (p) => {
      const raw = JSON.parse(readFileSync(p, 'utf8'))
      const arr = Array.isArray(raw)
        ? raw.map((w) => ({ word: (w.word ?? '').trim(), startTime: w.startTime, endTime: w.endTime }))
        : (raw.chunks ?? []).map((ch) => ({ word: ch.text?.trim(), startTime: ch.timestamp?.[0], endTime: ch.timestamp?.[1] }))
      return arr.filter((w) => w.word && Number.isFinite(w.startTime) && Number.isFinite(w.endTime))
    }
    const ja = loadWords(join(FIXTURES, c.transcript))
    const refined = c.en && existsSync(join(FIXTURES, c.en))
      ? refineMixedLanguageAlignment(rows, ja, loadWords(join(FIXTURES, c.en))).refined
      : refineAlignmentWithPhrases(rows, ja, c.lang)
    const ours = refined.lines.map((l) => l.startTime)
    const p90onset = pct(Array.from(sig.onset).filter((v) => v > 0), 0.9)
    console.log(`\n  ${c.name}:`)
    for (const mult of [0.1, 0.2, 0.4]) {
      const floor = Math.max(0.02, mult * p90onset)
      const peaks = onsetPeaks(sig, floor)
      const deltas = []
      for (let i = 0; i < lineTexts.length; i++) {
        if (truthTime[i] == null) continue
        const dO = toNearestOnset(peaks, ours[i], WINDOW_SEC)
        const dL = toNearestOnset(peaks, truthTime[i], WINDOW_SEC)
        if (dO != null && dL != null) deltas.push([dO, dL])
      }
      const a = summarise(deltas.map((d) => d[0]))
      const l = summarise(deltas.map((d) => d[1]))
      console.log(`    floor=${floor.toFixed(3)} (${(mult * 100).toFixed(0)}% of p90) peaks=${String(peaks.length).padStart(4)} paired=${String(deltas.length).padStart(3)}  app p50=${a.p50?.toFixed(3)} signed=${a.signedMedian?.toFixed(3)}   LRC p50=${l.p50?.toFixed(3)} signed=${l.signedMedian?.toFixed(3)}  -> app ${a.p50 < l.p50 ? 'closer' : 'further'}`)
    }
  }
}

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify({ windowSec: WINDOW_SEC, results }, null, 1))
console.log(`\nwrote ${OUT}`)

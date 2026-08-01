// scripts/hybrid-align-scorecard.mjs
/**
 * SPIKE (selective anchored CTC refine): does a CTC refiner applied ONLY to
 * untrusted lines, inside windows pinned by trusted anchor lines from the
 * shipped pipeline, beat the current word-mode + mixed-consensus baseline on
 * dense code-switched songs?
 *
 * Prior art: 531e0d3 measured the BLANKET hybrid (all lines, 4-line groups) —
 * mixed result, do not adopt. This is the selective variant that commit's
 * conclusion flagged as the only plausible-but-unvalidated role.
 *
 *   npx tsx scripts/hybrid-align-scorecard.mjs                # baseline table
 *   npx tsx scripts/hybrid-align-scorecard.mjs --selective    # + CTC refine (later task)
 *   npx tsx scripts/hybrid-align-scorecard.mjs --sweep        # pad/policy sweep (later task)
 *   flags: --song <name> --pad <s> --anchors consensus|good|both --debug
 *
 * Never prints lyric text — indices and times only.
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const F = (p) => join(root, p)

const SONGS = [
  {
    name: 'recollect', mixed: true,
    audio: F('public/e2e/recollect.mp3'),
    lyrics: F('tests/ai-pipeline/fixtures/recollect/lyrics.txt'),
    ja: F('tests/ai-pipeline/fixtures/recollect/transcript.word.json'),
    en: F('tests/ai-pipeline/fixtures/recollect/transcript.segment.forced-en.json'),
    truth: F('tests/ai-pipeline/fixtures/lrc-truth/recollect.json'),
  },
  {
    name: 'stranger-than-heaven', mixed: true,
    audio: F('public/e2e/stranger.mp3'),
    lyrics: F('tests/ai-pipeline/fixtures/stranger-than-heaven/lyrics.txt'),
    ja: F('tests/ai-pipeline/fixtures/stranger-than-heaven/transcript.word.json'),
    en: F('tests/ai-pipeline/fixtures/stranger-than-heaven/transcript.segment.forced-en.json'),
    truth: F('tests/ai-pipeline/fixtures/lrc-truth/stranger-than-heaven.json'),
  },
  {
    name: 'guitar-loneliness', mixed: false,
    audio: F('public/e2e/guitar.mp3'),
    lyrics: F('tests/ai-pipeline/fixtures/guitar-loneliness/lyrics.ja.txt'),
    ja: F('tests/ai-pipeline/fixtures/guitar-loneliness/transcript.word.json'),
    truth: F('tests/ai-pipeline/fixtures/lrc-truth/guitar-loneliness.json'),
  },
  {
    name: 'veil', mixed: false,
    audio: F('public/e2e/veil.mp3'),
    lyrics: F('tests/ai-pipeline/fixtures/veil/lyrics.ja.txt'),
    ja: F('tests/ai-pipeline/fixtures/veil/transcript.words.json'),
    truth: F('tests/ai-pipeline/fixtures/lrc-truth/veil.json'),
  },
  {
    name: 'going-my-way', mixed: false,
    audio: F('public/e2e/going-my-way.mp3'),
    lyrics: F('tests/ai-pipeline/fixtures/going-my-way/lyrics.txt'),
    ja: null, // no committed transcript — skipped in baseline mode (CTC-only guard later)
    truth: F('tests/ai-pipeline/fixtures/lrc-truth/going-my-way.json'),
  },
]

/** Word array or {chunks:[{text,timestamp}]} — mirrors forced-align-scorecard. */
function loadTranscriptWords(path) {
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  if (Array.isArray(raw)) {
    return raw.flatMap((w) => {
      const word = (w.word ?? '').trim()
      if (!word || !Number.isFinite(w.startTime) || !Number.isFinite(w.endTime)) return []
      return [{ word, startTime: w.startTime, endTime: w.endTime }]
    })
  }
  return (raw.chunks ?? []).flatMap((c) => {
    const [start, end] = c.timestamp ?? []
    const word = c.text?.trim()
    if (!word || !Number.isFinite(start) || !Number.isFinite(end)) return []
    return [{ word, startTime: start, endTime: end }]
  })
}

const { refineAlignmentWithPhrases } = await import(pathToFileURL(F('src/lyrics/phraseAlignment.ts')).href)
const { refineMixedLanguageAlignment, consensusAgreedLines } = await import(pathToFileURL(F('src/ai-pipeline/mixedLanguageAlign.ts')).href)
const { detectSheetLanguage } = await import(pathToFileURL(F('src/ai-pipeline/whisperLanguage.ts')).href)
const { parseLrc, matchSheetToLrc } = await import(pathToFileURL(F('scripts/lib/lrcTruth.mjs')).href)

/** Raw + offset-normalized line-start error vs truth. */
function score(lineTimes, truth) {
  const idx = []
  for (let i = 0; i < truth.length; i++) if (truth[i] != null && lineTimes[i] != null) idx.push(i)
  const raw = idx.map((i) => Math.abs(lineTimes[i] - truth[i]))
  const diffs = idx.map((i) => lineTimes[i] - truth[i]).sort((a, b) => a - b)
  const off = diffs.length ? diffs[Math.floor(diffs.length / 2)] : 0
  const norm = idx.map((i) => Math.abs(lineTimes[i] - (truth[i] + off)))
  const stats = (errs) => {
    const e = [...errs].sort((a, b) => a - b)
    return {
      mean: errs.reduce((a, b) => a + b, 0) / Math.max(1, errs.length),
      p50: e[Math.floor(0.5 * e.length)] ?? 0,
      p90: e[Math.floor(0.9 * e.length)] ?? 0,
      over1: errs.filter((x) => x > 1).length,
      over15: errs.filter((x) => x > 1.5).length,
    }
  }
  return { scored: idx.length, offset: off, raw: stats(raw), norm: stats(norm) }
}

/** Baseline app-path alignment; returns { lines, quality, anchors: {consensus, good} }. */
function runBaseline(song, lineTexts) {
  const rows = lineTexts.map((original) => ({ original, translation: '', startTime: 0, endTime: 0 }))
  if (song.mixed) {
    const jaWords = loadTranscriptWords(song.ja)
    const enWords = loadTranscriptWords(song.en)
    const res = refineMixedLanguageAlignment(rows, jaWords, enWords)
    const consensus = consensusAgreedLines(res.passes.ja, res.passes.en).map((a) => a.li)
    const good = (res.refined.lineAlignmentQuality ?? [])
      .map((q, i) => (q === 'good' ? i : -1)).filter((i) => i >= 0)
    return { lines: res.refined.lines, quality: res.refined.lineAlignmentQuality, anchors: { consensus, good } }
  }
  const words = loadTranscriptWords(song.ja)
  const lang = detectSheetLanguage(lineTexts, 'ja')
  const refined = refineAlignmentWithPhrases(rows, words, lang)
  const good = (refined.lineAlignmentQuality ?? [])
    .map((q, i) => (q === 'good' ? i : -1)).filter((i) => i >= 0)
  return { lines: refined.lines, quality: refined.lineAlignmentQuality, anchors: { consensus: good, good } }
}

const only = process.argv.indexOf('--song') >= 0 ? process.argv[process.argv.indexOf('--song') + 1] : null
const debug = process.argv.includes('--debug')
const rows = []
for (const song of SONGS) {
  if (only && song.name !== only) continue
  if (!song.ja || !existsSync(song.ja) || !existsSync(song.lyrics) || !existsSync(song.truth)) {
    console.log(`skip ${song.name} (missing fixture)`)
    continue
  }
  const lineTexts = readFileSync(song.lyrics, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)
  if (debug) {
    const jaWords = loadTranscriptWords(song.ja)
    console.log(`${song.name}: lines=${lineTexts.length} jaWords=${jaWords.length}${song.en ? ` enWords=${loadTranscriptWords(song.en).length}` : ''}`)
  }
  const base = runBaseline(song, lineTexts)
  const tj = JSON.parse(readFileSync(song.truth, 'utf8'))
  const truth = matchSheetToLrc(lineTexts, parseLrc(tj.syncedLyrics))
  const s = score(base.lines.map((l) => l.startTime), truth)
  rows.push({ name: `${song.name} (baseline)`, ...s, anchors: base.anchors.consensus.length })
  console.log(`${song.name}: baseline scored=${s.scored} rawMean=${s.raw.mean.toFixed(2)} normMean=${s.norm.mean.toFixed(2)} anchors=${base.anchors.consensus.length}`)
}

console.log('\n=== HYBRID SCORECARD ===')
console.log('config                                scored  anch | raw:  mean   p50   p90  >1s >1.5 | norm:  mean   p50   p90  >1s >1.5 | off')
for (const r of rows) {
  const f = (x) => x.toFixed(2).padStart(5)
  console.log(
    `${r.name.padEnd(37)} ${String(r.scored).padStart(5)} ${String(r.anchors ?? '').padStart(5)} |     ${f(r.raw.mean)} ${f(r.raw.p50)} ${f(r.raw.p90)} ${String(r.raw.over1).padStart(4)} ${String(r.raw.over15).padStart(4)} |      ${f(r.norm.mean)} ${f(r.norm.p50)} ${f(r.norm.p90)} ${String(r.norm.over1).padStart(4)} ${String(r.norm.over15).padStart(4)} | ${r.offset.toFixed(2)}`,
  )
}

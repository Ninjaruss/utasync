/**
 * SPIKE (approach B / WhisperX-timestamp lever): does the word-level cross-attention
 * timestamp path beat the tail-clipping SEGMENT path on long (>180s) full-tier songs?
 *
 * Full tier currently forces `segment` mode past 180s for SPEED (alignTimestampMode.ts),
 * even though word mode is documented as more accurate (segment chunks clip the sung
 * final syllable ~0.7-1.0s early). transformers.js's `return_timestamps:'word'` already
 * uses cross-attention token timestamps under the hood (pipelines.js), and the WebGPU
 * worker already does manual per-window word transcription — so the speed blocker that
 * motivated the cutoff is largely obsolete on full tier. This measures the accuracy the
 * cutoff is trading away, with ZERO model download: it runs the REAL app aligner
 * (refineAlignmentWithPhrases) on the committed WORD vs SEGMENT transcript fixtures and
 * scores line-start error against the committed synced-LRC truth (same offset-normalized
 * metric as forced-align-scorecard.mjs). Never prints lyric text — indices/times only.
 *
 *   npx tsx scripts/word-vs-segment-scorecard.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const F = (p) => join(root, p)

// Songs with BOTH a word and a segment transcript fixture + LRC truth (the honest A/B).
const SONGS = [
  {
    name: 'stranger-than-heaven',
    lyrics: F('tests/ai-pipeline/fixtures/stranger-than-heaven/lyrics.txt'),
    word: F('tests/ai-pipeline/fixtures/stranger-than-heaven/transcript.word.json'),
    segment: F('tests/ai-pipeline/fixtures/stranger-than-heaven/transcript.segment.json'),
    truth: F('tests/ai-pipeline/fixtures/lrc-truth/stranger-than-heaven.json'),
  },
  {
    name: 'guitar-loneliness',
    lyrics: F('tests/ai-pipeline/fixtures/guitar-loneliness/lyrics.ja.txt'),
    word: F('tests/ai-pipeline/fixtures/guitar-loneliness/transcript.word.json'),
    segment: F('tests/ai-pipeline/fixtures/guitar-loneliness/transcript.segment.json'),
    truth: F('tests/ai-pipeline/fixtures/lrc-truth/guitar-loneliness.json'),
  },
]

/** Normalize a word array or {chunks:[{text,timestamp:[s,e]}]} — mirrors audit-corpus.mjs. */
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

const readLines = (p) => readFileSync(p, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)

const { refineAlignmentWithPhrases } = await import(pathToFileURL(F('src/lyrics/phraseAlignment.ts')).href)
const { detectSheetLanguage } = await import(pathToFileURL(F('src/ai-pipeline/whisperLanguage.ts')).href)
const { parseLrc, matchSheetToLrc } = await import(pathToFileURL(F('scripts/lib/lrcTruth.mjs')).href)

/** Offset-normalized (median-subtracted) abs line-start error vs LRC truth. */
function score(lineTexts, lineTimes, truth) {
  const diffs = []
  for (let i = 0; i < lineTexts.length; i++) {
    if (truth[i] != null && lineTimes[i] != null) diffs.push(lineTimes[i] - truth[i])
  }
  const so = [...diffs].sort((a, b) => a - b)
  const off = so.length ? so[Math.floor(so.length / 2)] : 0
  const errs = []
  for (let i = 0; i < lineTexts.length; i++) {
    if (truth[i] == null || lineTimes[i] == null) continue
    errs.push(Math.abs(lineTimes[i] - (truth[i] + off)))
  }
  const e = [...errs].sort((a, b) => a - b)
  return {
    scored: errs.length,
    mean: errs.reduce((a, b) => a + b, 0) / Math.max(1, errs.length),
    p50: e[Math.floor(0.5 * e.length)] ?? 0,
    p90: e[Math.floor(0.9 * e.length)] ?? 0,
    over1: errs.filter((x) => x > 1).length,
    over15: errs.filter((x) => x > 1.5).length,
  }
}

function alignLineStarts(lineTexts, words, lang) {
  const rows = lineTexts.map((original) => ({ original, translation: '', startTime: 0, endTime: 0 }))
  return refineAlignmentWithPhrases(rows, words, lang).lines.map((l) => l.startTime)
}

const rows = []
for (const s of SONGS) {
  if (![s.lyrics, s.word, s.segment, s.truth].every(existsSync)) {
    console.log(`skip ${s.name} (missing asset)`)
    continue
  }
  const lineTexts = readLines(s.lyrics)
  const lang = detectSheetLanguage(lineTexts, 'ja')
  const tj = JSON.parse(readFileSync(s.truth, 'utf8'))
  const truth = tj.syncedLyrics ? matchSheetToLrc(lineTexts, parseLrc(tj.syncedLyrics)) : lineTexts.map(() => null)

  const wordScore = score(lineTexts, alignLineStarts(lineTexts, loadTranscriptWords(s.word), lang), truth)
  const segScore = score(lineTexts, alignLineStarts(lineTexts, loadTranscriptWords(s.segment), lang), truth)
  rows.push({ name: s.name, lines: lineTexts.length, lang, word: wordScore, seg: segScore })
}

const fmt = (r) => `${r.mean.toFixed(2).padStart(5)} ${r.p50.toFixed(2).padStart(5)} ${r.p90.toFixed(2).padStart(6)} ${String(r.over1).padStart(4)} ${String(r.over15).padStart(5)}`
console.log('\n=== WORD vs SEGMENT line-start error (offset-normalized, lower is better) ===')
console.log('song                      mode     lines  mean   p50    p90   >1s  >1.5s')
for (const r of rows) {
  console.log(`${r.name.padEnd(24)} word    ${String(r.lines).padStart(6)}  ${fmt(r.word)}`)
  console.log(`${''.padEnd(24)} segment ${String(r.lines).padStart(6)}  ${fmt(r.seg)}`)
  const dP50 = r.seg.p50 - r.word.p50
  const dMean = r.seg.mean - r.word.mean
  console.log(`${''.padEnd(24)} Δ(seg−word): mean ${dMean >= 0 ? '+' : ''}${dMean.toFixed(2)}s  p50 ${dP50 >= 0 ? '+' : ''}${dP50.toFixed(2)}s  (positive ⇒ word mode wins)\n`)
}

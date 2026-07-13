/**
 * Ground-truth alignment audit: score aligner output against human-synced
 * LRC timestamps from LRCLIB (tests/ai-pipeline/fixtures/lrc-truth/).
 *
 * Unlike audit-corpus.mjs (which scores against Whisper's own transcript and
 * is blind to transcription-time skew), this measures what the listener
 * actually perceives: line-start error vs human-timed truth.
 *
 * For each configuration it reports BOTH:
 *  - transcript error: distance from truth to the line's matched transcript
 *    evidence (Whisper's fault),
 *  - alignment error: distance from truth to our final line start
 *    (end-to-end; the aligner's fault only where it exceeds transcript error).
 * A robust median version-offset is removed first (LRC versions can carry a
 * constant intro-length difference) and reported.
 *
 * Run: npx tsx scripts/audit-vs-lrc.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const FIXTURES = join(root, 'tests/ai-pipeline/fixtures')

const { refineAlignmentWithPhrases } = await import(pathToFileURL(join(root, 'src/lyrics/phraseAlignment.ts')).href)
const { refineMixedLanguageAlignment } = await import(pathToFileURL(join(root, 'src/ai-pipeline/mixedLanguageAlign.ts')).href)
const { sanitizeTranscript } = await import(pathToFileURL(join(root, 'src/ai-pipeline/aligner.ts')).href)
const { computeLineMatchedSpans } = await import(pathToFileURL(join(root, 'src/ai-pipeline/contentAligner.ts')).href)
const { parseLrc, matchSheetToLrc } = await import(pathToFileURL(join(root, 'scripts/lib/lrcTruth.mjs')).href)

function loadWords(path) {
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  const arr = Array.isArray(raw)
    ? raw.map((w) => ({ word: (w.word ?? '').trim(), startTime: w.startTime, endTime: w.endTime }))
    : (raw.chunks ?? []).map((c) => ({ word: c.text?.trim(), startTime: c.timestamp?.[0], endTime: c.timestamp?.[1] }))
  return arr.filter((w) => w.word && Number.isFinite(w.startTime) && Number.isFinite(w.endTime))
}
const readLines = (p) => readFileSync(p, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)

const median = (xs) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}
const pct = (xs, p) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]
}

function score(name, lines, spans, truthTime, lineTexts) {
  // Version offset: median of (our anchored evidence − truth) over lines with
  // BOTH truth and transcript evidence — evidence is version-independent-ish.
  const diffs = []
  for (let i = 0; i < lines.length; i++) {
    if (truthTime[i] == null) continue
    if (spans[i]?.firstTime != null && spans[i].matchedChars / Math.max(1, spans[i].totalChars) >= 0.5) {
      diffs.push(spans[i].firstTime - truthTime[i])
    }
  }
  const offset = median(diffs) ?? 0

  const transcriptErr = []
  const alignErr = []
  const worst = []
  for (let i = 0; i < lines.length; i++) {
    if (truthTime[i] == null) continue
    const t = truthTime[i] + offset
    if (spans[i]?.firstTime != null && spans[i].matchedChars / Math.max(1, spans[i].totalChars) >= 0.5) {
      transcriptErr.push(Math.abs(spans[i].firstTime - t))
    }
    const e = Math.abs(lines[i].startTime - t)
    alignErr.push(e)
    worst.push({ i, e: +e.toFixed(1), text: lineTexts[i].slice(0, 22) })
  }
  worst.sort((a, b) => b.e - a.e)
  const fmt = (x) => (x == null ? ' n/a' : x.toFixed(2).padStart(5))
  console.log(
    `${name.padEnd(34)} offset=${offset.toFixed(2).padStart(6)}s | transcript p50=${fmt(median(transcriptErr))} p90=${fmt(pct(transcriptErr, 0.9))} (n=${transcriptErr.length}) | align p50=${fmt(median(alignErr))} p90=${fmt(pct(alignErr, 0.9))} >1s=${alignErr.filter((e) => e > 1).length}/${alignErr.length} | worst: ${worst.slice(0, 3).map((w) => `#${w.i} ${w.e}s`).join(', ')}`,
  )
  return { offset, alignErr }
}

const SONGS = [
  {
    name: 'guitar-loneliness',
    lyrics: 'guitar-loneliness/lyrics.ja.txt',
    truth: 'lrc-truth/guitar-loneliness.json',
    lang: 'ja',
    configs: [
      { label: 'word', transcript: 'guitar-loneliness/transcript.word.json' },
      { label: 'segment', transcript: 'guitar-loneliness/transcript.segment.json' },
    ],
  },
  {
    name: 'stranger-than-heaven',
    lyrics: 'stranger-than-heaven/lyrics.txt',
    truth: 'lrc-truth/stranger-than-heaven.json',
    lang: 'mixed',
    configs: [
      { label: 'word ja-only', transcript: 'stranger-than-heaven/transcript.word.json' },
      { label: 'segment ja-only', transcript: 'stranger-than-heaven/transcript.segment.json' },
      { label: 'word mixed 2-pass', transcript: 'stranger-than-heaven/transcript.word.json', transcriptEn: 'stranger-than-heaven/transcript.word.forced-en.json' },
      { label: 'segment mixed 2-pass', transcript: 'stranger-than-heaven/transcript.segment.json', transcriptEn: 'stranger-than-heaven/transcript.segment.forced-en.json' },
      { label: 'segment medium ja-only', transcript: 'stranger-than-heaven/transcript.segment.medium.json' },
    ],
  },
]

for (const song of SONGS) {
  const lineTexts = readLines(join(FIXTURES, song.lyrics))
  const lrc = JSON.parse(readFileSync(join(FIXTURES, song.truth), 'utf8'))
  const truthTime = matchSheetToLrc(lineTexts, parseLrc(lrc.syncedLyrics))
  const matched = truthTime.filter((t) => t != null).length
  console.log(`\n=== ${song.name}: ${matched}/${lineTexts.length} sheet lines have LRC truth (lrc dur ${lrc.duration}s)`)
  const sheetRows = lineTexts.map((original) => ({ original, translation: '', startTime: 0, endTime: 0 }))
  for (const cfg of song.configs) {
    const path = join(FIXTURES, cfg.transcript)
    if (!existsSync(path)) { console.log(`${cfg.label}: transcript missing, skipped`); continue }
    const words = loadWords(path)
    let refined
    let scoredWords = words
    if (cfg.transcriptEn) {
      const en = loadWords(join(FIXTURES, cfg.transcriptEn))
      const mixed = refineMixedLanguageAlignment(sheetRows, words, en)
      refined = mixed.refined
      scoredWords = mixed.transcriptWords
    } else {
      refined = refineAlignmentWithPhrases(sheetRows, words, song.lang)
    }
    const spans = computeLineMatchedSpans(lineTexts, sanitizeTranscript(scoredWords))
    score(`${song.name} ${cfg.label}`, refined.lines, spans, truthTime, lineTexts)
  }
}

/**
 * Ground-truth alignment audit: score aligner output against human-synced
 * LRC timestamps from LRCLIB (tests/ai-pipeline/fixtures/lrc-truth/).
 *
 * Unlike audit-corpus.mjs (which scores against Whisper's own transcript and
 * is blind to transcription-time skew), this measures what the listener
 * actually perceives: line-start error vs human-timed truth.
 *
 * Reports each configuration in TWO frames (see scripts/lib/lrcTruth.mjs):
 *  - ABSOLUTE error vs truth — what the listener hears, including any constant
 *    whole-song lag. This is the number that decides.
 *  - RESIDUAL error after removing a robust median version offset — a
 *    diagnostic that separates "we inherited a constant offset" from "our
 *    relative structure is wrong". It is never the deciding number.
 * The offset itself is printed and is assertable in the CI gate.
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
const { parseLrc, matchSheetToLrc, scoreAgainstTruth } = await import(
  pathToFileURL(join(root, 'scripts/lib/lrcTruth.mjs')).href
)

function loadWords(path) {
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  const arr = Array.isArray(raw)
    ? raw.map((w) => ({ word: (w.word ?? '').trim(), startTime: w.startTime, endTime: w.endTime }))
    : (raw.chunks ?? []).map((c) => ({ word: c.text?.trim(), startTime: c.timestamp?.[0], endTime: c.timestamp?.[1] }))
  return arr.filter((w) => w.word && Number.isFinite(w.startTime) && Number.isFinite(w.endTime))
}
const readLines = (p) => readFileSync(p, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)

const f = (x, w = 5) => (x == null ? ' n/a'.padStart(w) : x.toFixed(2).padStart(w))
const pc = (x, w = 4) => (x == null ? ' n/a'.padStart(w) : `${Math.round(x * 100)}%`.padStart(w))

function score(name, lines, spans, truthTime, lineTexts) {
  const m = scoreAgainstTruth(lines, spans, truthTime, { lineTexts })
  console.log(`${name.padEnd(34)} | offset=${f(m.offset, 6)}s (n=${String(m.nOffsetPairs).padStart(2)})`)
  console.log(
    `  ABSOLUTE (gate)      p50=${f(m.absP50)} p90=${f(m.absP90)} worst=${f(m.absWorst)}` +
      ` | <=250ms=${pc(m.fracWithin250)} <=500ms=${pc(m.fracWithin500)} <=1s=${pc(m.fracWithin1000)}` +
      ` | signed mean=${f(m.signedMean, 6)}s (${m.signedMean > 0 ? 'late' : 'early'})`,
  )
  console.log(
    `  residual (diagnostic) p50=${f(m.resP50)} p90=${f(m.resP90)} >1s=${m.resOver1s}/${m.n}` +
      ` | n=${m.n} worst: ${m.worst.map((w) => `#${w.index} ${w.error}s`).join(', ')}`,
  )
  console.log(
    `  transcript evidence   p50=${f(m.transcriptP50)} p90=${f(m.transcriptP90)} (n=${m.nTranscript})`,
  )
  console.log(
    `  evidence-backed only  p50=${f(m.evP50)} p90=${f(m.evP90)} worst=${f(m.evWorst)} (n=${m.nEvidence})` +
      ` | NO evidence: ${m.nNoEvidence} lines, worst ${f(m.noEvidenceWorst)}s`,
  )
  return m
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
      // The app's shipped default (see src/ai-pipeline/alignTimestampMode.ts):
      // word mode on every transcribing tier.
      { label: 'word ja-only', transcript: 'stranger-than-heaven/transcript.word.json' },
      { label: 'segment ja-only', transcript: 'stranger-than-heaven/transcript.segment.json' },
      // The app's EN-forced pass always transcribes at segment granularity, so word mode pairs a word JA transcript with the segment EN one.
      { label: 'word mixed 2-pass', transcript: 'stranger-than-heaven/transcript.word.json', transcriptEn: 'stranger-than-heaven/transcript.segment.forced-en.json' },
      { label: 'segment mixed 2-pass', transcript: 'stranger-than-heaven/transcript.segment.json', transcriptEn: 'stranger-than-heaven/transcript.segment.forced-en.json' },
      { label: 'segment medium ja-only', transcript: 'stranger-than-heaven/transcript.segment.medium.json' },
    ],
  },
  // veil and recollect are gated by tests/ai-pipeline/lrc-truth.test.ts but were
  // missing from this instrument, so their numbers could not be reproduced by
  // hand. Kept in the same order as the gate.
  {
    name: 'veil',
    lyrics: 'veil/lyrics.ja.txt',
    truth: 'lrc-truth/veil.json',
    lang: 'ja',
    configs: [{ label: 'word ja-only', transcript: 'veil/transcript.words.json' }],
  },
  {
    name: 'recollect',
    lyrics: 'recollect/lyrics.txt',
    truth: 'lrc-truth/recollect.json',
    lang: 'mixed',
    configs: [
      {
        label: 'segment mixed 2-pass',
        transcript: 'recollect/transcript.segment.json',
        transcriptEn: 'recollect/transcript.segment.forced-en.json',
      },
    ],
  },
]

console.log('ABSOLUTE error is what the listener hears and is the gate.')
console.log('residual removes a median version offset and is a diagnostic only.\n')

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

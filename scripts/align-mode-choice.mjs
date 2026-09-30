/**
 * Does the app's OWN quality verdict pick the better Whisper timestamp mode?
 *
 * This is the falsifiable experiment the accuracy plan (W1.1, and the ablation
 * harness W0.6) requires before any code changes: `preferredWhisperTimestampMode`
 * currently returns a constant ('word' on every transcribing tier), justified by
 * a stem-only measurement recorded in a code comment (word mean 5.61s vs segment
 * 0.74s). Meanwhile the committed MIX fixtures appear to say the opposite.
 *
 * Neither is a basis for a constant. If the app's own verdict — placementConfidence
 * over the per-line labels it already computes — reliably ranks the modes the same
 * way truth does, then mode selection can be made per song and automatic, with no
 * user button. If it does not, the constant stays and this experiment says so.
 *
 * Truth is scored in the ABSOLUTE frame, including the systematic offset, and
 * partitioned by transcript evidence (see scripts/lib/lrcTruth.mjs).
 *
 * Run: npx tsx scripts/align-mode-choice.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const FIXTURES = join(root, 'tests/ai-pipeline/fixtures')

const { refineAlignmentWithPhrases } = await import(pathToFileURL(join(root, 'src/lyrics/phraseAlignment.ts')).href)
const { refineMixedLanguageAlignment, placementConfidence } = await import(
  pathToFileURL(join(root, 'src/ai-pipeline/mixedLanguageAlign.ts')).href
)
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

const SONGS = [
  {
    name: 'guitar-loneliness',
    lyrics: 'guitar-loneliness/lyrics.ja.txt',
    truth: 'lrc-truth/guitar-loneliness.json',
    lang: 'ja',
    modes: {
      word: { transcript: 'guitar-loneliness/transcript.word.json' },
      segment: { transcript: 'guitar-loneliness/transcript.segment.json' },
    },
  },
  {
    name: 'recollect',
    lyrics: 'recollect/lyrics.txt',
    truth: 'lrc-truth/recollect.json',
    lang: 'mixed',
    // The forced-EN pass is always transcribed at segment granularity in the app,
    // so word mode pairs a word JA transcript with the segment EN one.
    modes: {
      word: { transcript: 'recollect/transcript.word.json', transcriptEn: 'recollect/transcript.segment.forced-en.json' },
      segment: { transcript: 'recollect/transcript.segment.json', transcriptEn: 'recollect/transcript.segment.forced-en.json' },
    },
  },
  {
    name: 'stranger-than-heaven',
    lyrics: 'stranger-than-heaven/lyrics.txt',
    truth: 'lrc-truth/stranger-than-heaven.json',
    lang: 'mixed',
    modes: {
      word: { transcript: 'stranger-than-heaven/transcript.word.json', transcriptEn: 'stranger-than-heaven/transcript.segment.forced-en.json' },
      segment: { transcript: 'stranger-than-heaven/transcript.segment.json', transcriptEn: 'stranger-than-heaven/transcript.segment.forced-en.json' },
      'segment-medium': { transcript: 'stranger-than-heaven/transcript.segment.medium.json', transcriptEn: 'stranger-than-heaven/transcript.segment.forced-en.json' },
    },
  },
]

const rows = []
for (const song of SONGS) {
  const lineTexts = readLines(join(FIXTURES, song.lyrics))
  const lrc = JSON.parse(readFileSync(join(FIXTURES, song.truth), 'utf8'))
  const truthTime = matchSheetToLrc(lineTexts, parseLrc(lrc.syncedLyrics))
  const sheetRows = lineTexts.map((original) => ({ original, translation: '', startTime: 0, endTime: 0 }))
  console.log(`\n=== ${song.name}`)
  console.log(
    '  mode             verdict  absP50 absP90 absWorst <=250ms evP90  noEv | proportional  lowConf',
  )
  for (const [mode, cfg] of Object.entries(song.modes)) {
    const path = join(FIXTURES, cfg.transcript)
    if (!existsSync(path)) { console.log(`  ${mode.padEnd(16)} (transcript missing)`); continue }
    const ja = loadWords(path)
    let refined
    let scoredWords = ja
    if (cfg.transcriptEn) {
      const en = loadWords(join(FIXTURES, cfg.transcriptEn))
      const mixed = refineMixedLanguageAlignment(sheetRows, ja, en)
      refined = mixed.refined
      scoredWords = mixed.transcriptWords
    } else {
      refined = refineAlignmentWithPhrases(sheetRows, ja, song.lang)
    }
    const quality = refined.lineAlignmentQuality ?? []
    const verdict = placementConfidence(quality)
    const spans = computeLineMatchedSpans(lineTexts, sanitizeTranscript(scoredWords))
    const m = scoreAgainstTruth(refined.lines, spans, truthTime, { lineTexts })
    const lowConf = quality.filter((q) => q !== 'good').length
    rows.push({ song: song.name, mode, verdict, m, proportional: refined.mode === 'proportional' })
    console.log(
      `  ${mode.padEnd(16)} ${verdict.toFixed(3)}    ${f(m.absP50)} ${f(m.absP90)}   ${f(m.absWorst)}` +
        `   ${String(Math.round((m.fracWithin250 ?? 0) * 100)).padStart(3)}%  ${f(m.evP90)}  ${String(m.nNoEvidence).padStart(3)}` +
        ` | ${refined.mode.padEnd(11)} ${lowConf}/${quality.length}`,
    )
  }
}

console.log('\n=== Does the app verdict agree with truth on which mode is better?\n')
let agree = 0
let compared = 0
for (const song of SONGS) {
  const rs = rows.filter((r) => r.song === song.name)
  if (rs.length < 2) continue
  const byVerdict = [...rs].sort((a, b) => b.verdict - a.verdict)[0]
  const byTruth = [...rs].sort((a, b) => a.m.absP90 - b.m.absP90)[0]
  compared++
  const ok = byVerdict.mode === byTruth.mode
  if (ok) agree++
  console.log(
    `  ${song.name.padEnd(22)} verdict picks ${byVerdict.mode.padEnd(15)} (absP90 ${f(byVerdict.m.absP90)})` +
      ` | truth picks ${byTruth.mode.padEnd(15)} (absP90 ${f(byTruth.m.absP90)})  ${ok ? 'AGREE' : 'DISAGREE'}`,
  )
}
console.log(`\n  ${agree}/${compared} songs: the verdict ranks the modes the way truth does.`)
if (agree < compared) {
  console.log('  A disagreement means placementConfidence is NOT yet a safe mode selector.')
}

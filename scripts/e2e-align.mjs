/**
 * End-to-end alignment quality check with REAL Whisper transcription (Node).
 *
 * Mirrors the app's default AutoAlignFlow path for a song: decode mp3 →
 * forced-language pass(es) (mixed sheets get JA + EN-segment passes) → mixed
 * merge / phrase refine → round-11 focused gap re-transcription (real slices
 * from the same audio) → score every line's start against synced-LRC truth.
 *
 * Run:
 *   npx tsx scripts/e2e-align.mjs <mp3> <lyrics.txt> <lrc-truth.json> [--mode word|segment]
 * e.g.
 *   npx tsx scripts/e2e-align.mjs ~/Downloads/stranger.mp3 \
 *     tests/ai-pipeline/fixtures/stranger-than-heaven/lyrics.txt \
 *     tests/ai-pipeline/fixtures/lrc-truth/stranger-than-heaven.json
 *
 * Unlike audit-corpus.mjs (committed transcripts), this runs the whole pipeline
 * fresh — same code the browser runs, minus the Worker/WebGPU wrapping (Node
 * uses scripts/lib/nodeWhisper.mjs with the same model + options).
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const [, , mp3Path, lyricsPath, truthPath] = process.argv
if (!mp3Path || !lyricsPath || !truthPath) {
  console.error('Usage: npx tsx scripts/e2e-align.mjs <mp3> <lyrics.txt> <lrc-truth.json> [--mode word|segment]')
  process.exit(1)
}
const modeArg = process.argv.indexOf('--mode')
const timestampMode = modeArg >= 0 ? process.argv[modeArg + 1] : 'segment' // app default for >180s tracks
const NO_GAP = process.argv.includes('--no-gap') // isolate the base alignment from the focused re-pass
const modelArg = process.argv.indexOf('--model')
const model = modelArg >= 0 ? process.argv[modelArg + 1] : undefined // e.g. Xenova/whisper-medium (the app's High-accuracy pass)

const { decodeMp3ToMono } = await import(pathToFileURL(join(root, 'scripts/lib/nodeAudio.mjs')).href)
const { transcribeAudio } = await import(pathToFileURL(join(root, 'scripts/lib/nodeWhisper.mjs')).href)
const { sanitizeTranscript } = await import(pathToFileURL(join(root, 'src/ai-pipeline/aligner.ts')).href)
const { refineAlignmentWithPhrases } = await import(pathToFileURL(join(root, 'src/lyrics/phraseAlignment.ts')).href)
const { refineMixedLanguageAlignment } = await import(pathToFileURL(join(root, 'src/ai-pipeline/mixedLanguageAlign.ts')).href)
const { reanalyzeGaps } = await import(pathToFileURL(join(root, 'src/ai-pipeline/gapReanalyze.ts')).href)
const { detectSheetLanguage } = await import(pathToFileURL(join(root, 'src/ai-pipeline/whisperLanguage.ts')).href)
const { chunksToWords } = await import(pathToFileURL(join(root, 'src/ai-pipeline/transcriptChunks.ts')).href)
const { computeLineMatchedSpans } = await import(pathToFileURL(join(root, 'src/ai-pipeline/contentAligner.ts')).href)
const { parseLrc, matchSheetToLrc } = await import(pathToFileURL(join(root, 'scripts/lib/lrcTruth.mjs')).href)

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
const langName = (l) => (l === 'ja' ? 'japanese' : l === 'en' ? 'english' : 'auto')

const lineTexts = readFileSync(lyricsPath, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)
const sheetRows = lineTexts.map((original) => ({ original, translation: '', startTime: 0, endTime: 0 }))
const alignmentLanguage = detectSheetLanguage(lineTexts, 'ja')

console.log(`Decoding ${mp3Path}…`)
const { data: audioData, sampleRate } = await decodeMp3ToMono(mp3Path)
const durationSec = audioData.length / sampleRate
console.log(`duration=${durationSec.toFixed(1)}s lang=${alignmentLanguage} mode=${timestampMode}`)

const t0 = performance.now()
let refined
let transcriptWords
if (alignmentLanguage === 'mixed') {
  console.log(`JA pass…${model ? ` (${model})` : ''}`)
  const jaT = await transcribeAudio(audioData, sampleRate, { language: 'japanese', timestampMode, model })
  console.log('EN pass (segment)…')
  const enT = await transcribeAudio(audioData, sampleRate, { language: 'english', timestampMode: 'segment', model })
  const mixed = refineMixedLanguageAlignment(sheetRows, chunksToWords(jaT), chunksToWords(enT))
  refined = mixed.refined
  transcriptWords = mixed.transcriptWords
} else {
  const tr = await transcribeAudio(audioData, sampleRate, { language: langName(alignmentLanguage), timestampMode, model })
  const words = chunksToWords(tr)
  transcriptWords = sanitizeTranscript(words)
  refined = refineAlignmentWithPhrases(sheetRows, words, alignmentLanguage)
}

if (NO_GAP) console.log('(focused gap re-pass DISABLED via --no-gap)')
else console.log('Focused gap re-pass…')
const transcribeSlice = async (s0, s1, lang, promptText) => {
  const slice = audioData.subarray(Math.floor(s0 * sampleRate), Math.floor(s1 * sampleRate))
  const tr = await transcribeAudio(slice, sampleRate, {
    language: langName(lang),
    timestampMode: 'segment',
    model,
    promptText,
  })
  return chunksToWords(tr).map((w) => ({ ...w, startTime: w.startTime + s0, endTime: w.endTime + s0 }))
}
if (!NO_GAP) {
  const gap = await reanalyzeGaps({
    refined,
    transcriptWords,
    sheetRows,
    alignmentLanguage,
    sourceLanguage: 'ja',
    transcribeSlice,
    onProgress: (n) => n > 0 && console.log(`  recovering ${n} section(s)…`),
  })
  refined = gap.refined
  transcriptWords = gap.transcriptWords
  console.log(`gap sections filled: ${gap.filledCount}; total ${(performance.now() - t0).toFixed(0)}ms`)
}

// --- score vs truth ---
// Truth JSON is either synced LRC ({syncedLyrics}) or caption onsets
// ({onsets:[{idx,onset,shared?,tol?}]}, e.g. official video captions — the only
// usable truth for live-arrangement recordings like THE FIRST TAKE, where an
// LRC synced to the studio version would not apply). `shared` marks the second
// half of a caption (onset is a lower bound, not a start) — excluded.
const truthJson = JSON.parse(readFileSync(truthPath, 'utf8'))
let truth
if (truthJson.syncedLyrics) {
  truth = matchSheetToLrc(lineTexts, parseLrc(truthJson.syncedLyrics))
} else if (truthJson.onsets) {
  truth = lineTexts.map(() => null)
  for (const g of truthJson.onsets) {
    if (g.shared) continue
    truth[g.idx] = g.onset
  }
} else {
  throw new Error('truth JSON needs syncedLyrics (LRC) or onsets (captions)')
}
const spans = computeLineMatchedSpans(lineTexts, sanitizeTranscript(transcriptWords))
const diffs = []
for (let i = 0; i < lineTexts.length; i++) {
  if (truth[i] == null || !spans[i]) continue
  if (spans[i].matchedChars / Math.max(1, spans[i].totalChars) >= 0.5) diffs.push(spans[i].firstTime - truth[i])
}
const offset = median(diffs) ?? 0
const quality = refined.lineAlignmentQuality ?? []
const errs = []
console.log(`\nPer-line start error vs LRC truth (offset ${offset.toFixed(2)}s removed):`)
for (let i = 0; i < refined.lines.length; i++) {
  if (truth[i] == null) continue
  const err = refined.lines[i].startTime - (truth[i] + offset)
  errs.push(Math.abs(err))
  const flag = Math.abs(err) > 1.5 ? '!!' : Math.abs(err) > 1 ? ' !' : '  '
  console.log(`${flag} #${String(i).padStart(2)} ${err.toFixed(2).padStart(7)}s [${(quality[i] ?? '?').padEnd(12)}] ${lineTexts[i].slice(0, 36)}`)
}
console.log(
  `\nSUMMARY lines=${errs.length} mean|err|=${(errs.reduce((a, b) => a + b, 0) / Math.max(1, errs.length)).toFixed(2)}s ` +
  `p50=${pct(errs, 0.5).toFixed(2)}s p90=${pct(errs, 0.9).toFixed(2)}s ` +
  `>1s=${errs.filter((e) => e > 1).length} >1.5s=${errs.filter((e) => e > 1.5).length} >3s=${errs.filter((e) => e > 3).length}`,
)
console.log(
  `labels: good=${quality.filter((q) => q === 'good').length} approx=${quality.filter((q) => q === 'approximate').length} review=${quality.filter((q) => q === 'needs_review').length}`,
)

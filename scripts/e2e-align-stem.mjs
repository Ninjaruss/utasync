/**
 * Isolation-ON end-to-end alignment check — the vocal-stem counterpart of
 * scripts/e2e-align.mjs. Faithfully mirrors AutoAlignFlow's path WHEN "Isolate
 * vocals" is ON: it reads a pre-separated vocal stem (from scripts/separate-vocals.mjs),
 * transcribes IT (not the mix), gap-repasses from IT, then applies the stem-only
 * acoustic anchors — computeVocalActivity → firstVocalOnset → anchorLeadingEdge →
 * backfillLateStartsToAcousticOnset — and scores every line's start against synced-LRC
 * (or caption-onset) truth. This is the piece e2e-align.mjs can't exercise (it runs on
 * the raw mix and skips the acoustic anchors).
 *
 * Two-step (separation is slow — cache the stem once, then align many times):
 *   npx tsx scripts/separate-vocals.mjs <mp3> <stem.pcm>
 *   npx tsx scripts/e2e-align-stem.mjs <stem.pcm> <lyrics.txt> <truth.json> [--mode word|segment] [--model id] [--no-gap] [--no-anchor]
 *
 * <stem.pcm> is raw Float32LE mono @ 44100 Hz (separate-vocals.mjs output).
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const STEM_SR = 44100

const [, , pcmPath, lyricsPath, truthPath] = process.argv
if (!pcmPath || !lyricsPath || !truthPath) {
  console.error('Usage: npx tsx scripts/e2e-align-stem.mjs <stem.pcm> <lyrics.txt> <truth.json> [--mode word|segment] [--model id] [--no-gap] [--no-anchor]')
  process.exit(1)
}
const modeArg = process.argv.indexOf('--mode')
const timestampMode = modeArg >= 0 ? process.argv[modeArg + 1] : 'segment'
const modelArg = process.argv.indexOf('--model')
const model = modelArg >= 0 ? process.argv[modelArg + 1] : undefined
const NO_GAP = process.argv.includes('--no-gap')
const NO_ANCHOR = process.argv.includes('--no-anchor')

const imp = (p) => import(pathToFileURL(join(root, p)).href)
const { transcribeAudio } = await imp('scripts/lib/nodeWhisper.mjs')
const { sanitizeTranscript } = await imp('src/ai-pipeline/aligner.ts')
const { refineAlignmentWithPhrases } = await imp('src/lyrics/phraseAlignment.ts')
const { refineMixedLanguageAlignment } = await imp('src/ai-pipeline/mixedLanguageAlign.ts')
const { reanalyzeGaps } = await imp('src/ai-pipeline/gapReanalyze.ts')
const { detectSheetLanguage } = await imp('src/ai-pipeline/whisperLanguage.ts')
const { chunksToWords } = await imp('src/ai-pipeline/transcriptChunks.ts')
const { computeLineMatchedSpans } = await imp('src/ai-pipeline/contentAligner.ts')
const { computeVocalActivity, firstVocalOnset, detectInstrumentalGaps } = await imp('src/ai-pipeline/vocalActivity.ts')
const { anchorLeadingEdge, backfillLateStartsToAcousticOnset, snapLeadingVerseToOnset } = await imp('src/lyrics/leadingEdgeAnchor.ts')
const { reanalyzeLateSections } = await imp('src/lyrics/lateSectionReanchor.ts')
const SNAP_VERSE = process.argv.includes('--snap-verse') // EXPERIMENTAL: not wired into AutoAlignFlow
const NO_LATE = process.argv.includes('--no-late') // disable the late-section re-pass
const { parseLrc, matchSheetToLrc } = await imp('scripts/lib/lrcTruth.mjs')

const langName = (l) => (l === 'ja' ? 'japanese' : l === 'en' ? 'english' : 'auto')
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }
const pct = (xs, p) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))] }

const buf = readFileSync(pcmPath)
const vocals = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4))
const lineTexts = readFileSync(lyricsPath, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)
const sheetRows = lineTexts.map((original) => ({ original, translation: '', startTime: 0, endTime: 0 }))
const alignmentLanguage = detectSheetLanguage(lineTexts, 'ja')
console.log(`stem ${(vocals.length / STEM_SR).toFixed(1)}s @${STEM_SR} lang=${alignmentLanguage} mode=${timestampMode} model=${model ?? 'whisper-small'} anchor=${!NO_ANCHOR}`)

const t0 = performance.now()
let refined
let transcriptWords
if (alignmentLanguage === 'mixed') {
  console.log('JA pass…')
  const jaT = await transcribeAudio(vocals, STEM_SR, { language: 'japanese', timestampMode, model })
  console.log('EN pass (segment)…')
  const enT = await transcribeAudio(vocals, STEM_SR, { language: 'english', timestampMode: 'segment', model })
  const mixed = refineMixedLanguageAlignment(sheetRows, chunksToWords(jaT), chunksToWords(enT))
  refined = mixed.refined
  transcriptWords = mixed.transcriptWords
} else {
  const tr = await transcribeAudio(vocals, STEM_SR, { language: langName(alignmentLanguage), timestampMode, model })
  const words = chunksToWords(tr)
  transcriptWords = sanitizeTranscript(words)
  refined = refineAlignmentWithPhrases(sheetRows, words, alignmentLanguage)
}

const transcribeSlice = async (s0, s1, lang, promptText) => {
  const slice = vocals.subarray(Math.floor(s0 * STEM_SR), Math.floor(s1 * STEM_SR))
  const tr = await transcribeAudio(slice, STEM_SR, { language: langName(lang), timestampMode: 'segment', model, promptText })
  return chunksToWords(tr).map((w) => ({ ...w, startTime: w.startTime + s0, endTime: w.endTime + s0 }))
}
if (!NO_GAP) {
  const gap = await reanalyzeGaps({
    refined, transcriptWords, sheetRows, alignmentLanguage, sourceLanguage: 'ja',
    transcribeSlice, onProgress: (n) => n > 0 && console.log(`  gap re-pass: ${n} section(s)…`),
  })
  refined = gap.refined
  transcriptWords = gap.transcriptWords
  console.log(`gap sections filled: ${gap.filledCount}`)
}

// Stem-only acoustic anchors (AutoAlignFlow.tsx: computeVocalActivity → firstVocalOnset
// → anchorLeadingEdge → backfillLateStartsToAcousticOnset). LRC-prior is skipped —
// plain-text sheets carry no prior (all startTimes 0), matching a freshly-added song.
let onsetInfo = 'skipped'
if (!NO_ANCHOR) {
  const vocalSig = computeVocalActivity(vocals, STEM_SR, { source: 'stem' })
  const onset = firstVocalOnset(vocalSig)
  const spans = computeLineMatchedSpans(refined.lines.map((l) => l.original || l.translation), sanitizeTranscript(transcriptWords))
  if (onset != null) refined = { ...refined, lines: anchorLeadingEdge(refined.lines, onset, alignmentLanguage, { spans }) }
  if (SNAP_VERSE && onset != null) refined = { ...refined, lines: snapLeadingVerseToOnset(refined.lines, onset, alignmentLanguage, { spans }) }
  refined = { ...refined, lines: backfillLateStartsToAcousticOnset(refined.lines, spans, vocalSig) }
  onsetInfo = onset == null ? 'null (no clean intro→onset)' : `${onset.toFixed(2)}s`
}
console.log(`firstVocalOnset=${onsetInfo}`)

if (!NO_LATE) {
  const vocalSig = computeVocalActivity(vocals, STEM_SR, { source: 'stem' })
  const gaps = detectInstrumentalGaps(vocalSig)
  console.log(`late-section re-pass: gaps=${gaps.map((g) => `${g.start.toFixed(0)}-${g.end.toFixed(0)}`).join(',')}`)
  const late = await reanalyzeLateSections({
    refined, sheetRows, alignmentLanguage, sourceLanguage: 'ja', vocalSig, transcribeSlice,
    onProgress: (n) => n > 0 && console.log(`  re-timing ${n} gap section(s)…`),
  })
  refined = late.refined
  console.log(`late-section starts pulled earlier: ${late.changedCount}`)
}
console.log(`total ${(performance.now() - t0).toFixed(0)}ms`)

// --- score vs truth (synced LRC {syncedLyrics} or caption onsets {onsets:[{idx,onset,shared?}]}) ---
const truthJson = JSON.parse(readFileSync(truthPath, 'utf8'))
let truth
if (truthJson.syncedLyrics) truth = matchSheetToLrc(lineTexts, parseLrc(truthJson.syncedLyrics))
else if (truthJson.onsets) { truth = lineTexts.map(() => null); for (const g of truthJson.onsets) if (!g.shared) truth[g.idx] = g.onset }
else throw new Error('truth JSON needs syncedLyrics (LRC) or onsets (captions)')

const spans = computeLineMatchedSpans(lineTexts, sanitizeTranscript(transcriptWords))
const diffs = []
for (let i = 0; i < lineTexts.length; i++) {
  if (truth[i] == null || !spans[i]) continue
  if (spans[i].matchedChars / Math.max(1, spans[i].totalChars) >= 0.5) diffs.push(spans[i].firstTime - truth[i])
}
const offset = median(diffs) ?? 0
const quality = refined.lineAlignmentQuality ?? []
const errs = []
console.log(`\nPer-line start error vs truth (offset ${offset.toFixed(2)}s removed):`)
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
console.log(`labels: good=${quality.filter((q) => q === 'good').length} approx=${quality.filter((q) => q === 'approximate').length} review=${quality.filter((q) => q === 'needs_review').length}`)

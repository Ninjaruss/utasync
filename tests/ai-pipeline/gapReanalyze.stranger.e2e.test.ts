import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { reanalyzeGaps } from '../../src/ai-pipeline/gapReanalyze'
import { refineAlignmentWithPhrases } from '../../src/lyrics/phraseAlignment'
import { enumerateGapHoles, holeWorthRetrying } from '../../src/lyrics/gapRealign'
import { sanitizeTranscript, type TranscriptWord } from '../../src/ai-pipeline/aligner'
import { computeLineMatchedSpans } from '../../src/ai-pipeline/contentAligner'
import { parseLrc, matchSheetToLrc } from '../../scripts/lib/lrcTruth.mjs'

/**
 * Round-11 focused-re-pass e2e on the WORST real corpus failure: the
 * ja-forced stranger-than-heaven transcript has a ~35s hole (165→200s —
 * Whisper transcribed nothing over the bridge + last chorus), so the aligner
 * packed lyric lines ~#40–51 tens of seconds early and a repeated chorus tag
 * anchored on a stolen occurrence. Pre-round-11, the needs_review→approximate
 * upgrades disguised the run from enumerateGapHoles and the stolen anchor
 * capped the window at ~158s, so gap re-transcription could never reach the
 * un-heard audio.
 *
 * This test drives the REAL pipeline end-to-end (refine → enumerate → aim →
 * splice) with one mock: transcribeSlice serves the committed EN-forced
 * transcript restricted to the requested window — exactly what the app's
 * forced-language slice would hear (the hole's lines are English, so
 * forcedLangForHole picks 'en'). Ground truth: the human-synced LRC.
 */
const here = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(here, 'fixtures/stranger-than-heaven')

function loadWords(path: string): TranscriptWord[] {
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  const arr = Array.isArray(raw)
    ? raw.map((w: { word?: string; startTime?: number; endTime?: number }) => ({
        word: (w.word ?? '').trim(),
        startTime: w.startTime,
        endTime: w.endTime,
      }))
    : (raw.chunks ?? []).map((c: { text?: string; timestamp?: number[] }) => ({
        word: c.text?.trim(),
        startTime: c.timestamp?.[0],
        endTime: c.timestamp?.[1],
      }))
  return arr.filter(
    (w: { word?: string; startTime?: number; endTime?: number }) =>
      w.word && Number.isFinite(w.startTime) && Number.isFinite(w.endTime),
  ) as TranscriptWord[]
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

describe('focused re-pass recovers the stranger-than-heaven transcript hole', () => {
  it(
    'finds the disguised hole past the stolen anchor, aims at the un-heard span, and the splice fixes the last chorus',
    { timeout: 30_000 },
    async () => {
      const lineTexts = readFileSync(join(FIXTURES, 'lyrics.txt'), 'utf8')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
      const words = loadWords(join(FIXTURES, 'transcript.word.json'))
      const enWords = loadWords(join(FIXTURES, 'transcript.segment.forced-en.json'))
      const sheetRows = lineTexts.map((original) => ({
        original,
        translation: '',
        startTime: 0,
        endTime: 0,
      }))
      const refined = refineAlignmentWithPhrases(sheetRows, words, 'ja')

      // LRC truth with the version offset removed (same recipe as audit-vs-lrc).
      const lrc = JSON.parse(readFileSync(join(here, 'fixtures/lrc-truth/stranger-than-heaven.json'), 'utf8'))
      const truth = matchSheetToLrc(lineTexts, parseLrc(lrc.syncedLyrics)) as (number | null)[]
      const spans = computeLineMatchedSpans(lineTexts, sanitizeTranscript(words))
      const diffs: number[] = []
      for (let i = 0; i < lineTexts.length; i++) {
        const t = truth[i]
        const s = spans[i]
        if (t == null || !s) continue
        if (s.matchedChars / Math.max(1, s.totalChars) >= 0.5) diffs.push(s.firstTime - t)
      }
      const offset = median(diffs)
      // The last-chorus block the hole swallowed (truth ~177.5–194.5s).
      const CHORUS = [44, 45, 46, 47, 48, 49, 50, 51]
      const meanErr = (lines: { startTime: number }[]) => {
        let sum = 0
        for (const i of CHORUS) sum += Math.abs(lines[i].startTime - (truth[i]! + offset))
        return sum / CHORUS.length
      }
      const errBefore = meanErr(refined.lines)
      expect(errBefore).toBeGreaterThan(15) // the block really is packed ~tens of seconds early

      // 1. The hole is no longer disguised, and its window reaches the un-heard
      //    audio (pre-round-11 the stolen anchor capped it near 158s).
      const holes = enumerateGapHoles(refined, words).filter((h) =>
        holeWorthRetrying(h, words, lineTexts),
      )
      const wide = holes.find((h) => h.from <= 44 && h.to >= 51)
      expect(wide, 'a worth-retrying hole spanning the last chorus').toBeTruthy()
      expect(wide!.t1).toBeGreaterThan(195)

      // 2. Focused re-pass with a slice transcriber serving the EN-forced words
      //    for the requested window only.
      const transcribeSlice = async (t0: number, t1: number) =>
        enWords.filter((w) => w.startTime >= t0 && w.endTime <= t1)
      const result = await reanalyzeGaps({
        refined,
        transcriptWords: words,
        sheetRows,
        alignmentLanguage: 'mixed',
        sourceLanguage: 'ja',
        transcribeSlice,
      })
      expect(result.filledCount).toBeGreaterThanOrEqual(1)

      // 3. The last chorus lands dramatically closer to the human-synced truth.
      const errAfter = meanErr(result.refined.lines)
      expect(errAfter).toBeLessThan(errBefore * 0.5)
      expect(errAfter).toBeLessThan(6)
      // The slice-evidenced block itself is essentially fixed (was ~-36s off).
      for (const i of [45, 46, 47, 48, 49]) {
        expect(
          Math.abs(result.refined.lines[i].startTime - (truth[i]! + offset)),
          `line #${i} recovered onto its sung position`,
        ).toBeLessThan(2.5)
      }
      // NEVER-WORSE: lines that were already correctly placed after the hole
      // (#52-54, ~2s from truth via their own evidence) are byte-identical —
      // the focused splice must not touch them (weak echo matches at the range
      // edges used to drag them 5-9s off).
      for (const i of [52, 53, 54]) {
        expect(result.refined.lines[i].startTime).toBe(refined.lines[i].startTime)
        expect(result.refined.lines[i].endTime).toBe(refined.lines[i].endTime)
      }
    },
  )
})

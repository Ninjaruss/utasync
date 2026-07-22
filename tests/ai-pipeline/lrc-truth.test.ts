import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { refineAlignmentWithPhrases } from '../../src/lyrics/phraseAlignment'
import { refineMixedLanguageAlignment } from '../../src/ai-pipeline/mixedLanguageAlign'
import { sanitizeTranscript, type TranscriptWord } from '../../src/ai-pipeline/aligner'
import { computeLineMatchedSpans } from '../../src/ai-pipeline/contentAligner'
import { parseLrc, matchSheetToLrc } from '../../scripts/lib/lrcTruth.mjs'
import type { TimedLine } from '../../src/core/types'

/**
 * Ground-truth regression lock (plan: 2026-07-13-alignment-ground-truth.md).
 * Scores aligned line starts against human-synced LRCLIB timestamps — the
 * only metric that measures what the listener hears. Thresholds are the
 * measured post-fix values plus small headroom; if a change pushes truth
 * error past them, the change is wrong no matter what the transcript-relative
 * corpus scorecard says (the truth instrument is the senior gate).
 */

const here = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(here, 'fixtures')

function loadWords(path: string): TranscriptWord[] {
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  const arr = Array.isArray(raw)
    ? raw.map((w: { word?: string; startTime?: number; endTime?: number }) => ({
        word: (w.word ?? '').trim(), startTime: w.startTime, endTime: w.endTime,
      }))
    : (raw.chunks ?? []).map((c: { text?: string; timestamp?: [number, number] }) => ({
        word: c.text?.trim(), startTime: c.timestamp?.[0], endTime: c.timestamp?.[1],
      }))
  return arr.filter((w: { word?: string; startTime?: number; endTime?: number }) =>
    w.word && Number.isFinite(w.startTime) && Number.isFinite(w.endTime)) as TranscriptWord[]
}
const readLines = (p: string) =>
  readFileSync(p, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)

function truthMetrics(
  lines: TimedLine[],
  lineTexts: string[],
  scoredWords: TranscriptWord[],
  truthTime: (number | null)[],
) {
  const spans = computeLineMatchedSpans(lineTexts, sanitizeTranscript(scoredWords))
  const diffs: number[] = []
  for (let i = 0; i < lines.length; i++) {
    const t = truthTime[i]
    const s = spans[i]
    if (t == null || !s || s.firstTime == null) continue
    if (s.matchedChars / Math.max(1, s.totalChars) < 0.5) continue
    diffs.push(s.firstTime - t)
  }
  diffs.sort((a, b) => a - b)
  const offset = diffs[Math.floor(diffs.length / 2)] ?? 0
  const errs: number[] = []
  for (let i = 0; i < lines.length; i++) {
    const t = truthTime[i]
    if (t == null) continue
    errs.push(Math.abs(lines[i].startTime - (t + offset)))
  }
  errs.sort((a, b) => a - b)
  return {
    p50: errs[Math.floor(errs.length / 2)] ?? Infinity,
    p90: errs[Math.min(errs.length - 1, Math.floor(0.9 * errs.length))] ?? Infinity,
    over1s: errs.filter((e) => e > 1).length,
    n: errs.length,
  }
}

function loadTruth(fixture: string, lyrics: string) {
  const lineTexts = readLines(join(FIXTURES, lyrics))
  const lrc = JSON.parse(readFileSync(join(FIXTURES, fixture), 'utf8'))
  const truthTime = matchSheetToLrc(lineTexts, parseLrc(lrc.syncedLyrics))
  return { lineTexts, truthTime }
}

describe('alignment vs human-synced LRC ground truth', () => {
  it('guitar-loneliness word mode stays within measured truth error', { timeout: 20_000 }, () => {
    const { lineTexts, truthTime } = loadTruth('lrc-truth/guitar-loneliness.json', 'guitar-loneliness/lyrics.ja.txt')
    const words = loadWords(join(FIXTURES, 'guitar-loneliness/transcript.word.json'))
    const sheetRows = lineTexts.map((original) => ({ original, translation: '', startTime: 0, endTime: 0 }))
    const refined = refineAlignmentWithPhrases(sheetRows, words, 'ja')
    const m = truthMetrics(refined.lines, lineTexts, words, truthTime)
    expect(m.n).toBeGreaterThanOrEqual(30)
    expect(m.p50).toBeLessThanOrEqual(0.5)   // measured 0.40 (round 6, unchanged)
    expect(m.p90).toBeLessThanOrEqual(1.95)  // measured 1.62 (round 6, unchanged)
    expect(m.over1s).toBeLessThanOrEqual(6)  // measured 5 (round 6, unchanged)
  })

  it('guitar-loneliness segment mode stays within measured truth error', { timeout: 20_000 }, () => {
    const { lineTexts, truthTime } = loadTruth('lrc-truth/guitar-loneliness.json', 'guitar-loneliness/lyrics.ja.txt')
    const words = loadWords(join(FIXTURES, 'guitar-loneliness/transcript.segment.json'))
    const sheetRows = lineTexts.map((original) => ({ original, translation: '', startTime: 0, endTime: 0 }))
    const refined = refineAlignmentWithPhrases(sheetRows, words, 'ja')
    const m = truthMetrics(refined.lines, lineTexts, words, truthTime)
    expect(m.p50).toBeLessThanOrEqual(0.9)   // measured 0.73 (round 6, unchanged)
    expect(m.p90).toBeLessThanOrEqual(2.35)  // measured 1.93 round 6 (was 1.96 → 2.4)
    expect(m.over1s).toBeLessThanOrEqual(16) // measured 13 round 6 (was 14 → 17)
  })

  it('stranger-than-heaven segment ja-only stays within measured truth error', { timeout: 30_000 }, () => {
    const { lineTexts, truthTime } = loadTruth('lrc-truth/stranger-than-heaven.json', 'stranger-than-heaven/lyrics.txt')
    const ja = loadWords(join(FIXTURES, 'stranger-than-heaven/transcript.segment.json'))
    const sheetRows = lineTexts.map((original) => ({ original, translation: '', startTime: 0, endTime: 0 }))
    const refined = refineAlignmentWithPhrases(sheetRows, ja, 'ja')
    const m = truthMetrics(refined.lines, lineTexts, ja, truthTime)
    expect(m.n).toBe(59)
    // Locks the round-6 D2 verse-cascade recovery: p50 5.93 → 1.44 (high-cov
    // above-cap late-start pull recovered rows ~23–30). Do not loosen.
    expect(m.p50).toBeLessThanOrEqual(1.8)   // measured 1.44 round 6 (was 5.93)
    // p90/over1s are dominated by the ~20-line class-A alternate-take chorus
    // tail (#32–51, no transcript evidence anywhere) — un-anchorable at source,
    // guarded loosely so the tail can't silently grow.
    expect(m.p90).toBeLessThanOrEqual(35)    // measured 33.79 (class-A tail)
    expect(m.over1s).toBeLessThanOrEqual(35) // measured 33 (class-A tail)
  })

  it('stranger-than-heaven segment two-pass (the app path) stays within measured truth error', { timeout: 30_000 }, () => {
    const { lineTexts, truthTime } = loadTruth('lrc-truth/stranger-than-heaven.json', 'stranger-than-heaven/lyrics.txt')
    const ja = loadWords(join(FIXTURES, 'stranger-than-heaven/transcript.segment.json'))
    const en = loadWords(join(FIXTURES, 'stranger-than-heaven/transcript.segment.forced-en.json'))
    const sheetRows = lineTexts.map((original) => ({ original, translation: '', startTime: 0, endTime: 0 }))
    const mixed = refineMixedLanguageAlignment(sheetRows, ja, en)
    const m = truthMetrics(mixed.refined.lines, lineTexts, mixed.transcriptWords, truthTime)
    expect(m.n).toBe(59)
    expect(m.p50).toBeLessThanOrEqual(0.7)   // measured 0.56 (round 6, unchanged; was 2.03 pre-fix)
    expect(m.p90).toBeLessThanOrEqual(7.8)   // measured 6.48 round 6 (was 7.86 → 9.5)
    expect(m.over1s).toBeLessThanOrEqual(24) // measured 20 round 6 (was 22 → 27)
  })

  // veil — pure Japanese; the aligner's clean-JA case. Very accurate; tight
  // thresholds lock it so a change tuned for hard mixed songs can't quietly
  // regress the common single-language path.
  it('veil (pure Japanese) stays within measured truth error', { timeout: 20_000 }, () => {
    const { lineTexts, truthTime } = loadTruth('lrc-truth/veil.json', 'veil/lyrics.ja.txt')
    const words = loadWords(join(FIXTURES, 'veil/transcript.words.json'))
    const sheetRows = lineTexts.map((original) => ({ original, translation: '', startTime: 0, endTime: 0 }))
    const refined = refineAlignmentWithPhrases(sheetRows, words, 'ja')
    const m = truthMetrics(refined.lines, lineTexts, words, truthTime)
    expect(m.n).toBeGreaterThanOrEqual(45)   // measured 48
    expect(m.p50).toBeLessThanOrEqual(0.45)  // measured 0.24 — pure JA is very accurate
    expect(m.p90).toBeLessThanOrEqual(1.3)   // measured 0.96
    expect(m.over1s).toBeLessThanOrEqual(6)  // measured 4
  })

  // Recollect (Re:Zero S4 OP, Konomi Suzuki feat. Ashnikko) — dense within-line
  // JA/EN code-switching. Non-vocal-isolated transcripts, so error is high and
  // transcription-bound; the consensus pass-selection recovered whole-section
  // drift (mean 3.38 → 2.89s). Thresholds lock the current state as a ratchet.
  it('recollect segment two-pass (mixed) stays within measured truth error', { timeout: 30_000 }, () => {
    const { lineTexts, truthTime } = loadTruth('lrc-truth/recollect.json', 'recollect/lyrics.txt')
    const ja = loadWords(join(FIXTURES, 'recollect/transcript.segment.json'))
    const en = loadWords(join(FIXTURES, 'recollect/transcript.segment.forced-en.json'))
    const sheetRows = lineTexts.map((original) => ({ original, translation: '', startTime: 0, endTime: 0 }))
    const mixed = refineMixedLanguageAlignment(sheetRows, ja, en)
    const m = truthMetrics(mixed.refined.lines, lineTexts, mixed.transcriptWords, truthTime)
    expect(m.n).toBeGreaterThanOrEqual(40)         // measured 47
    expect(m.p50).toBeLessThanOrEqual(2.2)         // measured 1.89 (consensus pass-selection; 2.1 without)
    expect(m.p90).toBeLessThanOrEqual(7.0)         // measured 6.18
    expect(m.over1s).toBeLessThanOrEqual(35)       // measured 32 — high: non-isolated transcript, transcription-bound
  })
})

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
    expect(m.p50).toBeLessThanOrEqual(0.6)   // measured 0.45
    expect(m.p90).toBeLessThanOrEqual(2.2)   // measured 1.70
    expect(m.over1s).toBeLessThanOrEqual(8)  // measured 6
  })

  it('guitar-loneliness segment mode stays within measured truth error', { timeout: 20_000 }, () => {
    const { lineTexts, truthTime } = loadTruth('lrc-truth/guitar-loneliness.json', 'guitar-loneliness/lyrics.ja.txt')
    const words = loadWords(join(FIXTURES, 'guitar-loneliness/transcript.segment.json'))
    const sheetRows = lineTexts.map((original) => ({ original, translation: '', startTime: 0, endTime: 0 }))
    const refined = refineAlignmentWithPhrases(sheetRows, words, 'ja')
    const m = truthMetrics(refined.lines, lineTexts, words, truthTime)
    expect(m.p50).toBeLessThanOrEqual(1.0)   // measured 0.81
    expect(m.p90).toBeLessThanOrEqual(3.6)   // measured 2.92
    expect(m.over1s).toBeLessThanOrEqual(18) // measured 16
  })

  it('stranger-than-heaven segment two-pass (the app path) stays within measured truth error', { timeout: 30_000 }, () => {
    const { lineTexts, truthTime } = loadTruth('lrc-truth/stranger-than-heaven.json', 'stranger-than-heaven/lyrics.txt')
    const ja = loadWords(join(FIXTURES, 'stranger-than-heaven/transcript.segment.json'))
    const en = loadWords(join(FIXTURES, 'stranger-than-heaven/transcript.segment.forced-en.json'))
    const sheetRows = lineTexts.map((original) => ({ original, translation: '', startTime: 0, endTime: 0 }))
    const mixed = refineMixedLanguageAlignment(sheetRows, ja, en)
    const m = truthMetrics(mixed.refined.lines, lineTexts, mixed.transcriptWords, truthTime)
    expect(m.n).toBe(59)
    expect(m.p50).toBeLessThanOrEqual(0.9)   // measured 0.73 (was 2.03 pre-fix)
    expect(m.p90).toBeLessThanOrEqual(9.5)   // measured 7.86 (LRC version drift caveat)
    expect(m.over1s).toBeLessThanOrEqual(28) // measured 25 (was 35)
  })
})

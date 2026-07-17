import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { refineAlignmentWithPhrases } from '../../src/lyrics/phraseAlignment'
import { refineMixedLanguageAlignment } from '../../src/ai-pipeline/mixedLanguageAlign'
import { sanitizeTranscript } from '../../src/ai-pipeline/aligner'
import { computeLineMatchedSpans } from '../../src/ai-pipeline/contentAligner'
import { parseLrc, matchSheetToLrc } from '../../scripts/lib/lrcTruth.mjs'
import type { LineAlignmentQuality } from '../../src/core/types'

/**
 * Label-honesty ratchet (2026-07 line-accuracy audit): the per-line quality
 * labels must not lie. For every corpus config with ground truth (human-synced
 * LRC for guitar-loneliness + stranger-than-heaven, official caption onsets for
 * akfg), this measures how many lines labeled 'good' actually START more than
 * the tolerance away from the truth — the "says it's aligned but isn't" false
 * negative — and pins each config at its post-fix count. It also pins a FLOOR
 * on the number of 'good' labels per config, so honesty can't be trivially
 * "achieved" by demoting everything.
 *
 * If a legitimate aligner change shifts these numbers, re-measure with
 *   npx tsx scripts/audit-line-quality.mjs --details
 * and update the table with a findings note — ceilings only ratchet DOWN.
 */
const here = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(here, 'fixtures')

// Official YouTube caption onsets for the AKFG corpus lyrics; canonical copy in
// akfg-ground-truth.test.ts. `shared` = second half of a caption (onset is a
// lower bound only) — excluded from misplacement scoring.
const AKFG_TRUTH: { idx: number; onset: number; shared?: boolean; tol?: number }[] = [
  { idx: 0, onset: 98 }, { idx: 1, onset: 104 }, { idx: 2, onset: 111 },
  { idx: 3, onset: 118 }, { idx: 4, onset: 122 }, { idx: 5, onset: 131 },
  { idx: 6, onset: 131, shared: true }, { idx: 7, onset: 141 },
  { idx: 8, onset: 141, shared: true }, { idx: 9, onset: 148 },
  { idx: 10, onset: 154 }, { idx: 11, onset: 154, shared: true },
  { idx: 12, onset: 161 }, { idx: 13, onset: 177 }, { idx: 14, onset: 183 },
  { idx: 15, onset: 190 }, { idx: 16, onset: 203 }, { idx: 17, onset: 210 },
  { idx: 18, onset: 217 }, { idx: 19, onset: 217, shared: true },
  { idx: 20, onset: 223, tol: 3 }, { idx: 21, onset: 262 }, { idx: 22, onset: 275 },
  { idx: 23, onset: 282 }, { idx: 24, onset: 292 }, { idx: 25, onset: 292, shared: true },
  { idx: 26, onset: 299 }, { idx: 27, onset: 306 }, { idx: 28, onset: 306, shared: true },
  { idx: 29, onset: 312, tol: 3 },
]

const TRUTH_TOL_S = 1.5

interface Expectation {
  /** Max lines labeled 'good' whose start misses truth by > tolerance. */
  maxMisplacedGood: number
  /** Min lines still labeled 'good' (anti-over-flagging floor). */
  minGood: number
}

// Post-fix measurements (see scripts/audit-line-quality.mjs). Before the
// label-honesty pass the same oracle counted 41 misplaced 'good' lines across
// these configs; the residual below is dominated by ~1.5-3s transcript-
// timestamp skews that text evidence cannot see (the weak-labels /
// segment-blocks Edit-mode hint owns those).
const EXPECTATIONS: Record<string, Expectation> = {
  'akfg-firsttake-word': { maxMisplacedGood: 1, minGood: 24 },
  'akfg-firsttake-segment': { maxMisplacedGood: 0, minGood: 23 },
  'akfg-garbled-word': { maxMisplacedGood: 1, minGood: 19 },
  'akfg-instrumental-word': { maxMisplacedGood: 1, minGood: 20 },
  'stranger-than-heaven-word': { maxMisplacedGood: 0, minGood: 24 },
  'stranger-than-heaven-segment': { maxMisplacedGood: 0, minGood: 21 },
  'stranger-than-heaven-word-autolang': { maxMisplacedGood: 0, minGood: 0 },
  'stranger-than-heaven-segment-autolang': { maxMisplacedGood: 0, minGood: 0 },
  'stranger-than-heaven-word-medium': { maxMisplacedGood: 1, minGood: 26 },
  'stranger-than-heaven-segment-medium': { maxMisplacedGood: 2, minGood: 25 },
  'stranger-than-heaven-mixed-segment': { maxMisplacedGood: 3, minGood: 29 },
  'stranger-than-heaven-mixed-word': { maxMisplacedGood: 5, minGood: 31 },
  'guitar-loneliness-word': { maxMisplacedGood: 3, minGood: 40 },
  'guitar-loneliness-segment': { maxMisplacedGood: 2, minGood: 26 },
}

// No-truth configs still get an anti-over-flagging floor.
const GOOD_FLOORS: Record<string, number> = {
  veil: 34,
  'my-eyes-only': 37,
}

interface CorpusSong {
  name: string
  lang: 'ja' | 'en' | 'mixed'
  lyrics: string
  transcript: string
  transcriptEn?: string
}

function loadTranscriptWords(path: string) {
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  if (Array.isArray(raw)) {
    return raw.flatMap((w: { word?: string; startTime?: number; endTime?: number }) => {
      const word = (w.word ?? '').trim()
      if (!word || !Number.isFinite(w.startTime) || !Number.isFinite(w.endTime)) return []
      return [{ word, startTime: w.startTime!, endTime: w.endTime! }]
    })
  }
  return (raw.chunks ?? []).flatMap((c: { text?: string; timestamp?: number[] }) => {
    const [start, end] = c.timestamp ?? []
    const word = c.text?.trim()
    if (!word || !Number.isFinite(start) || !Number.isFinite(end)) return []
    return [{ word, startTime: start!, endTime: end! }]
  })
}

const readLines = (p: string) =>
  readFileSync(p, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)

const median = (xs: number[]): number | null => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

function loadTruth(songName: string, lineTexts: string[]) {
  if (songName.startsWith('guitar-loneliness') || songName.startsWith('stranger-than-heaven')) {
    const file = songName.startsWith('guitar-loneliness')
      ? 'lrc-truth/guitar-loneliness.json'
      : 'lrc-truth/stranger-than-heaven.json'
    const lrc = JSON.parse(readFileSync(join(FIXTURES, file), 'utf8'))
    const time = matchSheetToLrc(lineTexts, parseLrc(lrc.syncedLyrics)) as (number | null)[]
    return { time, tol: time.map(() => TRUTH_TOL_S), needsOffset: true }
  }
  if (songName.startsWith('akfg')) {
    const time: (number | null)[] = lineTexts.map(() => null)
    const tol = lineTexts.map(() => TRUTH_TOL_S)
    for (const g of AKFG_TRUTH) {
      if (g.shared) continue
      time[g.idx] = g.onset
      tol[g.idx] = Math.max(TRUTH_TOL_S, g.tol ?? 2)
    }
    return { time, tol, needsOffset: false }
  }
  return { time: lineTexts.map(() => null) as (number | null)[], tol: [] as number[], needsOffset: false }
}

const manifest = JSON.parse(readFileSync(join(FIXTURES, 'corpus.json'), 'utf8')) as {
  songs: CorpusSong[]
}

describe('label honesty vs ground truth (corpus ratchet)', () => {
  for (const song of manifest.songs) {
    const expectation = EXPECTATIONS[song.name]
    const goodFloor = expectation?.minGood ?? GOOD_FLOORS[song.name]
    if (!expectation && goodFloor === undefined) continue

    it(`${song.name}: misplaced-good <= ${expectation?.maxMisplacedGood ?? 'n/a'}, good >= ${goodFloor}`, { timeout: 20_000 }, () => {
      const lineTexts = readLines(join(FIXTURES, song.lyrics))
      let words = loadTranscriptWords(join(FIXTURES, song.transcript))
      const sheetRows = lineTexts.map((original) => ({
        original,
        translation: '',
        startTime: 0,
        endTime: 0,
      }))
      let refined
      if (song.transcriptEn) {
        const enWords = loadTranscriptWords(join(FIXTURES, song.transcriptEn))
        const mixed = refineMixedLanguageAlignment(sheetRows, words, enWords)
        refined = mixed.refined
        words = mixed.transcriptWords
      } else {
        refined = refineAlignmentWithPhrases(sheetRows, words, song.lang)
      }
      const quality = (refined.lineAlignmentQuality ?? []) as LineAlignmentQuality[]
      const goodCount = quality.filter((q) => q === 'good').length
      expect(goodCount, 'good-label floor (over-flagging guard)').toBeGreaterThanOrEqual(goodFloor)

      if (!expectation) return
      const truth = loadTruth(song.name, lineTexts)
      // LRC versions can carry a constant intro-length offset — remove the
      // robust median of (evidence - truth) like scripts/audit-vs-lrc.mjs.
      let offset = 0
      if (truth.needsOffset) {
        const spans = computeLineMatchedSpans(lineTexts, sanitizeTranscript(words))
        const diffs: number[] = []
        for (let i = 0; i < refined.lines.length; i++) {
          const t = truth.time[i]
          const s = spans[i]
          if (t == null || !s) continue
          if (s.matchedChars / Math.max(1, s.totalChars) >= 0.5) diffs.push(s.firstTime - t)
        }
        offset = median(diffs) ?? 0
      }
      let misplacedGood = 0
      const offenders: string[] = []
      for (let i = 0; i < refined.lines.length; i++) {
        if (quality[i] !== 'good') continue
        const t = truth.time[i]
        if (t == null) continue
        const err = refined.lines[i].startTime - (t + offset)
        if (Math.abs(err) > truth.tol[i]) {
          misplacedGood++
          offenders.push(`#${i} err=${err.toFixed(2)}s ${lineTexts[i].slice(0, 24)}`)
        }
      }
      expect(
        misplacedGood,
        `lines labeled 'good' but starting > tolerance from truth:\n  ${offenders.join('\n  ')}`,
      ).toBeLessThanOrEqual(expectation.maxMisplacedGood)
    })
  }
})

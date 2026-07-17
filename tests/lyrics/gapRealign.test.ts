import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  enumerateGapHoles,
  holeWorthRetrying,
  spliceGapAlignment,
  type GapHole,
} from '../../src/lyrics/gapRealign'
import { refineAlignmentWithPhrases, type RefinedAlignment } from '../../src/lyrics/phraseAlignment'
import type {
  LineAlignmentQuality,
  SungPhrase,
  TimedLine,
} from '../../src/core/types'
import type { TranscriptWord } from '../../src/ai-pipeline/aligner'

const line = (
  original: string,
  startTime: number,
  endTime: number,
): TimedLine => ({ original, translation: '', startTime, endTime })

const w = (word: string, startTime: number, endTime: number): TranscriptWord => ({
  word,
  startTime,
  endTime,
})

/** Split `text` into evenly-timed word tokens spanning [start,end] (char-LCS
 * matches the lyric text of the same words). Mirrors the runCoverage fixtures. */
function anchorWords(text: string, start: number, end: number): TranscriptWord[] {
  const words = text.split(' ')
  const dur = (end - start) / words.length
  return words.map((word, i) => w(word, start + i * dur, start + (i + 1) * dur))
}

/** Build a RefinedAlignment literal: one 1:1 phrase per line so phrase re-sync
 * has something to move, plus a per-line quality array. */
function makeRefined(
  lines: TimedLine[],
  quality: LineAlignmentQuality[],
): RefinedAlignment {
  const phrases: SungPhrase[] = lines.map((l, i) => ({
    id: `p${i}`,
    startTime: l.startTime,
    endTime: l.endTime,
    original: l.original,
    translation: l.translation,
    anchorSource: 'lcs',
    sourceLineIndices: [i],
  }))
  return {
    lines,
    phrases,
    report: { splits: 0, merges: 0, lowConfidence: 0 },
    mode: 'content',
    confidence: 0.9,
    anchorSources: lines.map(() => 'lcs'),
    lineAlignmentQuality: quality,
    phraseLayout: 'sheet',
  }
}

const BEFORE = 'the quick brown fox jumps over the lazy dog again'
const AFTER = 'every good boy deserves fudge and cake at the party'
const GAP1 = 'moonlight velvet harbor drifting slowly onward'
const GAP2 = 'silver rivers flowing gently through the night'

describe('enumerateGapHoles', () => {
  it('finds a needs_review run bounded by good anchors', () => {
    const lines = [
      line(BEFORE, 10, 14),
      line(GAP1, 14, 14.1),
      line(GAP2, 14.1, 14.2),
      line(AFTER, 44, 48),
    ]
    const refined = makeRefined(lines, ['good', 'needs_review', 'needs_review', 'good'])
    const holes = enumerateGapHoles(refined, [])
    expect(holes).toEqual<GapHole[]>([{ from: 1, to: 2, t0: 14, t1: 44 }])
  })

  it('returns [] for a fully-good alignment', () => {
    const lines = [line(BEFORE, 10, 14), line(GAP1, 14, 18), line(AFTER, 44, 48)]
    const refined = makeRefined(lines, ['good', 'good', 'good'])
    expect(enumerateGapHoles(refined, [])).toEqual([])
  })

  it('skips a run whose lines are all interjection/blank', () => {
    const lines = [
      line(BEFORE, 10, 14),
      line('嗚呼', 14, 14.1),
      line('Ahh, ooh-hmm', 14.1, 14.2),
      line(AFTER, 44, 48),
    ]
    const refined = makeRefined(lines, ['good', 'needs_review', 'needs_review', 'good'])
    expect(enumerateGapHoles(refined, [])).toEqual([])
  })

  it('anchors t0/t1 to the edges when the hole touches the array boundary', () => {
    const lines = [line(GAP1, 0, 4), line(AFTER, 44, 48)]
    const refined = makeRefined(lines, ['needs_review', 'good'])
    // from=0 → t0 defaults to 0; anchorAfter=lines[1].startTime=44.
    expect(enumerateGapHoles(refined, [])).toEqual<GapHole[]>([{ from: 0, to: 0, t0: 0, t1: 44 }])
  })
})

describe('holeWorthRetrying', () => {
  const sheetTexts = [BEFORE, GAP1, GAP2, AFTER]
  const hole: GapHole = { from: 1, to: 2, t0: 14, t1: 44 }

  it('is true for a low-coverage lyric window (sheet expects lyrics, transcript does not corroborate)', () => {
    // Only a lone hallucinated blip inside [14,44] — coverage ≈ 0.
    const words = [
      ...anchorWords(BEFORE, 10, 14),
      w('zzqx', 26, 27),
      ...anchorWords(AFTER, 44, 48),
    ]
    expect(holeWorthRetrying(hole, words, sheetTexts)).toBe(true)
  })

  it('is false when the window is already well covered by the transcript', () => {
    const words = [
      ...anchorWords(BEFORE, 10, 14),
      ...anchorWords(GAP1, 18, 26),
      ...anchorWords(GAP2, 30, 40),
      ...anchorWords(AFTER, 44, 48),
    ]
    expect(holeWorthRetrying(hole, words, sheetTexts)).toBe(false)
  })

  it('is false for a window shorter than the minimum (< ~4s), even with no coverage', () => {
    const shortHole: GapHole = { from: 1, to: 1, t0: 14, t1: 17 }
    const words = [...anchorWords(BEFORE, 10, 14), ...anchorWords(AFTER, 44, 48)]
    expect(holeWorthRetrying(shortHole, words, sheetTexts)).toBe(false)
  })
})

describe('spliceGapAlignment', () => {
  // A "bad" alignment: the two gap lines are needs_review and mis-timed (crammed
  // into a 0.2s sliver right after the first anchor), bounded by good anchors.
  function badAlignment() {
    const lines = [
      line(BEFORE, 10, 14),
      line(GAP1, 14, 14.1),
      line(GAP2, 14.1, 14.2),
      line(AFTER, 44, 48),
    ]
    return makeRefined(lines, ['good', 'needs_review', 'needs_review', 'good'])
  }

  const globalTranscript = [
    ...anchorWords(BEFORE, 10, 14),
    w('zzqx', 26, 27),
    ...anchorWords(AFTER, 44, 48),
  ]

  it('ACCEPTS a clean gap transcript: anchors the gap lines, fewer needs_review, monotonic, anchors untouched', () => {
    const refined = badAlignment()
    const before = structuredClone(refined)
    // A clean re-transcript of the window [14,44] whose words match the gap lines.
    const gapWords = [...anchorWords(GAP1, 18, 26), ...anchorWords(GAP2, 30, 40)]
    const res = spliceGapAlignment({
      refined,
      transcriptWords: globalTranscript,
      sheetRows: refined.lines,
      from: 1,
      to: 2,
      gapWords,
      lang: 'en',
    })

    expect(res.accepted).toBe(true)
    const q = res.refined.lineAlignmentQuality!
    const nrAfter = q.slice(1, 3).filter((x) => x === 'needs_review').length
    expect(nrAfter).toBeLessThan(2)
    // Gap lines land inside the window [14,44].
    expect(res.refined.lines[1].startTime).toBeGreaterThanOrEqual(14 - 1e-6)
    expect(res.refined.lines[2].endTime).toBeLessThanOrEqual(44 + 1e-6)
    // Monotonic non-degenerate.
    for (let i = 1; i < res.refined.lines.length; i++) {
      expect(res.refined.lines[i].startTime).toBeGreaterThanOrEqual(
        res.refined.lines[i - 1].startTime - 1e-6,
      )
    }
    // Anchors byte-identical to the input.
    expect(res.refined.lines[0]).toEqual(before.lines[0])
    expect(res.refined.lines[3]).toEqual(before.lines[3])
    // Transcript region-spliced: old window blip gone, gap words present.
    expect(res.transcriptWords.some((x) => x.word === 'zzqx')).toBe(false)
    expect(res.transcriptWords.some((x) => x.word === 'moonlight')).toBe(true)
    // Sorted by startTime.
    for (let i = 1; i < res.transcriptWords.length; i++) {
      expect(res.transcriptWords[i].startTime).toBeGreaterThanOrEqual(
        res.transcriptWords[i - 1].startTime - 1e-6,
      )
    }
  })

  // THE SECOND SAFETY TEST (round-8 G1 follow-up): the gap words carry the
  // CORRECT text but in the WRONG ORDER. A pure needs_review-count gate accepts
  // this (count drops 2→1 because one line still anchors) even though the other
  // line is forced ~15s from its evidence by monotonicity. The placement-aware
  // coverage guard must catch it: placed-coverage falls well below the order-free
  // coverage the same words could achieve, so the splice is REJECTED and the
  // input stays byte-identical.
  it('REJECTS correct-but-reversed gap words (placement regresses despite a needs_review drop)', () => {
    const refined = badAlignment()
    const snapshot = structuredClone(refined)
    // GAP2's words placed early (18–26), GAP1's words placed late (30–40): the
    // right text, reversed relative to the sheet line order.
    const reversedGap = [...anchorWords(GAP2, 18, 26), ...anchorWords(GAP1, 30, 40)]
    const res = spliceGapAlignment({
      refined,
      transcriptWords: globalTranscript,
      sheetRows: refined.lines,
      from: 1,
      to: 2,
      gapWords: reversedGap,
      lang: 'en',
    })

    expect(res.accepted).toBe(false)
    expect(res.refined).toBe(refined)
    expect(res.transcriptWords).toBe(globalTranscript)
    expect(refined).toEqual(snapshot)
  })

  // THE KEY SAFETY TEST: a garbled re-transcript must be rejected, leaving the
  // input byte-identical (the pass can never make a song worse).
  it('REJECTS a garbled gap transcript and returns refined + transcriptWords byte-identical', () => {
    const refined = badAlignment()
    const snapshot = structuredClone(refined)
    const garbledGap = [
      ...anchorWords('zzqx wkpb jjvg xxqq kkzz', 18, 26),
      ...anchorWords('qqww eezz rrtt yyuu ppxx', 30, 40),
    ]
    const res = spliceGapAlignment({
      refined,
      transcriptWords: globalTranscript,
      sheetRows: refined.lines,
      from: 1,
      to: 2,
      gapWords: garbledGap,
      lang: 'en',
    })

    expect(res.accepted).toBe(false)
    // Same references returned, and unmutated.
    expect(res.refined).toBe(refined)
    expect(res.transcriptWords).toBe(globalTranscript)
    expect(refined).toEqual(snapshot)
  })
})

// Corpus-style deterministic test over the COMMITTED garbled AKFG transcript
// (fixtures/akfg/transcript.word.garbled.json). Real garbled alignment → a
// real hole → a clean gap re-transcript (built from the hole lines' own text)
// splices in and improves. Fully deterministic (no Whisper). G3 will add the
// permanent standalone clean-gap fixture file; G1 reuses committed data.
describe('gapRealign over the committed garbled AKFG fixture', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const dir = join(here, '../ai-pipeline/fixtures/akfg')

  function loadTranscriptWords(path: string): TranscriptWord[] {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as {
      chunks?: { text?: string; timestamp?: number[] }[]
    }
    return (raw.chunks ?? []).flatMap((c) => {
      const [start, end] = c.timestamp ?? []
      const word = c.text?.trim()
      if (!word || !Number.isFinite(start) || !Number.isFinite(end)) return []
      return [w(word, start as number, end as number)]
    })
  }

  it('detects the garble-desert hole, flags it worth retrying, and a clean gap re-transcript is ACCEPTED', () => {
    const lineTexts = readFileSync(join(dir, 'lyrics.ja.txt'), 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
    const sheetRows: TimedLine[] = lineTexts.map((original) => ({
      original,
      translation: '',
      startTime: 0,
      endTime: 0,
    }))
    const words = loadTranscriptWords(join(dir, 'transcript.word.garbled.json'))
    const refined = refineAlignmentWithPhrases(sheetRows, words, 'ja')

    const holes = enumerateGapHoles(refined, words)
    expect(holes.length).toBeGreaterThan(0)
    // The desert [188,258]s strips lines' evidence → the biggest hole sits there.
    const hole = holes.reduce((a, b) => (b.to - b.from > a.to - a.from ? b : a))
    expect(hole.t1).toBeGreaterThan(hole.t0)
    // Sheet expects lyrics here but the garbled transcript doesn't corroborate.
    expect(holeWorthRetrying(hole, words, lineTexts)).toBe(true)

    // A clean gap re-transcript: each hole line's own text, laid evenly across
    // [t0,t1] (simulates the forced-language slice re-transcription of G2).
    const span = (hole.t1 - hole.t0) / (hole.to - hole.from + 1)
    const gapWords: TranscriptWord[] = []
    for (let k = hole.from; k <= hole.to; k++) {
      const s = hole.t0 + (k - hole.from) * span
      gapWords.push(w(refined.lines[k].original, s + 0.1, s + span - 0.1))
    }

    const before = structuredClone(refined)
    const res = spliceGapAlignment({
      refined,
      transcriptWords: words,
      sheetRows,
      from: hole.from,
      to: hole.to,
      gapWords,
      lang: 'ja',
    })

    expect(res.accepted).toBe(true)
    const q0 = before.lineAlignmentQuality!
    const q1 = res.refined.lineAlignmentQuality!
    const nrBefore = q0.slice(hole.from, hole.to + 1).filter((x) => x === 'needs_review').length
    const nrAfter = q1.slice(hole.from, hole.to + 1).filter((x) => x === 'needs_review').length
    expect(nrAfter).toBeLessThan(nrBefore)
    // Anchors outside the hole are byte-identical.
    if (hole.from > 0) expect(res.refined.lines[hole.from - 1]).toEqual(before.lines[hole.from - 1])
    if (hole.to + 1 < before.lines.length) {
      expect(res.refined.lines[hole.to + 1]).toEqual(before.lines[hole.to + 1])
    }
  })
})

describe('gapRealign shares round-7 constants', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const readConst = (relPath: string) => {
    const src = readFileSync(join(here, relPath), 'utf8')
    const m = src.match(/const RUN_COVERAGE_MIN = ([\d.]+)/)
    if (!m) throw new Error(`RUN_COVERAGE_MIN not found in ${relPath}`)
    return Number(m[1])
  }

  it('RUN_COVERAGE_MIN in gapRealign mirrors redistributeDegenerateRuns (no silent desync)', () => {
    // gapRealign mirrors the module-private constant with a comment; this guard
    // fails if a future retune of one copy forgets the other.
    expect(readConst('../../src/lyrics/gapRealign.ts')).toBe(
      readConst('../../src/lyrics/redistributeDegenerateRuns.ts'),
    )
  })
})

describe('enumerateGapHoles round-11 semantics (unverified runs bounded by verified anchors)', () => {
  it('surfaces a DISGUISED hole: an approximate run with no corroborating evidence', () => {
    // The upgrade passes relabeled an interpolated-over-a-void run to
    // approximate; the transcript has no words under it, so it is still a hole.
    const lines = [
      line(BEFORE, 10, 14),
      line(GAP1, 14, 16),
      line(GAP2, 16, 18),
      line(AFTER, 44, 48),
    ]
    const words = [...anchorWords(BEFORE, 10, 14), ...anchorWords(AFTER, 44, 48)]
    const refined = makeRefined(lines, ['good', 'approximate', 'approximate', 'good'])
    expect(enumerateGapHoles(refined, words)).toEqual<GapHole[]>([{ from: 1, to: 2, t0: 14, t1: 44 }])
  })

  it('does NOT hole an approximate run whose lines the transcript corroborates in place', () => {
    // Chunk-demoted segment lines: approximate by construction but their own
    // words sit under them at sane widths — nothing to re-transcribe.
    const lines = [
      line(BEFORE, 10, 14),
      line(GAP1, 14, 18),
      line(GAP2, 18, 22),
      line(AFTER, 44, 48),
    ]
    const words = [
      ...anchorWords(BEFORE, 10, 14),
      ...anchorWords(GAP1, 14, 18),
      ...anchorWords(GAP2, 18, 22),
      ...anchorWords(AFTER, 44, 48),
    ]
    const refined = makeRefined(lines, ['good', 'approximate', 'approximate', 'good'])
    expect(enumerateGapHoles(refined, words)).toEqual([])
  })

  it('extends a hole past a non-desert approximate line to the verified anchor (false-anchor bypass)', () => {
    // A wrongly-anchored line inside the trouble region reads approximate with
    // local evidence (a stolen occurrence). It must NOT cap the window: the
    // run reaches the good anchor beyond it, so the slice can cover the
    // un-heard audio after the false anchor.
    const lines = [
      line(BEFORE, 10, 14),
      line(GAP1, 14, 14.1), // needs_review trouble
      line(GAP2, 14.1, 16.1), // the false anchor: approximate WITH evidence under it
      line('crimson lanterns floating over quiet water tonight', 16.1, 18),
      line(AFTER, 44, 48),
    ]
    const words = [
      ...anchorWords(BEFORE, 10, 14),
      ...anchorWords(GAP2, 14.1, 16.1),
      ...anchorWords(AFTER, 44, 48),
    ]
    const refined = makeRefined(lines, [
      'good',
      'needs_review',
      'approximate',
      'approximate',
      'good',
    ])
    // One hole spanning the whole unverified run; t1 comes from the GOOD anchor.
    expect(enumerateGapHoles(refined, words)).toEqual<GapHole[]>([{ from: 1, to: 3, t0: 14, t1: 44 }])
  })
})

describe('spliceGapAlignment round-11 acceptance (no needs_review to drop)', () => {
  const mkArgs = (gapWords: TranscriptWord[]) => {
    const lines = [
      line(BEFORE, 10, 14),
      line(GAP1, 14, 16),
      line(GAP2, 16, 18),
      line(AFTER, 44, 48),
    ]
    // Approximate hole: zero needs_review on both sides of the splice.
    const refined = makeRefined(lines, ['good', 'approximate', 'approximate', 'good'])
    const transcriptWords = [...anchorWords(BEFORE, 10, 14), ...anchorWords(AFTER, 44, 48)]
    const sheetRows = lines.map((l) => line(l.original, 0, 0))
    return { refined, transcriptWords, sheetRows, from: 1, to: 2, gapWords, lang: 'en' as const }
  }

  it('ACCEPTS a clean slice into an all-approximate hole when placed coverage strictly improves', () => {
    const gapWords = [...anchorWords(GAP1, 20, 24), ...anchorWords(GAP2, 30, 34)]
    const res = spliceGapAlignment(mkArgs(gapWords))
    expect(res.accepted).toBe(true)
    // The hole lines snapped to the fresh evidence.
    expect(res.refined.lines[1].startTime).toBeCloseTo(20, 0)
    expect(res.refined.lines[2].startTime).toBeCloseTo(30, 0)
    // Anchors untouched.
    expect(res.refined.lines[0].startTime).toBe(10)
    expect(res.refined.lines[3].startTime).toBe(44)
  })

  it('REJECTS an unrelated slice (no placed-coverage gain) and returns inputs byte-identical', () => {
    const gapWords = anchorWords('zebra quartz jigsaw phantom xylophone', 20, 30)
    const args = mkArgs(gapWords)
    const res = spliceGapAlignment(args)
    expect(res.accepted).toBe(false)
    expect(res.refined).toBe(args.refined)
    expect(res.transcriptWords).toBe(args.transcriptWords)
  })
})

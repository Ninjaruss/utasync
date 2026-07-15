import { describe, it, expect, vi } from 'vitest'
import {
  reanalyzeGaps,
  MAX_HOLES_PER_PASS,
} from '../../src/ai-pipeline/gapReanalyze'
import type { RefinedAlignment } from '../../src/lyrics/phraseAlignment'
import type { LineAlignmentQuality, SungPhrase, TimedLine } from '../../src/core/types'
import type { TranscriptWord } from '../../src/ai-pipeline/aligner'

const line = (original: string, startTime: number, endTime: number): TimedLine => ({
  original,
  translation: '',
  startTime,
  endTime,
})

const w = (word: string, startTime: number, endTime: number): TranscriptWord => ({
  word,
  startTime,
  endTime,
})

/** Evenly-timed word tokens for `text` spanning [start,end] (char-LCS matches the
 * lyric text of the same words). Mirrors gapRealign.test.ts. */
function anchorWords(text: string, start: number, end: number): TranscriptWord[] {
  const words = text.split(' ')
  const dur = (end - start) / words.length
  return words.map((word, i) => w(word, start + i * dur, start + (i + 1) * dur))
}

function makeRefined(lines: TimedLine[], quality: LineAlignmentQuality[]): RefinedAlignment {
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
const MID = 'sailing ships across the wide and open ocean blue'
const GAP1 = 'moonlight velvet harbor drifting slowly onward'
const GAP2 = 'silver rivers flowing gently through the night'
const GAP3 = 'copper mountains rising sharp against the dawn'
const GAP4 = 'amber meadows swaying softly in the breeze'

const garbage = (t0: number, t1: number): TranscriptWord[] => [
  ...anchorWords('zzqx wkpb jjvg xxqq kkzz', t0 + 1, (t0 + t1) / 2 - 1),
  ...anchorWords('qqww eezz rrtt yyuu ppxx', (t0 + t1) / 2 + 1, t1 - 1),
]

// A single hole (GAP1/GAP2 crammed into a sliver after the first anchor).
function oneHole() {
  const lines = [
    line(BEFORE, 10, 14),
    line(GAP1, 14, 14.1),
    line(GAP2, 14.1, 14.2),
    line(AFTER, 44, 48),
  ]
  return makeRefined(lines, ['good', 'needs_review', 'needs_review', 'good'])
}

const oneHoleTranscript = [
  ...anchorWords(BEFORE, 10, 14),
  w('zzqx', 26, 27),
  ...anchorWords(AFTER, 44, 48),
]

/** Clean re-transcript of a [t0,t1] window: two gap texts laid across it. */
function cleanGapSlice(t0: number, t1: number): TranscriptWord[] {
  const mid = t0 + (t1 - t0) / 2
  return [...anchorWords(GAP1, t0 + 1, mid - 1), ...anchorWords(GAP2, mid + 1, t1 - 1)]
}

describe('reanalyzeGaps', () => {
  it('(a) fills a hole when the mocked slice returns clean matching words', async () => {
    const refined = oneHole()
    const before = structuredClone(refined)
    const transcribeSlice = vi.fn(async (t0: number, t1: number) => cleanGapSlice(t0, t1))

    const res = await reanalyzeGaps({
      refined,
      transcriptWords: oneHoleTranscript,
      sheetRows: refined.lines,
      alignmentLanguage: 'en',
      transcribeSlice,
    })

    expect(res.filledCount).toBe(1)
    expect(transcribeSlice).toHaveBeenCalledTimes(1)
    // Slice window = the hole [14,44] (≤30s), forced English.
    expect(transcribeSlice).toHaveBeenCalledWith(14, 44, 'en')
    // The hole's needs_review count dropped.
    const q = res.refined.lineAlignmentQuality!
    expect(q.slice(1, 3).filter((x) => x === 'needs_review').length).toBeLessThan(2)
    // Surrounding anchors untouched (deep-equal to the pre-run values).
    expect(res.refined.lines[0]).toEqual(before.lines[0])
    expect(res.refined.lines[3]).toEqual(before.lines[3])
    // The fresh gap words landed in the persisted transcript.
    expect(res.transcriptWords.some((x) => x.word === 'moonlight')).toBe(true)
    expect(res.transcriptWords.some((x) => x.word === 'zzqx')).toBe(false)
  })

  it('(b) rejects a garbage slice: filledCount 0 and refined/transcript byte-identical', async () => {
    const refined = oneHole()
    const snapshot = structuredClone(refined)
    const transcribeSlice = vi.fn(async (t0: number, t1: number) => garbage(t0, t1))

    const res = await reanalyzeGaps({
      refined,
      transcriptWords: oneHoleTranscript,
      sheetRows: refined.lines,
      alignmentLanguage: 'en',
      transcribeSlice,
    })

    expect(res.filledCount).toBe(0)
    expect(transcribeSlice).toHaveBeenCalledTimes(1)
    // Same references returned, input unmutated.
    expect(res.refined).toBe(refined)
    expect(res.transcriptWords).toBe(oneHoleTranscript)
    expect(refined).toEqual(snapshot)
  })

  it('(c) never calls the slicer and returns refined unchanged when there are no holes', async () => {
    const lines = [line(BEFORE, 10, 14), line(GAP1, 14, 18), line(AFTER, 44, 48)]
    const refined = makeRefined(lines, ['good', 'good', 'good'])
    const transcribeSlice = vi.fn(async (t0: number, t1: number) => cleanGapSlice(t0, t1))

    const res = await reanalyzeGaps({
      refined,
      transcriptWords: oneHoleTranscript,
      sheetRows: refined.lines,
      alignmentLanguage: 'en',
      transcribeSlice,
    })

    expect(transcribeSlice).not.toHaveBeenCalled()
    expect(res.filledCount).toBe(0)
    expect(res.refined).toBe(refined)
  })

  it('(d) caps slices at MAX_HOLES_PER_PASS per pass and stops when a pass fills nothing', async () => {
    // Five single-line needs_review holes bounded by good anchors, each over a
    // wide uncovered window (>4s) → all "worth retrying".
    const lines: TimedLine[] = []
    const quality: LineAlignmentQuality[] = []
    const gapTexts = [GAP1, GAP2, GAP3, GAP4, MID]
    let t = 0
    const transcript: TranscriptWord[] = []
    lines.push(line('anchor zero words here', t, t + 2))
    quality.push('good')
    transcript.push(...anchorWords('anchor zero words here', t, t + 2))
    t += 2
    for (let i = 0; i < 5; i++) {
      // needs_review line crammed into a sliver; its real window is the gap to
      // the next anchor (no transcript words there → uncovered).
      lines.push(line(gapTexts[i], t, t + 0.1))
      quality.push('needs_review')
      const anchorStart = t + 18
      const anchorText = `anchor ${i} filler words present`
      lines.push(line(anchorText, anchorStart, anchorStart + 2))
      quality.push('good')
      transcript.push(...anchorWords(anchorText, anchorStart, anchorStart + 2))
      t = anchorStart + 2
    }
    const refined = makeRefined(lines, quality)
    // Garbage every slice → nothing accepted → the pass loop breaks after one pass.
    const transcribeSlice = vi.fn(async (t0: number, t1: number) => garbage(t0, t1))

    const res = await reanalyzeGaps({
      refined,
      transcriptWords: transcript,
      sheetRows: refined.lines,
      alignmentLanguage: 'en',
      transcribeSlice,
    })

    expect(transcribeSlice).toHaveBeenCalledTimes(MAX_HOLES_PER_PASS)
    expect(res.filledCount).toBe(0)
    expect(res.refined).toBe(refined)
  })

  it('(d2) does not retry a rejected range on the next pass', async () => {
    // Two holes: H1 (lines 1-2) gets a clean slice → accepted; H2 (lines 4-5)
    // gets garbage → rejected. H1's acceptance keeps the pass loop alive, but H2
    // must NOT be re-transcribed on pass 2 (retried-range guard).
    const lines = [
      line(BEFORE, 10, 14),
      line(GAP1, 14, 14.1),
      line(GAP2, 14.1, 14.2),
      line(MID, 44, 48),
      line(GAP3, 48, 48.1),
      line(GAP4, 48.1, 48.2),
      line(AFTER, 78, 82),
    ]
    const refined = makeRefined(lines, [
      'good',
      'needs_review',
      'needs_review',
      'good',
      'needs_review',
      'needs_review',
      'good',
    ])
    const transcript = [
      ...anchorWords(BEFORE, 10, 14),
      ...anchorWords(MID, 44, 48),
      ...anchorWords(AFTER, 78, 82),
    ]
    const transcribeSlice = vi.fn(async (t0: number, t1: number) =>
      t0 === 14 ? cleanGapSlice(t0, t1) : garbage(t0, t1),
    )

    const res = await reanalyzeGaps({
      refined,
      transcriptWords: transcript,
      sheetRows: refined.lines,
      alignmentLanguage: 'en',
      transcribeSlice,
    })

    // H1 + H2 attempted once each in pass 1; H2 NOT re-attempted in pass 2.
    expect(transcribeSlice).toHaveBeenCalledTimes(2)
    expect(res.filledCount).toBe(1)
  })

  it('(e) short-circuits mid-loop when isCancelled flips true', async () => {
    // Reuse the five-hole fixture; cancel after the first slice resolves.
    const lines: TimedLine[] = []
    const quality: LineAlignmentQuality[] = []
    const gapTexts = [GAP1, GAP2, GAP3, GAP4, MID]
    let t = 0
    lines.push(line('anchor zero words here', t, t + 2))
    quality.push('good')
    t += 2
    for (let i = 0; i < 5; i++) {
      lines.push(line(gapTexts[i], t, t + 0.1))
      quality.push('needs_review')
      const anchorStart = t + 18
      lines.push(line(`anchor ${i} filler words present`, anchorStart, anchorStart + 2))
      quality.push('good')
      t = anchorStart + 2
    }
    const refined = makeRefined(lines, quality)

    let cancelled = false
    const transcribeSlice = vi.fn(async (t0: number, t1: number) => {
      cancelled = true
      return garbage(t0, t1)
    })

    await reanalyzeGaps({
      refined,
      transcriptWords: [],
      sheetRows: refined.lines,
      alignmentLanguage: 'en',
      transcribeSlice,
      isCancelled: () => cancelled,
    })

    expect(transcribeSlice).toHaveBeenCalledTimes(1)
  })

  it('reports the holes-to-recover count through onProgress', async () => {
    const refined = oneHole()
    const onProgress = vi.fn()
    const transcribeSlice = vi.fn(async (t0: number, t1: number) => cleanGapSlice(t0, t1))

    await reanalyzeGaps({
      refined,
      transcriptWords: oneHoleTranscript,
      sheetRows: refined.lines,
      alignmentLanguage: 'en',
      transcribeSlice,
      onProgress,
    })

    expect(onProgress).toHaveBeenCalledWith(1)
  })

  it('forces the detected per-hole language on a mixed song', async () => {
    // Japanese hole between English anchors on a mixed sheet → the slice must be
    // forced to Japanese, not left to auto-detect.
    const JA = 'ふるいうたをうたおう'
    const lines = [
      line('hello brave new morning', 10, 14),
      line(JA, 14, 14.1),
      line('waking up again today', 44, 48),
    ]
    const refined = makeRefined(lines, ['good', 'needs_review', 'good'])
    const transcript = [
      ...anchorWords('hello brave new morning', 10, 14),
      ...anchorWords('waking up again today', 44, 48),
    ]
    const transcribeSlice = vi.fn(async (_t0: number, _t1: number) => [] as TranscriptWord[])

    await reanalyzeGaps({
      refined,
      transcriptWords: transcript,
      sheetRows: refined.lines,
      alignmentLanguage: 'mixed',
      transcribeSlice,
    })

    expect(transcribeSlice).toHaveBeenCalledTimes(1)
    expect(transcribeSlice.mock.calls[0][2]).toBe('ja')
  })

  it('falls back to the song sourceLanguage for a mixed-song hole with no detectable script', async () => {
    // A hole whose text is a short (<3-word) Latin phrase matches neither the
    // JA-script rule nor the >=3-Latin-word rule → detectSheetLanguage resolves to
    // its stored fallback, which must be the song's own language (here 'en'), not
    // the arbitrary 'ja' default. (The chars survive normalizeForMatch so the hole
    // still passes the worth-retrying gate and reaches language detection.)
    const lines = [
      line('hello brave new morning', 10, 14),
      line('hola mundo', 14, 14.1),
      line('waking up again today', 44, 48),
    ]
    const refined = makeRefined(lines, ['good', 'needs_review', 'good'])
    const transcript = [
      ...anchorWords('hello brave new morning', 10, 14),
      ...anchorWords('waking up again today', 44, 48),
    ]
    const transcribeSlice = vi.fn(async (_t0: number, _t1: number) => [] as TranscriptWord[])

    await reanalyzeGaps({
      refined,
      transcriptWords: transcript,
      sheetRows: refined.lines,
      alignmentLanguage: 'mixed',
      sourceLanguage: 'en',
      transcribeSlice,
    })

    expect(transcribeSlice).toHaveBeenCalledTimes(1)
    expect(transcribeSlice.mock.calls[0][2]).toBe('en')
  })
})

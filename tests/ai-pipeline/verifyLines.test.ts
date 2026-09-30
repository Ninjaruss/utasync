import { describe, it, expect, vi } from 'vitest'
import { verifyWeakLines } from '../../src/ai-pipeline/verifyLines'
import type { RefinedAlignment } from '../../src/lyrics/phraseAlignment'
import type { LineAlignmentQuality, SungPhrase, TimedLine } from '../../src/core/types'
import type { TranscriptWord } from '../../src/ai-pipeline/aligner'

/**
 * Verdict-driven windowed verification (plan item 2).
 *
 * Gap re-transcription only targets structural HOLES, and measurement showed that reaches
 * exactly half of what the truth-free verdict distrusts — 85 of 170 repairable lines sit
 * outside any hole (ledger L21). This pass targets those, worst-evidence-first.
 *
 * The transcriber is injected, so every invariant below is testable without a model. The
 * invariants that matter are the safety ones: a verification that does not clear the existing
 * acceptance gate must leave the alignment BYTE-IDENTICAL, the budget must bound the Whisper
 * calls, and the prompt handed to the transcriber must be the line's OWN text — that is the
 * mechanism that makes the window a local question rather than a blind one.
 */

const line = (original: string, startTime: number, endTime: number): TimedLine => ({
  original, translation: '', startTime, endTime,
})
const w = (word: string, startTime: number, endTime: number): TranscriptWord => ({ word, startTime, endTime })

function anchorWords(text: string, start: number, end: number): TranscriptWord[] {
  const words = text.split(' ')
  const dur = (end - start) / words.length
  return words.map((word, i) => w(word, start + i * dur, start + (i + 1) * dur))
}

function makeRefined(lines: TimedLine[], quality: LineAlignmentQuality[]): RefinedAlignment {
  const phrases: SungPhrase[] = lines.map((l, i) => ({
    id: `p${i}`, startTime: l.startTime, endTime: l.endTime, original: l.original,
    translation: l.translation, anchorSource: 'lcs', sourceLineIndices: [i],
  }))
  return {
    lines, phrases, report: { splits: 0, merges: 0, lowConfidence: 0 }, mode: 'content',
    confidence: 0.9, anchorSources: lines.map(() => 'lcs'),
    lineAlignmentQuality: quality, phraseLayout: 'sheet',
  }
}

const BEFORE = 'alpha bravo'
const WEAK = 'charlie delta'
const AFTER = 'echo foxtrot'

/** One good anchor, one weakly-corroborated line, one good anchor. */
function fixture() {
  const lines = [line(BEFORE, 10, 14), line(WEAK, 20, 24), line(AFTER, 40, 44)]
  const refined = makeRefined(lines, ['good', 'approximate', 'good'])
  const transcriptWords = [
    ...anchorWords(BEFORE, 10, 14),
    // The weak line's words ARE in the transcript but far from where it sits: the case the
    // verdict flags and a local window can genuinely fix.
    ...anchorWords(WEAK, 30, 34),
    ...anchorWords(AFTER, 40, 44),
  ]
  return { refined, transcriptWords }
}

describe('verifyWeakLines', () => {
  it('accepts a verification that anchors the line on its own words', async () => {
    const { refined, transcriptWords } = fixture()
    // The window's transcript places the line's own words at 30s, where they actually sound.
    const transcribeSlice = vi.fn(async () => anchorWords(WEAK, 30, 34))
    const res = await verifyWeakLines({
      refined, transcriptWords, sheetRows: refined.lines, targets: [1],
      transcribeSlice, lang: 'en',
    })
    expect(res.accepted).toEqual([1])
    expect(res.rejected).toEqual([])
    expect(res.attempts).toBe(1)
    const placed = res.refined.lines[1].startTime
    expect(placed).toBeGreaterThanOrEqual(29)
    expect(placed).toBeLessThanOrEqual(31)
  })

  it('rejects a verification that does not clear the gate, leaving the input BYTE-IDENTICAL', async () => {
    const { refined, transcriptWords } = fixture()
    // Garbled: the existing acceptance gate cannot corroborate it.
    const transcribeSlice = vi.fn(async () => anchorWords('zzqx wkpb jjvg', 20, 24))
    const res = await verifyWeakLines({
      refined, transcriptWords, sheetRows: refined.lines, targets: [1],
      transcribeSlice, lang: 'en',
    })
    expect(res.accepted).toEqual([])
    expect(res.rejected).toEqual([1])
    // Same references: the pass can never make a song worse.
    expect(res.refined).toBe(refined)
    expect(res.transcriptWords).toBe(transcriptWords)
  })

  it('hands the transcriber the LINE\'S OWN text as the prompt', async () => {
    const { refined, transcriptWords } = fixture()
    const transcribeSlice = vi.fn(async () => anchorWords(WEAK, 30, 34))
    await verifyWeakLines({
      refined, transcriptWords, sheetRows: refined.lines, targets: [1], transcribeSlice, lang: 'en',
    })
    // That prompt is the whole mechanism: it turns a whole-song question into a local one.
    expect(transcribeSlice.mock.calls[0][3]).toBe(WEAK)
    // ...and the window is local to the line's current placement, not the song.
    const [t0, t1] = transcribeSlice.mock.calls[0]
    expect(t0).toBe(18)
    expect(t1).toBe(26)
  })

  it('bounds the number of transcriptions by the budget, worst-first', async () => {
    const lines = [line('a a', 0, 2), line('b b', 5, 7), line('c c', 10, 12), line('d d', 15, 17)]
    const refined = makeRefined(lines, ['approximate', 'approximate', 'approximate', 'approximate'])
    const transcribeSlice = vi.fn(async () => anchorWords('zzz qqq', 0, 2))
    const res = await verifyWeakLines({
      refined, transcriptWords: [], sheetRows: lines,
      // The verdict's order: least evidence first. Only the first two may be spent on.
      targets: [2, 0, 3, 1], transcribeSlice, lang: 'en', maxLines: 2,
    })
    expect(res.attempts).toBe(2)
    const seen = transcribeSlice.mock.calls.map((c) => c[3])
    expect(seen).toEqual(['c c', 'a a'])
  })

  it('stops spending on cancellation and reports the rest as skipped', async () => {
    const lines = [line('a a', 0, 2), line('b b', 5, 7), line('c c', 10, 12)]
    const refined = makeRefined(lines, ['approximate', 'approximate', 'approximate'])
    let calls = 0
    const transcribeSlice = vi.fn(async () => {
      calls++
      // Cancel arrives while the first slice is in flight.
      return anchorWords('zzz qqq', 0, 2)
    })
    const res = await verifyWeakLines({
      refined, transcriptWords: [], sheetRows: lines, targets: [0, 1, 2],
      transcribeSlice, lang: 'en', maxLines: 3,
      isCancelled: () => calls >= 1,
    })
    expect(res.attempts).toBe(1)
    expect(res.skipped.length).toBe(2)
  })

  it('skips lines with no text, and never spends a transcription on one', async () => {
    const lines = [line('a a', 0, 2), line('', 5, 7)]
    const refined = makeRefined(lines, ['approximate', 'approximate'])
    const transcribeSlice = vi.fn(async () => anchorWords('zzz', 0, 2))
    const res = await verifyWeakLines({
      refined, transcriptWords: [], sheetRows: lines, targets: [0, 1], transcribeSlice, lang: 'en',
    })
    expect(res.skipped).toContain(1)
    expect(res.attempts).toBe(1)
  })

  it('treats a failing slice as best-effort, leaving that line untouched', async () => {
    const { refined, transcriptWords } = fixture()
    const transcribeSlice = vi.fn(async () => { throw new Error('WASM crash') })
    const res = await verifyWeakLines({
      refined, transcriptWords, sheetRows: refined.lines, targets: [1], transcribeSlice, lang: 'en',
    })
    expect(res.skipped).toEqual([1])
    expect(res.accepted).toEqual([])
    expect(res.refined).toBe(refined)
  })

  it('de-duplicates targets and ignores out-of-range ones', async () => {
    const { refined, transcriptWords } = fixture()
    const transcribeSlice = vi.fn(async () => anchorWords(WEAK, 30, 34))
    const res = await verifyWeakLines({
      refined, transcriptWords, sheetRows: refined.lines, targets: [1, 1, 99], transcribeSlice, lang: 'en',
    })
    expect(res.attempts).toBe(1)
    expect(res.skipped).toContain(99)
  })
})

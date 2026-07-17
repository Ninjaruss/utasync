import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { reanalyzeGaps } from '../../src/ai-pipeline/gapReanalyze'
import {
  refineAlignmentWithPhrases,
  type RefinedAlignment,
} from '../../src/lyrics/phraseAlignment'
import { enumerateGapHoles, holeWorthRetrying } from '../../src/lyrics/gapRealign'
import { computeLineMatchedSpans, normalizeForMatch } from '../../src/ai-pipeline/contentAligner'
import type { TimedLine } from '../../src/core/types'
import type { TranscriptWord } from '../../src/ai-pipeline/aligner'

/**
 * End-to-end deterministic composition test (round 8, G3) — the seam G2 deferred.
 *
 * G1's tests call spliceGapAlignment directly; G2's tests drive reanalyzeGaps
 * over SYNTHETIC refined literals. Neither exercises the full real chain that
 * ships in AutoAlignFlow:
 *
 *   refineAlignmentWithPhrases (real garbled transcript → a real HOLE)
 *     → reanalyzeGaps (real orchestrator: enumerate holes, worth-retrying filter,
 *        slice clamp, per-hole language)
 *        → spliceGapAlignment (real accept-if-better splice)
 *           → refineAlignmentWithPhrases (real sub-refine of the hole rows)
 *
 * ONLY the slice transcription is mocked (the transcribeSlice boundary — exactly
 * what AutoAlignFlow injects). No Whisper, no MP3. The clean "gap re-transcript"
 * is the hole lines' own ground-truth text laid across the slice window, which is
 * what a correct forced-language re-transcription of that audio would return.
 *
 * Fixture choice: reuse the COMMITTED garbled AKFG transcript
 * (fixtures/akfg/transcript.word.garbled.json) + build the clean gap words in-test
 * from the sheet's own lines. No standalone clean-gap fixture file is added: the
 * clean gap words ARE the known-correct line texts, so a committed JSON would only
 * re-serialize lyrics.ja.txt (duplication that could silently drift from the
 * sheet) while adding zero information. The garbled transcript already supplies
 * the real hole; the ground truth is the sheet.
 */
describe('gap re-transcription end-to-end (real refine → reanalyze → splice → sub-refine)', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const dir = join(here, 'fixtures/akfg')

  function loadTranscriptWords(path: string): TranscriptWord[] {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as {
      chunks?: { text?: string; timestamp?: number[] }[]
    }
    return (raw.chunks ?? []).flatMap((c) => {
      const [start, end] = c.timestamp ?? []
      const word = c.text?.trim()
      if (!word || !Number.isFinite(start) || !Number.isFinite(end)) return []
      return [{ word, startTime: start as number, endTime: end as number }]
    })
  }

  function sheetRows(): TimedLine[] {
    return readFileSync(join(dir, 'lyrics.ja.txt'), 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((original) => ({ original, translation: '', startTime: 0, endTime: 0 }))
  }

  /** Placement-aware run-coverage over [from..to]: each line's chars matched by
   * the transcript words inside its OWN placed window. Mirrors the private measure
   * spliceGapAlignment gates on — recomputed here to prove the user-visible win
   * (a misplaced line scores low even when the words exist elsewhere). */
  function placedCoverage(
    lines: TimedLine[],
    words: TranscriptWord[],
    from: number,
    to: number,
  ): number {
    let matched = 0
    let total = 0
    for (let k = from; k <= to; k++) {
      const text = lines[k].original
      total += normalizeForMatch(text).length
      const windowWords = words.filter(
        (word) => word.endTime > lines[k].startTime && word.startTime < lines[k].endTime,
      )
      const spans = computeLineMatchedSpans([text], windowWords)
      matched += spans[0] ? spans[0].matchedChars : 0
    }
    return total === 0 ? 1 : matched / total
  }

  // The garbled fixture is a real global transcript whose middle verse is a
  // desert/garble → refineAlignmentWithPhrases strands lines 15–20 as a
  // needs_review HOLE over [~190,~262]s. Shared setup for both directions.
  function badRefine(): { refined: RefinedAlignment; rows: TimedLine[]; words: TranscriptWord[] } {
    const rows = sheetRows()
    const words = loadTranscriptWords(join(dir, 'transcript.word.garbled.json'))
    const refined = refineAlignmentWithPhrases(rows, words, 'ja')
    return { refined, rows, words }
  }

  it('recovers a garbled gap: clean slice fills the hole to its TRUE positions', async () => {
    const { refined, rows, words } = badRefine()

    // The real refine leaves exactly one hole WORTH RETRYING (the garble
    // desert). Round-11 enumerate also surfaces stray repetition-only
    // approximate rows, but their sub-4s windows fail holeWorthRetrying — the
    // same filter every orchestrator applies before slicing.
    const lineTexts = rows.map((r) => r.original)
    const holes = enumerateGapHoles(refined, words).filter((h) =>
      holeWorthRetrying(h, words, lineTexts),
    )
    expect(holes.length).toBe(1)
    const hole = holes[0]
    expect(hole.to).toBeGreaterThan(hole.from) // multi-line run
    const nLines = hole.to - hole.from + 1

    // BEFORE: the hole lines are all needs_review and their placed coverage is ~0
    // (the garbled transcript carries no corroborating words under them).
    const q0 = refined.lineAlignmentQuality!
    const nrBefore = q0.slice(hole.from, hole.to + 1).filter((x) => x === 'needs_review').length
    expect(nrBefore).toBe(nLines)
    const covBefore = placedCoverage(refined.lines, words, hole.from, hole.to)
    expect(covBefore).toBeLessThan(0.05)

    // Snapshot the surrounding anchors to prove they are untouched.
    const anchorBefore = structuredClone(refined.lines[hole.from - 1])
    const anchorAfter = structuredClone(refined.lines[hole.to + 1])

    // The mocked slice transcriber: lay each hole line's ground-truth text evenly
    // across the window it is asked about, at KNOWN true positions we record. This
    // is what a correct forced-language re-transcription of that clean audio would
    // return. Words are in absolute song time (the transcribeSlice contract).
    const truePos: { start: number; end: number }[] = []
    const transcribeSlice = vi.fn(async (t0: number, t1: number) => {
      const span = (t1 - t0) / nLines
      const out: TranscriptWord[] = []
      for (let k = hole.from; k <= hole.to; k++) {
        const start = t0 + (k - hole.from) * span + 0.1
        const end = t0 + (k - hole.from + 1) * span - 0.1
        truePos[k - hole.from] = { start, end }
        out.push({ word: refined.lines[k].original, startTime: start, endTime: end })
      }
      return out
    })

    const res = await reanalyzeGaps({
      refined,
      transcriptWords: words,
      sheetRows: rows,
      alignmentLanguage: 'ja',
      transcribeSlice,
    })

    // The hole was FILLED end-to-end.
    expect(res.filledCount).toBe(1)
    expect(transcribeSlice).toHaveBeenCalledTimes(1)
    // Slice was forced Japanese and clamped to the single-window ≤30s path (the
    // hole spans ~71s; only its first 30s is re-heard).
    const [t0Arg, t1Arg, langArg] = transcribeSlice.mock.calls[0]
    expect(langArg).toBe('ja')
    expect(t0Arg).toBeCloseTo(hole.t0, 5)
    expect(t1Arg - t0Arg).toBeLessThanOrEqual(30 + 1e-6)

    // needs_review over the hole dropped, and placement-aware coverage ROSE from
    // ~0 to essentially fully corroborated.
    const q1 = res.refined.lineAlignmentQuality!
    const nrAfter = q1.slice(hole.from, hole.to + 1).filter((x) => x === 'needs_review').length
    expect(nrAfter).toBeLessThan(nrBefore)
    const covAfter = placedCoverage(res.refined.lines, res.transcriptWords, hole.from, hole.to)
    expect(covAfter).toBeGreaterThan(0.9)
    expect(covAfter).toBeGreaterThan(covBefore)

    // THE POINT: each gap line lands NEAR its true position (the times we laid the
    // clean words at), not merely somewhere non-degenerate. Sub-second — within
    // 0.5s (a monotonic-fixup boundary nudge is the only slack).
    for (let k = hole.from; k <= hole.to; k++) {
      const tp = truePos[k - hole.from]
      expect(res.refined.lines[k].startTime).toBeCloseTo(tp.start, 0)
      expect(res.refined.lines[k].endTime).toBeCloseTo(tp.end, 0)
    }

    // Monotonic non-degenerate across the whole song after the splice.
    for (let i = 1; i < res.refined.lines.length; i++) {
      expect(res.refined.lines[i].startTime).toBeGreaterThanOrEqual(
        res.refined.lines[i - 1].startTime - 1e-6,
      )
    }

    // The surrounding good anchors are byte-identical (never in the splice range).
    expect(res.refined.lines[hole.from - 1]).toEqual(anchorBefore)
    expect(res.refined.lines[hole.to + 1]).toEqual(anchorAfter)

    // The fresh gap words replaced the garble inside the window.
    expect(
      res.transcriptWords.some((wd) => wd.word === refined.lines[hole.from].original),
    ).toBe(true)
  })

  it('safety: a garbage slice fills nothing and leaves the alignment byte-identical to the no-gap pass', async () => {
    const { refined, rows, words } = badRefine()
    // The exact result AutoAlignFlow would persist if the gap pass never ran.
    const noGapSnapshot = structuredClone(refined)

    // A slice transcriber that returns pure garble (no chars in common with the
    // hole lines) — the accept-if-better guard must reject it.
    const transcribeSlice = vi.fn(async (t0: number, t1: number) => {
      const mid = (t0 + t1) / 2
      return [
        { word: 'zzqx wkpb jjvg xxqq', startTime: t0 + 1, endTime: mid - 1 },
        { word: 'kkzz qqww eezz rrtt', startTime: mid + 1, endTime: t1 - 1 },
      ] as TranscriptWord[]
    })

    const res = await reanalyzeGaps({
      refined,
      transcriptWords: words,
      sheetRows: rows,
      alignmentLanguage: 'ja',
      transcribeSlice,
    })

    // The slice WAS attempted (the hole is worth retrying) but nothing accepted.
    expect(transcribeSlice).toHaveBeenCalledTimes(1)
    expect(res.filledCount).toBe(0)
    // Same reference returned and byte-identical to the no-gap-pass alignment.
    expect(res.refined).toBe(refined)
    expect(res.transcriptWords).toBe(words)
    expect(res.refined).toEqual(noGapSnapshot)
  })
})

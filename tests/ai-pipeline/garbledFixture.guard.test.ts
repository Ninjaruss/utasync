import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { refineAlignmentWithPhrases } from '../../src/lyrics/phraseAlignment'
import {
  minLineDuration,
  offTimingLineCount,
  COMPRESSION_FRACTION,
} from '../../src/lyrics/lineDegeneracy'
import type { LineAlignmentQuality, TimedLine } from '../../src/core/types'

/**
 * CI guard for the COMMITTED garbled/desert fixture
 * (fixtures/akfg/transcript.word.garbled.json, produced deterministically by
 * scripts/make-garbled-fixture.mjs from the diagnosis recipe in
 * docs/superpowers/audits/2026-07-14-approx-run-diagnosis.md, H1/H2). Every
 * other corpus transcript is a healthy Whisper run, so the user's screenshot
 * pileup never tripped the scorecard — this fixture closes that gap.
 *
 * THIS is the test that would have caught the screenshot: on pre-round-6 code
 * this input packs six 0.1–1.2s slivers onto the hallucinated 228–229s blip,
 * all wearing `approximate` chips, with the off-timing banner reading zero
 * (diagnosis H2/H4). It locks the round-6 B (packing floor + zero-width
 * elimination) and C (coverage-gated label + honest banner) invariants over the
 * shipped, scorecard-scored fixture.
 *
 * It replaces the in-test perturbation formerly in garbledTranscript.honesty.
 * test.ts: the committed fixture's word array is byte-identical to that recipe
 * (asserted by the recipe pin below), so a second in-memory copy was redundant —
 * guarding the shipped fixture is strictly stronger.
 */
const here = dirname(fileURLToPath(import.meta.url))
const dir = join(here, 'fixtures/akfg')

/** Mirrors the scorecard/audit loader: {chunks:[{text,timestamp}]} → words. */
function loadTranscriptWords(path: string) {
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  return (raw.chunks ?? []).flatMap((c: { text?: string; timestamp?: number[] }) => {
    const [start, end] = c.timestamp ?? []
    const word = c.text?.trim()
    if (!word || !Number.isFinite(start) || !Number.isFinite(end)) return []
    return [{ word, startTime: start as number, endTime: end as number }]
  })
}

// YouTube caption onsets by line index (subset of akfg-word-ground-truth
// .test.ts's GT: shared-caption rows omitted). Properties of the audio, so they
// hold for the garbled transcript too. Lines 15-20 lose ALL their real evidence
// to the [188,258]s garble window and cannot be honestly anchored.
const GT_ONSETS: Record<number, number> = {
  0: 98, 1: 104, 2: 111, 3: 118, 4: 122, 5: 131, 7: 141, 9: 148, 10: 154,
  12: 161, 13: 175, 14: 183, 15: 190, 16: 203, 17: 210, 18: 217, 20: 223,
  21: 262, 22: 275, 23: 282, 24: 292, 26: 299, 27: 306, 29: 312,
}

let cached: { lines: TimedLine[]; quality: LineAlignmentQuality[] } | undefined
function align() {
  if (cached) return cached
  const lineTexts = readFileSync(join(dir, 'lyrics.ja.txt'), 'utf8')
    .split('\n').map((l) => l.trim()).filter(Boolean)
  const sheetRows = lineTexts.map((original) => ({ original, translation: '', startTime: 0, endTime: 0 }))
  const words = loadTranscriptWords(join(dir, 'transcript.word.garbled.json'))
  const refined = refineAlignmentWithPhrases(sheetRows, words, 'ja')
  cached = { lines: refined.lines, quality: refined.lineAlignmentQuality ?? [] }
  return cached
}

describe('garbled fixture honesty guard (round 6 B+C invariants)', () => {
  // The fixture must actually embody the degenerate precondition: if the desert
  // ever silently re-fills with real evidence the run stops being degenerate and
  // every invariant below passes vacuously. Pin the recipe outcome.
  it('fixture embodies the diagnosis recipe (desert emptied, one hallucination)', () => {
    const raw = JSON.parse(
      readFileSync(join(dir, 'transcript.word.garbled.json'), 'utf8'),
    ) as { chunks: { text?: string; timestamp?: number[] }[] }
    const inDesert = raw.chunks.filter((c) => {
      const [s, e] = c.timestamp ?? []
      if (!Number.isFinite(s) || !Number.isFinite(e)) return false
      const mid = ((s as number) + (e as number)) / 2
      return mid >= 188 && mid <= 258
    })
    // Rows 16-21 + 赤い lost their evidence: the ONLY chunk left in the window is
    // the hallucinated `ような` at [228,229] that fabricates a false activity blip.
    expect(inDesert, 'garble desert [188,258]s must contain only the hallucination')
      .toEqual([{ text: 'ような', timestamp: [228, 229] }])
  })

  it('no zero-duration rows and no line packed below its floor (round 6 B)', { timeout: 30_000 }, () => {
    const { lines } = align()
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]
      // Screenshot symptom #1: "3:32–3:32" zero-duration rows from cursor
      // exhaustion / un-expanded final rows.
      expect(l.endTime, `SCREENSHOT BUG: line ${i} "${l.original.slice(0, 12)}" is zero-duration (${l.startTime.toFixed(2)}==${l.endTime.toFixed(2)})`)
        .toBeGreaterThan(l.startTime)
      // Screenshot symptom #2: 0.1–1.2s slivers pinned to the hallucinated blip.
      // Even genuine region-edge clamps must keep ≥0.55× the per-text floor.
      const dur = l.endTime - l.startTime
      const floor = minLineDuration(l.original)
      expect(dur, `SCREENSHOT BUG: line ${i} "${l.original.slice(0, 12)}" packed to ${dur.toFixed(2)}s, below floor ${(floor * COMPRESSION_FRACTION).toFixed(2)}s`)
        .toBeGreaterThanOrEqual(floor * COMPRESSION_FRACTION - 1e-6)
    }
  })

  it('labels honestly: a squashed line is never approximate/good (round 6 C)', { timeout: 30_000 }, () => {
    const { lines, quality } = align()
    let squashedApprox = 0
    for (let i = 0; i < lines.length; i++) {
      const dur = lines[i].endTime - lines[i].startTime
      const gate = minLineDuration(lines[i].original) * COMPRESSION_FRACTION
      if (dur >= gate - 1e-6) continue
      // Screenshot symptom #3: slivers wearing green/approx chips. A visibly
      // squashed span must stay flagged.
      expect(quality[i], `SCREENSHOT BUG: squashed line ${i} "${lines[i].original.slice(0, 12)}" (${dur.toFixed(2)}s) mislabeled ${quality[i]}`)
        .toBe('needs_review')
      if (quality[i] === 'approximate') squashedApprox++
    }
    // Post-B floors + C1 coverage gate make the squashed-approximate set empty;
    // the banner's second clause is the honesty backstop should either regress.
    expect(squashedApprox, 'no line may be both squashed and approximate').toBe(0)
  })

  it('the off-timing banner owns every unplaceable line (round 6 C banner)', { timeout: 30_000 }, () => {
    const { lines, quality } = align()
    const counted = (i: number) =>
      quality[i] === 'needs_review' ||
      (quality[i] === 'approximate' &&
        lines[i].endTime - lines[i].startTime <
          minLineDuration(lines[i].original) * COMPRESSION_FRACTION - 1e-6)
    const mistimed = Object.entries(GT_ONSETS)
      .map(([i, onset]) => ({ i: Number(i), err: Math.abs(lines[Number(i)].startTime - onset) }))
      .filter(({ err }) => err > 2)
    const bannerCount = offTimingLineCount(lines, quality)
    // Screenshot symptom #4: banner said "2 lines off-timing" while a whole run
    // was mistimed. The banner must own the damage — count at least the
    // truth-measurable >2s-mistimed lines, or individually flag every one.
    const owned = bannerCount >= mistimed.length || mistimed.every(({ i }) => counted(i))
    expect(mistimed.length, 'garble must actually displace lines').toBeGreaterThanOrEqual(4)
    expect(owned, `SCREENSHOT BUG: banner=${bannerCount} hides mistimed lines ${JSON.stringify(mistimed)}`).toBe(true)
  })
})

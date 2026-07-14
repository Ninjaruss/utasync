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

const here = dirname(fileURLToPath(import.meta.url))
const dir = join(here, 'fixtures/akfg')

/**
 * Diagnosis H4 garble recipe (2026-07-14 approx-run diagnosis): reproduce the
 * user-screenshot failure mode from the healthy akfg word fixture by dropping
 * every chunk with midpoint in [188, 258] (evidence desert across the second
 * chorus lead-in) and inserting one hallucinated 1s chunk inside it. Built
 * in-test on purpose — Task E commits the perturbation as a corpus fixture;
 * this file locks the display-honesty invariants (rounds 6 B+C) immediately.
 */
function garbledWords() {
  const raw = JSON.parse(readFileSync(join(dir, 'transcript.word.json'), 'utf8'))
  const chunks = (raw.chunks as { text?: string; timestamp?: number[] }[]).filter((c) => {
    const [s, e] = c.timestamp ?? []
    if (!Number.isFinite(s) || !Number.isFinite(e)) return false
    const mid = ((s as number) + (e as number)) / 2
    return !(mid >= 188 && mid <= 258)
  })
  chunks.push({ text: 'ような', timestamp: [228, 229] })
  chunks.sort((a, b) => (a.timestamp?.[0] ?? 0) - (b.timestamp?.[0] ?? 0))
  return chunks.flatMap((c) => {
    const [start, end] = c.timestamp ?? []
    const word = c.text?.trim()
    if (!word || !Number.isFinite(start) || !Number.isFinite(end)) return []
    return [{ word, startTime: start as number, endTime: end as number }]
  })
}

// YouTube caption onsets by line index (subset of akfg-word-ground-truth
// .test.ts's GT: shared-caption rows omitted). Properties of the audio, so
// they hold for the garbled transcript too. Lines 15-20 lose ALL their real
// evidence to the garble window and cannot be anchored.
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
  const refined = refineAlignmentWithPhrases(sheetRows, garbledWords(), 'ja')
  cached = { lines: refined.lines, quality: refined.lineAlignmentQuality ?? [] }
  return cached
}

// The user-screenshot repro (diagnosis H2/H4): before rounds 6 B+C this input
// packed six 0.1-1.2s slivers onto the hallucinated blip at 228-229s, all
// wearing approx chips, with the off-timing banner reading zero.
describe('garbled transcript honesty (rounds 6 B+C invariants)', () => {
  it('emits no zero-duration rows and no line below the compression floor', { timeout: 30_000 }, () => {
    const { lines } = align()
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]
      expect(l.endTime, `line ${i} "${l.original.slice(0, 10)}" zero width`).toBeGreaterThan(l.startTime)
      // Universal display floor: even genuine region-edge clamps keep at least
      // the compression threshold of the per-text floor (Task B packing).
      expect(l.endTime - l.startTime, `line ${i} "${l.original.slice(0, 10)}" duration`)
        .toBeGreaterThanOrEqual(minLineDuration(l.original) * COMPRESSION_FRACTION - 1e-6)
    }
  })

  it('labels honestly: approximate implies the span meets the upgrade gate', { timeout: 30_000 }, () => {
    const { lines, quality } = align()
    let squashedApprox = 0
    for (let i = 0; i < lines.length; i++) {
      const dur = lines[i].endTime - lines[i].startTime
      const gate = minLineDuration(lines[i].original) * COMPRESSION_FRACTION
      if (dur >= gate - 1e-6) continue
      // A visibly-squashed line must stay flagged — never approx, never good.
      expect(quality[i], `squashed line ${i} "${lines[i].original.slice(0, 10)}"`).toBe('needs_review')
      if (quality[i] === 'approximate') squashedApprox++
    }
    // Post B (packing floors) + C1 (coverage-gated upgrade) the squashed-
    // approximate set is structurally empty; the banner's second clause exists
    // as the honesty backstop should either invariant regress.
    expect(squashedApprox).toBe(0)
  })

  it('the off-timing banner owns every unplaceable line', { timeout: 30_000 }, () => {
    const { lines, quality } = align()
    const counted = (i: number) =>
      quality[i] === 'needs_review' ||
      (quality[i] === 'approximate' &&
        lines[i].endTime - lines[i].startTime <
          minLineDuration(lines[i].original) * COMPRESSION_FRACTION - 1e-6)
    const mistimed = Object.entries(GT_ONSETS)
      .map(([i, onset]) => ({ i: Number(i), err: Math.abs(lines[Number(i)].startTime - onset) }))
      .filter(({ err }) => err > 2)
    // The banner must own the damage: count at least the truth-measurable
    // >2s-mistimed lines, or individually flag every one of them. (One garble
    // line may sit on the hallucinated blip at full floor width and read
    // approximate per the C1 gate — the flagged no-GT shared-caption line in
    // the same run keeps the count honest.)
    const bannerCount = offTimingLineCount(lines, quality)
    const owned = bannerCount >= mistimed.length || mistimed.every(({ i }) => counted(i))
    expect(mistimed.length, 'garble must actually displace lines').toBeGreaterThanOrEqual(4)
    expect(owned, `banner=${bannerCount} vs mistimed=${JSON.stringify(mistimed)}`).toBe(true)
  })
})

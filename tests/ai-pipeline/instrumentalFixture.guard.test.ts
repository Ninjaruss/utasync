import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { refineAlignmentWithPhrases } from '../../src/lyrics/phraseAlignment'
import { minLineDuration, COMPRESSION_FRACTION } from '../../src/lyrics/lineDegeneracy'
import type { LineAlignmentQuality, TimedLine } from '../../src/core/types'

/**
 * CI guard for the COMMITTED instrumental-placement fixture
 * (fixtures/akfg/transcript.word.instrumental.json, produced deterministically by
 * scripts/make-instrumental-fixture.mjs from the recipe in
 * docs/superpowers/audits/2026-07-14-approx-run-diagnosis.md, H1/H2 + "Round 7").
 *
 * THIS is the fixture that specifically exercises the round-7 run-coverage gate:
 * the round-6 garbled fixture is a transcript DESERT with a single blip, whereas
 * here sheet rows 16-20 lose their real vocals AND four sparse hallucinated noise
 * moras (ネ/ヌ/ホ, ~1.3s of audio total) form a false ~9s INSTRUMENTAL activity
 * region at 245-254s, after the block's true position. On pre-round-7 code the
 * packer treated that region as activity and clustered the whole verse onto it
 * (row 16 at 245.0s, sub-2s slivers, some wearing a false `approximate` chip) —
 * the user's "verse on the instrumental" report. The run-coverage gate rejects
 * the region (char-LCS corroborates ~0% of the run AND its ~1.3s of audio is
 * below the 1.5s density floor), so the run spreads across its true window at
 * floor and stays honestly needs_review.
 */
const here = dirname(fileURLToPath(import.meta.url))
const dir = join(here, 'fixtures/akfg')

/** The run of unanchored lyric rows whose evidence the block-deletion removes. */
const RUN_FROM = 16
const RUN_TO = 20
/** The inserted hallucinated instrumental-noise region (see the generator). */
const NOISE_START = 245
const NOISE_END = 254.35

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

let cached: { lines: TimedLine[]; quality: LineAlignmentQuality[] } | undefined
function align() {
  if (cached) return cached
  const lineTexts = readFileSync(join(dir, 'lyrics.ja.txt'), 'utf8')
    .split('\n').map((l) => l.trim()).filter(Boolean)
  const sheetRows = lineTexts.map((original) => ({ original, translation: '', startTime: 0, endTime: 0 }))
  const words = loadTranscriptWords(join(dir, 'transcript.word.instrumental.json'))
  const refined = refineAlignmentWithPhrases(sheetRows, words, 'ja')
  cached = { lines: refined.lines, quality: refined.lineAlignmentQuality ?? [] }
  return cached
}

describe('instrumental-placement fixture guard (round 7 run-coverage gate)', () => {
  // The fixture must actually embody the precondition: the block window emptied
  // of real vocals, with ONLY the hallucinated noise region left inside it. If
  // the block ever silently re-fills with real evidence the run stops being
  // degenerate and every invariant below passes vacuously. Pin the recipe.
  it('fixture embodies the recipe (block vocals gone, only noise moras remain)', () => {
    const raw = JSON.parse(
      readFileSync(join(dir, 'transcript.word.instrumental.json'), 'utf8'),
    ) as { chunks: { text?: string; timestamp?: number[] }[] }
    // The block deletion window [198,260]s must contain ONLY the four inserted
    // katakana noise moras — no surviving real vocal / ♪ chunk.
    const inBlock = raw.chunks.filter((c) => {
      const [s, e] = c.timestamp ?? []
      if (!Number.isFinite(s) || !Number.isFinite(e)) return false
      const mid = ((s as number) + (e as number)) / 2
      return mid >= 198 && mid <= 260
    })
    expect(inBlock, 'block window [198,260]s must hold only the 4 hallucinated noise moras')
      .toEqual([
        { text: 'ネ', timestamp: [245.0, 245.3] },
        { text: 'ヌ', timestamp: [248.1, 248.45] },
        { text: 'ホ', timestamp: [251.0, 251.3] },
        { text: 'ネ', timestamp: [254.0, 254.35] },
      ])
    // …and the moras cluster into ONE activity region (consecutive gaps < 4s)
    // carrying < 1.5s of audio — the shape the gate must reject.
    const audio = inBlock.reduce((a, c) => a + (c.timestamp![1] - c.timestamp![0]), 0)
    expect(audio, 'noise region must stay below the 1.5s density floor').toBeLessThan(1.5)
  })

  it('does NOT cluster the verse run onto the instrumental noise region (round 7)', { timeout: 30_000 }, () => {
    const { lines } = align()
    // Row 16 lands near the block's true window (its real onset ~203s), not
    // packed onto the 245s noise blip.
    expect(lines[RUN_FROM].startTime, `row ${RUN_FROM} clustered on the ${NOISE_START}s noise at ${lines[RUN_FROM].startTime.toFixed(1)}s`)
      .toBeLessThan(230)
    // The run spreads across its window rather than piling onto the ~9s blip
    // region (pre-round-7 the whole run fit inside ~8s of noise).
    expect(lines[RUN_TO].startTime - lines[RUN_FROM].startTime, 'run must spread, not cluster')
      .toBeGreaterThan(15)
    // No run line overlaps the hallucinated noise region [245, 254.35].
    for (let i = RUN_FROM; i <= RUN_TO; i++) {
      const onNoise = lines[i].startTime < NOISE_END && lines[i].endTime > NOISE_START
      expect(onNoise, `row ${i} still overlaps the ${NOISE_START}-${NOISE_END}s noise region`).toBe(false)
    }
  })

  it('keeps the unanchored run honestly labelled and above floor (round 6 B + round 7)', { timeout: 30_000 }, () => {
    const { lines, quality } = align()
    for (let i = RUN_FROM; i <= RUN_TO; i++) {
      const dur = lines[i].endTime - lines[i].startTime
      // No zero-duration rows, no sub-floor slivers (round 6 B floors).
      expect(dur, `row ${i} "${lines[i].original.slice(0, 12)}" is zero-duration`).toBeGreaterThan(0)
      const floor = minLineDuration(lines[i].original)
      expect(dur, `row ${i} packed to ${dur.toFixed(2)}s, below floor ${(floor * COMPRESSION_FRACTION).toFixed(2)}s`)
        .toBeGreaterThanOrEqual(floor * COMPRESSION_FRACTION - 1e-6)
      // Landing off any corroborated activity, the run stays needs_review —
      // never the false `approximate` the noise blip used to buy it pre-round-7.
      expect(quality[i], `row ${i} mislabeled ${quality[i]} off real evidence`).toBe('needs_review')
    }
  })
})

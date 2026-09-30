import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { refineAlignmentWithPhrases } from '../../src/lyrics/phraseAlignment'
import { refineMixedLanguageAlignment } from '../../src/ai-pipeline/mixedLanguageAlign'
import { sanitizeTranscript, type TranscriptWord } from '../../src/ai-pipeline/aligner'
import { computeLineMatchedSpans } from '../../src/ai-pipeline/contentAligner'
import { parseLrc, matchSheetToLrc, scoreAgainstTruth } from '../../scripts/lib/lrcTruth.mjs'
import { applyLrcPrior } from '../../src/lyrics/lrcPrior'
import type { TimedLine } from '../../src/core/types'

/**
 * Ground-truth regression lock (plan: 2026-07-13-alignment-ground-truth.md,
 * rebuilt 2026-09-28 by docs/superpowers/plans/2026-09-28-automatic-sync-accuracy.md).
 *
 * Scores aligned line starts against human-synced LRCLIB timestamps, in the
 * ABSOLUTE frame — |our start − truth|, which is what the listener hears and
 * which includes any constant whole-song lag.
 *
 * Two things changed on 2026-09-28, both fixing blindspots:
 *
 *  1. It used to score only the RESIDUAL after subtracting a robust median
 *     "version offset". A uniform desync — the most audible timing defect there
 *     is, and the one users report — therefore scored as exactly 0.00s, and the
 *     offset itself (measured 0.31s on the version-exact song, 1.2-1.4s on the
 *     alternate take) was printed but never asserted. The offset is now asserted,
 *     and the residual survives only as a diagnostic in scripts/audit-vs-lrc.mjs.
 *
 *  2. Every line was scored, so on stranger-than-heaven a block of ~30 lines
 *     that the transcript has NO evidence for (the alternate-take lyrics/sung
 *     mismatch) dominated p90 and made that threshold unfalsifiable — it sat at
 *     its own measured value forever. Lines are now partitioned:
 *       - absP50/absP90/absWorst and fracWithin250 cover ALL truth lines: the
 *         listener's experience, which must improve.
 *       - evP90 covers evidence-backed lines only: what the aligner can be held
 *         accountable for, asserted tightly.
 *       - nNoEvidence is bounded, so lines cannot be made un-anchorable to
 *         escape the tight bound.
 *
 * Thresholds are the measured 2026-09-28 values with ~10% headroom, i.e. they
 * are ratchets. They are NOT requirements: the requirement is the perceptual
 * contract in the plan (C1-C4: offset <=100ms, >=85% of lines within 250ms,
 * worst line <=1.0s). Current values are far outside it. Tighten these as the
 * pipeline improves; never loosen one to make a change pass.
 *
 * Reproduce every number here with: npx tsx scripts/audit-vs-lrc.mjs
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

function loadTruth(fixture: string, lyrics: string) {
  const lineTexts = readLines(join(FIXTURES, lyrics))
  const lrc = JSON.parse(readFileSync(join(FIXTURES, fixture), 'utf8'))
  const truthTime = matchSheetToLrc(lineTexts, parseLrc(lrc.syncedLyrics))
  return { lineTexts, truthTime }
}

const sheet = (lineTexts: string[]): TimedLine[] =>
  lineTexts.map((original) => ({ original, translation: '', startTime: 0, endTime: 0 }))

type TruthMetrics = ReturnType<typeof scoreAgainstTruth>

interface Bounds {
  n?: number
  /** Systematic offset vs truth. Version-exact songs bound this tightly; see the
   * per-song notes for why the alternate take cannot. */
  offsetAbs?: number
  absP50: number
  absP90: number
  absWorst: number
  fracWithin250: number
  evP90: number
  maxNoEvidence: number
}

function assertTruth(label: string, m: TruthMetrics, b: Bounds) {
  const at = (what: string) => `${label}: ${what}`
  if (b.n !== undefined) expect(m.n, at('truth-line count')).toBeGreaterThanOrEqual(b.n)
  if (b.offsetAbs !== undefined) {
    expect(Math.abs(m.offset), at('systematic offset (s) vs human truth')).toBeLessThanOrEqual(b.offsetAbs)
  }
  expect(m.absP50, at('ABSOLUTE p50 error (s)')).toBeLessThanOrEqual(b.absP50)
  expect(m.absP90, at('ABSOLUTE p90 error (s)')).toBeLessThanOrEqual(b.absP90)
  expect(m.absWorst, at('ABSOLUTE worst-line error (s)')).toBeLessThanOrEqual(b.absWorst)
  expect(m.fracWithin250, at('share of lines within 250ms')).toBeGreaterThanOrEqual(b.fracWithin250)
  expect(m.evP90, at('p90 error on evidence-backed lines (s)')).toBeLessThanOrEqual(b.evP90)
  expect(m.nNoEvidence, at('lines the transcript had no evidence for')).toBeLessThanOrEqual(b.maxNoEvidence)
}

describe('alignment vs human-synced LRC ground truth (absolute frame)', () => {
  // guitar-loneliness: version-EXACT (LRC dur 229.0s vs our 228.98s). This is the
  // only fixture where the offset is unambiguously ours, so it is the one that
  // carries the tight offset bound. Measured 0.31s (word) / 0.36s (segment) — a
  // uniform lag the listener hears, and the plan's C1 target is <=0.10s.
  it('guitar-loneliness word mode', { timeout: 20_000 }, () => {
    const { lineTexts, truthTime } = loadTruth('lrc-truth/guitar-loneliness.json', 'guitar-loneliness/lyrics.ja.txt')
    const words = loadWords(join(FIXTURES, 'guitar-loneliness/transcript.word.json'))
    const refined = refineAlignmentWithPhrases(sheet(lineTexts), words, 'ja')
    const spans = computeLineMatchedSpans(lineTexts, sanitizeTranscript(words))
    assertTruth('guitar word', scoreAgainstTruth(refined.lines, spans, truthTime, { lineTexts }), {
      n: 34, offsetAbs: 0.45, absP50: 0.40, absP90: 2.2, absWorst: 3.0,
      fracWithin250: 0.40, evP90: 2.0, maxNoEvidence: 6,
    })
  })

  it('guitar-loneliness segment mode', { timeout: 20_000 }, () => {
    const { lineTexts, truthTime } = loadTruth('lrc-truth/guitar-loneliness.json', 'guitar-loneliness/lyrics.ja.txt')
    const words = loadWords(join(FIXTURES, 'guitar-loneliness/transcript.segment.json'))
    const refined = refineAlignmentWithPhrases(sheet(lineTexts), words, 'ja')
    const spans = computeLineMatchedSpans(lineTexts, sanitizeTranscript(words))
    assertTruth('guitar segment', scoreAgainstTruth(refined.lines, spans, truthTime, { lineTexts }), {
      n: 34, offsetAbs: 0.50, absP50: 0.50, absP90: 2.6, absWorst: 6.2,
      fracWithin250: 0.35, evP90: 2.6, maxNoEvidence: 6,
    })
  })

  // veil — pure Japanese; the aligner's clean case, and the best offset in the
  // corpus (measured -0.02s). Locks the common single-language path so a change
  // tuned for hard mixed songs cannot quietly regress it.
  it('veil (pure Japanese)', { timeout: 20_000 }, () => {
    const { lineTexts, truthTime } = loadTruth('lrc-truth/veil.json', 'veil/lyrics.ja.txt')
    const words = loadWords(join(FIXTURES, 'veil/transcript.words.json'))
    const refined = refineAlignmentWithPhrases(sheet(lineTexts), words, 'ja')
    const spans = computeLineMatchedSpans(lineTexts, sanitizeTranscript(words))
    assertTruth('veil', scoreAgainstTruth(refined.lines, spans, truthTime, { lineTexts }), {
      n: 45, offsetAbs: 0.15, absP50: 0.32, absP90: 1.2, absWorst: 2.2,
      fracWithin250: 0.45, evP90: 0.9, maxNoEvidence: 14,
    })
  })

  // Recollect — dense within-line JA/EN code-switching, non-isolated transcript,
  // so error is high and transcription-bound. 31 of 47 dated lines have NO
  // transcript evidence at all: the largest term here is evidence absence, not
  // aligner precision, which is why evP90 is asserted far tighter than absP90.
  it('recollect segment two-pass (mixed)', { timeout: 30_000 }, () => {
    const { lineTexts, truthTime } = loadTruth('lrc-truth/recollect.json', 'recollect/lyrics.txt')
    const ja = loadWords(join(FIXTURES, 'recollect/transcript.segment.json'))
    const en = loadWords(join(FIXTURES, 'recollect/transcript.segment.forced-en.json'))
    const mixed = refineMixedLanguageAlignment(sheet(lineTexts), ja, en)
    const spans = computeLineMatchedSpans(lineTexts, sanitizeTranscript(mixed.transcriptWords))
    assertTruth('recollect', scoreAgainstTruth(mixed.refined.lines, spans, truthTime, { lineTexts }), {
      n: 45, offsetAbs: 0.30, absP50: 2.0, absP90: 6.8, absWorst: 9.0,
      fracWithin250: 0.18, evP90: 4.6, maxNoEvidence: 33,
    })
  })

  // stranger-than-heaven: the LRC is a 237s edit of our 233.57s audio (an
  // alternate take whose sung words differ from the sheet), so a large part of
  // the ~1.4s offset is a genuine version difference we cannot attribute to
  // ourselves. The bound is loose FOR THAT REASON and is documented as such;
  // see tests/ai-pipeline/lrc-truth.test.ts plan item W0.5 for re-sourcing this
  // fixture against a version-matched recording.
  const VERSION_MISMATCHED_OFFSET = 1.60

  it('stranger-than-heaven segment ja-only', { timeout: 30_000 }, () => {
    const { lineTexts, truthTime } = loadTruth('lrc-truth/stranger-than-heaven.json', 'stranger-than-heaven/lyrics.txt')
    const ja = loadWords(join(FIXTURES, 'stranger-than-heaven/transcript.segment.json'))
    const refined = refineAlignmentWithPhrases(sheet(lineTexts), ja, 'ja')
    const spans = computeLineMatchedSpans(lineTexts, sanitizeTranscript(ja))
    assertTruth('stranger segment ja-only', scoreAgainstTruth(refined.lines, spans, truthTime, { lineTexts }), {
      n: 59, offsetAbs: VERSION_MISMATCHED_OFFSET, absP50: 2.5, absP90: 34.5, absWorst: 39,
      fracWithin250: 0.04, evP90: 5.0, maxNoEvidence: 35,
    })
  })

  it('stranger-than-heaven segment medium ja-only', { timeout: 30_000 }, () => {
    const { lineTexts, truthTime } = loadTruth('lrc-truth/stranger-than-heaven.json', 'stranger-than-heaven/lyrics.txt')
    const ja = loadWords(join(FIXTURES, 'stranger-than-heaven/transcript.segment.medium.json'))
    const refined = refineAlignmentWithPhrases(sheet(lineTexts), ja, 'ja')
    const spans = computeLineMatchedSpans(lineTexts, sanitizeTranscript(ja))
    assertTruth('stranger segment medium', scoreAgainstTruth(refined.lines, spans, truthTime, { lineTexts }), {
      n: 59, offsetAbs: VERSION_MISMATCHED_OFFSET, absP50: 1.5, absP90: 9.5, absWorst: 21,
      fracWithin250: 0.06, evP90: 2.2, maxNoEvidence: 28,
    })
  })

  it('stranger-than-heaven segment two-pass (app path)', { timeout: 30_000 }, () => {
    const { lineTexts, truthTime } = loadTruth('lrc-truth/stranger-than-heaven.json', 'stranger-than-heaven/lyrics.txt')
    const ja = loadWords(join(FIXTURES, 'stranger-than-heaven/transcript.segment.json'))
    const en = loadWords(join(FIXTURES, 'stranger-than-heaven/transcript.segment.forced-en.json'))
    const mixed = refineMixedLanguageAlignment(sheet(lineTexts), ja, en)
    const spans = computeLineMatchedSpans(lineTexts, sanitizeTranscript(mixed.transcriptWords))
    assertTruth('stranger segment 2-pass', scoreAgainstTruth(mixed.refined.lines, spans, truthTime, { lineTexts }), {
      n: 59, offsetAbs: VERSION_MISMATCHED_OFFSET, absP50: 1.7, absP90: 7.5, absWorst: 14,
      fracWithin250: 0.04, evP90: 3.8, maxNoEvidence: 29,
    })
  })

  // NEW 2026-09-28 (plan W0.4): the shipped default is word timestamps on every
  // transcribing tier (src/ai-pipeline/alignTimestampMode.ts), and this config —
  // word JA pass + the always-segment EN pass, i.e. the real app path for a
  // mixed sheet — was NOT gated by any truth test before. It is now.
  // Measured: it is the BEST of the three paths on this mix fixture
  // (absP90 4.13 vs segment two-pass 6.50 vs segment medium 8.14), which
  // contradicts the older stem-only measurement in alignTimestampMode.ts
  // (word mean 5.61s vs segment 0.74s). Both are real: mode quality depends on
  // the audio source, which is exactly why the choice must be measured per song
  // rather than hard-coded — see plan W1.1.
  it('stranger-than-heaven word two-pass (the shipped mode)', { timeout: 30_000 }, () => {
    const { lineTexts, truthTime } = loadTruth('lrc-truth/stranger-than-heaven.json', 'stranger-than-heaven/lyrics.txt')
    const ja = loadWords(join(FIXTURES, 'stranger-than-heaven/transcript.word.json'))
    const en = loadWords(join(FIXTURES, 'stranger-than-heaven/transcript.segment.forced-en.json'))
    const mixed = refineMixedLanguageAlignment(sheet(lineTexts), ja, en)
    const spans = computeLineMatchedSpans(lineTexts, sanitizeTranscript(mixed.transcriptWords))
    assertTruth('stranger word 2-pass', scoreAgainstTruth(mixed.refined.lines, spans, truthTime, { lineTexts }), {
      n: 59, offsetAbs: VERSION_MISMATCHED_OFFSET, absP50: 1.7, absP90: 5.0, absWorst: 11,
      fracWithin250: 0.02, evP90: 3.8, maxNoEvidence: 32,
    })
  })

  // NEW 2026-09-28 (plan W0.4): word mode WITHOUT the EN second pass. This is the
  // configuration alignTimestampMode.ts documents as failing (a late ramp from
  // line #31 on), and it was gated by no truth test while corpus-baseline.json
  // reported the same run as healthy. Kept as a visible, bounded defect: the
  // numbers below are the 2026-09-28 measurement, and the plan's W1.1 must drive
  // them down. It is NOT the app's path for this mixed sheet (the two-pass above
  // is), so it is a floor on the mode itself rather than on shipped behaviour.
  it('stranger-than-heaven word ja-only (documented word-mode defect)', { timeout: 30_000 }, () => {
    const { lineTexts, truthTime } = loadTruth('lrc-truth/stranger-than-heaven.json', 'stranger-than-heaven/lyrics.txt')
    const ja = loadWords(join(FIXTURES, 'stranger-than-heaven/transcript.word.json'))
    const refined = refineAlignmentWithPhrases(sheet(lineTexts), ja, 'ja')
    const spans = computeLineMatchedSpans(lineTexts, sanitizeTranscript(ja))
    assertTruth('stranger word ja-only', scoreAgainstTruth(refined.lines, spans, truthTime, { lineTexts }), {
      n: 59, offsetAbs: VERSION_MISMATCHED_OFFSET, absP50: 2.3, absP90: 38, absWorst: 40,
      fracWithin250: 0.015, evP90: 2.3, maxNoEvidence: 36,
    })
  })
})

/**
 * PRIOR RECONCILIATION — the measurement that justifies changing the policy at
 * `src/player/alignmentPolicy.ts:42`, which currently refuses to touch lyrics that
 * already carry timings (a fetched LRCLIB entry, an imported .lrc).
 *
 * `scripts/align-ablation.mjs --axis=prior` measured, across 8 song-mode pairs and a
 * range of simulated catalogue offsets, that aligning WITH the prior as a constraint
 * and then reconciling (`applyLrcPrior`) beat aligning from scratch in **every** pair at
 * **every** error size, including an already-exact prior:
 *
 *     prior err   mean absP90   better  tie  worse
 *     +0.0s        1.52           8      0     0
 *     +0.3s        1.44           8      0     0
 *     +0.7s        1.44           8      0     0
 *     +1.4s        1.44           8      0     0
 *     +2.5s        1.89           8      0     0
 *
 * (scratch mean absP90 across the same 8 pairs: 5.47). So the refusal is not merely
 * unsourced — it is actively costly.
 *
 * THE CAVEAT THAT KEEPS THIS HONEST: the prior built here has TRUTH'S RELATIVE
 * STRUCTURE and only a constant offset, which is what a duration-matched catalogue entry
 * should be and is not proven to be. This gate therefore says "reconciliation cannot lose
 * to scratch when the prior's shape is right". It does NOT say real LRCLIB entries have
 * the right shape, and must not be cited for that.
 *
 * A representative subset is gated rather than the full 8-pair sweep, to keep the suite
 * fast; run the script for the whole table.
 */
describe('a correctly-shaped prior never loses to aligning from scratch', () => {
  /** The three pairs with the largest scratch error, so a regression has room to show. */
  const CASES = [
    { label: 'guitar-loneliness word', lyrics: 'guitar-loneliness/lyrics.ja.txt', truth: 'lrc-truth/guitar-loneliness.json', lang: 'ja' as const, t: 'guitar-loneliness/transcript.word.json' },
    { label: 'stranger-than-heaven word two-pass', lyrics: 'stranger-than-heaven/lyrics.txt', truth: 'lrc-truth/stranger-than-heaven.json', lang: 'mixed' as const, t: 'stranger-than-heaven/transcript.word.json', en: 'stranger-than-heaven/transcript.segment.forced-en.json' },
    { label: 'recollect segment two-pass', lyrics: 'recollect/lyrics.txt', truth: 'lrc-truth/recollect.json', lang: 'mixed' as const, t: 'recollect/transcript.segment.json', en: 'recollect/transcript.segment.forced-en.json' },
  ]

  function alignWithPrior(c: (typeof CASES)[number], priorDelta: number | null) {
    const { lineTexts, truthTime } = loadTruth(c.truth, c.lyrics)
    const ja = loadWords(join(FIXTURES, c.t))
    const rows = lineTexts.map((original, i) => ({
      original,
      translation: '',
      startTime: priorDelta != null && truthTime[i] != null ? (truthTime[i] as number) + priorDelta : 0,
      endTime: 0,
    }))
    const priorTimes = rows.map((r) => r.startTime)
    let refined
    let scored = ja
    if (c.en) {
      const en = loadWords(join(FIXTURES, c.en))
      const mixed = refineMixedLanguageAlignment(rows, ja, en)
      refined = mixed.refined
      scored = mixed.transcriptWords
    } else {
      refined = refineAlignmentWithPhrases(rows, ja, c.lang)
    }
    if (priorTimes.some((t) => t > 0)) {
      const spansForPrior = computeLineMatchedSpans(lineTexts, sanitizeTranscript(scored))
      refined = { ...refined, lines: applyLrcPrior(refined.lines, spansForPrior, priorTimes) }
    }
    const spans = computeLineMatchedSpans(lineTexts, sanitizeTranscript(scored))
    return scoreAgainstTruth(refined.lines, spans, truthTime, { lineTexts })
  }

  for (const c of CASES) {
    for (const delta of [0, 0.7]) {
      it(`${c.label}: a prior ${delta === 0 ? 'already exact' : `+${delta}s out`} loses nothing`, { timeout: 60_000 }, () => {
        const scratch = alignWithPrior(c, null)
        const withPrior = alignWithPrior(c, delta)
        // Never materially worse than scratch — this is the safety property that lets the
        // reconciliation pass run at all.
        expect(
          withPrior.absP90,
          `${c.label} δ=${delta}: prior absP90 ${withPrior.absP90?.toFixed(2)} vs scratch ${scratch.absP90?.toFixed(2)}`,
        ).toBeLessThanOrEqual((scratch.absP90 as number) + 0.2)
        // And it must actually help on the pairs where scratch was weakest.
        if ((scratch.absP90 as number) > 3) {
          expect(
            withPrior.absP90,
            `${c.label} δ=${delta}: a prior should materially help a song scratch aligns badly`,
          ).toBeLessThan((scratch.absP90 as number) * 0.7)
        }
      })
    }
  }
})

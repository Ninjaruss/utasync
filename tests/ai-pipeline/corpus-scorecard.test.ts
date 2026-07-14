import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { refineAlignmentWithPhrases } from '../../src/lyrics/phraseAlignment'
import { refineMixedLanguageAlignment } from '../../src/ai-pipeline/mixedLanguageAlign'
import { alignLyrics, sanitizeTranscript } from '../../src/ai-pipeline/aligner'
import { computeLineMatchedSpans } from '../../src/ai-pipeline/contentAligner'
import { computeBoundaryMetrics } from '../../scripts/lib/boundaryMetrics.mjs'
import { minLineDuration } from '../../src/lyrics/lineDegeneracy'
import type { TimedLine } from '../../src/core/types'

/**
 * Fast, deterministic CI guard for the audit corpus. Runs the real phrase-aware
 * alignment over every committed fixture song and asserts the alignment metrics
 * never regress past the snapshot in corpus-baseline.json. Tokenizer-free, so it
 * stays quick; reading + pairing diagnostics live in scripts/audit-corpus.mjs.
 *
 * If a fix legitimately changes a metric, re-snapshot with:
 *   npx tsx scripts/audit-corpus.mjs --write-baseline
 */
const here = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(here, 'fixtures')

interface CorpusSong {
  name: string
  lang: 'ja' | 'en' | 'mixed'
  lyrics: string
  transcript: string
  /** Present on mixed two-pass rows: the EN-forced transcript (see audit-corpus.mjs). */
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
    return [{ word, startTime: start, endTime: end }]
  })
}

const manifest = JSON.parse(readFileSync(join(FIXTURES, 'corpus.json'), 'utf8')) as { songs: CorpusSong[] }
const baseline = JSON.parse(readFileSync(join(FIXTURES, 'corpus-baseline.json'), 'utf8')) as Record<
  string,
  Record<string, number | string>
>

// Documented measurement artifacts: cells allowed to exceed the baseline
// because the flagged line is verifiably at its ground-truth placement and the
// boundary metric misfires on ambiguous span attribution. Each entry needs a
// findings-doc reference; remove it when the baseline is next ratcheted.
//
// Round-6 Task B (floored degenerate-run packing + zero-width elimination,
// diagnosis H2/H3): all entries verified per-row against the LRC ground truth
// (no config regresses; four improve — see the fix commit body).
//
// Round-6 Task C (coverage-gated needs_review→approximate upgrade, diagnosis
// H4): label-only shifts — LRC timing and every bnd_*/align_* timing cell are
// byte-identical. Each added align_needs_review line was verified squashed
// below COMPRESSION_FRACTION of its floor (the gate's exact predicate): word
// +5 (rows 33/34/45/49/50), segment +7 (29/32/35/45/48/49/50), word-autolang
// +19, segment-autolang +27, segment-medium +2 (rows 0/1), mixed-segment +1
// (row 32). Sub-gate slivers on activity blips read approximate before.
//
// Round-6 Task D (late-start backfill drag clamps, diagnosis H5): only D1
// (straddle-guard fallback) moves a corpus cell — guitar-loneliness-segment
// bnd_midword_p2, a Whisper-merged-chunk split artifact detailed on its entry
// below. D2 (high-coverage cap exception) improves stranger-segment LRC timing
// with no corpus regression; D3 (prevFloor pinning) was not-applicable on HEAD.
const ALLOWED_MEASUREMENT_ARTIFACTS: Record<string, Record<string, number>> = {
  // Floor-spread run lines no longer overlap the false activity blip that fed
  // the blanket needs_review→approximate upgrade (Task B), and squashed
  // sub-gate spans no longer take the upgrade at all (Task C) — the extra
  // needs_review are the honest labels for evidence-free or squashed spreads.
  'stranger-than-heaven-word': { align_needs_review: 8 },
  'stranger-than-heaven-segment': { align_needs_review: 10 },
  'stranger-than-heaven-word-autolang': { align_needs_review: 46 },
  'stranger-than-heaven-segment-autolang': { align_needs_review: 28 },
  'stranger-than-heaven-word-medium': { align_needs_review: 12 },
  'stranger-than-heaven-segment-medium': { align_needs_review: 7 },
  'stranger-than-heaven-mixed-word': {
    align_needs_review: 4,
    // Row 24's start is pushed 0.62s by the display-floor reclaim that gives
    // the zero-room rows 22/23 their 1.2s floor (post-merge co-start block).
    bnd_latestart_p2: 1,
    bnd_midword_p2: 5,
  },
  'stranger-than-heaven-mixed-segment': {
    align_needs_review: 3,
    // Row 45 leaves the zero_dur bucket (0s → 1.2s floor, the fixed defect)
    // and row 24 is narrowed by the same rows-22/23 reclaim; every previously
    // compressed row got wider (0.30–0.88s → 1.2s).
    align_compressed: 8,
    // Rows 21/23/24: end borrowed / end floored / start pushed by the
    // display-floor reclaim of the co-start block (all bounded by the floor).
    bnd_early_p2: 3,
    bnd_late_p2: 1,
    bnd_latestart_p2: 2,
    bnd_midword_p2: 4,
  },
  // Round-6 Task D1 (straddle-guard fallback, diagnosis H5): #44
  // "なりたい 何者かでいい" (span onset 195.90, 10/10 coverage) was frozen at
  // 197.85 — 2.92s past LRC truth 194.93 — because the shared boundary at
  // prevSpanEnd (195.81) lands inside Whisper's MERGED chunk
  // "何回になりたいなりたい" [194.60,196.50] (three lyric words collapsed into one
  // 1.90s token), so the guard abandoned the pull. The fallback splits that
  // merged chunk at the previous line's own matched-span end — the true vocal
  // boundary — cutting the LRC error to 0.88s. Both sides of the split (#43 end,
  // #44 start) now sit inside the merged token, so bnd_midword counts +2; it is
  // the chunk-granularity artifact round-5 flagged for this exact row
  // (A2 #44, deferred "no win without sub-chunk timing evidence"), now supplied
  // by the neighbour's span. No LRC config regresses (guitar-segment #44
  // 2.9→0.9, >1s 14→13). Remove at the next baseline ratchet.
  'guitar-loneliness-segment': { bnd_midword_p2: 2 },
}

describe('audit corpus — alignment non-regression', () => {
  it('baseline has a row for every corpus song', () => {
    // Without this, a typo'd song name would silently skip that song's
    // assertions forever (the per-song guard below warns but passes).
    const missing = manifest.songs.filter((s) => !baseline[s.name]).map((s) => s.name)
    expect(missing, `re-snapshot with: npx tsx scripts/audit-corpus.mjs --write-baseline`).toEqual([])
  })

  for (const song of manifest.songs) {
    // 20s: the two-pass alignment re-run is CPU-bound and can exceed the 5s
    // default when the whole suite runs in parallel workers.
    it(`${song.name} does not regress vs baseline`, { timeout: 20_000 }, () => {
      const lineTexts = readFileSync(join(FIXTURES, song.lyrics), 'utf8')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
      let words = loadTranscriptWords(join(FIXTURES, song.transcript))
      const sheetRows: TimedLine[] = lineTexts.map((original) => ({
        original,
        translation: '',
        startTime: 0,
        endTime: 0,
      }))
      // Mirror audit-corpus.mjs: a row with an EN-forced transcript audits the
      // mixed two-pass path and scores against the merged transcript.
      let refined
      if (song.transcriptEn) {
        const enWords = loadTranscriptWords(join(FIXTURES, song.transcriptEn))
        const mixed = refineMixedLanguageAlignment(sheetRows, words, enWords)
        refined = mixed.refined
        words = mixed.transcriptWords
      } else {
        refined = refineAlignmentWithPhrases(sheetRows, words, song.lang)
      }

      const base = baseline[song.name]
      if (!base) {
        // New corpus songs have no row until the baseline is re-snapshotted
        // (audit-corpus.mjs --write-baseline). Warn so drift is visible; a
        // strict coverage assertion lands with the snapshot.
        console.warn(`corpus-scorecard: no baseline row for ${song.name} — skipping`)
        return
      }

      const quality = refined.lineAlignmentQuality ?? []
      const needsReview = quality.filter((q) => q === 'needs_review').length
      let monotonicity = 0
      let zeroDur = 0
      let longDur = 0
      let pileup = 0
      let compressed = 0
      for (let i = 0; i < refined.lines.length; i++) {
        const l = refined.lines[i]
        const dur = l.endTime - l.startTime
        const text = l.original || l.translation
        if (dur <= 0.1) zeroDur++
        if (dur > 18) longDur++
        if (i > 0 && l.startTime < refined.lines[i - 1].startTime) monotonicity++
        if (i > 0 && l.startTime - refined.lines[i - 1].startTime < 0.4) pileup++
        if (dur > 0 && dur < minLineDuration(text) * 0.55) compressed++
      }

      // Carve-outs cap alignment cells the same way as the boundary cells below.
      const cap = (key: string, baselineVal: number) =>
        Math.max(baselineVal, ALLOWED_MEASUREMENT_ARTIFACTS[song.name]?.[key] ?? 0)
      expect(refined.lines.length).toBe(lineTexts.length)
      expect(needsReview).toBeLessThanOrEqual(cap('align_needs_review', base.align_needs_review as number))
      expect(monotonicity).toBeLessThanOrEqual(cap('align_monotonicity', base.align_monotonicity as number))
      expect(zeroDur).toBeLessThanOrEqual(cap('align_zero_dur', base.align_zero_dur as number))
      expect(longDur).toBeLessThanOrEqual(cap('align_long_dur', base.align_long_dur as number))
      expect(pileup).toBeLessThanOrEqual(cap('align_pileup', base.align_pileup as number))
      expect(compressed).toBeLessThanOrEqual(cap('align_compressed', base.align_compressed as number))

      const sanitized = sanitizeTranscript(words)
      const spans = computeLineMatchedSpans(lineTexts, sanitized)
      const pass1 = alignLyrics(lineTexts, words, sheetRows, song.lang)
      const bnd1 = computeBoundaryMetrics(pass1.lines, spans, sanitized)
      const bnd2 = computeBoundaryMetrics(refined.lines, spans, sanitized)
      const boundaryChecks = [
        ['bnd_early_p1', bnd1.earlyEnd],
        ['bnd_early_p2', bnd2.earlyEnd],
        ['bnd_latestart_p1', bnd1.lateStart],
        ['bnd_latestart_p2', bnd2.lateStart],
        ['bnd_late_p1', bnd1.lateEnd],
        ['bnd_late_p2', bnd2.lateEnd],
        ['bnd_midword_p2', bnd2.midWord],
        ['bnd_beyond_audio', bnd2.beyondAudio],
      ] as const
      for (const [key, val] of boundaryChecks) {
        const baselineVal = base[key]
        if (typeof baselineVal === 'number') {
          const cap = Math.max(
            baselineVal,
            ALLOWED_MEASUREMENT_ARTIFACTS[song.name]?.[key] ?? 0,
          )
          expect(val, `${song.name} ${key} regressed: ${val} > ${cap}`).toBeLessThanOrEqual(cap)
        }
      }
    })
  }
})

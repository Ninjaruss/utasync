import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { refineAlignmentWithPhrases } from '../../src/lyrics/phraseAlignment'
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
  lang: 'ja' | 'en'
  lyrics: string
  transcript: string
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

describe('audit corpus — alignment non-regression', () => {
  for (const song of manifest.songs) {
    it(`${song.name} does not regress vs baseline`, () => {
      const lineTexts = readFileSync(join(FIXTURES, song.lyrics), 'utf8')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
      const words = loadTranscriptWords(join(FIXTURES, song.transcript))
      const sheetRows: TimedLine[] = lineTexts.map((original) => ({
        original,
        translation: '',
        startTime: 0,
        endTime: 0,
      }))
      const refined = refineAlignmentWithPhrases(sheetRows, words, song.lang)

      const quality = refined.lineAlignmentQuality ?? []
      const needsReview = quality.filter((q) => q === 'needs_review').length
      let monotonicity = 0
      let zeroDur = 0
      let longDur = 0
      for (let i = 0; i < refined.lines.length; i++) {
        const l = refined.lines[i]
        const dur = l.endTime - l.startTime
        if (dur <= 0.1) zeroDur++
        if (dur > 18) longDur++
        if (i > 0 && l.startTime < refined.lines[i - 1].startTime) monotonicity++
      }

      const base = baseline[song.name]
      expect(refined.lines.length).toBe(lineTexts.length)
      expect(needsReview).toBeLessThanOrEqual(base.align_needs_review as number)
      expect(monotonicity).toBeLessThanOrEqual(base.align_monotonicity as number)
      expect(zeroDur).toBeLessThanOrEqual(base.align_zero_dur as number)
      expect(longDur).toBeLessThanOrEqual(base.align_long_dur as number)
    })
  }
})

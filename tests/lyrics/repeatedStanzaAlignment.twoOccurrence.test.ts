import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { refineAlignmentWithPhrases } from '../../src/lyrics/phraseAlignment'

const here = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(here, '../ai-pipeline/fixtures')

function loadChunks(p: string) {
  const raw = JSON.parse(readFileSync(p, 'utf8'))
  const arr = Array.isArray(raw) ? raw : null
  if (arr) {
    return arr.flatMap((w: { word?: string; startTime?: number; endTime?: number }) => {
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

function loadLines(p: string) {
  return readFileSync(p, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)
}

function refine(lyrics: string, transcript: string) {
  const lineTexts = loadLines(join(FIXTURES, lyrics))
  const words = loadChunks(join(FIXTURES, transcript))
  const sheetRows = lineTexts.map((original) => ({ original, translation: '', startTime: 0, endTime: 0 }))
  return { lineTexts, refined: refineAlignmentWithPhrases(sheetRows, words, 'ja' as const) }
}

describe('two-occurrence repeat re-anchor (evidence-gated)', () => {
  // Targets the gate mechanism directly: stranger's 2-occurrence repeat block
  // (rows 16-19 / 34-37: "錆ひとつない…" / "I found a place that I can call
  // home" / "Tested my fate…" / "連れ行くその場所は") on the SEGMENT transcript.
  // Under the old blanket 2-occurrence skip, the second occurrence sits on
  // stale timing (rows 35-38 score needs_review/approximate/needs_review/good;
  // sheet total 20). The gated re-anchor is accepted (strictly fewer
  // needs_review lines, higher summed rank) and recovers rows 35-36 to "good",
  // dropping the sheet total to 19. Both assertions are RED with the gate
  // deleted (blanket skip restored) — verified by temporarily checking out the
  // pre-gate src file.
  //
  // The bridge "Paved my way, won't live in my past" (rows 44 & 48) is
  // intentionally NOT asserted: grepping the transcripts for its content words
  // ("paved", "pull", "shot", "once", "part of", "never look") yields only a
  // stray "past" at ~116.4s — the bridge couplet is absent from the transcript,
  // so no placement policy can lift it above needs_review (transcript-limited).
  it('stranger 2x repeat block re-anchors on the segment transcript', () => {
    const { lineTexts, refined } = refine(
      'stranger-than-heaven/lyrics.txt',
      'stranger-than-heaven/transcript.segment.json',
    )
    const first = lineTexts.indexOf('I found a place that I can call home')
    const second = lineTexts.indexOf('I found a place that I can call home', first + 1)
    expect(first).toBe(17)
    expect(second).toBe(35)
    const quality = refined.lineAlignmentQuality ?? []
    // Whole-sheet count: blanket skip yields 20; the accepted re-anchor of the
    // [16,34] block must bring it to 19 or better.
    const totalNeedsReview = quality.filter((q) => q === 'needs_review').length
    expect(totalNeedsReview).toBeLessThanOrEqual(19)
    // Block-local: of the 4 rows starting at the repeat's "I found a place…"
    // line, the gated re-anchor achieves 3 non-needs_review (rows 35, 36, 38;
    // row 37 "連れ行くその場所は" stays flagged). The blanket skip manages only 2.
    const cleanInBlock = [0, 1, 2, 3].filter((k) => quality[second + k] !== 'needs_review').length
    expect(cleanInBlock).toBeGreaterThanOrEqual(3)
    // And the line the re-anchor recovers outright:
    expect(quality[second]).not.toBe('needs_review')
  })

  it('veil does not regress (its 2-occurrence verse pairs must fail the gate)', () => {
    const { refined } = refine('veil/lyrics.ja.txt', 'veil/transcript.words.json')
    const needsReview = (refined.lineAlignmentQuality ?? []).filter((q) => q === 'needs_review').length
    expect(needsReview).toBeLessThanOrEqual(7) // current locked baseline value
  })
})

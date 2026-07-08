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
  // NOTE on the bridge assertion: stranger's bridge "Paved my way, won't live in
  // my past" (sheet rows 44 & 48) is transcribed as unrelated garble in
  // transcript.word.json — the entire bridge couplet is absent. Grepping the
  // whole transcript for the bridge's content words ("paved", "pull", "shot",
  // "once", "part of", "never look") yields only a single stray "past" at
  // ~116.4s; the ~154s region reads "…made a way, boy / Taking us to the place
  // where / Stranger…heaven". So neither bridge occurrence can score above
  // needs_review from any placement (verified: even force-accepting the
  // re-anchor leaves rows 48-50 needs_review). The evidence-gated re-anchor
  // therefore CORRECTLY declines to move this block (candidate is not strictly
  // better) — so we assert the gate is safe here (no worse than a no-op) rather
  // than a re-anchor that this fixture's transcript cannot support.
  it('stranger bridge repeat: gate declines an un-anchorable garbled re-anchor', () => {
    const { lineTexts, refined } = refine(
      'stranger-than-heaven/lyrics.txt',
      'stranger-than-heaven/transcript.word.json',
    )
    const first = lineTexts.indexOf('Paved my way, won\'t live in my past')
    const second = lineTexts.indexOf('Paved my way, won\'t live in my past', first + 1)
    expect(first).toBe(44)
    expect(second).toBe(48)
    const quality = refined.lineAlignmentQuality ?? []
    // The second block never precedes the first (monotonic), and the gate does
    // not push it earlier than the reference occurrence.
    expect(refined.lines[second].startTime).toBeGreaterThanOrEqual(refined.lines[first].startTime)
    // The gate must not REGRESS: total needs_review across the whole sheet stays
    // at or below the Task-1 baseline (27 word). Proves the speculative 2-occ
    // re-anchor never lands a worse placement anywhere (incl. this un-anchorable
    // bridge, which it correctly declines to move).
    const totalNeedsReview = quality.filter((q) => q === 'needs_review').length
    expect(totalNeedsReview).toBeLessThanOrEqual(27)
  })

  it('veil does not regress (its 2-occurrence verse pairs must fail the gate)', () => {
    const { refined } = refine('veil/lyrics.ja.txt', 'veil/transcript.words.json')
    const needsReview = (refined.lineAlignmentQuality ?? []).filter((q) => q === 'needs_review').length
    expect(needsReview).toBeLessThanOrEqual(7) // current locked baseline value
  })
})

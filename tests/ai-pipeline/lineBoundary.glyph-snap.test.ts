import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { refineAlignmentWithPhrases } from '../../src/lyrics/phraseAlignment'
import { sanitizeTranscript } from '../../src/ai-pipeline/aligner'
import { computeLineMatchedSpans } from '../../src/ai-pipeline/contentAligner'

const here = dirname(fileURLToPath(import.meta.url))

function loadWords(p: string) {
  const raw = JSON.parse(readFileSync(p, 'utf8'))
  if (Array.isArray(raw)) {
    return raw.flatMap((w: { word?: string; startTime?: number; endTime?: number }) => {
      const word = w.word?.trim()
      if (!word || !Number.isFinite(w.startTime) || !Number.isFinite(w.endTime)) return []
      return [{ word, startTime: w.startTime as number, endTime: w.endTime as number }]
    })
  }
  return (raw.chunks ?? []).flatMap((c: { text?: string; timestamp?: number[] }) => {
    const [start, end] = c.timestamp ?? []
    const word = c.text?.trim()
    if (!word || !Number.isFinite(start) || !Number.isFinite(end)) return []
    return [{ word, startTime: start as number, endTime: end as number }]
  })
}

function loadLines(p: string): string[] {
  return readFileSync(p, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)
}

// D2: snapBoundaryToGlyphTransition snapped a line boundary to the wrong glyph
// — a transition *inside* the line's own span (clipping the end early) or the
// following line's onset (starting late). On my-eyes-only the two
// "I promise for my eyes only" lines lost ~0.5s of tail; on veil L6 started
// ~1.06s late (findings 2026-07-line-boundary-findings.md).
describe('line boundary: glyph-snap over-shift (D2)', () => {
  it('my-eyes: "I promise for my eyes only" earlyEnd within bound (both occurrences)', () => {
    const dir = join(here, 'fixtures')
    const lineTexts = loadLines(join(dir, 'my-eyes-only.lyrics.txt'))
    const words = loadWords(join(dir, 'my-eyes-only.transcript.json'))
    const sheetRows = lineTexts.map((original) => ({ original, translation: '', startTime: 0, endTime: 0 }))
    const refined = refineAlignmentWithPhrases(sheetRows, words, 'ja')
    const spans = computeLineMatchedSpans(lineTexts, sanitizeTranscript(words))

    const occurrences = lineTexts
      .map((t, i) => (t === 'I promise for my eyes only' ? i : -1))
      .filter((i) => i >= 0)
    expect(occurrences.length).toBeGreaterThanOrEqual(2)
    for (const i of occurrences) {
      const span = spans[i]!
      expect(span, `no span for line ${i}`).not.toBeNull()
      expect(span.lastEndTime - refined.lines[i].endTime, `line ${i} earlyEnd`).toBeLessThanOrEqual(0.35)
    }
  })

  it('veil: L6 "温まることない痛みと" lateStart within bound', () => {
    const dir = join(here, 'fixtures/veil')
    const lineTexts = loadLines(join(dir, 'lyrics.ja.txt'))
    const words = loadWords(join(dir, 'transcript.words.json'))
    const sheetRows = lineTexts.map((original) => ({ original, translation: '', startTime: 0, endTime: 0 }))
    const refined = refineAlignmentWithPhrases(sheetRows, words, 'ja')
    const spans = computeLineMatchedSpans(lineTexts, sanitizeTranscript(words))

    const i = lineTexts.indexOf('温まることない痛みと')
    expect(i).toBeGreaterThanOrEqual(0)
    const span = spans[i]!
    expect(span).not.toBeNull()
    expect(refined.lines[i].startTime - span.firstTime).toBeLessThanOrEqual(0.35)
  })
})

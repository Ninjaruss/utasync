import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { refineAlignmentWithPhrases } from '../../src/lyrics/phraseAlignment'
import { sanitizeTranscript } from '../../src/ai-pipeline/aligner'
import { computeLineMatchedSpans } from '../../src/ai-pipeline/contentAligner'

const here = dirname(fileURLToPath(import.meta.url))
const FIX = join(here, 'fixtures/guitar-loneliness')

// Loader that accepts both the word-array and the {chunks:[{text,timestamp}]}
// Whisper formats, matching scripts/audit-corpus.mjs.
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

// D1: realignMergedLineGroups over-shifts merged chorus lines on
// guitar-loneliness-segment. The tuner snapped group-member lines to the merged
// group's envelope instead of respecting each member's own matched span, giving
// L4/L7 lateStart and L30 earlyEnd (findings 2026-07-line-boundary-findings.md).
describe('line boundary: merged-group over-shift (D1)', () => {
  const lineTexts = loadLines(join(FIX, 'lyrics.ja.txt'))
  const words = loadWords(join(FIX, 'transcript.segment.json'))
  const sheetRows = lineTexts.map((original) => ({ original, translation: '', startTime: 0, endTime: 0 }))
  const refined = refineAlignmentWithPhrases(sheetRows, words, 'ja')
  const spans = computeLineMatchedSpans(lineTexts, sanitizeTranscript(words))

  const idxOf = (text: string) => {
    const i = lineTexts.indexOf(text)
    if (i < 0) throw new Error(`line not found: ${text}`)
    return i
  }

  it.each([
    ['春と秋 どこいっちゃったんだよ'],
    ['わたしはどこにいる'],
  ])('lateStart within bound: %s', (text) => {
    const i = idxOf(text)
    const span = spans[i]!
    expect(span).not.toBeNull()
    // lateStart = line begins after its first sung word by more than 0.35s
    expect(refined.lines[i].startTime - span.firstTime).toBeLessThanOrEqual(0.35)
  })

  it('earlyEnd within bound: なんでこんな熱くなっちゃってんだ', () => {
    const i = idxOf('なんでこんな熱くなっちゃってんだ')
    const span = spans[i]!
    expect(span).not.toBeNull()
    expect(span.lastEndTime - refined.lines[i].endTime).toBeLessThanOrEqual(0.35)
  })
})

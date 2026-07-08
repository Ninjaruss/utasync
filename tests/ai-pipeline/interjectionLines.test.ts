import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isInterjectionLyricLine } from '../../src/ai-pipeline/contentAligner'
import { refineAlignmentWithPhrases } from '../../src/lyrics/phraseAlignment'

const here = dirname(fileURLToPath(import.meta.url))
const FIX = join(here, 'fixtures/stranger-than-heaven')

describe('isInterjectionLyricLine — EN vocalizations', () => {
  it.each([
    'Ahh, ooh-hmm, yeah-yeah',
    'Ooh-ooh (Oh)',
    'Oh, yeah (Hey)',
    'Yeah-yeah, ayy, yeah-yeah (Hey)',
    '(Hey) Oh, alright',
  ])('classifies %s as interjection', (line) => {
    expect(isInterjectionLyricLine(line)).toBe(true)
  })

  it.each([
    'Back streets, walking on the edge of the night',
    'I found a place where I\'m not alone',
    'Oh what a night it was', // real words beyond vocalizations
    '嗚呼...',                  // JA branch unchanged
  ])('does not misclassify %s', (line) => {
    expect(isInterjectionLyricLine(line)).toBe(line === '嗚呼...')
  })
})

describe('interjection lines are un-scoreable, not needs_review', () => {
  it('stranger interlude rows 38-42 classify approximate after refine', () => {
    const lineTexts = readFileSync(join(FIX, 'lyrics.txt'), 'utf8')
      .split('\n').map((l) => l.trim()).filter(Boolean)
    const raw = JSON.parse(readFileSync(join(FIX, 'transcript.word.json'), 'utf8'))
    const words = (raw.chunks ?? []).flatMap((c: { text?: string; timestamp?: number[] }) => {
      const [start, end] = c.timestamp ?? []
      const word = c.text?.trim()
      if (!word || !Number.isFinite(start) || !Number.isFinite(end)) return []
      return [{ word, startTime: start, endTime: end }]
    })
    const sheetRows = lineTexts.map((original) => ({ original, translation: '', startTime: 0, endTime: 0 }))
    const refined = refineAlignmentWithPhrases(sheetRows, words, 'ja')
    const quality = refined.lineAlignmentQuality ?? []
    const interjRows = lineTexts
      .map((t, i) => ({ t, i }))
      .filter(({ t }) => isInterjectionLyricLine(t))
      .map(({ i }) => i)
    expect(interjRows.length).toBe(5)
    for (const i of interjRows) {
      expect(quality[i], `row ${i} "${lineTexts[i]}"`).not.toBe('needs_review')
    }

    // The run-aware redistribution contract: every interlude row keeps a
    // visible span at/above the floor (0.12s minus the 0.01s inter-line gap)
    // and starts stay strictly monotonic without overlapping the next row.
    for (const i of interjRows) {
      const line = refined.lines[i]
      expect(line.endTime - line.startTime, `row ${i} span`).toBeGreaterThanOrEqual(0.11)
      const next = refined.lines[i + 1]
      if (next) {
        expect(next.startTime, `row ${i} -> ${i + 1} order`).toBeGreaterThanOrEqual(line.startTime)
        expect(line.endTime, `row ${i} overlap`).toBeLessThanOrEqual(next.startTime + 0.001)
      }
    }
  })
})

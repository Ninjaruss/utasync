import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { refineAlignmentWithPhrases } from '../../src/lyrics/phraseAlignment'
import { sanitizeTranscript } from '../../src/ai-pipeline/aligner'
import { computeLineMatchedSpans } from '../../src/ai-pipeline/contentAligner'
// @ts-expect-error plain ESM module without types
import { computeBoundaryMetrics } from '../../scripts/lib/boundaryMetrics.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const FIX = join(here, 'fixtures/veil')

// veil L4 "届かないままの景色と": Whisper mis-heard the line's final と as を
// (…景[27.74] 色[28.18] を[28.62-29.10] 温[29.34]…), so the LCS span ends at
// 28.62 and no glyph pair can find the true transition. The refined end landed
// at 28.95 — strictly inside を — clipping the final sung syllable. The whole
// word belongs to this line (the next line starts at 29.34, after the word),
// so the end must extend to the word edge.
describe('line boundary: end must not sit inside a sung word (mid-word end)', () => {
  const lineTexts = readFileSync(join(FIX, 'lyrics.ja.txt'), 'utf8')
    .split('\n').map((l) => l.trim()).filter(Boolean)
  const words = JSON.parse(readFileSync(join(FIX, 'transcript.words.json'), 'utf8'))
  const sheetRows = lineTexts.map((original) => ({ original, translation: '', startTime: 0, endTime: 0 }))
  const refined = refineAlignmentWithPhrases(sheetRows, words, 'ja')
  const sanitized = sanitizeTranscript(words)
  const spans = computeLineMatchedSpans(lineTexts, sanitized)

  it('veil pass-2 has zero mid-word boundaries', () => {
    const m = computeBoundaryMetrics(refined.lines, spans, sanitized)
    expect(m.midWord).toBe(0)
  })

  it('L4 "届かないままの景色と" ends at/after its final mis-transcribed syllable', () => {
    const i = lineTexts.indexOf('届かないままの景色と')
    expect(i).toBeGreaterThanOrEqual(0)
    // を[28.62-29.10] is the mis-heard final と; the end must not clip it.
    expect(refined.lines[i].endTime).toBeGreaterThanOrEqual(29.10 - 0.01)
    // and it must not bleed into the next line's onset (温 at 29.34).
    expect(refined.lines[i].endTime).toBeLessThanOrEqual(29.34 + 0.01)
  })
})

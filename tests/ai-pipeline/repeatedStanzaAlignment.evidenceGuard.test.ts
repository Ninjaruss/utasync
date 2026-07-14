import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { refineAlignmentWithPhrases } from '../../src/lyrics/phraseAlignment'
import { sanitizeTranscript } from '../../src/ai-pipeline/aligner'
import { computeLineMatchedSpans } from '../../src/ai-pipeline/contentAligner'
import { minLineDuration } from '../../src/lyrics/lineDegeneracy'

const here = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(here, 'fixtures')

const words = JSON.parse(
  readFileSync(join(FIXTURES, 'my-eyes-only.transcript.json'), 'utf8'),
) as Array<{ word: string; startTime: number; endTime: number }>
const lineTexts = readFileSync(join(FIXTURES, 'my-eyes-only.lyrics.txt'), 'utf8')
  .split('\n').map((l) => l.trim()).filter(Boolean)

// CLASS-T2b (round-5 finding A4): the sheet's `ねえ いつか / ねえ いつも` block
// repeats three times (rows 4–5, 20–21, 36–37), and row 38 is a standalone
// `ねえ いつか` right after the third occurrence. realignRepeatedStanzaOccurrences
// used to window-realign the third occurrence into row 38's audio (the window
// extends to nextStart + 2), so #37 `ねえ いつも` — near-identical to #38's text —
// jumped from its own fully-matched audio onto #38's, piling both onto 171.32
// and squashing #37 to ~0.3s. There is no LRC truth for this song, so the test
// anchors on the line's own char-LCS matched-span evidence instead.
describe('repeated-stanza third-occurrence evidence guard (my-eyes-only #37/#38)', () => {
  it('keeps #37 on its own high-coverage span evidence and #38 unsquashed', { timeout: 60000 }, () => {
    const sheetRows = lineTexts.map((original) => ({
      original,
      translation: '',
      startTime: 0,
      endTime: 0,
    }))
    const refined = refineAlignmentWithPhrases(sheetRows, words, 'ja')
    const spans = computeLineMatchedSpans(lineTexts, sanitizeTranscript(words))

    // Preconditions: #37 has full-coverage span evidence of its own; if the
    // fixture ever changes shape, fail loudly here rather than in the asserts.
    expect(lineTexts[37]).toBe('ねえ いつも')
    expect(lineTexts[38]).toBe('ねえ いつか')
    const span37 = spans[37]
    expect(span37).not.toBeNull()
    expect(span37!.matchedChars / span37!.totalChars).toBeGreaterThanOrEqual(0.75)

    // #37 must not be re-anchored off its own matched-span evidence: its final
    // start has to sit within the span (small tolerance for boundary tuning).
    const line37 = refined.lines[37]
    expect(line37.startTime).toBeGreaterThanOrEqual(span37!.firstTime - 2)
    expect(line37.startTime).toBeLessThanOrEqual(span37!.lastEndTime + 2)

    // Neither line of the pair may end up squashed by the pile-up.
    expect(line37.endTime - line37.startTime).toBeGreaterThanOrEqual(
      minLineDuration(lineTexts[37]) * 0.55,
    )
    const line38 = refined.lines[38]
    expect(line38.endTime - line38.startTime).toBeGreaterThanOrEqual(
      minLineDuration(lineTexts[38]) * 0.55,
    )
    // And #37 must start strictly before #38 (no pile-up at the same instant).
    expect(line38.startTime - line37.startTime).toBeGreaterThanOrEqual(0.4)
  })
})

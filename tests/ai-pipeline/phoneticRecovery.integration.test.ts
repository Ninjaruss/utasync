import { describe, it, expect } from 'vitest'
import { refineAlignmentWithPhrases } from '../../src/lyrics/phraseAlignment'

interface W {
  word: string
  startTime: number
  endTime: number
}

/** One transcript word per JA glyph at ~0.35s each, starting at `start`. */
function jaWords(text: string, start: number, perChar = 0.35): W[] {
  return [...text].map((word, i) => ({
    word,
    startTime: +(start + i * perChar).toFixed(3),
    endTime: +(start + (i + 1) * perChar).toFixed(3),
  }))
}

function enWords(pairs: [string, number, number][]): W[] {
  return pairs.map(([word, s, e]) => ({ word, startTime: s, endTime: e }))
}

function refine(lyrics: string[], words: W[]) {
  const sheetRows = lyrics.map((original) => ({ original, translation: '', startTime: 0, endTime: 0 }))
  return refineAlignmentWithPhrases(sheetRows, words, 'ja')
}

// Task 7 / C2b — phonetic anchor recovery for misheard sung English lines.
// These are SYNTHETIC end-to-end scenarios (the real stranger-than-heaven
// candidate is blocked by a separate class-B mis-anchoring of its neighbour, so
// it cannot demonstrate the tuner in isolation). "Broken city lights" misheard
// as "Prakkun zaydee loyss" fails the lexical LCS (quality needs_review) but
// keeps its consonant frame (phonetic similarity 0.889 >= the 0.70 floor).
describe('phonetic anchor recovery (integration)', () => {
  it('re-anchors a misheard English line onto its true (misheard) sung span', () => {
    const lyrics = ['君の声が聞こえる', 'Broken city lights', '夜が明ける前に', '静かに歩いて']
    const words: W[] = [
      ...jaWords('君の声が聞こえる', 10.0), // anchors 'good' ~10.0-12.8
      // misheard "Broken city lights" -> "Prakkun zaydee loyss" @ 20.0-22.0,
      // sitting in the gap between the JA anchors with room on both sides so the
      // ownership guard does not trip.
      ...enWords([
        ['Prakkun', 20.0, 20.6],
        ['zaydee', 20.6, 21.2],
        ['loyss', 21.2, 22.0],
      ]),
      ...jaWords('夜が明ける前に', 25.0),
      ...jaWords('静かに歩いて', 29.0),
    ]

    const refined = refine(lyrics, words)
    const line = refined.lines[1]
    // Without phonetic recovery this line is interpolated across the dead air
    // (roughly 14.5-23.5, far off the real span). Recovery pins it to 20.0-22.0.
    expect(line.startTime).toBeGreaterThan(19.5)
    expect(line.startTime).toBeLessThan(20.5)
    expect(line.endTime).toBeGreaterThan(21.5)
    expect(line.endTime).toBeLessThan(22.5)
    // A recovered line sits on real (misheard) audio — upgraded off needs_review.
    expect(refined.lineAlignmentQuality[1]).not.toBe('needs_review')
  })

  it('does NOT re-anchor an English line with no phonetic match (threshold gate holds)', () => {
    const lyrics = ['君の声が聞こえる', 'Broken city lights', '夜が明ける前に', '静かに歩いて']
    const words: W[] = [
      ...jaWords('君の声が聞こえる', 10.0),
      // Unrelated JA activity fills the 20-22 gap — no English phonetic match.
      ...jaWords('全然違う言葉', 20.0),
      ...jaWords('夜が明ける前に', 25.0),
      ...jaWords('静かに歩いて', 29.0),
    ]

    const refined = refine(lyrics, words)
    const line = refined.lines[1]
    // The tuner must not false-anchor the English line onto the unrelated JA
    // span at 20.0; it stays where the lexical pipeline left it (~14.5) and
    // remains flagged (no spurious upgrade).
    expect(line.startTime).toBeLessThan(19.0)
    expect(refined.lineAlignmentQuality[1]).toBe('needs_review')
  })
})

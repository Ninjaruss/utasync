import { describe, it, expect } from 'vitest'
import { autoAlignLines } from '../../src/lyrics/lineAligner'

/**
 * Embeds so that the CONCATENATION of 'part-a' and 'part-b' matches
 * 'WHOLE', while neither half matches it well alone.
 */
const embed = async (texts: string[]) =>
  texts.map((t) => {
    const v = new Array(4).fill(0)
    const hasA = t.includes('part-a')
    const hasB = t.includes('part-b')
    if (hasA && hasB) { v[0] = 1 }            // the merged pair
    else if (hasA) { v[1] = 1 }
    else if (hasB) { v[2] = 1 }
    else if (t.includes('WHOLE')) { v[0] = 1 } // matches only the merged pair
    else { v[3] = 1 }
    return v
  })

// Long enough to clear MIN_TRANSLATION_GLYPHS_FOR_GROUP (55 non-space glyphs) —
// measured against the real corpus, a lower gate let the G candidate perturb
// dp[][] scores on cells that never picked it, moving pair_unpaired on clean
// 1:1 fixtures, and separately broke a Veil word-pairing integration fixture
// that uses uniform embeddings (every dp[][] cell tied), even though G was
// never selected in the final path either time. See task-7-report.md.
const WHOLE_TEXT = 'WHOLE covering both of these two combined sung lines together as one'

describe('G move — two originals to one translation', () => {
  it('groups two originals onto one translation', async () => {
    const { aligned, groups, extras } = await autoAlignLines(
      ['part-a', 'part-b', 'other'],
      [WHOLE_TEXT, 'unrelated tail'],
      embed,
    )
    expect(groups[0]).toBe(groups[1])
    expect(groups[2]).not.toBe(groups[0])
    expect(aligned[0]).toBe(WHOLE_TEXT)
    expect(aligned[1]).toBe(WHOLE_TEXT)
    expect(extras).toEqual([])
  })

  it('does NOT let a short translation swallow two long originals', async () => {
    const longA = 'part-a ' + 'x'.repeat(40)
    const longB = 'part-b ' + 'y'.repeat(40)
    const { groups } = await autoAlignLines([longA, longB], ['WHOLE'], embed)
    expect(groups[0]).not.toBe(groups[1])
  })

  it('prefers pairing one and blanking the other when that scores better', async () => {
    // 'part-a' matches the (long enough to clear the gate) translation exactly;
    // 'zzz' matches nothing, so blanking it must still beat forcing a group. The
    // grouped 'part-a\nzzz' text is embedded as a distinct, non-matching vector
    // (diluted by 'zzz') so the G candidate is a genuinely worse reading, not an
    // artifact of a naive embed function that ignores 'zzz' entirely.
    const longExact = 'part-a exact and definitely nothing whatsoever about the other line at all'
    const { aligned, groups } = await autoAlignLines(
      ['part-a', 'zzz'],
      [longExact],
      async (texts) => texts.map((t) => {
        const v = new Array(4).fill(0)
        if (t.includes('part-a') && t.includes('zzz')) v[2] = 1
        else if (t.includes('part-a')) v[1] = 1
        else v[3] = 1
        return v
      }),
    )
    expect(groups[0]).not.toBe(groups[1])
    expect(aligned[1]).toBe('')
  })
})

describe('skip penalty', () => {
  it('does not collapse into long unpaired runs when counts diverge', async () => {
    const originals = Array.from({ length: 10 }, (_, i) => `match-${i}`)
    const translations = Array.from({ length: 6 }, (_, i) => `MATCH-${i}`)
    const embedN = async (texts: string[]) =>
      texts.map((t) => {
        const v = new Array(16).fill(0)
        const m = /match-(\d+)/i.exec(t)
        v[m ? Number(m[1]) : 15] = 1
        return v
      })
    const { aligned } = await autoAlignLines(originals, translations, embedN)
    const paired = aligned.filter(Boolean).length
    expect(paired, 'every translation should find its original').toBe(6)
  })
})

describe('translationGroup stamping', () => {
  it('stamps translationGroup only on rows that share a translation', async () => {
    const { smartAttachSecondLanguage } = await import('../../src/lyrics/lineAligner')
    const primary = [
      { startTime: 0, endTime: 1, original: 'part-a', translation: '' },
      { startTime: 1, endTime: 2, original: 'part-b', translation: '' },
      { startTime: 2, endTime: 3, original: 'other', translation: '' },
    ]
    const result = await smartAttachSecondLanguage(
      primary,
      `${WHOLE_TEXT}\nunrelated tail`,
      embed,
    )
    expect(result.lines[0].translationGroup).toBe(result.lines[1].translationGroup)
    expect(result.lines[0].translationGroup).toBeDefined()
    expect(result.lines[2].translationGroup).toBeUndefined()
  })
})

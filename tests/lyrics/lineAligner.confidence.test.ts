import { describe, it, expect } from 'vitest'
import { autoAlignLines, smartAttachSecondLanguage } from '../../src/lyrics/lineAligner'
import type { TimedLine } from '../../src/core/types'

/** Embeds so that 'match-N' aligns with 'MATCH-N' and nothing else. */
const embed = async (texts: string[]) =>
  texts.map((t) => {
    const v = new Array(16).fill(0)
    const m = /match-(\d+)/i.exec(t)
    v[m ? Number(m[1]) % 16 : 15] = 1
    return v
  })

describe('autoAlignLines confidence', () => {
  it('scores a clean pairing high and a forced one low', async () => {
    const originals = ['match-1', 'match-2', 'match-3']
    const translations = ['MATCH-1', 'MATCH-2', 'nothing like it']
    const { confidence } = await autoAlignLines(originals, translations, embed)

    expect(confidence).toHaveLength(3)
    expect(confidence[0]).toBeGreaterThan(0.7)
    expect(confidence[1]).toBeGreaterThan(0.7)
    expect(confidence[2]).toBeLessThan(0.5)
  })

  it('gives an unpaired original zero confidence', async () => {
    const { aligned, confidence } = await autoAlignLines(
      ['match-1', 'match-2'], ['MATCH-1'], embed,
    )
    expect(aligned[1]).toBe('')
    expect(confidence[1]).toBe(0)
  })

  it('leaves a deliberately-skipped metadata row without a confidence', async () => {
    const primary: TimedLine[] = [
      { startTime: 0, endTime: 1, original: 'Some Song Title', translation: '' },
      { startTime: 1, endTime: 2, original: 'かなしいうた', translation: '' },
    ]
    const result = await smartAttachSecondLanguage(
      primary, 'a sad song', embed, { songTitle: 'Some Song Title', artist: 'Someone' },
    )
    // The Latin metadata row is declined, not failed: no confidence at all.
    expect(result.lines[0].translationConfidence).toBeUndefined()
  })
})

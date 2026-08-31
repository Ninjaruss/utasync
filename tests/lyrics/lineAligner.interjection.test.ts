import { describe, it, expect } from 'vitest'
import { autoAlignLines } from '../../src/lyrics/lineAligner'

/**
 * An interjection line ("嗚呼", "あー", any 1-2 glyph Japanese line) used to be
 * scored at a hard -1, so it could NEVER take a translation. That was meant to
 * stop it stealing a real line's English, but it also meant that when a paste
 * genuinely DID contain a line for it, that line had nowhere to go — the DP's
 * merge move glued it onto the following row instead, so the user saw their
 * text on the wrong line and nothing on the interjection.
 *
 * What actually protects the no-translation case is the FREE SKIP for
 * interjection originals, not the -1. Scored normally, an interjection pairs
 * when a matching translation exists and is skipped for free when none does.
 */

/** Pairs 'match-N' with 'MATCH-N'; everything else is orthogonal. */
const embed = async (texts: string[]) =>
  texts.map((t) => {
    const v = new Array(16).fill(0)
    const m = /match-(\d+)/i.exec(t)
    v[m ? Number(m[1]) % 15 : 15] = 1
    return v
  })

describe('interjection lines', () => {
  it('takes its translation when the paste genuinely has one', async () => {
    // 嗚呼 is an interjection; here the paste DOES carry a line for it.
    const originals = ['match-1', '嗚呼 match-2', 'match-3']
    const translations = ['MATCH-1', 'MATCH-2', 'MATCH-3']
    const { aligned } = await autoAlignLines(originals, translations, embed)

    expect(aligned[0]).toBe('MATCH-1')
    expect(aligned[1], 'the interjection row must receive its own translation').toBe('MATCH-2')
    expect(aligned[2]).toBe('MATCH-3')
  })

  it('does not glue the interjection translation onto the next row', async () => {
    const originals = ['match-1', '嗚呼 match-2', 'match-3']
    const { aligned } = await autoAlignLines(originals, ['MATCH-1', 'MATCH-2', 'MATCH-3'], embed)
    // The old behaviour merged two translations onto one row with a newline.
    expect(aligned.some((a) => a.includes('\n')), 'no row should carry two translations').toBe(false)
  })

  it('is still left unpaired when nothing matches it', async () => {
    // The free skip, not a -1 score, is what protects this case.
    const originals = ['match-1', '嗚呼', 'match-3']
    const { aligned } = await autoAlignLines(originals, ['MATCH-1', 'MATCH-3'], embed)

    expect(aligned[0]).toBe('MATCH-1')
    expect(aligned[1], 'a bare interjection with no matching line stays blank').toBe('')
    expect(aligned[2]).toBe('MATCH-3')
  })
})

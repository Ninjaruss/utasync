// tests/lyrics/lineAligner.extras.test.ts
import { describe, it, expect } from 'vitest'
import { smartAttachSecondLanguage } from '../../src/lyrics/lineAligner'
import type { TimedLine } from '../../src/core/types'

const embed = async (texts: string[]) =>
  texts.map((t) => {
    // Deterministic pseudo-embedding: unit vector keyed on length + first char.
    const v = new Array(8).fill(0)
    v[t.length % 8] = 1
    return v
  })

describe('extras are never silently dropped', () => {
  it('reports unplaced translation lines on a TIMED primary', async () => {
    const primary: TimedLine[] = [
      { startTime: 1, endTime: 2, original: 'アルファ', translation: '' },
      { startTime: 2, endTime: 3, original: 'ベータ', translation: '' },
    ]
    // Four translation lines for two rows: at least two cannot be placed 1:1.
    const secondary = 'one\ntwo\nthree\nfour'
    const result = await smartAttachSecondLanguage(primary, secondary, embed)

    const emitted = result.lines.flatMap((l) => (l.translation ?? '').split('\n').filter(Boolean))
    const all = [...emitted, ...(result.extras ?? [])]
    for (const line of ['one', 'two', 'three', 'four']) {
      expect(all, `"${line}" must survive somewhere`).toContain(line)
    }
  })
})

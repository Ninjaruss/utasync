import { describe, it, expect } from 'vitest'
import { lineToTokenIds, lineToTokenIdsJa } from '../../../src/ai-pipeline/forcedAlign/normalize'

// Uppercase char vocab like wav2vec2-base-960h. '|' is the word separator; '<pad>' is blank.
const label2id: Record<string, number> = { '<pad>': 0, '|': 1, A: 2, B: 3, O: 4, Z: 5, R: 6 }

describe('lineToTokenIds', () => {
  it('uppercases, maps chars to ids, spaces to the word separator, drops unknowns', () => {
    const ids = lineToTokenIds('ab z!', 'en', label2id, { wordSep: '|' })
    expect(ids).toEqual([2, 3, 1, 5]) // A B | Z  (space -> '|', '!' dropped)
  })

  it('romanizes JA before mapping (async romanizer injected)', async () => {
    const romanize = async () => 'aozora'
    const ids = await lineToTokenIdsJa('青空', label2id, { wordSep: '|', romanize })
    expect(ids).toEqual([2, 4, 5, 4, 6, 2]) // A O Z O R A
  })
})

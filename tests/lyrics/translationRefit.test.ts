import { describe, it, expect } from 'vitest'
import { shouldRefitTranslation } from '../../src/lyrics/translationRefit'
import type { TimedLine } from '../../src/core/types'

const L = (original: string): TimedLine => ({ startTime: 0, endTime: 1, original, translation: '' })

describe('shouldRefitTranslation', () => {
  it('is false when the originals are unchanged', () => {
    expect(shouldRefitTranslation([L('a'), L('b')], [L('a'), L('b')])).toBe(false)
  })

  it('is true when the line count changed', () => {
    expect(shouldRefitTranslation([L('a'), L('b')], [L('a'), L('b'), L('c')])).toBe(true)
  })

  it('is true when a line text changed', () => {
    expect(shouldRefitTranslation([L('a'), L('b')], [L('a'), L('B!')])).toBe(true)
  })

  it('ignores pure timing changes', () => {
    const before = [{ startTime: 0, endTime: 1, original: 'a', translation: '' }]
    const after = [{ startTime: 5, endTime: 9, original: 'a', translation: '' }]
    expect(shouldRefitTranslation(before, after)).toBe(false)
  })

  it('is false for two empty line lists', () => {
    expect(shouldRefitTranslation([], [])).toBe(false)
  })
})

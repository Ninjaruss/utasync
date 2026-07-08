import { describe, it, expect } from 'vitest'
import { resolveTokenReading, shouldPromoteSungReading } from '../../src/lyrics/readingDisplay'
import type { Token } from '../../src/core/types'

const token = (extra: Partial<Token>): Token => ({
  surface: '理由',
  startIndex: 0,
  endIndex: 2,
  ...extra,
})

describe('shouldPromoteSungReading', () => {
  it('promotes a high-confidence alternate even in dictionary mode', () => {
    const t = token({ audioReading: 'ワケ', readingConfidence: 0.95 })
    expect(shouldPromoteSungReading(t, 'dictionary')).toBe(true)
  })

  it('does not promote a below-threshold alternate in dictionary mode', () => {
    const t = token({ audioReading: 'ワケ', readingConfidence: 0.79 })
    expect(shouldPromoteSungReading(t, 'dictionary')).toBe(false)
  })

  it('promotes any adopted alternate in sung mode', () => {
    const t = token({ audioReading: 'アス', readingConfidence: 0.4 })
    expect(shouldPromoteSungReading(t, 'sung')).toBe(true)
  })

  it('never promotes when audio verified the dictionary reading', () => {
    const t = token({ reading: 'リユウ', readingVerified: true, audioReading: 'リユウ' })
    expect(shouldPromoteSungReading(t, 'sung')).toBe(false)
  })
})

describe('resolveTokenReading', () => {
  it('promotes a high-confidence alternate into ruby in dictionary mode', () => {
    const resolved = resolveTokenReading(
      token({ reading: 'リユウ', audioReading: 'ワケ', readingConfidence: 0.85 }),
      'dictionary',
    )
    expect(resolved.ruby).toBe('わけ')
    expect(resolved.source).toBe('sung')
    expect(resolved.title).toContain('りゆう')
  })

  it('promotes the sung reading into ruby in sung mode', () => {
    const resolved = resolveTokenReading(
      token({ reading: 'リユウ', audioReading: 'ワケ', readingConfidence: 0.85 }),
      'sung',
    )
    expect(resolved.ruby).toBe('わけ')
    expect(resolved.source).toBe('sung')
  })

  it('keeps dictionary in ruby for low-confidence alternates', () => {
    const resolved = resolveTokenReading(
      token({ reading: 'センソウ', audioReading: 'ソレ', readingConfidence: 0.35 }),
      'dictionary',
    )
    expect(resolved.ruby).toBe('せんそう')
    expect(resolved.source).toBe('dictionary')
    expect(resolved.title).toContain('それ')
  })

  it('shows dictionary when audio verified the reading', () => {
    const resolved = resolveTokenReading(
      token({ reading: 'キミ', readingVerified: true }),
      'dictionary',
    )
    expect(resolved.ruby).toBe('きみ')
    expect(resolved.source).toBe('dictionary')
    expect(resolved.title).toBe('Verified from audio')
  })
})

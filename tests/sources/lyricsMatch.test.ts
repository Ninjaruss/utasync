import { describe, it, expect } from 'vitest'
import {
  sameArtist,
  isAlternateLanguage,
  durationMatches,
  rankByDuration,
} from '../../src/sources/lyricsMatch'

describe('sameArtist', () => {
  it('matches Latin names case-insensitively', () => {
    expect(sameArtist('YOASOBI', 'Yoasobi')).toBe(true)
  })

  it('matches when one name contains the other', () => {
    expect(sameArtist('Taylor Swift', 'Swift')).toBe(true)
  })

  it('matches CJK artist names', () => {
    expect(sameArtist('米津玄師', '米津 玄師')).toBe(true)
  })

  it('rejects unrelated artists', () => {
    expect(sameArtist('Adele', 'Beyoncé')).toBe(false)
  })
})

describe('isAlternateLanguage', () => {
  it('treats English as alternate to Japanese primary', () => {
    expect(isAlternateLanguage('Your eyes in the night', 'ja')).toBe(true)
  })

  it('rejects Japanese when primary is Japanese', () => {
    expect(isAlternateLanguage('君の瞳', 'ja')).toBe(false)
  })

  it('treats Japanese as alternate to English primary', () => {
    expect(isAlternateLanguage('君の瞳', 'other')).toBe(true)
  })
})

describe('durationMatches', () => {
  it('allows ±2 second tolerance', () => {
    expect(durationMatches(233, 235)).toBe(true)
    expect(durationMatches(230, 235)).toBe(false)
  })

  it('passes when either side is missing', () => {
    expect(durationMatches(undefined, 200)).toBe(true)
    expect(durationMatches(200, undefined)).toBe(true)
  })
})

describe('rankByDuration', () => {
  it('orders closest duration first', () => {
    const ranked = rankByDuration(
      [{ duration: 300 }, { duration: 235 }, { duration: 242 }],
      241,
    )
    expect(ranked.map((r) => r.duration)).toEqual([242, 235, 300])
  })
})

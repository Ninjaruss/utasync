import { describe, it, expect } from 'vitest'
import { metadataLooksConsistent, needsLyricsMatchConfirmation } from '../../src/sources/lyricsMatch'

describe('metadataLooksConsistent', () => {
  it('accepts close title and artist matches', () => {
    expect(metadataLooksConsistent('Blinding Lights', 'The Weeknd', 'Blinding Lights', 'The Weeknd')).toBe(true)
  })

  it('rejects clearly different songs', () => {
    expect(metadataLooksConsistent('Song A', 'Artist A', 'Totally Different', 'Other Band')).toBe(false)
  })
})

describe('needsLyricsMatchConfirmation', () => {
  it('requires confirm for low-score fuzzy matches', () => {
    expect(needsLyricsMatchConfirmation('A', 'B', {
      track: 'X', artist: 'Y', matchScore: 0.6, matchKind: 'fuzzy',
    })).toBe(true)
  })

  it('skips confirm for high-score consistent exact matches', () => {
    expect(needsLyricsMatchConfirmation('My Song', 'My Artist', {
      track: 'My Song', artist: 'My Artist', matchScore: 0.98, matchKind: 'exact',
    })).toBe(false)
  })

  it('does not require confirm when there is no LRCLIB match metadata', () => {
    expect(needsLyricsMatchConfirmation('My Song', 'My Artist', undefined)).toBe(false)
  })
})

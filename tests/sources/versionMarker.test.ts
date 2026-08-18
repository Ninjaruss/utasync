import { describe, it, expect } from 'vitest'
import { extractVersionMarkers, versionAgreement } from '../../src/sources/versionMarker'

describe('extractVersionMarkers', () => {
  it('finds a Latin marker in parentheses', () => {
    expect(extractVersionMarkers('Song Name (Live)')).toEqual(['live'])
  })

  it('finds a Japanese marker', () => {
    // The reported case: a specific vocal version of a Yamashita track.
    expect(extractVersionMarkers('幸せにさよなら (山下ヴォーカル・バージョン)')).toContain('version')
  })

  it('normalises spelling variants to one token', () => {
    expect(extractVersionMarkers('Song (Remaster)')).toEqual(['remaster'])
    expect(extractVersionMarkers('Song (Remastered)')).toEqual(['remaster'])
    expect(extractVersionMarkers('Song (2019 Remastered Version)')).toContain('remaster')
  })

  it('returns nothing for a plain title', () => {
    expect(extractVersionMarkers('Song Name')).toEqual([])
  })

  // "Official Video" is production noise, not a musical version — treating it as a
  // marker would penalise every correct YouTube match.
  it('ignores upload noise that is not a version', () => {
    expect(extractVersionMarkers('Song Name (Official Video)')).toEqual([])
    expect(extractVersionMarkers('Song Name [MV]')).toEqual([])
  })

  it('finds markers in brackets and after a dash', () => {
    expect(extractVersionMarkers('Song Name [Acoustic]')).toEqual(['acoustic'])
    expect(extractVersionMarkers('Song Name - Live')).toEqual(['live'])
  })
})

describe('versionAgreement', () => {
  it('is neutral when neither title declares a version', () => {
    expect(versionAgreement('Song', 'Song')).toBe(0)
  })

  it('rewards a match', () => {
    expect(versionAgreement('Song (Live)', 'Song (Live)')).toBeGreaterThan(0)
  })

  it('penalises a conflict', () => {
    expect(versionAgreement('Song (Live)', 'Song (Acoustic)')).toBeLessThan(0)
  })

  // The reported failure: the user's title declares a version, the candidate is the
  // plain master. That is a likely wrong-master match and must cost score.
  it('penalises a versioned query matching an unversioned candidate', () => {
    expect(versionAgreement('Song (Live)', 'Song')).toBeLessThan(0)
  })

  it('penalises an unversioned query matching a versioned candidate', () => {
    expect(versionAgreement('Song', 'Song (Live)')).toBeLessThan(0)
  })

  it('is symmetric', () => {
    expect(versionAgreement('Song (Live)', 'Song')).toBe(versionAgreement('Song', 'Song (Live)'))
  })
})

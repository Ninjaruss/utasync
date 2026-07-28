import { describe, it, expect } from 'vitest'
import { deriveSources, computeSyncState } from '../../../src/core/db/migrations'
import type { Song } from '../../../src/core/types'

function baseSong(over: Partial<Song> = {}): Song {
  return {
    id: 's1', title: 'T', artist: 'A',
    lyrics: { lines: [], sourceLanguage: 'ja', translationLanguage: 'en', alignmentMode: 'manual' },
    createdAt: new Date(),
    ...over,
  }
}

describe('deriveSources', () => {
  it('maps a YouTube sourceUrl to a youtube SourceRef without local audio processing', () => {
    const s = baseSong({ sourceUrl: 'https://youtube.com/watch?v=abc123' })
    expect(deriveSources(s)).toEqual([
      { provider: 'youtube', ref: 'abc123', url: 'https://youtube.com/watch?v=abc123', hasAudio: false },
    ])
  })

  it('maps a stored audio path to an upload SourceRef with audio', () => {
    const s = baseSong({ audioStoredPath: 'songs/s1.mp3' })
    expect(deriveSources(s)).toEqual([
      { provider: 'upload', ref: 'songs/s1.mp3', hasAudio: true },
    ])
  })

  it('returns existing sources untouched when already present', () => {
    const sources = [{ provider: 'youtube' as const, ref: 'x', hasAudio: true }]
    expect(deriveSources(baseSong({ sources }))).toBe(sources)
  })

  it('returns [] when there is no source information', () => {
    expect(deriveSources(baseSong())).toEqual([])
  })
})

describe('computeSyncState', () => {
  it('is needs-sync when there are no lines', () => {
    expect(computeSyncState(baseSong())).toBe('needs-sync')
  })

  it('is needs-sync when any line lacks a positive startTime', () => {
    const lines = [
      { startTime: 1, endTime: 2, original: 'a', translation: '' },
      { startTime: 0, endTime: 0, original: 'b', translation: '' },
    ]
    expect(computeSyncState(baseSong({ lyrics: { lines, sourceLanguage: 'ja', translationLanguage: 'en', alignmentMode: 'manual' } }))).toBe('needs-sync')
  })

  it('is synced when every line has a positive startTime', () => {
    const lines = [
      { startTime: 0.5, endTime: 2, original: 'a', translation: '' },
      { startTime: 2, endTime: 4, original: 'b', translation: '' },
    ]
    expect(computeSyncState(baseSong({ lyrics: { lines, sourceLanguage: 'ja', translationLanguage: 'en', alignmentMode: 'manual' } }))).toBe('synced')
  })

  it('is synced when the first line starts at 0 and the rest are positive', () => {
    const lines = [
      { startTime: 0, endTime: 2, original: 'a', translation: '' },
      { startTime: 2, endTime: 4, original: 'b', translation: '' },
    ]
    expect(computeSyncState(baseSong({ lyrics: { lines, sourceLanguage: 'ja', translationLanguage: 'en', alignmentMode: 'manual' } }))).toBe('synced')
  })

  // Quality-aware song badge: a fully-timed song whose aligner flagged many
  // lines as unverifiable is not honestly "synced".
  const timedLines = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ startTime: i * 2, endTime: i * 2 + 2, original: `l${i}`, translation: '' }))
  const lyricsWith = (n: number, quality: ('good' | 'approximate' | 'needs_review')[]) => ({
    lines: timedLines(n),
    lineAlignmentQuality: quality,
    sourceLanguage: 'ja' as const,
    translationLanguage: 'en' as const,
    alignmentMode: 'auto' as const,
  })

  it('stays synced when only a small share of lines are needs_review', () => {
    // 1 of 10 = 10%, at/under tolerance → still synced.
    const q = Array.from({ length: 10 }, (_, i) => (i === 0 ? 'needs_review' : 'good')) as ('good' | 'needs_review')[]
    expect(computeSyncState(baseSong({ lyrics: lyricsWith(10, q) }))).toBe('synced')
  })

  it('becomes needs-sync when many lines are needs_review', () => {
    // 4 of 10 = 40% unverified → the "synced" badge would be a false positive.
    const q = Array.from({ length: 10 }, (_, i) => (i < 4 ? 'needs_review' : 'good')) as ('good' | 'needs_review')[]
    expect(computeSyncState(baseSong({ lyrics: lyricsWith(10, q) }))).toBe('needs-sync')
  })

  it('does not flip to needs-sync on routine approximate line-ends', () => {
    // A long segment-mode track: every line is approximate (fuzzy ends) but
    // none is needs_review — still fine to sing along to, stays synced.
    const q = Array.from({ length: 12 }, () => 'approximate') as 'approximate'[]
    expect(computeSyncState(baseSong({ lyrics: lyricsWith(12, q) }))).toBe('synced')
  })

  it('ignores blank lines when measuring the unverified share', () => {
    const lines = [
      { startTime: 0, endTime: 2, original: 'a', translation: '' },
      { startTime: 2, endTime: 4, original: '', translation: '' }, // blank spacer
      { startTime: 4, endTime: 6, original: 'c', translation: '' },
      { startTime: 6, endTime: 8, original: 'd', translation: '' },
    ]
    // 1 needs_review out of 3 non-blank lines = 33% → needs-sync.
    const lineAlignmentQuality = ['needs_review', 'good', 'good', 'good'] as ('good' | 'needs_review')[]
    expect(
      computeSyncState(baseSong({ lyrics: { lines, lineAlignmentQuality, sourceLanguage: 'ja', translationLanguage: 'en', alignmentMode: 'auto' } })),
    ).toBe('needs-sync')
  })

  it('falls back to the structural check when quality length does not match lines', () => {
    // Stale/absent quality (e.g. phrase-layout mismatch) must not be trusted.
    const q = ['needs_review', 'needs_review'] as ('needs_review')[]
    expect(computeSyncState(baseSong({ lyrics: lyricsWith(10, q as never) }))).toBe('synced')
  })
})

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
})

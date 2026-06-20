import { describe, it, expect } from 'vitest'
import {
  createPlaylistEntry,
  movePlaylistEntryByIndex,
  playlistEntryLabel,
} from '../../src/player/abLoopPlaylist'

describe('abLoopPlaylist', () => {
  it('creates entries with optional labels', () => {
    const entry = createPlaylistEntry(10, 25, 'Chorus')
    expect(entry.a).toBe(10)
    expect(entry.b).toBe(25)
    expect(entry.label).toBe('Chorus')
    expect(entry.id).toBeTruthy()
  })

  it('formats labels from timestamps when unnamed', () => {
    expect(playlistEntryLabel({ id: 'x', a: 65, b: 92 })).toBe('1:05–1:32')
  })

  it('moves entries without mutating when out of range', () => {
    const a = createPlaylistEntry(1, 2, 'A')
    const b = createPlaylistEntry(3, 4, 'B')
    const entries = [a, b]
    expect(movePlaylistEntryByIndex(entries, 0, 0)).toBe(entries)
    expect(movePlaylistEntryByIndex(entries, 0, 2)).toBe(entries)
    expect(movePlaylistEntryByIndex(entries, 1, 0)).toEqual([b, a])
  })
})

import { describe, it, expect } from 'vitest'
import {
  DEFAULT_PLAYLIST_REPEAT_COUNT,
  createPlaylistEntry,
  movePlaylistEntryByIndex,
  normalizePlaylistRepeatCount,
  playlistRepeatHelpText,
  playlistRepeatLabel,
  shouldAdvancePlaylistAfterCycle,
} from '../../src/player/abLoopPlaylist'

describe('shouldAdvancePlaylistAfterCycle', () => {
  it('defaults to 3 repeats before advancing', () => {
    expect(shouldAdvancePlaylistAfterCycle(1, DEFAULT_PLAYLIST_REPEAT_COUNT)).toBe(false)
    expect(shouldAdvancePlaylistAfterCycle(2, DEFAULT_PLAYLIST_REPEAT_COUNT)).toBe(false)
    expect(shouldAdvancePlaylistAfterCycle(3, DEFAULT_PLAYLIST_REPEAT_COUNT)).toBe(true)
  })

  it('advances after one cycle when repeat count is 1', () => {
    expect(shouldAdvancePlaylistAfterCycle(1, 1)).toBe(true)
  })

  it('never advances when repeat count is infinite (0)', () => {
    expect(shouldAdvancePlaylistAfterCycle(1, 0)).toBe(false)
    expect(shouldAdvancePlaylistAfterCycle(99, 0)).toBe(false)
  })

  it('normalizes invalid repeat counts', () => {
    expect(shouldAdvancePlaylistAfterCycle(2, -2)).toBe(false)
    expect(shouldAdvancePlaylistAfterCycle(3, 2.9)).toBe(true)
  })
})

describe('normalizePlaylistRepeatCount', () => {
  it('floors positive values and clamps negatives to infinite', () => {
    expect(normalizePlaylistRepeatCount(3.7)).toBe(3)
    expect(normalizePlaylistRepeatCount(-1)).toBe(0)
    expect(normalizePlaylistRepeatCount(Number.NaN)).toBe(DEFAULT_PLAYLIST_REPEAT_COUNT)
  })
})

describe('playlistRepeatLabel', () => {
  it('shows infinity symbol for non-positive counts', () => {
    expect(playlistRepeatLabel(0)).toBe('∞')
    expect(playlistRepeatLabel(3)).toBe('3')
  })
})

describe('playlistRepeatHelpText', () => {
  it('describes finite and infinite repeat behavior', () => {
    expect(playlistRepeatHelpText(3)).toContain('3 times')
    expect(playlistRepeatHelpText(1)).toContain('once')
    expect(playlistRepeatHelpText(0)).toContain('until you stop')
  })
})

describe('createPlaylistEntry', () => {
  it('creates an entry with id and optional label', () => {
    const entry = createPlaylistEntry(1, 5, 'verse')
    expect(entry.a).toBe(1)
    expect(entry.b).toBe(5)
    expect(entry.label).toBe('verse')
    expect(entry.id).toBeTruthy()
  })
})

describe('movePlaylistEntryByIndex', () => {
  it('moves an entry within bounds', () => {
    const entries = [
      createPlaylistEntry(0, 1, 'a'),
      createPlaylistEntry(2, 3, 'b'),
    ]
    const moved = movePlaylistEntryByIndex(entries, 1, 0)
    expect(moved[0].label).toBe('b')
    expect(moved[1].label).toBe('a')
  })
})

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LyricsFoundConfirm, lyricsFoundReadyToApply } from '../../src/lyrics/LyricsFoundConfirm'
import type { TimedLine } from '../../src/core/types'

const lines: TimedLine[] = [
  { startTime: 0, endTime: 1, original: 'Line one', translation: '' },
  { startTime: 1, endTime: 2, original: 'Line two', translation: '' },
]

describe('LyricsFoundConfirm', () => {
  it('shows LRCLIB matched title and artist', () => {
    render(
      <LyricsFoundConfirm
        queriedTitle="My Song"
        queriedArtist="My Artist"
        lines={lines}
        synced
        sourceLabel="LRCLIB (synced)"
        match={{ track: 'Other Song', artist: 'Other Artist', matchScore: 0.6, matchKind: 'fuzzy' }}
        confirmed={false}
        onConfirm={vi.fn()}
        onUseDifferent={vi.fn()}
      />,
    )
    expect(screen.getByText('Other Song')).toBeTruthy()
    expect(screen.getByText(/Other Artist/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /yes, this is the right song/i })).toBeTruthy()
  })

  it('calls onConfirm when user accepts a fuzzy match', () => {
    const onConfirm = vi.fn()
    render(
      <LyricsFoundConfirm
        queriedTitle="My Song"
        queriedArtist="My Artist"
        lines={lines}
        synced
        sourceLabel="LRCLIB (synced)"
        match={{ track: 'Other Song', artist: 'Other Artist', matchScore: 0.6, matchKind: 'fuzzy' }}
        confirmed={false}
        onConfirm={onConfirm}
        onUseDifferent={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /yes, this is the right song/i }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })
})

describe('lyricsFoundReadyToApply', () => {
  it('blocks apply until confirm when metadata diverges', () => {
    const match = { track: 'Wrong', artist: 'Wrong', matchScore: 0.5, matchKind: 'fuzzy' as const }
    expect(lyricsFoundReadyToApply('Real Title', 'Real Artist', match, false)).toBe(false)
    expect(lyricsFoundReadyToApply('Real Title', 'Real Artist', match, true)).toBe(true)
  })

  it('allows apply without confirm on strong exact match', () => {
    const match = { track: 'My Song', artist: 'My Artist', matchScore: 0.98, matchKind: 'exact' as const }
    expect(lyricsFoundReadyToApply('My Song', 'My Artist', match, false)).toBe(true)
  })
})

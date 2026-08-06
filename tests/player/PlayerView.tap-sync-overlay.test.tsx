import { describe, it, expect, vi, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { db } from '../../src/core/db/schema'
import { PlayerView } from '../../src/player/PlayerView'
import { usePlayerStore } from '../../src/player/PlayerStore'

const ytPlay = vi.fn()
const ytDestroy = vi.fn()

// The real component mounts an iframe; what matters here is only whether it is
// mounted at all, and whether entering tap-through tears it down.
vi.mock('../../src/player/YouTubePlayer', () => ({
  YouTubePlayer: () => {
    return <div data-testid="yt-player" />
  },
}))

vi.mock('../../src/ai-pipeline/capability', () => ({
  getDeviceTier: () => 'full',
  canUseVocalSeparation: () => true,
  hasWebGPU: () => true,
}))

vi.mock('../../src/ai-pipeline/AutoAlignFlow', () => ({
  AutoAlignFlow: () => <div data-testid="auto-align-flow" />,
  default: () => <div data-testid="auto-align-flow" />,
}))

beforeEach(async () => {
  ytPlay.mockClear()
  ytDestroy.mockClear()
  usePlayerStore.setState({ currentSongId: null, playbackState: 'idle', position: 0, duration: 0 })
  await db.songs.clear()
  // A YouTube-link song whose lyrics were pasted, so they carry no timings.
  // This is the exact shape that routes straight into tap-through on open.
  await db.songs.put({
    id: 'yt1',
    title: 'T',
    artist: 'A',
    sourceUrl: 'https://www.youtube.com/watch?v=abc12345678',
    sources: [{ provider: 'youtube', ref: 'abc12345678', url: 'https://www.youtube.com/watch?v=abc12345678', hasAudio: false }],
    lyrics: {
      lines: [
        { startTime: 0, endTime: 0, original: 'line one', translation: '' },
        { startTime: 0, endTime: 0, original: 'line two', translation: '' },
      ],
      sourceLanguage: 'en',
      translationLanguage: 'en',
      alignmentMode: 'manual',
    },
    syncState: 'needs-sync',
    createdAt: new Date(),
  } as never)
})

describe('PlayerView tap-through on a YouTube song', () => {
  it('keeps the YouTube player mounted, so taps are stamped against a running clock', async () => {
    render(<PlayerView songId="yt1" onBack={vi.fn()} autoAlignOnOpen />)

    // The song routes itself into tap-through on open.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Mark line start' })).toBeTruthy())

    // Regression: tap-through used to be an early return that unmounted the
    // only <YouTubePlayer> in the tree, freezing the clock at 0:00 so every tap
    // recorded the same timestamp.
    expect(screen.getByTestId('yt-player')).toBeTruthy()
  })

  it('returns to the player when tap-through is cancelled', async () => {
    render(<PlayerView songId="yt1" onBack={vi.fn()} autoAlignOnOpen />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Mark line start' })).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /cancel tap-through/i }))

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Mark line start' })).toBeNull())
    // The app header — and its ← Back — is reachable again.
    expect(screen.getByRole('button', { name: '← Back' })).toBeTruthy()
    expect(screen.getByTestId('yt-player')).toBeTruthy()
  })
})

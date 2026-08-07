import { describe, it, expect, vi, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { db } from '../../src/core/db/schema'
import { PlayerView } from '../../src/player/PlayerView'
import { usePlayerStore } from '../../src/player/PlayerStore'

vi.mock('../../src/core/opfs/audio', () => ({
  getAudioFile: vi.fn(async () => new File([], 'song1.mp3')),
}))

vi.mock('../../src/player/AudioEngine', () => ({
  AudioEngine: class {
    duration = 10; position = 0
    async load() {} play() {} pause() {} seek() {} destroy() {} setRate() {} setVolume() {}
    onTimeUpdate() {} onEnd() {}
  },
}))

vi.mock('../../src/ai-pipeline/capability', () => ({
  getDeviceTier: () => 'full', canUseVocalSeparation: () => true, hasWebGPU: () => true,
}))

const seed = async (id: string, title: string) => {
  await db.songs.put({
    id, title, artist: 'A',
    audioStoredPath: `songs/${id}.mp3`,
    sources: [{ provider: 'upload', ref: id, hasAudio: true }],
    lyrics: {
      lines: [{ startTime: 1, endTime: 3, original: `${title} line`, translation: '' }],
      sourceLanguage: 'en', translationLanguage: 'en', alignmentMode: 'manual',
    },
    syncState: 'synced', createdAt: new Date(),
  } as never)
}

beforeEach(async () => {
  usePlayerStore.setState({ currentSongId: null, playbackState: 'idle', position: 0, duration: 0 })
  await db.songs.clear()
  await seed('song1', 'First')
  await seed('song2', 'Second')
})

describe('switching songs before the first load settles', () => {
  it('lands a genuinely new song in Play mode', async () => {
    const { rerender } = render(<PlayerView songId="song1" onBack={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('First line')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    await waitFor(() => expect(screen.getByRole('button', { name: /edit timestamp for line 1/i })).toBeTruthy())

    rerender(<PlayerView songId="song2" onBack={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('Second line')).toBeTruthy())
    expect(screen.queryByRole('button', { name: /edit timestamp for line 1/i })).toBeNull()
  })

  // Regression: the load routine awaits a Dexie write and had no `cancelled`
  // re-check afterwards, so a superseded load could resume and overwrite the
  // song the user had already moved on to.
  it('shows the song that was asked for, not one a superseded load resolved to', async () => {
    const { rerender } = render(<PlayerView songId="song1" onBack={vi.fn()} />)
    // Switch before the first load can settle.
    rerender(<PlayerView songId="song2" onBack={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('Second line')).toBeTruthy())
    await new Promise((r) => setTimeout(r, 60))
    expect(screen.queryByText('First line')).toBeNull()
    expect(screen.getByText('Second line')).toBeTruthy()
  })

  it('does not let a superseded load drag the user out of Edit mode', async () => {
    const { rerender } = render(<PlayerView songId="song1" onBack={vi.fn()} />)
    rerender(<PlayerView songId="song2" onBack={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Second line')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    await waitFor(() => expect(screen.getByRole('button', { name: /edit timestamp for line 1/i })).toBeTruthy())

    // Any late resolution of the song1 load must not reset the mode.
    await new Promise((r) => setTimeout(r, 80))
    expect(screen.getByRole('button', { name: /edit timestamp for line 1/i })).toBeTruthy()
  })
})

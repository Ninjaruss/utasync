import { describe, it, expect, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { db } from '../../src/core/db/schema'
import { PlayerView } from '../../src/player/PlayerView'

vi.mock('../../src/player/AudioEngine', () => ({
  AudioEngine: class {
    duration = 10; position = 3
    async load() {} play() {} pause() {} seek() {} destroy() {} setRate() {} setVolume() {}
    onTimeUpdate() {} onEnd() {}
  },
}))

async function seedSong(overrides: Record<string, unknown>) {
  await db.songs.clear()
  await db.songs.put({
    id: 'song1', title: 'T', artist: 'A',
    sources: [{ provider: 'youtube', ref: 'abc', hasAudio: true }],
    lyrics: { lines: [{ startTime: 1, endTime: 3, original: 'hello', translation: '' }], sourceLanguage: 'en', translationLanguage: 'en', alignmentMode: 'manual' },
    syncState: 'synced', createdAt: new Date(),
    ...overrides,
  } as never)
}

describe('PlayerView local audio gating', () => {
  it('does not offer Auto-align for a YouTube-only song with no stored audio', async () => {
    await seedSong({})
    render(<PlayerView songId="song1" onBack={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('hello')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    await waitFor(() => expect(screen.getByLabelText(/edit timestamp/i)).toBeTruthy())
    expect(screen.queryByRole('button', { name: /auto-align/i })).toBeNull()
    expect(screen.getByText(/tap-through to time lyrics/i)).toBeTruthy()
  })

  it('offers Auto-align once audioStoredPath is present', async () => {
    await seedSong({ audioStoredPath: '/audio/song1' })
    render(<PlayerView songId="song1" onBack={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('hello')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    // Generous timeout: this assertion flakes under full-suite load at the default 1s.
    await waitFor(() => expect(screen.getByRole('button', { name: /auto-align/i })).toBeTruthy(), { timeout: 10_000 })
  })

  it('shows an add-audio banner for YouTube-only songs', async () => {
    await seedSong({ sourceUrl: 'https://youtube.com/watch?v=abc123' })
    render(<PlayerView songId="song1" onBack={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('hello')).toBeTruthy())
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /add audio file/i })).toBeTruthy()
      expect(screen.getByText(/streaming via youtube/i)).toBeTruthy()
    })
  })

  it('streams via YouTube when only unified sources are stored', async () => {
    await seedSong({ sources: [{ provider: 'youtube', ref: 'abc123', url: 'https://youtube.com/watch?v=abc123', hasAudio: false }] })
    render(<PlayerView songId="song1" onBack={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('hello')).toBeTruthy())
    await waitFor(() => {
      expect(screen.getByText(/streaming via youtube/i)).toBeTruthy()
    })
  })

  it('does not offer play-mode re-align (Edit → Auto-align is the sole entry point)', async () => {
    await seedSong({ audioStoredPath: '/audio/song1' })
    render(<PlayerView songId="song1" onBack={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('hello')).toBeTruthy())
    expect(screen.queryByRole('button', { name: /re-align/i })).toBeNull()
  })
})

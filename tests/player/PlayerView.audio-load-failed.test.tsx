import { describe, it, expect, vi, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, waitFor } from '@testing-library/react'
import { db } from '../../src/core/db/schema'
import { PlayerView } from '../../src/player/PlayerView'

// Deliberately NOT mocking core/opfs/audio: getAudioFile throws in jsdom, which is
// exactly the "stored audio failed to load" production case we want to surface.

vi.mock('../../src/player/AudioEngine', () => ({
  AudioEngine: class {
    duration = 0; position = 0
    async load() {} play() {} pause() {} seek() {} destroy() {} setRate() {} setVolume() {}
    onTimeUpdate() {} onEnd() {}
  },
}))

beforeEach(async () => {
  await db.songs.clear()
  await db.songs.put({
    id: 'song1', title: 'T', artist: 'A',
    audioStoredPath: 'songs/song1.mp3',
    sources: [{ provider: 'upload', ref: 'song1', hasAudio: true }],
    lyrics: { lines: [{ startTime: 1, endTime: 3, original: 'hello', translation: '' }], sourceLanguage: 'en', translationLanguage: 'en', alignmentMode: 'manual' },
    syncState: 'synced', createdAt: new Date(),
  } as never)
})

describe('PlayerView audio load failure', () => {
  it('surfaces a recovery banner when a stored audio file cannot be loaded', async () => {
    render(<PlayerView songId="song1" onBack={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('hello')).toBeTruthy())
    await waitFor(() => expect(screen.getByText(/couldn.t load this song.s audio/i)).toBeTruthy())
    // The recovery affordance lets the user re-attach a file.
    expect(screen.getByText(/re-?attach/i)).toBeTruthy()
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, waitFor } from '@testing-library/react'
import { db } from '../../src/core/db/schema'
import { PlayerView } from '../../src/player/PlayerView'
import { usePlayerStore } from '../../src/player/PlayerStore'

const load = vi.fn(async () => {})
const setVolume = vi.fn()

vi.mock('../../src/player/AudioEngine', () => ({
  AudioEngine: class {
    duration = 10
    position = 0
    load = load
    setVolume = setVolume
    play() {}
    pause() {}
    seek() {}
    destroy() {}
    setRate() {}
    onTimeUpdate() {}
    onEnd() {}
  },
}))

vi.mock('../../src/core/opfs/audio', () => ({
  getAudioFile: vi.fn(async () => new File([], 'song1.mp3')),
}))

beforeEach(async () => {
  load.mockClear()
  setVolume.mockClear()
  await db.songs.clear()
  await db.songs.put({
    id: 'song1',
    title: 'T',
    artist: 'A',
    sources: [{ provider: 'youtube', ref: 'abc', hasAudio: true }],
    lyrics: {
      lines: [{ startTime: 1, endTime: 3, original: 'hello', translation: '' }],
      sourceLanguage: 'en',
      translationLanguage: 'en',
      alignmentMode: 'manual',
    },
    syncState: 'synced',
    createdAt: new Date(),
    isTrialSong: false,
    audioStoredPath: '/audio/song1',
  } as never)
  usePlayerStore.setState({ volume: 0.6, currentSongId: null, position: 0 })
})

describe('PlayerView volume', () => {
  it('passes store volume into audio load and applies it after load', async () => {
    render(<PlayerView songId="song1" onBack={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('hello')).toBeTruthy())
    await waitFor(() => expect(load).toHaveBeenCalledWith(expect.anything(), 0.6))
    await waitFor(() => expect(setVolume).toHaveBeenCalledWith(0.6))
  })
})

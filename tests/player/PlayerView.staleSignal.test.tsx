import { describe, it, expect, vi, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { db } from '../../src/core/db/schema'
import { PlayerView } from '../../src/player/PlayerView'

/**
 * The vocal-activity envelope is persisted so drag re-timing can snap onto a real
 * onset without re-running Demucs. It describes ONE piece of audio. Replacing the
 * audio and keeping the signal would snap corrections onto onsets from a track
 * that is no longer playing — a confident, invisible wrong answer, worse than not
 * snapping at all.
 */

vi.mock('../../src/player/AudioEngine', () => ({
  AudioEngine: class {
    duration = 0; position = 0
    async load() {} play() {} pause() {} seek() {} destroy() {} setRate() {} setVolume() {}
    onTimeUpdate() {} onEnd() {}
  },
}))
vi.mock('../../src/sources/audioIngest', () => ({
  attachAudioToSong: vi.fn(async () => ({ audioStoredPath: 'songs/replaced.mp3' })),
}))
vi.mock('../../src/sources/coverArt', () => ({ resolveCoverArt: vi.fn(async () => undefined) }))

const signal = () => ({
  hopSec: 0.02,
  activity: new Float32Array([0, 1, 1]),
  onset: new Float32Array([0, 1, 0]),
  source: 'stem' as const,
})

beforeEach(async () => {
  await db.songs.clear()
  await db.songs.put({
    id: 'song1', title: 'T', artist: 'A',
    audioStoredPath: 'songs/song1.mp3',
    sources: [{ provider: 'upload', ref: 'song1', hasAudio: true }],
    lyrics: {
      lines: [{ startTime: 1, endTime: 3, original: 'hello', translation: '' }],
      sourceLanguage: 'en', translationLanguage: 'en', alignmentMode: 'auto',
      vocalActivity: signal(),
    },
    syncState: 'synced', createdAt: new Date(),
  } as never)
})

describe('replacing a song audio file', () => {
  it('drops the vocal-activity signal that described the old audio', async () => {
    render(<PlayerView songId="song1" onBack={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('hello')).toBeTruthy())
    // The signal is there to begin with, or this test proves nothing.
    expect((await db.songs.get('song1'))?.lyrics.vocalActivity).toBeTruthy()

    await waitFor(() => expect(screen.getByText(/re-?attach/i)).toBeTruthy())
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    expect(input).toBeTruthy()
    fireEvent.change(input, {
      target: { files: [new File([new Uint8Array([1, 2, 3])], 'new.mp3', { type: 'audio/mpeg' })] },
    })

    await waitFor(async () => {
      const saved = await db.songs.get('song1')
      expect(saved?.audioStoredPath).toBe('songs/replaced.mp3')
      expect(saved?.lyrics.vocalActivity).toBeUndefined()
      // The lyrics themselves must survive — only the audio-derived signal goes.
      expect(saved?.lyrics.lines[0].original).toBe('hello')
    })
  })
})

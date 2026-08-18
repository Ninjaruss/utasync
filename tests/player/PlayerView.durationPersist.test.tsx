import { describe, it, expect, vi, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { render, waitFor, act } from '@testing-library/react'
import { db } from '../../src/core/db/schema'
import { usePlayerStore } from '../../src/player/PlayerStore'
import { PlayerView } from '../../src/player/PlayerView'

/**
 * Lyric matching leans heavily on track length, but Song never stored one:
 * UploadAudioFlow read it from file metadata, used it once, and dropped it, and a
 * YouTube song has none until its player reports one. This captures the first real
 * duration playback produces.
 */

vi.mock('../../src/core/opfs/audio', () => ({ getAudioFile: vi.fn(async () => new File([], 'x.mp3')) }))

// Reported duration is controlled per-test via this ref.
const engineDuration = { current: 230 }
vi.mock('../../src/player/AudioEngine', () => ({
  AudioEngine: class {
    get duration() { return engineDuration.current }
    position = 0
    async load() {} play() {} pause() {} seek() {} destroy() {} setRate() {} setVolume() {}
    onTimeUpdate() {} onEnd() {}
  },
}))

const song = (extra: Record<string, unknown>) => ({
  id: 's1', title: 'T', artist: 'A', audioStoredPath: 's1',
  lyrics: {
    lines: [{ startTime: 0, endTime: 1, original: 'hello', translation: '' }],
    sourceLanguage: 'en', translationLanguage: 'en', alignmentMode: 'manual',
  },
  syncState: 'synced', createdAt: new Date(),
  ...extra,
})

beforeEach(async () => {
  engineDuration.current = 230
  // The zustand store is module-level and survives between tests in a file.
  // Without this reset, a later case inherits an earlier one's duration — which
  // is exactly what made an earlier implementation look like it had a
  // production staleness race and led to a fix that broke the YouTube path.
  usePlayerStore.setState({ duration: 0, position: 0, currentSongId: null })
  await db.songs.clear()
})

describe('learning a track duration from playback', () => {
  it('stores the duration when the song has none', async () => {
    await db.songs.put(song({}) as never)

    render(<PlayerView songId="s1" onBack={vi.fn()} />)

    await waitFor(async () => {
      expect((await db.songs.get('s1'))?.durationSec).toBe(230)
    })
  })

  // A duration read from file metadata is exact; a polled/derived one is not. Once
  // a trustworthy value is stored it must not be clobbered by a worse one.
  it('does not overwrite a duration already stored', async () => {
    await db.songs.put(song({ durationSec: 228 }) as never)

    render(<PlayerView songId="s1" onBack={vi.fn()} />)

    await waitFor(async () => {
      expect((await db.songs.get('s1'))?.durationSec).toBe(228)
    })
  })

  /**
   * The case this feature exists for, and the one an earlier implementation
   * silently broke. A YouTube-only song never calls engine.load(), so
   * engine.duration stays 0 forever — the length arrives solely via the store,
   * pushed there by YouTubePlayer's polling. Reading the engine instead of the
   * store made this path never learn a duration at all, invisibly.
   */
  it('stores the duration for a YouTube song, which has no audio engine', async () => {
    engineDuration.current = 0 // no local audio: the engine never loads one
    await db.songs.put(
      song({ audioStoredPath: undefined, sourceUrl: 'https://youtu.be/abc123' }) as never,
    )

    render(<PlayerView songId="s1" onBack={vi.fn()} />)

    // Stand in for YouTubePlayer reporting a stable length to the store.
    await waitFor(() => expect(document.body.textContent).toContain('hello'))
    act(() => {
      usePlayerStore.setState({ currentSongId: 's1', duration: 214 })
    })

    await waitFor(async () => {
      expect((await db.songs.get('s1'))?.durationSec).toBe(214)
    })
  })

  it('ignores a duration reported while a different song is current', async () => {
    await db.songs.put(song({}) as never)

    render(<PlayerView songId="s1" onBack={vi.fn()} />)
    act(() => {
      usePlayerStore.setState({ currentSongId: 'some-other-song', duration: 999 })
    })

    await waitFor(() => expect(document.body.textContent).toContain('hello'))
    expect((await db.songs.get('s1'))?.durationSec).not.toBe(999)
  })

  it('ignores a zero duration', async () => {
    engineDuration.current = 0
    await db.songs.put(song({}) as never)

    render(<PlayerView songId="s1" onBack={vi.fn()} />)

    await waitFor(async () => {
      expect(await db.songs.get('s1')).toBeTruthy()
    })
    expect((await db.songs.get('s1'))?.durationSec).toBeUndefined()
  })
})

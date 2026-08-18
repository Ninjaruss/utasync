import { describe, it, expect, vi, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { render, waitFor } from '@testing-library/react'
import { db } from '../../src/core/db/schema'
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

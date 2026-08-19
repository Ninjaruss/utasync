import { describe, it, expect, vi, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { db } from '../../src/core/db/schema'
import { usePlayerStore } from '../../src/player/PlayerStore'
import { useLyricsStore } from '../../src/lyrics/LyricsStore'
import { PlayerView } from '../../src/player/PlayerView'

/**
 * PlayerView is REUSED across songs — App renders the same element and swaps the
 * songId prop, so the component never remounts and nothing derived from the old
 * song resets on its own. Both specs here are about state that outlived its song or
 * its mode, which is the failure mode that class of bug always takes.
 */

export const engineCalls: { seeks: number[] } = { seeks: [] }
vi.mock('../../src/player/AudioEngine', () => ({
  AudioEngine: class {
    duration = 120; position = 0
    async load() {} play() {} pause() {} seek(t: number) { engineCalls.seeks.push(t) }
    destroy() {} setRate() {} setVolume() {} onTimeUpdate() {} onEnd() {}
  },
}))
vi.mock('../../src/core/opfs/audio', () => ({ getAudioFile: vi.fn(async () => new File([], 'x.mp3')) }))

export const decodeCalls: string[] = []
vi.mock('../../src/core/audio/decodeToMono', () => ({
  decodeAudioFileToMono: vi.fn(async () => {
    decodeCalls.push('decode')
    const data = new Float32Array(2000)
    for (let i = 500; i < 600; i++) data[i] = 0.9
    return { data, sampleRate: 1000 }
  }),
}))

const song = (id: string, text: string) => ({
  id, title: id, artist: 'A', audioStoredPath: `songs/${id}.mp3`,
  lyrics: {
    lines: [
      { startTime: 0, endTime: 5, original: `${text} first`, translation: '' },
      { startTime: 30, endTime: 35, original: `${text} flagged`, translation: '' },
    ],
    sourceLanguage: 'ja', translationLanguage: 'en', alignmentMode: 'auto',
    lineAlignmentQuality: ['good', 'needs_review'],
  },
  syncState: 'synced', createdAt: new Date(),
})

beforeEach(async () => {
  engineCalls.seeks = []
  decodeCalls.length = 0
  usePlayerStore.setState({ duration: 0, position: 0, currentSongId: null, abLoop: { a: null, b: null } })
  await db.songs.clear()
  await db.songs.put(song('song-a', 'A') as never)
  await db.songs.put(song('song-b', 'B') as never)
})

const slider = () => screen.getByRole('slider', { name: /start time/i }) as HTMLInputElement

describe('re-timing state across a song change', () => {
  // The waveform describes ONE track. Carrying it to the next song would show the
  // user a confident picture of audio that is not playing — the same class of wrong
  // answer as a stale vocal-activity signal, which is already guarded.
  it('reads the new song audio instead of reusing the previous waveform', async () => {
    const { rerender } = render(<PlayerView songId="song-a" onBack={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('A flagged')).toBeTruthy())
    usePlayerStore.setState({ currentSongId: 'song-a', position: 31, duration: 120 })
    await act(async () => { useLyricsStore.setState({ activeLine: 1 }) })
    await waitFor(() => expect(slider()).toBeTruthy())
    await waitFor(() => expect(decodeCalls.length).toBe(1))

    rerender(<PlayerView songId="song-b" onBack={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('B flagged')).toBeTruthy())
    usePlayerStore.setState({ currentSongId: 'song-b', position: 31, duration: 120 })
    await act(async () => { useLyricsStore.setState({ activeLine: 1 }) })
    await waitFor(() => expect(slider()).toBeTruthy())

    await waitFor(() => expect(decodeCalls.length).toBe(2))
  })
})

describe('leaving Play mode mid-drag', () => {
  // The mode gate hides the strip, but hiding a control is not the same as stopping
  // what it started. A loop still wrapping the playhead in Edit mode would fight
  // every seek the user makes while editing, with nothing on screen to explain it.
  it('stops looping when the user switches to Edit', async () => {
    render(<PlayerView songId="song-a" onBack={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('A flagged')).toBeTruthy())
    usePlayerStore.setState({ currentSongId: 'song-a', position: 31, duration: 120 })
    await act(async () => { useLyricsStore.setState({ activeLine: 1 }) })
    await waitFor(() => expect(slider()).toBeTruthy())

    // Start a drag, which arms the loop.
    fireEvent.change(slider(), { target: { value: '30.5' } })
    expect(engineCalls.seeks.length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: /^edit$/i }))
    await waitFor(() =>
      expect(screen.queryByRole('slider', { name: /start time/i })).toBeNull(),
    )

    const before = engineCalls.seeks.length
    await act(async () => { usePlayerStore.setState({ position: 90 }) })
    expect(engineCalls.seeks.length).toBe(before)
  })
})

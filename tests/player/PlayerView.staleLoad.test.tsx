import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import 'fake-indexeddb/auto'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { db } from '../../src/core/db/schema'
import { PlayerView } from '../../src/player/PlayerView'
import { usePlayerStore } from '../../src/player/PlayerStore'
import { useLyricsStore } from '../../src/lyrics/LyricsStore'

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
  getDeviceTier: () => 'full', canUseVocalSeparation: () => true, canAutoAlign: () => true, hasWebGPU: () => true,
}))

/**
 * `staleRefine: true` seeds an auto-aligned song whose `alignmentPipelineVersion`
 * is behind the current one, which is what makes the load re-refine on open and
 * await a Dexie write. That await is the ONLY place a superseded load can resume
 * after its first cancellation check — without it the whole load runs
 * synchronously after `db.songs.get` and no late continuation is possible, so a
 * test built on a plain 'manual' song cannot exercise the regression at all.
 */
const seed = async (id: string, title: string, opts?: { staleRefine?: boolean }) => {
  const lines = [
    { startTime: 1, endTime: 3, original: `${title} line`, translation: '' },
    { startTime: 4, endTime: 6, original: `${title} tail`, translation: '' },
  ]
  const transcriptWords = [
    { word: `${title}`, startTime: 1.1, endTime: 1.8 },
    { word: 'line', startTime: 1.8, endTime: 2.9 },
    { word: `${title}`, startTime: 4.1, endTime: 4.8 },
    { word: 'tail', startTime: 4.8, endTime: 5.9 },
  ]
  await db.songs.put({
    id, title, artist: 'A',
    audioStoredPath: `songs/${id}.mp3`,
    sources: [{ provider: 'upload', ref: id, hasAudio: true }],
    lyrics: {
      // Two lines each, and titles that are not substrings of the line text, so
      // "what the lyrics store is showing" and "the song that finished loading"
      // can never be mistaken for one another by a stale store.
      lines,
      sourceLanguage: 'en', translationLanguage: 'en',
      alignmentMode: opts?.staleRefine ? 'auto' : 'manual',
      ...(opts?.staleRefine
        ? { transcriptWords, alignmentPipelineVersion: 1, alignmentConfidence: 0.9 }
        : {}),
    },
    syncState: 'synced', createdAt: new Date(),
  } as never)
}

/**
 * The lines the player renders come from a GLOBAL store (`useLyricsStore`), which
 * outlives any single mount. So `waitFor(() => getByText('Second line'))` could be
 * satisfied by the PREVIOUS test's lines while this test's own song was still
 * loading: the test then clicked Edit on a not-yet-loaded player, the load settled,
 * and the legitimate "a genuinely new song lands in Play mode" reset fired after the
 * click and ejected it. That is what made this file flake (measured ~1 run in 4),
 * and it also meant the assertions could pass for the wrong reason.
 *
 * Fixed at the root rather than by lengthening a sleep:
 *  - `beforeEach` clears the store, so no assertion can be satisfied by another
 *    test's lines;
 *  - every test waits for the song it ASKED for (the header renders `song.title`
 *    only once its load has settled) before interacting;
 *  - the stale-load regression is made deterministic by holding the superseded
 *    load open and releasing it at the exact point under test, instead of hoping
 *    an 80ms sleep lands on the right side of it.
 */
/**
 * Parks the re-refine's Dexie WRITE for `id`, which is the await a superseded load
 * resumes from. (`db.songs.get` is deliberately left alone: the load's first
 * cancellation check sits directly behind it, so holding the read only tests that
 * check, and every song passes that trivially.)
 */
function holdRefineWrite(id: string) {
  const real = db.songs.put.bind(db.songs)
  let release = () => {}
  let held = false
  const spy = vi.spyOn(db.songs, 'put').mockImplementation((song: { id?: string }) => {
    if (held || song?.id !== id) return real(song as never)
    held = true
    return new Promise((resolve) => {
      release = () => resolve(real(song as never))
    }) as never
  })
  return {
    /** True when the parked write was actually reached (the window really opened). */
    wasHeld: () => held,
    release: async () => {
      // Inside act: the released continuation sets state, and without this the
      // update lands outside React's knowledge (and outside the assertions' view).
      await act(async () => {
        release()
        await new Promise((r) => setTimeout(r, 0))
      })
    },
    restore: () => spy.mockRestore(),
  }
}

/** Waits until the song's OWN load has settled (the header renders song.title). */
const waitForSong = (title: string) =>
  waitFor(() => expect(screen.getByText(title, { selector: 'p' })).toBeTruthy())

const editButtons = () => screen.queryAllByRole('button', { name: /edit timestamp for line/i })

beforeEach(async () => {
  usePlayerStore.setState({ currentSongId: null, playbackState: 'idle', position: 0, duration: 0 })
  useLyricsStore.setState({ lines: [] })
  await db.songs.clear()
  await seed('song1', 'First', { staleRefine: true })
  await seed('song2', 'Second', { staleRefine: true })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('switching songs before the first load settles', () => {
  it('lands a genuinely new song in Play mode', async () => {
    const { rerender } = render(<PlayerView songId="song1" onBack={vi.fn()} />)
    await waitForSong('First')

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    await waitFor(() => expect(editButtons().length).toBeGreaterThan(0))

    rerender(<PlayerView songId="song2" onBack={vi.fn()} />)

    await waitForSong('Second')
    expect(editButtons()).toHaveLength(0)
  })

  // Regression: the load routine awaits a Dexie write and had no `cancelled`
  // re-check afterwards, so a superseded load could resume and overwrite the song
  // the user had already moved on to.
  it('shows the song that was asked for, not one a superseded load resolved to', async () => {
    const held = holdRefineWrite('song1')
    try {
      const { rerender } = render(<PlayerView songId="song1" onBack={vi.fn()} />)
      // Let song1 get PAST its first cancellation check and park on the re-refine
      // write. Only from there can a superseded load resume after the switch.
      await waitFor(() => expect(held.wasHeld()).toBe(true))
      // Now switch to song2 and let THAT load finish.
      rerender(<PlayerView songId="song2" onBack={vi.fn()} />)
      await waitForSong('Second')

      // Now let the superseded load resume, with the user already on song2.
      await held.release()

      // The durable harm: the resumed load claims the player for the song the
      // user left. (Asserting only the header would be masked — the current
      // song's own background enrichment writes it back a moment later — while
      // `currentSongId` is set by the load alone and stays wrong.)
      expect(usePlayerStore.getState().currentSongId).toBe('song2')
      expect(screen.getByText('Second', { selector: 'p' })).toBeTruthy()
    } finally {
      held.restore()
    }
  })

  it('does not let a superseded load drag the user out of Edit mode', async () => {
    const held = holdRefineWrite('song1')
    try {
      const { rerender } = render(<PlayerView songId="song1" onBack={vi.fn()} />)
      // Parked mid-load, past the first cancellation check.
      await waitFor(() => expect(held.wasHeld()).toBe(true))
      rerender(<PlayerView songId="song2" onBack={vi.fn()} />)
      await waitForSong('Second')

      fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
      await waitFor(() => expect(editButtons().length).toBeGreaterThan(0))

      // The late resolution of the song1 load happens HERE — after the user is
      // already in Edit — which is precisely the window the guard protects.
      await held.release()

      expect(editButtons().length).toBeGreaterThan(0)
      expect(usePlayerStore.getState().currentSongId).toBe('song2')
      expect(screen.getByText('Second', { selector: 'p' })).toBeTruthy()
    } finally {
      held.restore()
    }
  })
})

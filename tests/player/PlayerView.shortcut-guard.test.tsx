import { describe, it, expect, vi, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { db } from '../../src/core/db/schema'
import { PlayerView } from '../../src/player/PlayerView'
import { usePlayerStore } from '../../src/player/PlayerStore'

const play = vi.fn()
const pause = vi.fn()
const seek = vi.fn()

vi.mock('../../src/core/opfs/audio', () => ({
  getAudioFile: vi.fn(async () => new File([], 'song1.mp3')),
}))

vi.mock('../../src/player/AudioEngine', () => ({
  AudioEngine: class {
    duration = 10; position = 3
    play = play
    pause = pause
    seek = seek
    async load() {} destroy() {} setRate() {} setVolume() {}
    onTimeUpdate() {} onEnd() {}
  },
}))

beforeEach(async () => {
  play.mockClear()
  pause.mockClear()
  seek.mockClear()
  // The player store is a module singleton, so a test that leaves playback
  // "playing" would make the next one's Space press pause instead of play.
  usePlayerStore.setState({ currentSongId: null, playbackState: 'idle', position: 0, duration: 0 })
  await db.songs.clear()
  await db.songs.put({
    id: 'song1', title: 'T', artist: 'A',
    audioStoredPath: 'songs/song1.mp3',
    sources: [{ provider: 'upload', ref: 'song1', hasAudio: true }],
    lyrics: { lines: [{ startTime: 1, endTime: 3, original: 'hello', translation: '' }], sourceLanguage: 'en', translationLanguage: 'en', alignmentMode: 'manual' },
    syncState: 'synced', createdAt: new Date(),
  } as never)
})

// The shortcuts are registered on `window`, so without a guard they fire for
// every keystroke on the page — including ones aimed at a control the user
// deliberately focused. That is how Space stopped activating any button in the
// app, and how arrows inside an open sheet seeked the song underneath.
describe('PlayerView shortcuts yield to whatever owns the keystroke', () => {
  it('leaves Space alone when a button has focus', async () => {
    render(<PlayerView songId="song1" onBack={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('hello')).toBeTruthy())

    const editToggle = screen.getByRole('button', { name: 'Edit' })
    editToggle.focus()
    fireEvent.keyDown(editToggle, { code: 'Space', key: ' ' })

    expect(play).not.toHaveBeenCalled()
    expect(pause).not.toHaveBeenCalled()
  })

  it('leaves arrow keys alone inside an open dialog', async () => {
    render(<PlayerView songId="song1" onBack={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('hello')).toBeTruthy())

    const panel = document.createElement('div')
    panel.setAttribute('role', 'dialog')
    const inner = document.createElement('button')
    panel.appendChild(inner)
    document.body.appendChild(panel)
    try {
      fireEvent.keyDown(inner, { code: 'ArrowRight', key: 'ArrowRight' })
      expect(seek).not.toHaveBeenCalled()
    } finally {
      panel.remove()
    }
  })

  // Re-fired inside waitFor: the shortcut is a no-op until the local audio has
  // finished loading, and lyrics render before that resolves.
  it('still toggles playback when nothing on the page owns the keystroke', async () => {
    render(<PlayerView songId="song1" onBack={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('hello')).toBeTruthy())
    await waitFor(() => {
      fireEvent.keyDown(document.body, { code: 'Space', key: ' ' })
      expect(play).toHaveBeenCalled()
    })
  })

  it('still seeks with the arrow keys from the page', async () => {
    render(<PlayerView songId="song1" onBack={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('hello')).toBeTruthy())
    await waitFor(() => {
      fireEvent.keyDown(document.body, { code: 'ArrowRight', key: 'ArrowRight' })
      expect(seek).toHaveBeenCalled()
    })
  })
})

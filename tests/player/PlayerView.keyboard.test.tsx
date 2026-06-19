import { describe, it, expect, vi, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { db } from '../../src/core/db/schema'
import { PlayerView } from '../../src/player/PlayerView'

const play = vi.fn()
const pause = vi.fn()
const seek = vi.fn()

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
  await db.songs.clear()
  await db.songs.put({
    id: 'song1', title: 'T', artist: 'A',
    audioStoredPath: 'songs/song1.mp3',
    sources: [{ provider: 'upload', ref: 'song1', hasAudio: true }],
    lyrics: { lines: [{ startTime: 1, endTime: 3, original: 'hello', translation: '' }], sourceLanguage: 'en', translationLanguage: 'en', alignmentMode: 'manual' },
    syncState: 'synced', createdAt: new Date(), isTrialSong: false,
  } as never)
})

describe('PlayerView keyboard shortcuts', () => {
  it('toggles playback with spacebar after clicking lyrics', async () => {
    render(<PlayerView songId="song1" onBack={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('hello')).toBeTruthy())
    fireEvent.click(screen.getByText('hello'))
    fireEvent.keyDown(window, { code: 'Space', key: ' ' })
    expect(play).toHaveBeenCalled()
    expect(pause).not.toHaveBeenCalled()
  })

  it('does not toggle playback when space is pressed in a text field', async () => {
    render(<PlayerView songId="song1" onBack={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('hello')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.click(screen.getByRole('button', { name: /edit line 1/i }))
    const input = await screen.findByDisplayValue('hello')
    fireEvent.keyDown(input, { code: 'Space', key: ' ' })
    expect(play).not.toHaveBeenCalled()
    expect(pause).not.toHaveBeenCalled()
  })

  it('seeks backward and forward with arrow keys after clicking lyrics', async () => {
    render(<PlayerView songId="song1" onBack={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('hello')).toBeTruthy())
    fireEvent.click(screen.getByText('hello'))
    await waitFor(() => expect(seek).toHaveBeenCalledWith(1))

    seek.mockClear()
    fireEvent.keyDown(window, { code: 'ArrowRight', key: 'ArrowRight' })
    expect(seek).toHaveBeenCalledWith(6)

    seek.mockClear()
    fireEvent.keyDown(window, { code: 'ArrowLeft', key: 'ArrowLeft' })
    expect(seek).toHaveBeenCalledWith(1)
  })

  it('moves to the next and previous lyric with up and down arrows', async () => {
    await db.songs.put({
      id: 'song1', title: 'T', artist: 'A',
      audioStoredPath: 'songs/song1.mp3',
      sources: [{ provider: 'upload', ref: 'song1', hasAudio: true }],
      lyrics: {
        lines: [
          { startTime: 1, endTime: 3, original: 'one', translation: '' },
          { startTime: 5, endTime: 7, original: 'two', translation: '' },
          { startTime: 10, endTime: 12, original: 'three', translation: '' },
        ],
        sourceLanguage: 'en', translationLanguage: 'en', alignmentMode: 'manual',
      },
      syncState: 'synced', createdAt: new Date(), isTrialSong: false,
    } as never)

    render(<PlayerView songId="song1" onBack={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('one')).toBeTruthy())
    fireEvent.click(screen.getByText('one'))
    await waitFor(() => expect(seek).toHaveBeenCalledWith(1))

    seek.mockClear()
    fireEvent.keyDown(window, { code: 'ArrowDown', key: 'ArrowDown' })
    expect(seek).toHaveBeenCalledWith(5)

    seek.mockClear()
    fireEvent.keyDown(window, { code: 'ArrowUp', key: 'ArrowUp' })
    expect(seek).toHaveBeenCalledWith(1)
  })
})

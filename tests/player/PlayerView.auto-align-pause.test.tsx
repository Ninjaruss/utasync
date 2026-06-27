import { describe, it, expect, vi, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { db } from '../../src/core/db/schema'
import { PlayerView } from '../../src/player/PlayerView'
import { usePlayerStore } from '../../src/player/PlayerStore'

const play = vi.fn()
const pause = vi.fn()

// A stored upload song's audio must actually load for playback to be enabled.
vi.mock('../../src/core/opfs/audio', () => ({
  getAudioFile: vi.fn(async () => new File([], 'song1.mp3')),
}))

vi.mock('../../src/player/AudioEngine', () => ({
  AudioEngine: class {
    duration = 10
    position = 0
    play = play
    pause = pause
    async load() {}
    seek() {}
    destroy() {}
    setRate() {}
    setVolume() {}
    onTimeUpdate() {}
    onEnd() {}
  },
}))

vi.mock('../../src/ai-pipeline/capability', () => ({ getDeviceTier: () => 'full' }))

vi.mock('../../src/ai-pipeline/AutoAlignFlow', () => ({
  AutoAlignFlow: () => <div data-testid="auto-align-flow">Auto-Align</div>,
  default: () => <div data-testid="auto-align-flow">Auto-Align</div>,
}))

beforeEach(async () => {
  play.mockClear()
  pause.mockClear()
  usePlayerStore.setState({
    currentSongId: null,
    playbackState: 'idle',
    position: 0,
    duration: 0,
  })
  await db.songs.clear()
  await db.songs.put({
    id: 'song1',
    title: 'T',
    artist: 'A',
    audioStoredPath: 'songs/song1.mp3',
    sources: [{ provider: 'upload', ref: 'song1', hasAudio: true }],
    lyrics: {
      lines: [{ startTime: 0, endTime: 0, original: 'hello', translation: '' }],
      sourceLanguage: 'en',
      translationLanguage: 'en',
      alignmentMode: 'manual',
    },
    syncState: 'unsynced',
    createdAt: new Date(),
    isTrialSong: false,
  } as never)
})

describe('PlayerView auto-align playback', () => {
  it('pauses playback when auto-align starts', async () => {
    render(<PlayerView songId="song1" onBack={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('hello')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /start playback/i }))
    expect(play).toHaveBeenCalled()
    usePlayerStore.setState({ playbackState: 'playing' })

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    await waitFor(() => expect(screen.getByRole('button', { name: /auto-align/i })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /auto-align/i }))
    fireEvent.click(screen.getByText('Continue'))

    expect(pause).toHaveBeenCalled()
    expect(usePlayerStore.getState().playbackState).toBe('paused')
    await waitFor(() => expect(screen.getByTestId('auto-align-flow')).toBeTruthy())
  })

  it('calls pause when auto-align opens on load', async () => {
    render(<PlayerView songId="song1" onBack={vi.fn()} autoAlignOnOpen />)
    await waitFor(() => expect(screen.getByTestId('auto-align-flow')).toBeTruthy())
    expect(pause).toHaveBeenCalled()
  })
})

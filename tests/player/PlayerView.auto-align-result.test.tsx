import { describe, it, expect, vi, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { db } from '../../src/core/db/schema'
import { PlayerView } from '../../src/player/PlayerView'
import { usePlayerStore } from '../../src/player/PlayerStore'
import type { Song } from '../../src/core/types'

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
  getDeviceTier: () => 'full',
  canUseVocalSeparation: () => true,
  hasWebGPU: () => true,
}))

// Stands in for the real flow: it reports a finished alignment the way
// AutoAlignFlow does, then keeps rendering its own result screen.
vi.mock('../../src/ai-pipeline/AutoAlignFlow', () => {
  const Flow = ({ song, onComplete, onClose }: { song: Song; onComplete: (s: Song) => void; onClose: () => void }) => (
    <div data-testid="auto-align-flow">
      <button type="button" onClick={() => onComplete({ ...song, lyrics: { ...song.lyrics, alignmentMode: 'auto' } })}>
        finish-align
      </button>
      <button type="button" onClick={onClose}>flow-close</button>
    </div>
  )
  return { AutoAlignFlow: Flow, default: Flow }
})

beforeEach(async () => {
  usePlayerStore.setState({ currentSongId: null, playbackState: 'idle', position: 0, duration: 0 })
  await db.songs.clear()
  await db.songs.put({
    id: 'song1', title: 'T', artist: 'A',
    audioStoredPath: 'songs/song1.mp3',
    sources: [{ provider: 'upload', ref: 'song1', hasAudio: true }],
    lyrics: {
      // Untimed: a song with NO usable timings is the one that needs a full
      // transcription. A song that already has them takes the drag-offset path
      // instead (see PlayerView.offsetAlign.test.tsx).
      lines: [{ startTime: 0, endTime: 0, original: 'hello', translation: '' }],
      sourceLanguage: 'en', translationLanguage: 'en', alignmentMode: 'manual',
    },
    syncState: 'synced', createdAt: new Date(),
  } as never)
})

describe('auto-align result screen', () => {
  // Regression: applyAlignedSong called setAlignMode(null) in the same tick that
  // the flow set stage 'done', so the success screen — and the low-confidence
  // warning with its "re-run with vocal isolation" CTA — could never render.
  it('stays open after alignment finishes, so its result can be read', async () => {
    render(<PlayerView songId="song1" onBack={vi.fn()} autoAlignOnOpen />)
    await waitFor(() => expect(screen.getByTestId('auto-align-flow')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'finish-align' }))

    // The real flow persists the song itself before calling onComplete, so the
    // contract under test is purely that reporting completion does not tear the
    // flow down before its result screen can be read.
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.getByTestId('auto-align-flow')).toBeTruthy()
  })

  it('closes when the user dismisses it themselves', async () => {
    render(<PlayerView songId="song1" onBack={vi.fn()} autoAlignOnOpen />)
    await waitFor(() => expect(screen.getByTestId('auto-align-flow')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'finish-align' }))
    fireEvent.click(screen.getByRole('button', { name: 'flow-close' }))

    await waitFor(() => expect(screen.queryByTestId('auto-align-flow')).toBeNull())
  })

  it('applies the aligned lyrics to the player behind it', async () => {
    render(<PlayerView songId="song1" onBack={vi.fn()} autoAlignOnOpen />)
    await waitFor(() => expect(screen.getByTestId('auto-align-flow')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'finish-align' }))
    fireEvent.click(screen.getByRole('button', { name: 'flow-close' }))

    await waitFor(() => expect(screen.getByText('hello')).toBeTruthy())
  })
})

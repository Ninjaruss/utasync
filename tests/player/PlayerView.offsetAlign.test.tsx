import { describe, it, expect, vi, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { db } from '../../src/core/db/schema'
import { PlayerView } from '../../src/player/PlayerView'
import { usePlayerStore } from '../../src/player/PlayerStore'

vi.mock('../../src/core/opfs/audio', () => ({ getAudioFile: vi.fn(async () => new File([], 's.mp3')) }))
vi.mock('../../src/player/AudioEngine', () => ({
  AudioEngine: class {
    duration = 240; position = 0
    async load() {} play() {} pause() {} seek() {} destroy() {} setRate() {} setVolume() {}
    onTimeUpdate() {} onEnd() {}
  },
}))
vi.mock('../../src/ai-pipeline/capability', () => ({
  getDeviceTier: () => 'full', canUseVocalSeparation: () => true, hasWebGPU: () => true,
}))
// If this renders, the app decided to transcribe — which is the thing the
// offset path exists to avoid for an already-timed song.
vi.mock('../../src/ai-pipeline/AutoAlignFlow', () => {
  const Flow = () => <div data-testid="auto-align-flow" />
  return { AutoAlignFlow: Flow, default: Flow }
})
// Stand in for the drag strip: expose one button that commits a drop time.
vi.mock('../../src/player/DragRetimeStrip', () => ({
  DragRetimeStrip: ({ lineIndex, onCommit }: {
    lineIndex: number | null
    onCommit: (i: number, t: number, o: { clamped: boolean }) => void
  }) => lineIndex === null ? null : (
    <div data-testid="drag-strip">
      <button type="button" onClick={() => onCommit(lineIndex, 7.76, { clamped: false })}>drop-at-7.76</button>
      <button type="button" onClick={() => onCommit(lineIndex, 12.5, { clamped: true })}>drop-clamped</button>
    </div>
  ),
}))

const LINES = [
  { startTime: 6.5, endTime: 9.1, original: 'one', translation: '' },
  { startTime: 9.4, endTime: 12.0, original: 'two', translation: '' },
]

beforeEach(async () => {
  usePlayerStore.setState({ currentSongId: null, playbackState: 'idle', position: 0, duration: 0 })
  await db.songs.clear()
  await db.songs.put({
    id: 'song1', title: 'T', artist: 'A',
    audioStoredPath: 'songs/song1.mp3',
    sources: [{ provider: 'upload', ref: 'song1', hasAudio: true }],
    lyrics: {
      lines: LINES.map((l) => ({ ...l })),
      sourceLanguage: 'ja', translationLanguage: 'en', alignmentMode: 'manual',
    },
    syncState: 'synced', createdAt: new Date(),
  } as never)
})

describe('a song that arrives with synced lyrics', () => {
  it('offers the drag instead of transcribing', async () => {
    render(<PlayerView songId="song1" onBack={vi.fn()} autoAlignOnOpen />)
    await waitFor(() => expect(screen.getByTestId('offset-align')).toBeTruthy())
    expect(screen.queryByTestId('auto-align-flow')).toBeNull()
  })

  it('shifts every line by the amount the user dragged, and stops re-prompting', async () => {
    render(<PlayerView songId="song1" onBack={vi.fn()} autoAlignOnOpen />)
    await waitFor(() => expect(screen.getByTestId('offset-align')).toBeTruthy())

    // First line sits at 6.50s; the user drops it at 7.76s => +1.26s for every line.
    fireEvent.click(screen.getByRole('button', { name: 'drop-at-7.76' }))

    await waitFor(async () => {
      const song = await db.songs.get('song1')
      expect(song!.lyrics.lines[0].startTime).toBeCloseTo(7.76)
      expect(song!.lyrics.lines[1].startTime).toBeCloseTo(10.66)
      expect(song!.lyrics.lines[1].endTime).toBeCloseTo(13.26)
      // Marked, so re-opening the song does not ask again.
      expect(song!.lyrics.alignmentMode).toBe('auto')
    })
    await waitFor(() => expect(screen.queryByTestId('offset-align')).toBeNull())
  })

  it('does not commit a shift the control could not express', async () => {
    render(<PlayerView songId="song1" onBack={vi.fn()} autoAlignOnOpen />)
    await waitFor(() => expect(screen.getByTestId('offset-align')).toBeTruthy())

    // Thumb pinned to the window edge: the real difference is larger than a
    // constant shift can represent, so this is the "different master" case.
    fireEvent.click(screen.getByRole('button', { name: 'drop-clamped' }))

    await waitFor(() => expect(screen.getByTestId('auto-align-flow')).toBeTruthy(), { timeout: 3000 })
    const song = await db.songs.get('song1')
    expect(song!.lyrics.lines[0].startTime, 'must not persist a clamped guess').toBeCloseTo(6.5)
  })
})

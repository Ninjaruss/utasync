import { describe, it, expect, vi, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { db } from '../../src/core/db/schema'
import { PlayerView } from '../../src/player/PlayerView'
import { ALIGNMENT_PIPELINE_VERSION } from '../../src/lyrics/phraseAlignment'
import { usePlayerStore } from '../../src/player/PlayerStore'
import { ToastProvider } from '../../src/core/ui/Toast'

vi.mock('../../src/core/opfs/audio', () => ({ getAudioFile: vi.fn(async () => new File([], 's.mp3')) }))
vi.mock('../../src/player/AudioEngine', () => ({
  AudioEngine: class {
    duration = 240; position = 0
    async load() {} play() {} pause() {} seek() {} destroy() {} setRate() {} setVolume() {}
    onTimeUpdate() {} onEnd() {}
  },
}))
const autoAlignSupported = vi.hoisted(() => ({ current: true }))

vi.mock('../../src/ai-pipeline/capability', () => ({
  getDeviceTier: () => 'full', canUseVocalSeparation: () => true, hasWebGPU: () => true,
  // Needed by the LRCLIB banner's automatic re-align button (ledger L12). A hoisted flag
  // rather than a literal, so a spec can actually exercise the unavailable case instead of
  // asserting something that cannot fail.
  canAutoAlign: () => autoAlignSupported.current,
}))
// If this renders, the app decided to transcribe — which is the thing the
// offset path exists to avoid for an already-timed song.
vi.mock('../../src/ai-pipeline/AutoAlignFlow', () => {
  const Flow = () => <div data-testid="auto-align-flow" />
  return { AutoAlignFlow: Flow, default: Flow }
})
// Stand in for the drag strip: buttons that commit a chosen drop time (a normal
// one, one far outside the drag window, and one clamped at its edge).
vi.mock('../../src/player/DragRetimeStrip', () => ({
  DragRetimeStrip: ({ lineIndex, onCommit }: {
    lineIndex: number | null
    onCommit: (i: number, t: number, o: { clamped: boolean }) => void
  }) => lineIndex === null ? null : (
    <div data-testid="drag-strip">
      <button type="button" onClick={() => onCommit(lineIndex, 7.76, { clamped: false })}>drop-at-7.76</button>
      <button type="button" onClick={() => onCommit(lineIndex, 20, { clamped: false })}>drop-far</button>
      <button type="button" onClick={() => onCommit(lineIndex, 12.5, { clamped: true })}>drop-clamped</button>
    </div>
  ),
}))

const LINES = [
  { startTime: 6.5, endTime: 9.1, original: 'one', translation: '' },
  { startTime: 9.4, endTime: 12.0, original: 'two', translation: '' },
]

/**
 * A song whose STORED transcript groups several lines into one long chunk, which is what
 * `accurateRealignReason` reports as 'segment-blocks' and what makes the Play-mode
 * "Some line timings are approximate" banner appear. Two such chunks are needed
 * (MERGED_SEGMENT_SUGGEST_THRESHOLD = 2).
 */
async function putChunkedSong() {
  await db.songs.put({
    id: 'song1', title: 'T', artist: 'A',
    audioStoredPath: 'songs/song1.mp3',
    sources: [{ provider: 'upload', ref: 'song1', hasAudio: true }],
    lyrics: {
      lines: [
        { startTime: 0, endTime: 2, original: 'a', translation: '' },
        { startTime: 2, endTime: 4, original: 'b', translation: '' },
        { startTime: 10, endTime: 12, original: 'c', translation: '' },
        { startTime: 12, endTime: 14, original: 'd', translation: '' },
      ],
      sourceLanguage: 'ja', translationLanguage: 'en', alignmentMode: 'auto',
      // Pin the pipeline version so the version-gated re-refine on open does NOT run: it
      // would recompute lines and quality from the stored transcript and rewrite the exact
      // state this fixture exists to create. (That behaviour is correct in the app; it just
      // makes a hand-built fixture unreachable.)
      alignmentPipelineVersion: ALIGNMENT_PIPELINE_VERSION,
      transcriptWords: [
        { word: 'a b', startTime: 0, endTime: 3 },
        { word: 'c d', startTime: 10, endTime: 13 },
      ],
    },
    syncState: 'synced', createdAt: new Date(),
  } as never)
}

async function putSong(timingSource?: string) {
  await db.songs.put({
    id: 'song1', title: 'T', artist: 'A',
    audioStoredPath: 'songs/song1.mp3',
    sources: [{ provider: 'upload', ref: 'song1', hasAudio: true }],
    lyrics: {
      lines: LINES.map((l) => ({ ...l })),
      sourceLanguage: 'ja', translationLanguage: 'en', alignmentMode: 'manual',
      ...(timingSource ? { timingSource } : {}),
    },
    syncState: 'synced', createdAt: new Date(),
  } as never)
}

beforeEach(async () => {
  usePlayerStore.setState({ currentSongId: null, playbackState: 'idle', position: 0, duration: 0 })
  await db.songs.clear()
  autoAlignSupported.current = true
})

describe('a song that arrives with synced lyrics', () => {
  it('just plays — no screen demanding anything', async () => {
    await putSong('lrclib')
    render(<PlayerView songId="song1" onBack={vi.fn()} autoAlignOnOpen />)
    await waitFor(() => expect(screen.getByText('one')).toBeTruthy())
    expect(screen.queryByTestId('auto-align-flow'), 'must not transcribe').toBeNull()
    expect(screen.queryByTestId('offset-align'), 'must not force a drag').toBeNull()
  })

  it('offers a nudge when the timings came from an external catalogue', async () => {
    await putSong('lrclib')
    render(<PlayerView songId="song1" onBack={vi.fn()} autoAlignOnOpen />)
    expect(await screen.findByTestId('lineup-lyrics')).toBeTruthy()
  })

  it('leads with the AUTOMATIC re-align, not the manual drag', async () => {
    // Ledger L12: reconciling against the timings a song already carries beat aligning
    // from scratch on 8/8 song-mode pairs at every prior error size (mean p90 5.47s ->
    // 1.44s). The capability already existed and was already wired; what was missing was
    // a way IN. This banner used to offer only the manual offset drag, which is two taps
    // from the path it should lead to.
    await putSong('lrclib')
    render(<PlayerView songId="song1" onBack={vi.fn()} autoAlignOnOpen />)
    const auto = await screen.findByTestId('realign-from-timings')
    expect(auto).toBeTruthy()
    // The manual drag stays as the fallback for timings that are merely offset.
    expect(screen.getByTestId('lineup-lyrics')).toBeTruthy()
    // Nothing transcribes until the user asks: the automatic path is one tap, not zero.
    expect(screen.queryByTestId('auto-align-flow')).toBeNull()
  })

  it('the automatic re-align opens the alignment flow on one tap', async () => {
    await putSong('lrclib')
    render(<PlayerView songId="song1" onBack={vi.fn()} autoAlignOnOpen />)
    fireEvent.click(await screen.findByTestId('realign-from-timings'))
    await waitFor(() => expect(screen.getByTestId('auto-align-flow')).toBeTruthy())
  })

  it('does not offer the automatic re-align where AI alignment is unavailable', async () => {
    // The manual nudge needs no model, so it must survive on a device that cannot align.
    autoAlignSupported.current = false
    await putSong('lrclib')
    render(<PlayerView songId="song1" onBack={vi.fn()} autoAlignOnOpen />)
    expect(await screen.findByTestId('lineup-lyrics')).toBeTruthy()
    expect(screen.queryByTestId('realign-from-timings')).toBeNull()
  })

  it('stays quiet for a subtitle file the user supplied themselves', async () => {
    // Very likely already exact — nagging about it would be noise, and would
    // invite damaging timings that were right.
    await putSong('subtitle-file')
    render(<PlayerView songId="song1" onBack={vi.fn()} autoAlignOnOpen />)
    await waitFor(() => expect(screen.getByText('one')).toBeTruthy())
    expect(screen.queryByTestId('lineup-lyrics')).toBeNull()
  })

  it('opens the drag from the nudge, and shifts every line on commit', async () => {
    await putSong('lrclib')
    render(<PlayerView songId="song1" onBack={vi.fn()} autoAlignOnOpen />)
    fireEvent.click(await screen.findByTestId('lineup-lyrics'))
    await waitFor(() => expect(screen.getByTestId('offset-align')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'drop-at-7.76' }))

    await waitFor(async () => {
      const song = await db.songs.get('song1')
      expect(song!.lyrics.lines[0].startTime).toBeCloseTo(7.76)
      expect(song!.lyrics.lines[1].startTime).toBeCloseTo(10.66)
      expect(song!.lyrics.alignmentMode).toBe('auto')
    })
    await waitFor(() => expect(screen.queryByTestId('offset-align')).toBeNull())
  })

  // Clamped means the user ran out of slider, so the value must not be recorded
  // as truth. It also must not throw them into a transcription: the strip's step
  // buttons walk the line out to any distance, and a song whose intro is longer
  // than the timings expect is a normal constant shift, not a different master.
  it('refuses a clamped shift but keeps the user where they were', async () => {
    await putSong('lrclib')
    render(
      <ToastProvider>
        <PlayerView songId="song1" onBack={vi.fn()} autoAlignOnOpen />
      </ToastProvider>,
    )
    fireEvent.click(await screen.findByTestId('lineup-lyrics'))
    await waitFor(() => expect(screen.getByTestId('offset-align')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'drop-clamped' }))

    await waitFor(() => expect(screen.getByText(/use \+10s to move further/i)).toBeTruthy())
    const song = await db.songs.get('song1')
    expect(song!.lyrics.lines[0].startTime, 'must not persist a clamped guess').toBeCloseTo(6.5)
    // Still on the screen they were using — full alignment is still there as an
    // explicit choice ("Run full alignment instead"), not imposed on them.
    expect(screen.getByTestId('offset-align')).toBeTruthy()
    expect(screen.queryByTestId('auto-align-flow')).toBeNull()
  })

  // The reported case: a long instrumental intro pushes the first line past what
  // the ±6s window reaches. Once the line has been walked out to it, the whole
  // song shifts by that constant like any other offset.
  it('shifts every line by a long intro, once the line is walked out to it', async () => {
    await putSong('lrclib')
    render(<PlayerView songId="song1" onBack={vi.fn()} autoAlignOnOpen />)
    fireEvent.click(await screen.findByTestId('lineup-lyrics'))
    await waitFor(() => expect(screen.getByTestId('offset-align')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'drop-far' }))

    await waitFor(async () => {
      const song = await db.songs.get('song1')
      // 20s vs the 6.5s the timings claimed: +13.5s, far outside the drag window.
      expect(song!.lyrics.lines[0].startTime).toBeCloseTo(20)
      expect(song!.lyrics.lines[1].startTime).toBeCloseTo(22.9)
      expect(song!.lyrics.alignmentMode).toBe('auto')
    })
  })
})

describe('approximate-timings banner leads with the automatic fix (item 6)', () => {
  it('offers a one-tap re-align instead of only manual work', async () => {
    // The banner used to name only manual routes ("tap a line… or fine-tune in Edit") while
    // the app already knew the automatic path was better here: 'segment-blocks' means the
    // stored transcript grouped lines into shared chunks, which is precisely what a
    // re-transcription fixes, and that path also reconciles against the existing timings
    // (8/8 better than aligning from scratch; ledger L12) and picks its own timestamp mode.
    await putChunkedSong()
    render(<PlayerView songId="song1" onBack={vi.fn()} />)
    expect(await screen.findByTestId('realign-approximate')).toBeTruthy()
    // Nothing transcribes until asked: one tap, not zero.
    expect(screen.queryByTestId('auto-align-flow')).toBeNull()
  })

  it('the one tap opens the alignment flow', async () => {
    await putChunkedSong()
    render(<PlayerView songId="song1" onBack={vi.fn()} />)
    fireEvent.click(await screen.findByTestId('realign-approximate'))
    await waitFor(() => expect(screen.getByTestId('auto-align-flow')).toBeTruthy())
  })

  it('does not offer it where AI alignment is unavailable, but still says why the timings are off', async () => {
    autoAlignSupported.current = false
    await putChunkedSong()
    render(<PlayerView songId="song1" onBack={vi.fn()} />)
    await waitFor(() => expect(screen.getByText(/Some line timings are approximate/)).toBeTruthy())
    expect(screen.queryByTestId('realign-approximate')).toBeNull()
  })
})


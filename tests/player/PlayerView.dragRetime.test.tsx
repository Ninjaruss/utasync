import { describe, it, expect, vi, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { db } from '../../src/core/db/schema'
import { usePlayerStore } from '../../src/player/PlayerStore'
import { useLyricsStore } from '../../src/lyrics/LyricsStore'
import { PlayerView } from '../../src/player/PlayerView'

/**
 * Correction used to commit the playhead at the instant of a click, carrying the
 * user's reaction latency (~250-400ms, always late) into stored timing — which
 * was then marked 'good' and never revisited. These specs pin that the committed
 * time comes from the drag POSITION, and that the swap reuses the existing anchor
 * commit path rather than duplicating it.
 */

vi.mock('../../src/core/opfs/audio', () => ({ getAudioFile: vi.fn(async () => new File([], 'x.mp3')) }))
vi.mock('../../src/player/AudioEngine', () => ({
  AudioEngine: class {
    duration = 120
    position = 0
    async load() {}
    play() {}
    pause() {}
    seek() {}
    destroy() {}
    setRate() {}
    setVolume() {}
    onTimeUpdate() {}
    onEnd() {}
  },
}))

const song = () => ({
  id: 'drag-1',
  title: 'T',
  artist: 'A',
  audioStoredPath: 'drag-1',
  lyrics: {
    lines: [
      { startTime: 0, endTime: 5, original: 'first line', translation: '' },
      { startTime: 30, endTime: 35, original: 'flagged line', translation: '' },
      { startTime: 60, endTime: 65, original: 'third line', translation: '' },
    ],
    sourceLanguage: 'ja',
    translationLanguage: 'en',
    alignmentMode: 'auto',
    // Marks line 1 as one selectAnchorTargets will return.
    lineAlignmentQuality: ['good', 'needs_review', 'good'],
  },
  syncState: 'synced',
  createdAt: new Date(),
})

beforeEach(async () => {
  usePlayerStore.setState({ duration: 0, position: 0, currentSongId: null })
  await db.songs.clear()
  await db.songs.put(song() as never)
})

/** Put the playhead on the flagged line so it becomes the active anchor target. */
async function openOnFlaggedLine() {
  render(<PlayerView songId="drag-1" onBack={vi.fn()} />)
  await waitFor(() => expect(screen.getByText('flagged line')).toBeTruthy())
  usePlayerStore.setState({ currentSongId: 'drag-1', position: 31, duration: 120 })
  // activeLine lives in the lyrics store, not the player store — the anchor
  // target is chosen from it, so setting the playhead alone is not enough.
  await act(async () => {
    useLyricsStore.setState({ activeLine: 1 })
  })
}

const slider = () => screen.getByRole('slider', { name: /start time/i }) as HTMLInputElement

describe('re-timing a flagged line by dragging', () => {
  it('offers the drag strip for the flagged line', async () => {
    await openOnFlaggedLine()
    await waitFor(() => expect(slider()).toBeTruthy())
  })

  it('commits the dragged time and routes through the anchor path', async () => {
    await openOnFlaggedLine()
    await waitFor(() => expect(slider()).toBeTruthy())

    fireEvent.change(slider(), { target: { value: '29.4' } })
    fireEvent.click(screen.getByRole('button', { name: /use this/i }))

    await waitFor(async () => {
      const saved = await db.songs.get('drag-1')
      expect(saved?.lyrics.lines[1].startTime).toBeCloseTo(29.4, 2)
      // Proves reuse of handleTapAnchor rather than a duplicate commit path.
      expect(saved?.lyrics.timingAnchors).toEqual(
        expect.arrayContaining([expect.objectContaining({ lineIndex: 1, source: 'user' })]),
      )
      expect(saved?.lyrics.lineAlignmentQuality?.[1]).toBe('good')
    })
  })

  // The whole point: what lands is where the thumb was, not when the click was.
  it('does not commit the playhead position', async () => {
    await openOnFlaggedLine()
    await waitFor(() => expect(slider()).toBeTruthy())

    fireEvent.change(slider(), { target: { value: '28.6' } })
    fireEvent.click(screen.getByRole('button', { name: /use this/i }))

    await waitFor(async () => {
      const saved = await db.songs.get('drag-1')
      expect(saved?.lyrics.lines[1].startTime).toBeCloseTo(28.6, 2)
      // 31 was the playhead — the old mechanic would have stored that.
      expect(saved?.lyrics.lines[1].startTime).not.toBeCloseTo(31, 1)
    })
  })
})

/**
 * A line further out than the window can reach lets the user drag only as far as
 * the edge. Committing that used to clear 'needs_review' anyway, so a knowingly
 * wrong time was recorded as truth and the line was never offered again — the
 * exact failure this whole mechanic exists to remove, reintroduced by a window
 * that cannot reach. Measured over the LRC-truth corpus, this hits 27% of the
 * lines the strip is offered for (scripts/audit-drag-window.mjs).
 */
describe('committing at the edge of the window', () => {
  it('keeps the line flagged instead of recording a clamped time as truth', async () => {
    await openOnFlaggedLine()
    await waitFor(() => expect(slider()).toBeTruthy())
    const max = slider().max

    fireEvent.change(slider(), { target: { value: max } })
    fireEvent.click(screen.getByRole('button', { name: /use this/i }))

    await waitFor(async () => {
      const saved = await db.songs.get('drag-1')
      // The move still happens — the line IS closer than it was.
      expect(saved?.lyrics.lines[1].startTime).toBeCloseTo(Number(max), 2)
      // ...but it is not truth, and must not be labelled as such.
      expect(saved?.lyrics.lineAlignmentQuality?.[1]).toBe('needs_review')
    })
  })

  it('offers the line again so the user can walk it the rest of the way', async () => {
    await openOnFlaggedLine()
    await waitFor(() => expect(slider()).toBeTruthy())
    const firstMax = Number(slider().max)

    fireEvent.change(slider(), { target: { value: String(firstMax) } })
    fireEvent.click(screen.getByRole('button', { name: /use this/i }))
    await waitFor(async () => {
      expect((await db.songs.get('drag-1'))?.lyrics.lines[1].startTime).toBeCloseTo(firstMax, 2)
    })

    // The line has moved away from the playhead, so the strip closes. Reach it
    // again the way playback would.
    await act(async () => {
      usePlayerStore.setState({ position: firstMax + 1 })
      useLyricsStore.setState({ activeLine: 1 })
    })

    // Re-centred on the new start, so the second pass reaches strictly further
    // than the first could — that is what makes walking a distant line converge
    // instead of stalling at the same edge forever.
    await waitFor(() => expect(Number(slider().max)).toBeGreaterThan(firstMax))
  })
})

/**
 * `retimingLine` latches the target so a preview seek cannot unmount the control
 * mid-drag. It was only ever cleared on commit, so a user who started adjusting
 * and then changed their mind stayed pinned to that line for the rest of the Play
 * session — the strip followed them around the song offering to re-time audio
 * they were nowhere near.
 */
describe('abandoning a drag', () => {
  it('lets go of the line when the user navigates somewhere else', async () => {
    await openOnFlaggedLine()
    await waitFor(() => expect(slider()).toBeTruthy())

    // Start adjusting — this is what latches the target.
    fireEvent.change(slider(), { target: { value: '29.4' } })
    expect(slider()).toBeTruthy()

    // Then change your mind and go back to the top of the song. Note this has to
    // be somewhere selectActiveAnchorTarget would not itself offer the line:
    // it latches for ANCHOR_LATCH_LINES rows AFTER a flagged one, so moving one
    // line forward would keep the strip up for a legitimate, unrelated reason.
    fireEvent.click(screen.getByText('first line'))
    await act(async () => {
      useLyricsStore.setState({ activeLine: 0 })
      usePlayerStore.setState({ position: 1 })
    })

    await waitFor(() =>
      expect(screen.queryByRole('slider', { name: /start time/i })).toBeNull(),
    )
  })

  it('still survives the seek its own preview causes', async () => {
    await openOnFlaggedLine()
    await waitFor(() => expect(slider()).toBeTruthy())

    // Overshoot and correct — every step seeks, and the control must survive it.
    for (const v of ['29.8', '29.2', '28.9', '29.1']) {
      fireEvent.change(slider(), { target: { value: v } })
      expect(screen.queryByRole('slider', { name: /start time/i })).toBeTruthy()
    }
    expect(slider().value).toBe('29.1')
  })
})

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
    ],
    sourceLanguage: 'ja',
    translationLanguage: 'en',
    alignmentMode: 'auto',
    // Marks line 1 as one selectAnchorTargets will return.
    lineAlignmentQuality: ['good', 'needs_review'],
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

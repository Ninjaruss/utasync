import { describe, it, expect, vi, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { db } from '../../src/core/db/schema'
import { usePlayerStore } from '../../src/player/PlayerStore'
import { useLyricsStore } from '../../src/lyrics/LyricsStore'
import { PlayerView } from '../../src/player/PlayerView'
import { ToastProvider } from '../../src/core/ui/Toast'

/**
 * Correction used to commit the playhead at the instant of a click, carrying the
 * user's reaction latency (~250-400ms, always late) into stored timing — which
 * was then marked 'good' and never revisited. These specs pin that the committed
 * time comes from the drag POSITION, and that the swap reuses the existing anchor
 * commit path rather than duplicating it.
 */

vi.mock('../../src/core/opfs/audio', () => ({ getAudioFile: vi.fn(async () => new File([], 'x.mp3')) }))
export const engineCalls: { seeks: number[]; plays: number; pauses: number } = { seeks: [], plays: 0, pauses: 0 }
vi.mock('../../src/player/AudioEngine', () => ({
  AudioEngine: class {
    duration = 120
    position = 0
    async load() {}
    play() { engineCalls.plays++ }
    pause() { engineCalls.pauses++ }
    seek(t: number) { engineCalls.seeks.push(t) }
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
  engineCalls.seeks = []; engineCalls.plays = 0; engineCalls.pauses = 0
  usePlayerStore.setState({ duration: 0, position: 0, currentSongId: null, abLoop: { a: null, b: null } })
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

/**
 * Snapping is the endgame of a drag, not a replacement for it. The window sizing
 * gets the thumb to roughly the right second; the strip is 194 CSS px wide and
 * spans 8.5s, so 44ms rides on every pixel and even a steady hand leaves tens of
 * milliseconds. Snapping removes that residual — but only where there is a real
 * onset to remove it to.
 */
describe('snapping a committed time to a vocal onset', () => {
  const hopSec = 0.02
  /** Strong onset at onsetSec, nothing anywhere else. */
  const signalWithOnset = (onsetSec: number, durSec = 120) => {
    const frames = Math.ceil(durSec / hopSec)
    const activity = new Float32Array(frames)
    const onset = new Float32Array(frames)
    const oi = Math.floor(onsetSec / hopSec)
    for (let f = oi; f < frames; f++) activity[f] = 1
    onset[oi] = 1
    return { hopSec, activity, onset, source: 'stem' as const }
  }

  const seedWithSignal = async (sig: unknown) => {
    const s = song() as Record<string, never>
    ;(s.lyrics as unknown as Record<string, unknown>).vocalActivity = sig
    await db.songs.put(s as never)
  }

  it('pulls a slightly-late commit back onto the real onset', async () => {
    await seedWithSignal(signalWithOnset(29))
    await openOnFlaggedLine()
    await waitFor(() => expect(slider()).toBeTruthy())

    // The user gets close — one or two slider pixels late.
    fireEvent.change(slider(), { target: { value: '29.15' } })
    fireEvent.click(screen.getByRole('button', { name: /use this/i }))

    await waitFor(async () => {
      const saved = await db.songs.get('drag-1')
      expect(saved?.lyrics.lines[1].startTime).toBeCloseTo(29, 2)
    })
  })

  // The regression guard for YouTube songs, which have no PCM and so no signal.
  // Their corrections must land exactly where the user put them.
  it('commits exactly what the user chose when there is no signal', async () => {
    await openOnFlaggedLine()
    await waitFor(() => expect(slider()).toBeTruthy())

    fireEvent.change(slider(), { target: { value: '29.15' } })
    fireEvent.click(screen.getByRole('button', { name: /use this/i }))

    await waitFor(async () => {
      const saved = await db.songs.get('drag-1')
      expect(saved?.lyrics.lines[1].startTime).toBeCloseTo(29.15, 3)
    })
  })

  // A signal with nothing nearby must not drag the choice to the closest bump it
  // can find. The user's judgement wins when the audio has nothing to say.
  it('leaves the choice alone when no onset is near it', async () => {
    await seedWithSignal(signalWithOnset(5))
    await openOnFlaggedLine()
    await waitFor(() => expect(slider()).toBeTruthy())

    fireEvent.change(slider(), { target: { value: '29.15' } })
    fireEvent.click(screen.getByRole('button', { name: /use this/i }))

    await waitFor(async () => {
      const saved = await db.songs.get('drag-1')
      expect(saved?.lyrics.lines[1].startTime).toBeCloseTo(29.15, 3)
    })
  })

  // Silently moving the user's explicit choice is worse than not moving it. Needs
  // a real ToastProvider — the bare context default is a no-op, so rendering
  // PlayerView alone would assert nothing.
  it('says so when it moved the time', async () => {
    await seedWithSignal(signalWithOnset(29))
    render(
      <ToastProvider>
        <PlayerView songId="drag-1" onBack={vi.fn()} />
      </ToastProvider>,
    )
    await waitFor(() => expect(screen.getByText('flagged line')).toBeTruthy())
    usePlayerStore.setState({ currentSongId: 'drag-1', position: 31, duration: 120 })
    await act(async () => {
      useLyricsStore.setState({ activeLine: 1 })
    })
    await waitFor(() => expect(slider()).toBeTruthy())

    fireEvent.change(slider(), { target: { value: '29.15' } })
    fireEvent.click(screen.getByRole('button', { name: /use this/i }))

    await waitFor(() => expect(screen.getByText(/snapped to vocal onset/i)).toBeTruthy())
  })

  // A clamped commit is the user running out of slider, not a considered choice.
  // Snapping it would dress a known-wrong time up as a precise one.
  it('does not snap a commit that was clamped by the window edge', async () => {
    await seedWithSignal(signalWithOnset(36.2))
    await openOnFlaggedLine()
    await waitFor(() => expect(slider()).toBeTruthy())
    const max = Number(slider().max)

    fireEvent.change(slider(), { target: { value: String(max) } })
    fireEvent.click(screen.getByRole('button', { name: /use this/i }))

    await waitFor(async () => {
      const saved = await db.songs.get('drag-1')
      expect(saved?.lyrics.lines[1].startTime).toBeCloseTo(max, 3)
      expect(saved?.lyrics.lineAlignmentQuality?.[1]).toBe('needs_review')
    })
  })
})

/**
 * Plain seek-on-drag was measured insufficient: dragging a paused song made no
 * sound at all, and while playing the playhead ran ~2.5s past the candidate within
 * 1.5s, so the onset under test was gone before it could be judged. The loop
 * restarts on every step, which is the feel that was chosen after listening.
 */
describe('the loop that plays while re-timing', () => {
  it('starts playback, because dragging a paused song was silent', async () => {
    await openOnFlaggedLine()
    await waitFor(() => expect(slider()).toBeTruthy())
    expect(engineCalls.plays).toBe(0)

    fireEvent.change(slider(), { target: { value: '29.4' } })

    expect(engineCalls.plays).toBeGreaterThan(0)
  })

  it('seeks to a lead-in before the candidate, not onto it', async () => {
    await openOnFlaggedLine()
    await waitFor(() => expect(slider()).toBeTruthy())

    fireEvent.change(slider(), { target: { value: '29.4' } })

    const last = engineCalls.seeks[engineCalls.seeks.length - 1]
    // You judge an entry by hearing the silence break, so the loop must open early.
    expect(last).toBeLessThan(29.4)
    expect(last).toBeGreaterThan(28.5)
  })

  it('restarts on every step, which is the chosen feel', async () => {
    await openOnFlaggedLine()
    await waitFor(() => expect(slider()).toBeTruthy())

    for (const v of ['29.4', '29.2', '29.0']) {
      fireEvent.change(slider(), { target: { value: v } })
    }
    // Three moves, three fresh lead-ins, each earlier than the last.
    const tail = engineCalls.seeks.slice(-3)
    expect(tail).toHaveLength(3)
    expect(tail[0]).toBeGreaterThan(tail[1])
    expect(tail[1]).toBeGreaterThan(tail[2])
  })

  // Regression guard: the wrap seeks, and a seek releases the re-timing latch unless
  // it declares itself. Without that flag the loop tore itself down on its FIRST
  // cycle — it looped exactly once and then let go, which a single-wrap test misses.
  it('keeps looping across repeated cycles', async () => {
    await openOnFlaggedLine()
    await waitFor(() => expect(slider()).toBeTruthy())
    fireEvent.change(slider(), { target: { value: '30.5' } })
    const lead = engineCalls.seeks[engineCalls.seeks.length - 1]

    // Count wraps, do not just re-read the last seek: a torn-down loop leaves the
    // previous wrap sitting at the end of the array, so an equality check on it
    // passes while nothing is looping any more.
    const wrapsBefore = engineCalls.seeks.length
    for (let cycle = 0; cycle < 3; cycle++) {
      await act(async () => { usePlayerStore.setState({ position: 40 }) })
      await act(async () => { usePlayerStore.setState({ position: lead }) })
    }
    const wraps = engineCalls.seeks.slice(wrapsBefore)
    expect(wraps).toHaveLength(3)
    for (const w of wraps) expect(w).toBeCloseTo(lead, 5)
    // And the control is still there to keep adjusting with.
    expect(slider()).toBeTruthy()
  })

  it('sends the playhead back when it runs out of the window', async () => {
    await openOnFlaggedLine()
    await waitFor(() => expect(slider()).toBeTruthy())
    fireEvent.change(slider(), { target: { value: '30.5' } })
    const lead = engineCalls.seeks[engineCalls.seeks.length - 1]
    expect(lead).toBeGreaterThan(0)

    // Playback runs past the end of the loop.
    await act(async () => { usePlayerStore.setState({ position: 40 }) })

    expect(engineCalls.seeks[engineCalls.seeks.length - 1]).toBeCloseTo(lead, 5)
  })

  it('stops looping once the time is committed', async () => {
    await openOnFlaggedLine()
    await waitFor(() => expect(slider()).toBeTruthy())
    fireEvent.change(slider(), { target: { value: '30.5' } })
    fireEvent.click(screen.getByRole('button', { name: /use this/i }))
    await waitFor(async () => {
      expect((await db.songs.get('drag-1'))?.lyrics.timingAnchors?.length).toBe(1)
    })

    const before = engineCalls.seeks.length
    await act(async () => { usePlayerStore.setState({ position: 90 }) })
    // No wrap: the loop is gone, so the playhead is free.
    expect(engineCalls.seeks.length).toBe(before)
  })

  it('puts playback back where it found it', async () => {
    await openOnFlaggedLine()
    await waitFor(() => expect(slider()).toBeTruthy())
    // Song was paused when the drag began.
    fireEvent.change(slider(), { target: { value: '30.5' } })
    expect(engineCalls.plays).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: /use this/i }))

    await waitFor(() => expect(engineCalls.pauses).toBeGreaterThan(0))
  })

  // Placing A/B points is real work and has to survive a line correction.
  it('does not disturb the user A-B loop', async () => {
    await openOnFlaggedLine()
    await act(async () => { usePlayerStore.setState({ abLoop: { a: 10, b: 20 } }) })
    await waitFor(() => expect(slider()).toBeTruthy())

    fireEvent.change(slider(), { target: { value: '30.5' } })
    await act(async () => { usePlayerStore.setState({ position: 40 }) })
    fireEvent.click(screen.getByRole('button', { name: /use this/i }))

    expect(usePlayerStore.getState().abLoop).toEqual({ a: 10, b: 20 })
  })

  it('lets go of the loop when the user navigates away mid-drag', async () => {
    await openOnFlaggedLine()
    await waitFor(() => expect(slider()).toBeTruthy())
    fireEvent.change(slider(), { target: { value: '30.5' } })

    fireEvent.click(screen.getByText('first line'))
    await act(async () => {
      useLyricsStore.setState({ activeLine: 0 })
      usePlayerStore.setState({ position: 1 })
    })

    const before = engineCalls.seeks.length
    await act(async () => { usePlayerStore.setState({ position: 95 }) })
    expect(engineCalls.seeks.length).toBe(before)
  })
})

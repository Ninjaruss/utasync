import { describe, it, expect, vi, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { db } from '../../src/core/db/schema'
import { PlayerView } from '../../src/player/PlayerView'
import { usePlayerStore } from '../../src/player/PlayerStore'
import { linePlaybackStart } from '../../src/lyrics/lineTiming'
import type { TimedLine } from '../../src/core/types'

const helloLine: TimedLine = { startTime: 1, endTime: 3, original: 'hello', translation: 'hi' }
const helloPlayback = linePlaybackStart(helloLine)

const seek = vi.fn()

// Local audio must actually load for the engine playback path (seek) to be used;
// a YouTube-only song routes seek to the YouTube player instead.
vi.mock('../../src/core/opfs/audio', () => ({
  getAudioFile: vi.fn(async () => new File([], 'song1.mp3')),
}))

vi.mock('../../src/player/AudioEngine', () => ({
  AudioEngine: class {
    duration = 10; position = 3
    seek = seek
    async load() {} play() {} pause() {} destroy() {} setRate() {} setVolume() {}
    onTimeUpdate() {} onEnd() {}
  },
}))
vi.mock('../../src/payment/trial', () => ({ canUsePro: () => true }))

beforeEach(async () => {
  seek.mockClear()
  await db.songs.clear()
  await db.songs.put({
    id: 'song1', title: 'T', artist: 'A',
    audioStoredPath: 'songs/song1.mp3',
    sources: [{ provider: 'upload', ref: 'song1', hasAudio: true }],
    lyrics: { lines: [{ startTime: 1, endTime: 3, original: 'hello', translation: 'hi' }], sourceLanguage: 'en', translationLanguage: 'en', alignmentMode: 'manual' },
    syncState: 'synced', createdAt: new Date(), isTrialSong: false,
  } as never)
  usePlayerStore.setState({ armingAB: null, abLoop: { a: null, b: null, preRoll: 2, loopCount: 3, crossfadeDuration: 0.3 } })
})

function expandLabeledSection(label: string) {
  const section = screen.getByLabelText(label)
  const toggle = section.querySelector('button[aria-expanded]')
  if (toggle?.getAttribute('aria-expanded') === 'false') fireEvent.click(toggle)
}

describe('PlayerView A/B loop', () => {
  it('shows A-B loop controls in play mode', async () => {
    render(<PlayerView songId="song1" onBack={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('hello')).toBeTruthy())
    expandLabeledSection('A-B Loop')
    expect(screen.getByLabelText('A-B Loop')).toBeTruthy()
    expect(screen.getByRole('button', { name: /a loop point/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /b loop point/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /start playback/i })).toBeTruthy()
  })

  it('hides A-B loop controls in edit mode', async () => {
    render(<PlayerView songId="song1" onBack={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('hello')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.queryByLabelText('A-B Loop')).toBeNull()
    expect(screen.queryByRole('button', { name: /a loop point/i })).toBeNull()
  })

  it('tapping A arms it instead of setting the current position', async () => {
    render(<PlayerView songId="song1" onBack={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('hello')).toBeTruthy())
    expandLabeledSection('A-B Loop')
    fireEvent.click(screen.getByRole('button', { name: /a loop point/i }))
    expect(usePlayerStore.getState().armingAB).toBe('a')
    expect(usePlayerStore.getState().abLoop.a).toBeNull()
  })

  it('tapping the armed button again cancels arming', async () => {
    render(<PlayerView songId="song1" onBack={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('hello')).toBeTruthy())
    expandLabeledSection('A-B Loop')
    fireEvent.click(screen.getByRole('button', { name: /a loop point/i }))
    expect(usePlayerStore.getState().armingAB).toBe('a')
    fireEvent.click(screen.getByRole('button', { name: /a loop point/i }))
    expect(usePlayerStore.getState().armingAB).toBeNull()
  })

  it('tapping a lyric line while armed sets that endpoint and seeks to it', async () => {
    render(<PlayerView songId="song1" onBack={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('hello')).toBeTruthy())
    expandLabeledSection('A-B Loop')
    fireEvent.click(screen.getByRole('button', { name: /a loop point/i }))
    fireEvent.click(screen.getByText('hello'))
    expect(usePlayerStore.getState().abLoop.a).toBe(helloPlayback)
    expect(usePlayerStore.getState().armingAB).toBeNull()
    expect(seek).toHaveBeenCalledWith(helloPlayback)
  })

  it('loops a single lyric line when B is set on the same line as A', async () => {
    render(<PlayerView songId="song1" onBack={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('hello')).toBeTruthy())
    expandLabeledSection('A-B Loop')
    fireEvent.click(screen.getByRole('button', { name: /a loop point/i }))
    fireEvent.click(screen.getByText('hello'))
    fireEvent.click(screen.getByRole('button', { name: /b loop point/i }))
    fireEvent.click(screen.getByText('hello'))
    const { abLoop } = usePlayerStore.getState()
    expect(abLoop.a).toBe(helloPlayback)
    expect(abLoop.b).toBe(3)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('loops a single lyric line when B is set before A', async () => {
    render(<PlayerView songId="song1" onBack={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('hello')).toBeTruthy())
    expandLabeledSection('A-B Loop')
    fireEvent.click(screen.getByRole('button', { name: /b loop point/i }))
    fireEvent.click(screen.getByText('hello'))
    fireEvent.click(screen.getByRole('button', { name: /a loop point/i }))
    fireEvent.click(screen.getByText('hello'))
    const { abLoop } = usePlayerStore.getState()
    expect(abLoop.a).toBe(helloPlayback)
    expect(abLoop.b).toBe(3)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('clicking outside the lyric list cancels arming', async () => {
    render(<PlayerView songId="song1" onBack={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('hello')).toBeTruthy())
    expandLabeledSection('A-B Loop')
    fireEvent.click(screen.getByRole('button', { name: /a loop point/i }))
    expect(usePlayerStore.getState().armingAB).toBe('a')
    fireEvent.click(screen.getByText('Settings'))
    expect(usePlayerStore.getState().armingAB).toBeNull()
  })

  it('warns when B is not after A', async () => {
    usePlayerStore.setState({
      abLoop: { a: 8, b: 3, preRoll: 2, loopCount: 3, crossfadeDuration: 0.3 },
    })
    render(<PlayerView songId="song1" onBack={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('hello')).toBeTruthy())
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Point B must be after point A'))
  })

  it('shows a looping indicator when A-B pair is valid', async () => {
    usePlayerStore.setState({
      abLoop: { a: 1, b: 3, preRoll: 2, loopCount: 3, crossfadeDuration: 0.3 },
    })
    render(<PlayerView songId="song1" onBack={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('hello')).toBeTruthy())
    expect(screen.getAllByText('Looping').length).toBeGreaterThanOrEqual(1)
  })
})

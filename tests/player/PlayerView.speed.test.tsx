import { describe, it, expect, vi, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { db } from '../../src/core/db/schema'
import { PlayerView } from '../../src/player/PlayerView'
import { usePlayerStore } from '../../src/player/PlayerStore'

vi.mock('../../src/player/AudioEngine', () => ({
  AudioEngine: class {
    duration = 10; position = 3
    async load() {} play() {} pause() {} seek() {} destroy() {} setRate() {} setVolume() {}
    onTimeUpdate() {} onEnd() {}
  },
}))
vi.mock('../../src/payment/trial', () => ({ canUsePro: () => true }))

beforeEach(async () => {
  await db.songs.clear()
  await db.songs.put({
    id: 'song1', title: 'T', artist: 'A',
    sources: [{ provider: 'youtube', ref: 'abc', hasAudio: true }],
    lyrics: { lines: [{ startTime: 1, endTime: 3, original: 'hello', translation: 'hi' }], sourceLanguage: 'en', translationLanguage: 'en', alignmentMode: 'manual' },
    syncState: 'synced', createdAt: new Date(), isTrialSong: false,
  } as never)
  usePlayerStore.setState({ speed: 1 })
})

describe('PlayerView speed control', () => {
  it('shows the speed slider in the speed section', async () => {
    render(<PlayerView songId="song1" onBack={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('hello')).toBeTruthy())
    const section = screen.getByLabelText('Playback speed')
    const toggle = section.querySelector('button[aria-expanded]')
    if (toggle?.getAttribute('aria-expanded') === 'false') fireEvent.click(toggle)
    expect(screen.getByRole('slider', { name: /playback speed/i })).toBeTruthy()
  })

  it('applies learner speed presets', async () => {
    render(<PlayerView songId="song1" onBack={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('hello')).toBeTruthy())
    const section = screen.getByLabelText('Playback speed')
    const toggle = section.querySelector('button[aria-expanded]')
    if (toggle?.getAttribute('aria-expanded') === 'false') fireEvent.click(toggle)
    fireEvent.click(screen.getByRole('button', { name: /slow, 75 percent speed/i }))
    expect(usePlayerStore.getState().speed).toBe(0.75)
    fireEvent.click(screen.getByRole('button', { name: /slower, 60 percent speed/i }))
    expect(usePlayerStore.getState().speed).toBe(0.6)
  })

  it('resets to normal speed on double-tap of the slider', async () => {
    usePlayerStore.setState({ speed: 0.6 })
    render(<PlayerView songId="song1" onBack={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('hello')).toBeTruthy())
    const slider = screen.getByRole('slider', { name: /playback speed/i })
    fireEvent.pointerUp(slider, { clientX: 10, clientY: 10 })
    fireEvent.pointerUp(slider, { clientX: 10, clientY: 10 })
    expect(usePlayerStore.getState().speed).toBe(1)
  })
})

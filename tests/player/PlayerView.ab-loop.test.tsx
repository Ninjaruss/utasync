import { describe, it, expect, vi, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { db } from '../../src/core/db/schema'
import { PlayerView } from '../../src/player/PlayerView'
import { usePlayerStore } from '../../src/player/PlayerStore'

vi.mock('../../src/player/AudioEngine', () => ({
  AudioEngine: class {
    duration = 10; position = 3
    async load() {} play() {} pause() {} seek() {} destroy() {}
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
  usePlayerStore.setState({ armingAB: null, abLoop: { a: null, b: null, preRoll: 2, loopCount: 3, crossfadeDuration: 0.3 } })
})

describe('PlayerView A/B loop', () => {
  it('tapping A arms it instead of setting the current position', async () => {
    render(<PlayerView songId="song1" onBack={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('hello')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /^a /i }))
    expect(usePlayerStore.getState().armingAB).toBe('a')
    expect(usePlayerStore.getState().abLoop.a).toBeNull()
  })

  it('tapping the armed button again cancels arming', async () => {
    render(<PlayerView songId="song1" onBack={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('hello')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /^a /i }))
    expect(usePlayerStore.getState().armingAB).toBe('a')
    fireEvent.click(screen.getByRole('button', { name: /^a /i }))
    expect(usePlayerStore.getState().armingAB).toBeNull()
  })

  it('tapping a lyric line while armed sets that endpoint', async () => {
    render(<PlayerView songId="song1" onBack={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('hello')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /^a /i }))
    fireEvent.click(screen.getByText('hello'))
    expect(usePlayerStore.getState().abLoop.a).toBe(1)
    expect(usePlayerStore.getState().armingAB).toBeNull()
  })

  it('clicking outside the lyric list cancels arming', async () => {
    render(<PlayerView songId="song1" onBack={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('hello')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /^a /i }))
    expect(usePlayerStore.getState().armingAB).toBe('a')
    fireEvent.click(screen.getByText('Settings'))
    expect(usePlayerStore.getState().armingAB).toBeNull()
  })
})

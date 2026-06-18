import { describe, it, expect, vi, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { db } from '../../src/core/db/schema'
import { PlayerView } from '../../src/player/PlayerView'

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
})

describe('PlayerView speed control', () => {
  it('shows a collapsed Speed chip by default, no slider visible', async () => {
    render(<PlayerView songId="song1" onBack={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('hello')).toBeTruthy())
    expect(screen.getByText(/speed: 100%/i)).toBeTruthy()
    expect(screen.queryByRole('slider')).toBeNull()
  })

  it('tapping the chip expands the slider, tapping again collapses it', async () => {
    render(<PlayerView songId="song1" onBack={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('hello')).toBeTruthy())
    fireEvent.click(screen.getByText(/speed: 100%/i))
    expect(screen.getByRole('slider')).toBeTruthy()
    fireEvent.click(screen.getByText(/speed: 100%/i))
    expect(screen.queryByRole('slider')).toBeNull()
  })
})

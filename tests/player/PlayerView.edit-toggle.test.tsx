import { describe, it, expect, vi, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { db } from '../../src/core/db/schema'
import { PlayerView } from '../../src/player/PlayerView'

vi.mock('../../src/player/AudioEngine', () => ({
  AudioEngine: class {
    duration = 10; position = 3
    async load() {} play() {} pause() {} seek() {} destroy() {} setRate() {} setVolume() {}
    onTimeUpdate() {} onEnd() {}
  },
}))

beforeEach(async () => {
  await db.songs.clear()
  await db.songs.put({
    id: 'song1', title: 'T', artist: 'A',
    sources: [{ provider: 'youtube', ref: 'abc', hasAudio: true }],
    lyrics: { lines: [{ startTime: 1, endTime: 3, original: 'hello', translation: 'hi' }], sourceLanguage: 'en', translationLanguage: 'en', alignmentMode: 'manual' },
    syncState: 'synced', createdAt: new Date(), isTrialSong: false,
  } as never)
})

describe('SongScreen Play/Edit toggle', () => {
  it('switches from Play mode to Edit mode and shows editable rows', async () => {
    render(<PlayerView songId="song1" onBack={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('hello')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    await waitFor(() => expect(screen.getByRole('button', { name: /edit timestamp for line 1/i })).toBeTruthy())
  })

  it('hides display toggles, speed, and A-B loop in Edit mode', async () => {
    render(<PlayerView songId="song1" onBack={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('hello')).toBeTruthy())
    expect(screen.getByRole('button', { name: /lyrics display options/i })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    await waitFor(() => expect(screen.getByRole('button', { name: /edit timestamp for line 1/i })).toBeTruthy())
    expect(screen.queryByRole('button', { name: /lyrics display options/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /practice tools/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /a loop point/i })).toBeNull()
    expect(screen.getByLabelText('Volume')).toBeTruthy()
  })
})

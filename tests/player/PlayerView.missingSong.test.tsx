import { describe, it, expect, vi, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { db } from '../../src/core/db/schema'
import { PlayerView } from '../../src/player/PlayerView'

vi.mock('../../src/core/opfs/audio', () => ({ getAudioFile: vi.fn(async () => new File([], 'x.mp3')) }))
vi.mock('../../src/player/AudioEngine', () => ({
  AudioEngine: class {
    duration = 0; position = 0
    async load() {} play() {} pause() {} seek() {} destroy() {} setRate() {} setVolume() {}
    onTimeUpdate() {} onEnd() {}
  },
}))

beforeEach(async () => { await db.songs.clear() })

describe('opening a song that is not in the library', () => {
  // Regression: a bookmarked or shared link to a deleted song rendered an empty
  // player — no lyrics, dead controls, and nothing saying why.
  it('says the song is missing rather than showing an empty player', async () => {
    render(<PlayerView songId="gone" onBack={vi.fn()} />)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/isn't in your library/i)
  })

  it('explains that songs live on the device that added them', async () => {
    render(<PlayerView songId="gone" onBack={vi.fn()} />)
    await screen.findByRole('alert')
    expect(screen.getByText(/stored\s+on the device that added them/i)).toBeTruthy()
  })

  it('offers a way back to the library', async () => {
    const onBack = vi.fn()
    render(<PlayerView songId="gone" onBack={onBack} />)
    await screen.findByRole('alert')

    fireEvent.click(screen.getByRole('button', { name: /back to library/i }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('still opens a song that does exist', async () => {
    await db.songs.put({
      id: 'here', title: 'T', artist: 'A',
      lyrics: { lines: [{ startTime: 0, endTime: 1, original: 'hello', translation: '' }], sourceLanguage: 'en', translationLanguage: 'en', alignmentMode: 'manual' },
      syncState: 'synced', createdAt: new Date(),
    } as never)

    render(<PlayerView songId="here" onBack={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('hello')).toBeTruthy())
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

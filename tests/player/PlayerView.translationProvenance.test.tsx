import { describe, it, expect, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { db } from '../../src/core/db/schema'
import { PlayerView } from '../../src/player/PlayerView'

// Step 0 verification (Task 11): a translation fit applied through the Second
// language panel must persist unplacedTranslations / translationSource /
// translationPairing on the stored song, not just update the in-memory lines.

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
    lyrics: {
      lines: [
        { startTime: 1, endTime: 3, original: 'hello there', translation: '' },
        { startTime: 3, endTime: 5, original: 'general kenobi', translation: '' },
      ],
      sourceLanguage: 'en',
      translationLanguage: 'en',
      alignmentMode: 'manual',
    },
    syncState: 'synced', createdAt: new Date(),
  } as never)
})

describe('translation provenance persists to storage', () => {
  it('stamps translationSource and translationPairing on the stored song after a clean fit', async () => {
    render(<PlayerView songId="song1" onBack={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('hello there')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    await waitFor(() => expect(screen.getByRole('button', { name: /edit timestamp for line 1/i })).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /^more$/i }))
    fireEvent.click(screen.getByRole('button', { name: /translation/i }))

    fireEvent.click(await screen.findByRole('button', { name: /paste lyrics/i }))
    const box = await screen.findByPlaceholderText(/english translation|japanese lyrics|translation/i)
    fireEvent.change(box, { target: { value: 'greetings friend\nhello master' } })
    fireEvent.click(screen.getByRole('button', { name: /attach/i }))

    await waitFor(async () => {
      const stored = await db.songs.get('song1')
      expect(stored?.lyrics.translationSource).toBe('greetings friend\nhello master')
    })

    const stored = await db.songs.get('song1')
    expect(stored?.lyrics.lines[0].translation).toBe('greetings friend')
    expect(stored?.lyrics.lines[1].translation).toBe('hello master')
    expect(stored?.lyrics.translationPairing).toBeDefined()
    expect(typeof stored?.lyrics.translationPairing?.meanConfidence).toBe('number')
    expect(stored?.lyrics.translationPairing?.version).toBe(1)
    expect(stored?.lyrics.unplacedTranslations).toEqual([])
  })
})

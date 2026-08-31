import { describe, it, expect, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { db } from '../../src/core/db/schema'
import { PlayerView } from '../../src/player/PlayerView'

// Task 11 Step 5/6: repair candidates are scored against nearby rows'
// translations plus unplaced lines via the cached embedder, and choosing one
// persists through the normal edit-lines path.

vi.mock('../../src/player/AudioEngine', () => ({
  AudioEngine: class {
    duration = 10; position = 3
    async load() {} play() {} pause() {} seek() {} destroy() {} setRate() {} setVolume() {}
    onTimeUpdate() {} onEnd() {}
  },
}))

// Deterministic fake embedder: each text maps to a fixed 2D vector so cosine
// similarity (a real, unmocked function) ranks candidates predictably —
// 'better fit' is closest to the flagged row's original, 'worse fit' is not.
vi.mock('../../src/ai-pipeline/textEmbedder', () => ({
  preloadEmbedder: vi.fn(),
  embedTexts: vi.fn(async (texts: string[]) =>
    texts.map((t) => {
      if (t === 'flagged original') return [1, 0]
      if (t === 'better fit') return [1, 0]
      if (t === 'worse fit') return [0.2, 0.98]
      return [0, 1]
    })),
}))

beforeEach(async () => {
  await db.songs.clear()
  await db.songs.put({
    id: 'song1', title: 'T', artist: 'A',
    sources: [{ provider: 'youtube', ref: 'abc', hasAudio: true }],
    lyrics: {
      lines: [
        { startTime: 0, endTime: 1, original: 'neighbor a', translation: 'worse fit' },
        { startTime: 1, endTime: 2, original: 'flagged original', translation: '' },
        { startTime: 2, endTime: 3, original: 'neighbor b', translation: 'unrelated' },
      ],
      sourceLanguage: 'en', translationLanguage: 'en', alignmentMode: 'manual',
      unplacedTranslations: [{ text: 'better fit', afterLineIndex: 0 }],
    },
    syncState: 'synced', createdAt: new Date(),
  } as never)
})

describe('PlayerView translation repair', () => {
  it('offers nearby and unplaced candidates ranked best-first, and persists the chosen one', async () => {
    render(<PlayerView songId="song1" onBack={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('flagged original')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /translation missing for line 2/i }))

    const options = await screen.findAllByRole('button', { name: /fit/i })
    // 'better fit' (the unplaced line) scores closer to the flagged row's
    // original than the neighbor's own translation 'worse fit', so it ranks first.
    expect(options[0]).toHaveTextContent('better fit')
    expect(screen.getByText(/unplaced/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^better fit/i }))

    await waitFor(async () => {
      const stored = await db.songs.get('song1')
      expect(stored?.lyrics.lines[1].translation).toBe('better fit')
    })
  })
})

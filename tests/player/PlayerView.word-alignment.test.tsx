import { describe, it, expect, vi, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, waitFor } from '@testing-library/react'
import { db } from '../../src/core/db/schema'
import { PlayerView } from '../../src/player/PlayerView'

vi.mock('../../src/player/AudioEngine', () => ({
  AudioEngine: class {
    duration = 10; position = 3
    async load() {} play() {} pause() {} seek() {} destroy() {}
    onTimeUpdate() {} onEnd() {}
  },
}))
vi.mock('../../src/ai-pipeline/capability', () => ({ getDeviceTier: () => 'full' }))
// Real tokenizeJapanese loads a kuromoji dictionary via fetch/fs, which isn't
// available in jsdom — stub it so enrichLines produces tokens deterministically.
vi.mock('../../src/language/japanese/tokenizer', () => ({
  tokenizeJapanese: async (text: string) =>
    text.split('').map((char, i) => ({
      surface: char, reading: char, pos: '名詞', startIndex: i, endIndex: i + 1,
    })),
}))
// toRomaji/toFurigana load the same unavailable-in-jsdom kuromoji dictionary
// (via kuroshiro) — stub them too so enrichLines's Promise.all doesn't reject.
vi.mock('../../src/language/japanese/phonetics', () => ({
  toRomaji: async (text: string) => text,
  toFurigana: async (text: string) => text,
}))
vi.mock('../../src/ai-pipeline/textEmbedder', () => ({
  // Deterministic fake: identical text -> identical vector, so '君' aligns to
  // whichever target word is given the same fake embedding below.
  embedTexts: vi.fn(async (texts: string[]) =>
    texts.map((t) => (t === '君' || t === 'you' ? [1, 0] : [0, 1]))),
}))

beforeEach(async () => {
  await db.songs.clear()
  await db.songs.put({
    id: 'song1', title: 'T', artist: 'A',
    sources: [{ provider: 'youtube', ref: 'abc', hasAudio: true }],
    lyrics: {
      lines: [{ startTime: 1, endTime: 3, original: '君', translation: 'you' }],
      sourceLanguage: 'ja', translationLanguage: 'en', alignmentMode: 'manual',
    },
    syncState: 'synced', createdAt: new Date(), isTrialSong: false,
  } as never)
})

describe('PlayerView word alignment', () => {
  it('computes alignmentIndices onto tokens after a song loads, on a full-tier device', async () => {
    render(<PlayerView songId="song1" onBack={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('君')).toBeTruthy())
    const { useLyricsStore } = await import('../../src/lyrics/LyricsStore')
    await waitFor(() => {
      const line = useLyricsStore.getState().lines[0]
      expect(line.tokens?.[0]?.alignmentIndices).toEqual([0])
    })
  })
})

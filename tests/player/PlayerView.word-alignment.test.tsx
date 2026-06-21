import { describe, it, expect, vi, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, waitFor } from '@testing-library/react'
import { db } from '../../src/core/db/schema'
import { PlayerView } from '../../src/player/PlayerView'
import { LYRICS_ENRICHMENT_VERSION } from '../../src/lyrics/lyricsEnrichment'

vi.mock('../../src/player/AudioEngine', () => ({
  AudioEngine: class {
    duration = 10; position = 3
    async load() {} play() {} pause() {} seek() {} destroy() {} setRate() {} setVolume() {}
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
  katakanaToHiragana: (text: string) => text,
}))
vi.mock('../../src/ai-pipeline/textEmbedder', () => ({
  preloadEmbedder: vi.fn(),
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
    const saved = await db.songs.get('song1')
    expect(saved?.lyrics.lines[0].tokens?.[0]?.alignmentIndices).toEqual([0])
  })

  it('skips normalization when enriched lyrics are already cached', async () => {
    await db.songs.put({
      id: 'song1', title: 'T', artist: 'A',
      sources: [{ provider: 'youtube', ref: 'abc', hasAudio: true }],
      lyrics: {
        lines: [{
          startTime: 1, endTime: 3, original: '君', translation: 'you',
          tokens: [{ surface: '君', startIndex: 0, endIndex: 1, alignmentIndices: [0] }],
        }],
        sourceLanguage: 'ja', translationLanguage: 'en', alignmentMode: 'manual',
        enrichmentVersion: LYRICS_ENRICHMENT_VERSION,
      },
      syncState: 'synced', createdAt: new Date(), isTrialSong: false,
    } as never)

    render(<PlayerView songId="song1" onBack={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('君')).toBeTruthy())
    expect(screen.queryByText(/normalizing lyrics/i)).toBeNull()
  })

  it('runs alignment-only when tokens exist but alignmentIndices are missing', async () => {
    await db.songs.put({
      id: 'song1', title: 'T', artist: 'A',
      sources: [{ provider: 'youtube', ref: 'abc', hasAudio: true }],
      lyrics: {
        lines: [{
          startTime: 1, endTime: 3, original: '君', translation: 'you',
          tokens: [{ surface: '君', pos: '名詞', startIndex: 0, endIndex: 1 }],
        }],
        sourceLanguage: 'ja', translationLanguage: 'en', alignmentMode: 'manual',
        enrichmentVersion: 1,
      },
      syncState: 'synced', createdAt: new Date(), isTrialSong: false,
    } as never)

    render(<PlayerView songId="song1" onBack={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('君')).toBeTruthy())
    const { useLyricsStore } = await import('../../src/lyrics/LyricsStore')
    await waitFor(() => {
      expect(useLyricsStore.getState().lines[0].tokens?.[0]?.alignmentIndices).toEqual([0])
    })
    const saved = await db.songs.get('song1')
    expect(saved?.lyrics.lines[0].tokens?.[0]?.alignmentIndices).toEqual([0])
  })

  it('skips embedder when no line has a visible translation', async () => {
    const { embedTexts } = await import('../../src/ai-pipeline/textEmbedder')
    vi.mocked(embedTexts).mockClear()

    await db.songs.clear()
    await db.songs.put({
      id: 'no-trans', title: 'T', artist: 'A',
      sources: [{ provider: 'youtube', ref: 'abc', hasAudio: true }],
      lyrics: {
        lines: [{
          startTime: 1, endTime: 3, original: 'hello', translation: 'hello',
          tokens: [{ surface: 'hello', pos: 'NOUN', startIndex: 0, endIndex: 5 }],
        }],
        sourceLanguage: 'en', translationLanguage: 'en', alignmentMode: 'manual',
        enrichmentVersion: 1,
      },
      syncState: 'synced', createdAt: new Date(), isTrialSong: false,
    } as never)

    render(<PlayerView songId="no-trans" onBack={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('hello')).toBeTruthy())
    await new Promise((r) => setTimeout(r, 50))
    expect(embedTexts).not.toHaveBeenCalled()
  })

  it('persists enrichment and skips normalization after reopening the song', async () => {
    const { unmount } = render(<PlayerView songId="song1" onBack={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('君')).toBeTruthy())
    const { useLyricsStore } = await import('../../src/lyrics/LyricsStore')
    await waitFor(() => {
      expect(useLyricsStore.getState().lines[0].tokens?.length).toBeGreaterThan(0)
    })
    const saved = await db.songs.get('song1')
    expect(saved?.lyrics.enrichmentVersion).toBe(LYRICS_ENRICHMENT_VERSION)

    unmount()
    render(<PlayerView songId="song1" onBack={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('君')).toBeTruthy())
    expect(screen.queryByText(/normalizing lyrics/i)).toBeNull()
  })
})

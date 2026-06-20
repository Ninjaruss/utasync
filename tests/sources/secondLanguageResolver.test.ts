import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/sources/lrclib', () => ({
  findSecondLanguageInLRCLIB: vi.fn(),
}))

vi.mock('../../src/sources/lyricsOvh', () => ({
  findSecondLanguageInLyricsOvh: vi.fn(),
}))

import { findSecondLanguageInLRCLIB } from '../../src/sources/lrclib'
import { findSecondLanguageInLyricsOvh } from '../../src/sources/lyricsOvh'
import {
  findSecondLanguageLyrics,
  formatSecondLanguageSearchReport,
} from '../../src/sources/secondLanguageResolver'

describe('findSecondLanguageLyrics', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns LRCLIB synced results without calling lyrics.ovh', async () => {
    vi.mocked(findSecondLanguageInLRCLIB).mockResolvedValue({
      lrc: '[00:01.00]Your eyes',
      synced: true,
    })
    const onStage = vi.fn()
    const onReport = vi.fn()
    const result = await findSecondLanguageLyrics('Song', 'Artist', 'ja', onStage, 180, onReport)

    expect(result?.source).toBe('lrclib-synced')
    expect(findSecondLanguageInLyricsOvh).not.toHaveBeenCalled()
    expect(onStage).toHaveBeenCalledWith('lrclib')
    expect(onReport).toHaveBeenCalledWith([
      { provider: 'lrclib', outcome: 'found', detail: 'synced' },
    ])
  })

  it('falls back to lyrics.ovh when LRCLIB has no alternate-language match', async () => {
    vi.mocked(findSecondLanguageInLRCLIB).mockResolvedValue(null)
    vi.mocked(findSecondLanguageInLyricsOvh).mockResolvedValue({
      lrc: 'Your eyes\nIn the night',
      synced: false,
    })
    const onStage = vi.fn()
    const onReport = vi.fn()

    const result = await findSecondLanguageLyrics('Song', 'Artist', 'ja', onStage, undefined, onReport)

    expect(result?.source).toBe('lyrics-ovh')
    expect(onStage).toHaveBeenCalledWith('lrclib')
    expect(onStage).toHaveBeenCalledWith('lyrics-ovh')
    expect(onReport).toHaveBeenCalledWith([
      { provider: 'lrclib', outcome: 'not-found' },
      { provider: 'lyrics-ovh', outcome: 'found' },
    ])
  })

  it('reports both providers as not-found when nothing matches', async () => {
    vi.mocked(findSecondLanguageInLRCLIB).mockResolvedValue(null)
    vi.mocked(findSecondLanguageInLyricsOvh).mockImplementation(async (_t, _a, _l, onAttempt) => {
      onAttempt?.({ artist: 'Artist', title: 'Song', outcome: 'not-found', detail: 'No lyrics found' })
      return null
    })
    const onReport = vi.fn()

    const result = await findSecondLanguageLyrics('Song', 'Artist', 'ja', undefined, undefined, onReport)

    expect(result).toBeNull()
    expect(onReport).toHaveBeenCalledWith([
      { provider: 'lrclib', outcome: 'not-found' },
      { provider: 'lyrics-ovh', outcome: 'not-found', detail: '1 not on lyric sites' },
    ])
  })
})

describe('formatSecondLanguageSearchReport', () => {
  it('summarizes provider outcomes for the UI', () => {
    const text = formatSecondLanguageSearchReport([
      { provider: 'lrclib', outcome: 'not-found' },
      { provider: 'lyrics-ovh', outcome: 'not-found', detail: '2 not on lyric sites' },
    ])
    expect(text).toContain('LRCLIB: not-found')
    expect(text).toContain('Genius & lyric sites: not-found')
  })
})

import { describe, it, expect } from 'vitest'
import { cleanPastedLyrics } from '../../src/lyrics/lyricCleanup'
import { linesFromPlainText } from '../../src/sources/songBuilder'

describe('cleanPastedLyrics', () => {
  it('strips Genius section headers but keeps the lyric lines', () => {
    const input = [
      '[Verse 1: Tori Kelly, Ado, 藤原聡]',
      'Back streets, walking on the edge of the night',
      'ただただ荒れていく時代に',
      '[Pre-Chorus: 藤原聡, 藤原聡 & Ado]',
      '彷徨う暗い暗い街',
    ].join('\n')
    expect(cleanPastedLyrics(input).split('\n').filter(Boolean)).toEqual([
      'Back streets, walking on the edge of the night',
      'ただただ荒れていく時代に',
      '彷徨う暗い暗い街',
    ])
  })

  it('removes concert, recommendation, romanization and embed noise', () => {
    const input = [
      'Stranger than heaven',
      'See Snoop Dogg Live',
      'Get tickets as low as $102',
      'You might also like',
      'Make Them Cry',
      'Drake',
      'Baby',
      'Justin Bieber',
      'Ado - 春に舞う (Haru Ni Mau) (Romanized)',
      'Genius Romanizations',
      '[Verse 2: Snoop Dogg]',
      'Followed by the echoes where the black light dims',
      '217Embed',
    ].join('\n')
    expect(cleanPastedLyrics(input).split('\n').filter(Boolean)).toEqual([
      'Stranger than heaven',
      'Followed by the echoes where the black light dims',
    ])
  })

  it('keeps parenthetical ad-libs and real lyric lines', () => {
    const input = [
      'Looking to my left, something don’t feel right (Hey)',
      '滾らせるこの覚悟の血 (Hey)',
      'I found a place that I can call home (Ah)',
    ].join('\n')
    expect(cleanPastedLyrics(input).split('\n').filter(Boolean)).toEqual([
      'Looking to my left, something don’t feel right (Hey)',
      '滾らせるこの覚悟の血 (Hey)',
      'I found a place that I can call home (Ah)',
    ])
  })

  it('drops a stray "you might also like" without a bounding header to only the marker', () => {
    const input = ['Real lyric one', 'You might also like', 'Real lyric two'].join('\n')
    // No section header follows, so only the marker line is removed.
    expect(cleanPastedLyrics(input).split('\n').filter(Boolean)).toEqual([
      'Real lyric one',
      'Real lyric two',
    ])
  })

  it('linesFromPlainText applies the cleaner end-to-end', () => {
    const input = [
      '[Chorus: Tori Kelly, 藤原聡]',
      'I found a place where I’m not alone',
      '錆ひとつない 触らせやしない 媚びる気はない',
      'You might also like',
      'Some Song',
      '[Bridge: Tori Kelly]',
      'Paved my way, won’t live in my past',
    ].join('\n')
    const lines = linesFromPlainText(input)
    expect(lines.map((l) => l.original)).toEqual([
      'I found a place where I’m not alone',
      '錆ひとつない 触らせやしない 媚びる気はない',
      'Paved my way, won’t live in my past',
    ])
  })
})

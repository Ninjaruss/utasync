import { describe, it, expect } from 'vitest'
import { cleanPastedLyrics, stripInlineFurigana } from '../../src/lyrics/lyricCleanup'
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

  it('strips inline furigana 漢字(かな) from kept lyric lines (ascii parens)', () => {
    expect(cleanPastedLyrics('君(きみ)の名前(なまえ)を呼(よ)ぶ')).toBe('君の名前を呼ぶ')
  })

  it('strips inline furigana with fullwidth parens', () => {
    expect(cleanPastedLyrics('君（きみ）の名前（なまえ）を呼（よ）ぶ')).toBe('君の名前を呼ぶ')
  })

  it('strips mixed paren styles within one line', () => {
    expect(cleanPastedLyrics('君(きみ)の名前（なまえ）')).toBe('君の名前')
  })

  it('strips consecutive/adjacent annotations with no separator', () => {
    expect(cleanPastedLyrics('名前(なまえ)呼(よ)ぶ')).toBe('名前呼ぶ')
  })

  it('strips a katakana reading 漢字(カナ)', () => {
    expect(cleanPastedLyrics('漢字(カナ)')).toBe('漢字')
  })

  it('does NOT strip a Latin ad-lib parenthetical', () => {
    expect(cleanPastedLyrics('Oh (Hey)')).toBe('Oh (Hey)')
  })

  it('does NOT strip "(Ah)" (Latin, not kana)', () => {
    expect(cleanPastedLyrics('(Ah)')).toBe('(Ah)')
  })

  it('does NOT strip a kana parenthetical at line start (no preceding kanji)', () => {
    expect(cleanPastedLyrics('(なにか)を探す')).toBe('(なにか)を探す')
  })

  it('does NOT strip a kana parenthetical preceded by kana, not kanji', () => {
    // "そら(あお)": the char before "(" is ら (hiragana), so it is not furigana.
    expect(cleanPastedLyrics('そら(あお)')).toBe('そら(あお)')
  })

  it('does NOT strip English parentheticals — isolated from the junk filter', () => {
    // "(Haru Ni Mau)" / "(Romanized)" are romanization annotations, not furigana.
    // Tested via the helper so the (Romanized) junk-line filter does not mask it.
    expect(stripInlineFurigana('春に舞う (Haru Ni Mau) (Romanized)')).toBe(
      '春に舞う (Haru Ni Mau) (Romanized)',
    )
  })

  it('leaves a normal Japanese line without furigana unchanged', () => {
    expect(cleanPastedLyrics('ただただ荒れていく時代に')).toBe('ただただ荒れていく時代に')
  })

  it('leaves an English line unchanged', () => {
    expect(cleanPastedLyrics('Back streets, walking on the edge of the night')).toBe(
      'Back streets, walking on the edge of the night',
    )
  })

  it('strips inline furigana end-to-end through linesFromPlainText', () => {
    const input = [
      '[Verse 1: Ado]',
      '君(きみ)の名前(なまえ)を呼(よ)ぶ',
      '滾(たぎ)らせるこの覚悟(かくご)の血(ち)',
    ].join('\n')
    const lines = linesFromPlainText(input)
    expect(lines.map((l) => l.original)).toEqual([
      '君の名前を呼ぶ',
      '滾らせるこの覚悟の血',
    ])
  })
})

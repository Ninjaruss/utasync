import { describe, it, expect } from 'vitest'
import { lineRomajiFromTokens } from '../../src/lyrics/readingDisplay'
import type { Token } from '../../src/core/types'

const tok = (surface: string, reading?: string, pos = '名詞'): Token => ({
  surface,
  reading,
  pos,
  startIndex: 0,
  endIndex: surface.length,
})

/**
 * Cross-token gemination: wanakana drops a token-final っ (いっ → "i"), so
 * numeral+counter splits like 一[イッ]+歩[ポ] romanized per-token read
 * "i po" instead of "ippo". The joiner must fuse a っ-final token with the
 * following consonant onset.
 */
describe('lineRomajiFromTokens — cross-token gemination', () => {
  it('fuses 一[イッ]+歩[ポ] into "ippo"', () => {
    expect(lineRomajiFromTokens([tok('一', 'イッ'), tok('歩', 'ポ')])).toBe('ippo')
  })

  it('keeps surrounding tokens spaced (一歩ずつ進んでも)', () => {
    const line = [tok('一', 'イッ'), tok('歩', 'ポ'), tok('ずつ', 'ズツ'), tok('進ん', 'ススン', '動詞'), tok('でも', 'デモ')]
    expect(lineRomajiFromTokens(line)).toBe('ippo zutsu susun demo')
  })

  it('uses the tch spelling before ch onsets', () => {
    expect(lineRomajiFromTokens([tok('待', 'マッ'), tok('ち', 'チ')])).toBe('matchi')
  })

  it('does not fuse before a vowel onset', () => {
    expect(lineRomajiFromTokens([tok('切', 'キッ'), tok('会', 'アイ')])).toBe('ki ai')
  })

  it('leaves a line-final っ token as wanakana renders it', () => {
    expect(lineRomajiFromTokens([tok('待', 'マッ')])).toBe('ma')
  })

  it('leaves plain tokens untouched', () => {
    expect(lineRomajiFromTokens([tok('粉雪', 'コナユキ')])).toBe('konayuki')
  })
})

/**
 * Grammatical particles shift phonetically: は→wa, へ→e, を→o. wanakana's
 * kanaToRomaji is grammar-blind (は→"ha"), so the particle romaji is overridden
 * by surface + 助詞 pos — never by the kana reading, which keeps lexical
 * 葉(は)/部屋(へや) untouched.
 */
describe('lineRomajiFromTokens — grammatical particle romaji', () => {
  it('renders topic は (助詞) as "wa"', () => {
    expect(lineRomajiFromTokens([tok('私', 'ワタシ'), tok('は', 'ハ', '助詞')])).toBe('watashi wa')
  })

  it('renders object を (助詞) as "o"', () => {
    expect(lineRomajiFromTokens([tok('あなた', 'アナタ'), tok('を', 'ヲ', '助詞')])).toBe('anata o')
  })

  it('renders direction へ (助詞) as "e"', () => {
    expect(lineRomajiFromTokens([tok('ところ', 'トコロ'), tok('へ', 'ヘ', '助詞')])).toBe('tokoro e')
  })

  it('overrides even when the particle token carries no reading (kana surface)', () => {
    expect(lineRomajiFromTokens([tok('君', 'キミ'), tok('は', undefined, '助詞')])).toBe('kimi wa')
  })

  // REGRESSION: lexical は/へ/を must stay phonetic.
  it('keeps lexical 葉 (名詞, は) as "ha"', () => {
    expect(lineRomajiFromTokens([tok('葉', 'ハ', '名詞')])).toBe('ha')
  })

  it('leaves a word containing へ internally unaffected (部屋 → heya)', () => {
    expect(lineRomajiFromTokens([tok('部屋', 'ヘヤ', '名詞')])).toBe('heya')
  })

  it('leaves a word containing を internally unaffected (男 has no を; 逢を-like nonsense)', () => {
    // A multi-char token whose surface is not exactly を is never overridden.
    expect(lineRomajiFromTokens([tok('全て', 'スベテ', '名詞')])).toBe('subete')
  })

  it('does not over-apply when surface is は but pos is not 助詞', () => {
    expect(lineRomajiFromTokens([tok('は', 'ハ', '名詞')])).toBe('ha')
  })

  it('still geminates around a particle (一歩を → ippo o)', () => {
    expect(lineRomajiFromTokens([tok('一', 'イッ'), tok('歩', 'ポ'), tok('を', 'ヲ', '助詞')])).toBe('ippo o')
  })

  it('leaves a normal particle-free line unchanged', () => {
    expect(lineRomajiFromTokens([tok('粉雪', 'コナユキ')])).toBe('konayuki')
  })
})

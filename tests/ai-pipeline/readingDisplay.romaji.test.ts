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

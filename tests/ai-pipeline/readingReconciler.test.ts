import { describe, it, expect } from 'vitest'
import type { TimedLine, Token } from '../../src/core/types'
import {
  normalizeKanaForCompare,
  readingsEquivalent,
  shouldAdoptSungReading,
  reconcileTokenReadings,
  wordsInLineWindow,
  isReliableTranscriptWindow,
  readingAdoptionConfidence,
  HIGH_READING_CONFIDENCE,
} from '../../src/ai-pipeline/readingReconciler'

const tok = (surface: string, reading: string, startIndex = 0): Token => ({
  surface,
  reading,
  pos: '名詞',
  startIndex,
  endIndex: startIndex + surface.length,
})

describe('normalizeKanaForCompare', () => {
  it('normalizes katakana and drops prolonged sound mark', () => {
    expect(normalizeKanaForCompare('キミ')).toBe('きみ')
    expect(normalizeKanaForCompare('あー')).toBe('あ')
  })
})

describe('readingsEquivalent', () => {
  it('treats kana variants as equivalent', () => {
    expect(readingsEquivalent('キミ', 'きみ')).toBe(true)
    expect(readingsEquivalent('アシタ', 'あした')).toBe(true)
  })

  it('detects alternate homograph readings', () => {
    expect(readingsEquivalent('アシタ', 'あす')).toBe(false)
  })
})

describe('shouldAdoptSungReading', () => {
  it('adopts a clearly different sung reading', () => {
    expect(shouldAdoptSungReading('アシタ', 'あす')).toBe(true)
  })

  it('does not adopt when readings match', () => {
    expect(shouldAdoptSungReading('キミ', 'きみ')).toBe(false)
  })
})

describe('reconcileTokenReadings', () => {
  const line: TimedLine = {
    startTime: 10,
    endTime: 14,
    original: '君の明日',
    translation: '',
  }

  it('verifies dictionary reading when audio matches', () => {
    const tokens = [tok('君', 'キミ', 0)]
    const words = [{ word: 'きみ', startTime: 10, endTime: 10.8 }]
    const out = reconcileTokenReadings(tokens, line, words)
    expect(out[0].readingVerified).toBe(true)
  })

  it('verifies a later token when its audio window matches', () => {
    const tokens = [tok('君', 'キミ', 0), tok('明日', 'アシタ', 1)]
    const words = [
      { word: 'きみ', startTime: 10, endTime: 10.5 },
      { word: 'あした', startTime: 12.5, endTime: 13.8 },
    ]
    const out = reconcileTokenReadings(tokens, line, words)
    expect(out[1].readingVerified).toBe(true)
  })

  it('adopts sung reading when it differs from dictionary', () => {
    const tokens = [tok('明日', 'アシタ', 0)]
    const words = [{ word: 'あす', startTime: 10, endTime: 11 }]
    const out = reconcileTokenReadings(tokens, line, words)
    expect(out[0].audioReading).toBe('アス')
    expect(out[0].readingMismatch).toBeFalsy()
  })

  it('stays neutral when audio evidence is a single stray mora', () => {
    // High-precision policy: one sub-mora fragment ('ろ' for 色) is not enough
    // evidence to call the dictionary reading wrong — leave the token neutral
    // rather than painting it amber.
    const tokens = [tok('色', 'イロ', 0)]
    const words = [{ word: 'ろ', startTime: 10.2, endTime: 10.5 }]
    const out = reconcileTokenReadings(tokens, line, words)
    expect(out[0].readingMismatch).toBeFalsy()
    expect(out[0].audioReading).toBeUndefined()
  })

  it('does not adopt a fragment sliced from a word spanning several tokens', () => {
    // Reproduces the 向こう→クニコ false-positive: a single transcript word
    // covers several tokens, so proportionally slicing it yields garbage kana
    // for any one token. That fragment must never be adopted or flagged — the
    // word is not owned by this token's window.
    const fragLine: TimedLine = { startTime: 0, endTime: 2, original: '向こう側', translation: '' }
    const tokens = [tok('向こう', 'ムコウ', 0), tok('側', 'ガワ', 1)]
    const words = [{ word: 'となりのいえ', startTime: 0, endTime: 2 }]
    const out = reconcileTokenReadings(tokens, fragLine, words)
    expect(out[0].audioReading).toBeUndefined()
    expect(out[0].readingMismatch).toBeFalsy()
    expect(out[1].audioReading).toBeUndefined()
    expect(out[1].readingMismatch).toBeFalsy()
  })

  it('flags a mismatch when owned audio differs but is too uncertain to adopt', () => {
    // The token owns a coarse (>8s) word whose kana clearly differ from the
    // dictionary reading: trustworthy enough to warn (amber), not enough to
    // override the ruby.
    const longLine: TimedLine = { startTime: 10, endTime: 18.2, original: '色', translation: '' }
    const tokens = [tok('色', 'イロ', 0)]
    const words = [{ word: 'あお', startTime: 10, endTime: 18.1 }]
    const out = reconcileTokenReadings(tokens, longLine, words)
    expect(out[0].readingMismatch).toBe(true)
    expect(out[0].audioReading).toBeUndefined()
  })

  it('ignores kana-only tokens', () => {
    const tokens = [tok('の', 'ノ', 0)]
    const words = [{ word: 'の', startTime: 10, endTime: 10.4 }]
    const out = reconcileTokenReadings(tokens, line, words)
    expect(out[0].readingVerified).toBeUndefined()
    expect(out[0].audioReading).toBeUndefined()
  })

  it('keeps the dictionary reading when only a phrase-level segment covers 理由', () => {
    // The transcript groups the whole sung line into one chunk; slicing it per
    // token is unreliable, so 理由 must keep its dictionary reading rather than
    // adopt a proportional fragment (the source of 車→なは-style garbage).
    const sadLine: TimedLine = {
      startTime: 177,
      endTime: 183,
      original: '理由もないのに何だか悲しい',
      translation: '',
    }
    const tokens = [tok('理由', 'リユウ', 0), tok('も', 'モ', 2), tok('ない', 'ナイ', 3)]
    const words = [{
      word: 'わけもないのに なんだか悲しい 泣けやしないから',
      startTime: 177,
      endTime: 186.5,
    }]
    const out = reconcileTokenReadings(tokens, sadLine, words)
    expect(out[0].audioReading).toBeUndefined()
  })
})

describe('reconcileTokenReadings — kanji-spelled transcript', () => {
  it('does not adopt okurigana/particles as a reading when the transcript spells the token in kanji', () => {
    // Whisper writes 車 as the kanji, so the kana in 車\'s sliced window are the
    // surrounding particles (…さ・な・車・は…), not its reading — keep くるま.
    const line: TimedLine = { startTime: 0, endTime: 4, original: '小さな車は君を', translation: '' }
    const tokens = [
      tok('小さな', 'チイサナ', 0),
      tok('車', 'クルマ', 3),
      tok('は', 'ハ', 4),
      tok('君', 'キミ', 5),
      tok('を', 'ヲ', 6),
    ]
    const words = [{ word: '小さな車は君を', startTime: 0, endTime: 4 }]
    const out = reconcileTokenReadings(tokens, line, words)
    const kuruma = out.find((t) => t.surface === '車')
    expect(kuruma?.audioReading).toBeUndefined()
    expect(kuruma?.readingMismatch).toBeFalsy()
  })
})

describe('isReliableTranscriptWindow', () => {
  it('trusts word-level (short) coverage', () => {
    const words = [{ word: 'わけ', startTime: 0, endTime: 0.8 }]
    expect(isReliableTranscriptWindow(words, 0, 1)).toBe(true)
  })

  it('distrusts a lone long segment chunk with no word-level sibling', () => {
    const words = [{ word: 'ながいせつめんのかたまり', startTime: 0, endTime: 10 }]
    expect(isReliableTranscriptWindow(words, 0, 10)).toBe(false)
  })

  it('is false when nothing covers the window', () => {
    expect(isReliableTranscriptWindow([], 0, 1)).toBe(false)
  })
})

describe('readingAdoptionConfidence', () => {
  const token = tok('理由', 'リユウ', 0)

  it('scores word-level evidence above the high threshold', () => {
    const words = [{ word: 'わけ', startTime: 0, endTime: 0.8 }]
    expect(readingAdoptionConfidence('わけ', token, words)).toBeGreaterThanOrEqual(HIGH_READING_CONFIDENCE)
  })

  it('scores a coarse segment chunk below the high threshold', () => {
    const words = [{ word: 'わけもないのに', startTime: 0, endTime: 10 }]
    expect(readingAdoptionConfidence('わけ', token, words)).toBeLessThan(HIGH_READING_CONFIDENCE)
  })

  it('returns 0 for sub-mora evidence', () => {
    const words = [{ word: 'ろ', startTime: 0, endTime: 0.3 }]
    expect(readingAdoptionConfidence('ろ', token, words)).toBe(0)
  })

  it('rejects a short-duration phrase chunk that spans many tokens', () => {
    // Real segment/word transcripts group a whole sung phrase into one ~5s chunk;
    // proportional slicing then yields garbage kana. Such a chunk is far longer
    // than the token, so it must not be trusted regardless of its short duration.
    const kuruma = tok('車', 'クルマ', 0)
    const phrase = [{ word: '赤い赤い小さな車は君を乗せて', startTime: 0, endTime: 5 }]
    expect(readingAdoptionConfidence('なは', kuruma, phrase)).toBe(0)
  })

  it('still trusts a token-sized word-level chunk', () => {
    const words = [{ word: 'わけ', startTime: 0, endTime: 0.8 }]
    expect(readingAdoptionConfidence('わけ', token, words)).toBeGreaterThanOrEqual(HIGH_READING_CONFIDENCE)
  })
})

describe('reconcileTokenReadings reading policy (D3)', () => {
  it('keeps a noisy segment-mode 戦争 slice below the ruby threshold', () => {
    const line: TimedLine = { startTime: 0, endTime: 10, original: '戦争', translation: '' }
    const tokens = [tok('戦争', 'センソウ', 0)]
    // One coarse Whisper segment spanning the whole line — proportional slicing
    // would otherwise put a wrong kana fragment over 戦争.
    const words = [{ word: 'それからずっとつづくよ', startTime: 0, endTime: 10 }]
    const out = reconcileTokenReadings(tokens, line, words)
    // The dictionary reading must win in the ruby: confidence stays below high.
    expect(out[0].readingConfidence ?? 0).toBeLessThan(HIGH_READING_CONFIDENCE)
  })

  it('adopts a high-confidence alternate from word-level evidence', () => {
    const line: TimedLine = { startTime: 0, endTime: 1, original: '理由', translation: '' }
    const tokens = [tok('理由', 'リユウ', 0)]
    const words = [{ word: 'わけ', startTime: 0, endTime: 0.8 }]
    const out = reconcileTokenReadings(tokens, line, words)
    expect(out[0].audioReading).toBe('ワケ')
    expect(out[0].readingConfidence ?? 0).toBeGreaterThanOrEqual(HIGH_READING_CONFIDENCE)
  })

  it('marks a token verified (confidence 1) when audio matches the dictionary', () => {
    const line: TimedLine = { startTime: 0, endTime: 1, original: '戦争', translation: '' }
    const tokens = [tok('戦争', 'センソウ', 0)]
    const words = [{ word: 'せんそう', startTime: 0, endTime: 0.9 }]
    const out = reconcileTokenReadings(tokens, line, words)
    expect(out[0].readingVerified).toBe(true)
    expect(out[0].readingConfidence).toBe(1)
  })
})

describe('wordsInLineWindow', () => {
  it('includes words overlapping the line span with padding', () => {
    const line: TimedLine = { startTime: 5, endTime: 8, original: 'x', translation: '' }
    const words = [
      { word: 'a', startTime: 4.9, endTime: 5.2 },
      { word: 'b', startTime: 7.8, endTime: 8.1 },
      { word: 'c', startTime: 9, endTime: 10 },
    ]
    expect(wordsInLineWindow(words, line).map((w) => w.word)).toEqual(['a', 'b'])
  })
})

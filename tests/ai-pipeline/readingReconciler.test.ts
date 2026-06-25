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

  it('flags mismatch when audio evidence is too short to adopt', () => {
    const tokens = [tok('色', 'イロ', 0)]
    const words = [{ word: 'ろ', startTime: 10.2, endTime: 10.5 }]
    const out = reconcileTokenReadings(tokens, line, words)
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

  it('adopts わけ from a mixed kanji/kana Whisper segment for 理由', () => {
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
    expect(out[0].audioReading).toBe('ワケ')
    expect(out[0].readingMismatch).toBeFalsy()
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

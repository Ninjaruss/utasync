import { describe, it, expect, beforeEach } from 'vitest'
import {
  setJmdictReadingsForTests,
  resetJmdictReadingsCache,
  jmdictReadingsLoaded,
  readingInventory,
  candidateTokenReadings,
  isValidJmdictReading,
  getJmdictReadingValidator,
} from '../../../src/language/japanese/jmdictReadings'
import type { Token } from '../../../src/core/types'

const tok = (surface: string, reading?: string, baseForm?: string): Token => ({
  surface, reading, baseForm, pos: '名詞', startIndex: 0, endIndex: surface.length,
})

beforeEach(() => {
  resetJmdictReadingsCache()
  setJmdictReadingsForTests({
    v: 1,
    source: 'jmdict-eng',
    readings: {
      // commons | uncommons
      角: 'かど,かく,つの',
      術: 'じゅつ|すべ',
      彷徨う: 'さまよう',
      粉雪: 'こなゆき|こゆき',
      風車: 'ふうしゃ,かざぐるま',
    },
  })
})

describe('readingInventory', () => {
  it('splits common and uncommon readings', () => {
    expect(readingInventory('術')).toEqual({ common: ['じゅつ'], uncommon: ['すべ'] })
    expect(readingInventory('角')).toEqual({ common: ['かど', 'かく', 'つの'], uncommon: [] })
  })

  it('returns undefined for unknown surfaces', () => {
    expect(readingInventory('存在しない')).toBeUndefined()
  })

  it('handles entries with no common readings', () => {
    setJmdictReadingsForTests({ v: 1, source: 'jmdict-eng', readings: { 憖: '|なまじ' } })
    expect(readingInventory('憖')).toEqual({ common: [], uncommon: ['なまじ'] })
  })
})

describe('candidateTokenReadings', () => {
  it('returns all inventory readings for an exact-surface match', () => {
    expect(candidateTokenReadings(tok('角', 'カク'))).toEqual(['かど', 'かく', 'つの'])
  })

  it('adapts baseForm readings to an inflected surface via okurigana swap', () => {
    // 彷徨っ (baseForm 彷徨う): さまよう → さまよ + っ = さまよっ
    expect(candidateTokenReadings(tok('彷徨っ', 'ホウコウッ', '彷徨う'))).toEqual(['さまよっ'])
  })

  it('does not adapt baseForm readings when the stems differ', () => {
    // baseForm stem 行 does not match surface stem 走 — bogus data must not produce candidates
    expect(candidateTokenReadings(tok('走っ', 'ハシッ', '行く'))).toEqual([])
  })

  it('returns empty for surfaces absent from the inventory', () => {
    expect(candidateTokenReadings(tok('謎語', 'メイゴ'))).toEqual([])
  })
})

describe('isValidJmdictReading', () => {
  it('accepts katakana input and normalizes for comparison', () => {
    expect(isValidJmdictReading(tok('角', 'カク'), 'カド')).toBe(true)
    expect(isValidJmdictReading(tok('角', 'カク'), 'かど')).toBe(true)
  })

  it('rejects kana that is not a listed reading', () => {
    expect(isValidJmdictReading(tok('角', 'カク'), 'かご')).toBe(false)
  })

  it('validates inflected forms against adapted baseForm readings', () => {
    expect(isValidJmdictReading(tok('彷徨っ', 'ホウコウッ', '彷徨う'), 'さまよっ')).toBe(true)
    expect(isValidJmdictReading(tok('彷徨っ', 'ホウコウッ', '彷徨う'), 'ほうこうっ')).toBe(false)
  })

  it('returns false for unknown surfaces (never vouches blindly)', () => {
    expect(isValidJmdictReading(tok('宇宙', 'ウチュウ'), 'そら')).toBe(false)
  })
})

describe('getJmdictReadingValidator', () => {
  it('returns a working validator when data is loaded', () => {
    const validate = getJmdictReadingValidator()
    expect(validate).toBeDefined()
    expect(validate!(tok('粉雪', 'コユキ'), 'こなゆき')).toBe(true)
  })

  it('returns undefined when no data is loaded', () => {
    resetJmdictReadingsCache()
    expect(jmdictReadingsLoaded()).toBe(false)
    expect(getJmdictReadingValidator()).toBeUndefined()
  })
})

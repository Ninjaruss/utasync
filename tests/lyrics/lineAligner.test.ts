import { describe, it, expect } from 'vitest'
import {
  isMixedScriptLine,
  splitMixedScriptLine,
  splitDualPhraseJapanese,
  expandSlotsAdaptive,
  mergeSlotTranslations,
  pairTranslationsToPrimary,
  latinHintScore,
  smartAttachSecondLanguage,
  targetWordsForAlignment,
  japaneseTokenIndices,
  targetWordBaseOffset,
  offsetTokenAlignmentIndices,
  buildAlignmentSegments,
  alignableEnglishTargetPool,
  alignmentIndicesAreValid,
  buildAlignJob,
} from '../../src/lyrics/lineAligner'
import type { TimedLine } from '../../src/core/types'

const line = (original: string, translation = '', startTime = 0, endTime = 0): TimedLine =>
  ({ original, startTime, endTime, translation })

describe('splitDualPhraseJapanese', () => {
  it('splits two substantial Japanese phrases', () => {
    expect(splitDualPhraseJapanese('滑り込むキミの横 隣り合わせのハート')).toEqual([
      '滑り込むキミの横',
      '隣り合わせのハート',
    ])
  })
  it('does not split short interjections like ねえ いつか', () => {
    expect(splitDualPhraseJapanese('ねえ いつか')).toBeNull()
  })
})

describe('expandSlotsAdaptive', () => {
  it('adds slots for dual-phrase lines until the count matches translations', () => {
    const originals = [
      'You always make me so happy 青空に溶けて',
      '滑り込むキミの横 隣り合わせのハート',
      'ねえ いつか',
    ]
    const slots = expandSlotsAdaptive(originals, 5)
    expect(slots).toHaveLength(5)
    expect(slots.filter((s) => s.lineIndex === 0)).toHaveLength(2)
    expect(slots.filter((s) => s.lineIndex === 1)).toHaveLength(2)
    expect(slots.filter((s) => s.lineIndex === 2)).toHaveLength(1)
  })
})

describe('pairTranslationsToPrimary — My Eyes Only pattern', () => {
  const primary: TimedLine[] = [
    line('You always make me so happy 青空に溶けて'),
    line('I promise for my eyes only キミの隣で'),
    line(''),
    line('ねえ いつか'),
    line('ねえ いつも'),
    line(''),
    line('滑り込むキミの横 隣り合わせのハート'),
    line('一歩ずつ進んでも 視線に困るあたし'),
  ]

  const english = [
    'You always make me so happy',
    'Melt into the blue sky',
    'I promise for my eyes only',
    'Next to you',
    'Hey, someday',
    'Hey, always',
    'Beside you as you slide in',
    'Adjacent hearts',
    'One step at a time',
    "I'm having trouble looking at you",
  ]

  it('pairs mixed and dual-phrase lines automatically via adaptive slots', () => {
    const { lines, method } = pairTranslationsToPrimary(primary, english)
    expect(method).toBe('slots')
    expect(lines[0].translation).toBe('You always make me so happy\nMelt into the blue sky')
    expect(lines[6].translation).toBe('Beside you as you slide in\nAdjacent hearts')
    expect(lines[7].translation).toBe("One step at a time\nI'm having trouble looking at you")
    expect(lines[3].translation).toBe('Hey, someday')
  })
})

describe('smartAttachSecondLanguage', () => {
  it('pairs dual-phrase Japanese lines without manual editing', async () => {
    const primary: TimedLine[] = [
      line('滑り込むキミの横 隣り合わせのハート', '', 1, 5),
    ]
    const secondary = 'Beside you as you slide in\nAdjacent hearts'
    const result = await smartAttachSecondLanguage(primary, secondary, async () => [])
    expect(result.method).toBe('slots')
    expect(result.mismatchedBlocks).toEqual([])
    expect(result.lines[0].translation).toBe('Beside you as you slide in\nAdjacent hearts')
  })
})

describe('latinHintScore', () => {
  it('scores identical English highly', () => {
    expect(latinHintScore('You always make me so happy', 'You always make me so happy')).toBe(1)
  })
})

describe('splitMixedScriptLine', () => {
  it('splits at the first Japanese character', () => {
    expect(splitMixedScriptLine('You always make me so happy 青空に溶けて')).toEqual({
      latin: 'You always make me so happy',
      japanese: '青空に溶けて',
    })
  })
})

describe('isMixedScriptLine', () => {
  it('detects English + Japanese on one line', () => {
    expect(isMixedScriptLine('You always make me so happy 青空に溶けて')).toBe(true)
  })
})

describe('mergeSlotTranslations', () => {
  it('joins multiple slot translations with newlines', () => {
    const originals = ['You always make me so happy 青空に溶けて']
    const slots = expandSlotsAdaptive(originals, 2)
    const merged = mergeSlotTranslations(1, slots, ['You always make me so happy', 'Melt into the blue sky'])
    expect(merged[0]).toBe('You always make me so happy\nMelt into the blue sky')
  })
})

describe('targetWordsForAlignment', () => {
  it('skips the duplicated Latin half for mixed-script lines', () => {
    const original = 'You always make me so happy 青空に溶けて'
    const translation = 'You always make me so happy\nMelt into the blue sky'
    expect(targetWordsForAlignment(original, translation)).toEqual([
      'Melt', 'into', 'the', 'blue', 'sky',
    ])
  })

  it('keeps all words for dual-phrase Japanese lines', () => {
    const original = '滑り込むキミの横 隣り合わせのハート'
    const translation = 'Beside you as you slide in\nAdjacent hearts'
    expect(targetWordsForAlignment(original, translation)).toEqual([
      'Beside', 'you', 'as', 'you', 'slide', 'in', 'Adjacent', 'hearts',
    ])
  })
})

describe('targetWordBaseOffset', () => {
  it('offsets past the duplicated Latin translation line on mixed-script lines', () => {
    const original = 'You always make me so happy 青空に溶けて'
    const translation = 'You always make me so happy\nMelt into the blue sky'
    expect(targetWordBaseOffset(original, translation)).toBe(6)
  })

  it('returns zero when the full translation is used for alignment', () => {
    const original = '滑り込むキミの横 隣り合わせのハート'
    const translation = 'Beside you as you slide in\nAdjacent hearts'
    expect(targetWordBaseOffset(original, translation)).toBe(0)
  })
})

describe('offsetTokenAlignmentIndices', () => {
  it('shifts stored indices into full-translation word coordinates', () => {
    const tokens = [
      { surface: '溶け', pos: '動詞', startIndex: 0, endIndex: 2, alignmentIndices: [0] },
      { surface: '青空', pos: '名詞', startIndex: 0, endIndex: 2, alignmentIndices: [4] },
    ]
    const shifted = offsetTokenAlignmentIndices(tokens, 6)
    expect(shifted[0].alignmentIndices).toEqual([6])
    expect(shifted[1].alignmentIndices).toEqual([10])
  })
})

describe('alignableEnglishTargetPool', () => {
  it('drops function words but keeps content words', () => {
    const pool = alignableEnglishTargetPool(['Only', 'one', 'step', 'behind'])
    expect(pool.words).toEqual(['only', 'one', 'step', 'behind'])
    expect(pool.indexMap).toEqual([0, 1, 2, 3])
  })

  it('filters the and as from a translation line', () => {
    const pool = alignableEnglishTargetPool(["I'm", 'the', 'same', 'as', 'always'])
    expect(pool.words).toEqual(['i', 'same', 'always'])
    expect(pool.indexMap).toEqual([0, 2, 4])
  })
})

describe('buildAlignmentSegments', () => {
  it('splits dual-phrase lines into per-translation-line segments', () => {
    const original = '一歩だけ遅れてる いつも通りのあたし'
    const translation = "Only one step behind\nI'm the same as always"
    const tokens = [
      { surface: '一', pos: '名詞', startIndex: 0, endIndex: 1 },
      { surface: '歩', pos: '名詞', startIndex: 1, endIndex: 2 },
      { surface: 'だけ', pos: '助詞', startIndex: 2, endIndex: 4 },
      { surface: '遅れ', pos: '動詞', startIndex: 4, endIndex: 6 },
      { surface: 'てる', pos: '動詞', startIndex: 6, endIndex: 8 },
      { surface: 'いつも', pos: '名詞', startIndex: 9, endIndex: 12 },
      { surface: '通り', pos: '名詞', startIndex: 12, endIndex: 14 },
      { surface: 'の', pos: '助詞', startIndex: 14, endIndex: 15 },
      { surface: 'あたし', pos: '名詞', startIndex: 15, endIndex: 18 },
    ]
    const segments = buildAlignmentSegments(original, translation, tokens)
    expect(segments).toHaveLength(2)
    expect(segments![0].alignTokenIndices).toEqual([0, 1, 2, 3, 4])
    expect(segments![1].alignTokenIndices).toEqual([5, 6, 7, 8])
    expect(segments![0].targetWords).toEqual(['only', 'one', 'step', 'behind'])
    expect(segments![1].targetWords).toEqual(['i', 'same', 'always'])
    expect(segments![1].targetIndexMap).toEqual([4, 6, 8])
  })
})

describe('japaneseTokenIndices', () => {
  it('limits mixed-script lines to the Japanese substring', () => {
    const original = 'You always make me so happy 青空に溶けて'
    const tokens = [
      { surface: 'You', pos: '名詞', startIndex: 0, endIndex: 3 },
      { surface: '青空', pos: '名詞', startIndex: 28, endIndex: 30 },
      { surface: 'に', pos: '助詞', startIndex: 30, endIndex: 31 },
      { surface: '溶け', pos: '動詞', startIndex: 31, endIndex: 33 },
      { surface: 'て', pos: '助詞', startIndex: 33, endIndex: 34 },
    ]
    expect(japaneseTokenIndices(original, tokens)).toEqual([1, 2, 3, 4])
  })
})

describe('alignmentIndicesAreValid', () => {
  it('rejects out-of-bounds translation indices', () => {
    const timed = line('君', 'you')
    timed.tokens = [{ surface: '君', pos: '名詞', startIndex: 0, endIndex: 1, alignmentIndices: [3] }]
    expect(alignmentIndicesAreValid(timed)).toBe(false)
  })

  it('rejects mixed-script Japanese tokens pointing into the duplicated Latin line', () => {
    const original = 'You always make me so happy 青空に溶けて'
    const translation = 'You always make me so happy\nMelt into the blue sky'
    const jaStart = original.indexOf('青空')
    const timed = line(original, translation)
    timed.tokens = [
      { surface: '青空', pos: '名詞', startIndex: jaStart, endIndex: jaStart + 2, alignmentIndices: [0] },
    ]
    expect(alignmentIndicesAreValid(timed)).toBe(false)
  })

  it('accepts indices mapped into the Japanese translation half', () => {
    const original = 'You always make me so happy 青空に溶けて'
    const translation = 'You always make me so happy\nMelt into the blue sky'
    const jaStart = original.indexOf('青空')
    const timed = line(original, translation)
    timed.tokens = [
      { surface: '青空', pos: '名詞', startIndex: jaStart, endIndex: jaStart + 2, alignmentIndices: [10] },
      { surface: '溶け', pos: '動詞', startIndex: jaStart + 3, endIndex: jaStart + 5, alignmentIndices: [6] },
    ]
    expect(alignmentIndicesAreValid(timed)).toBe(true)
  })

  it('rejects dual-phrase tokens pointing across segment boundaries', () => {
    const original = '一歩だけ遅れてる いつも通りのあたし'
    const translation = "Only one step behind\nI'm the same as always"
    const timed = line(original, translation)
    timed.tokens = [
      { surface: 'いつも', pos: '名詞', startIndex: 9, endIndex: 12, alignmentIndices: [0] },
    ]
    expect(alignmentIndicesAreValid(timed)).toBe(false)
  })
})

describe('buildAlignJob', () => {
  it('maps filtered English targets back to full-translation indices', () => {
    const original = 'You always make me so happy 青空に溶けて'
    const translation = 'You always make me so happy\nMelt into the blue sky'
    const timed = line(original, translation)
    timed.tokens = [{ surface: '青空', pos: '名詞', startIndex: 0, endIndex: 2 }]
    const job = buildAlignJob(timed)
    expect(job.targetIndexMap).toEqual([6, 9, 10])
    expect(job.targetWords).toEqual(['melt', 'blue', 'sky'])
  })

  it('uses per-line segments for dual-phrase Japanese lines', () => {
    const original = '一歩だけ遅れてる いつも通りのあたし'
    const translation = "Only one step behind\nI'm the same as always"
    const timed = line(original, translation)
    timed.tokens = [{ surface: '一', pos: '名詞', startIndex: 0, endIndex: 1 }]
    const job = buildAlignJob(timed)
    expect(job.segments).toHaveLength(2)
    expect(job.segments![1].targetIndexMap).toEqual([4, 6, 8])
  })
})

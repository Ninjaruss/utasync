import { describe, it, expect, vi } from 'vitest'
import {
  isMixedScriptLine,
  splitMixedScriptLine,
  splitDualPhraseJapanese,
  expandSlotsAdaptive,
  mergeSlotTranslations,
  pairTranslationsToPrimary,
  latinHintScore,
  smartAttachSecondLanguage,
  indexPairingLooksValid,
  DEFAULT_MAX_SEMANTIC_LINES,
  targetWordsForAlignment,
  japaneseTokenIndices,
  targetWordBaseOffset,
  offsetTokenAlignmentIndices,
  buildAlignmentSegments,
  alignableEnglishTargetPool,
  alignmentIndicesAreValid,
  buildAlignJob,
  isRepetitionOnlyLine,
  trimTranslationForRepetitionLine,
  autoAlignLines,
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

describe('indexPairingLooksValid', () => {
  it('rejects pure Japanese originals paired with English by index', () => {
    expect(indexPairingLooksValid(
      ['出来れば世界を僕は塗り変えたい', 'ローリング ローリング'],
      ["If possible, I'd like to repaint the world", 'Rolling, rolling'],
    )).toBe(false)
  })

  it('accepts mixed-script lines when the Latin half echoes in translation', () => {
    expect(indexPairingLooksValid(
      ['You always make me so happy 青空に溶けて'],
      ['You always make me so happy'],
    )).toBe(true)
  })
})

describe('smartAttachSecondLanguage — timed union merge', () => {
  it('union-merges instead of flagging mismatch when translation line count differs', async () => {
    const primary: TimedLine[] = [
      line('君の瞳', '', 1, 3),
      line('夜の中', '', 3, 5),
    ]
    const result = await smartAttachSecondLanguage(primary, 'Only one line', async () => [])
    expect(result.mismatchedBlocks).toEqual([])
    expect(result.method).toBe('timeline')
    expect(result.lines.filter((l) => l.translation === 'Only one line')).toHaveLength(1)
    expect(result.lines.some((l) => l.original === '君の瞳')).toBe(true)
  })

  it('keeps one row per primary line when counts match after semantic pairing', async () => {
    const primary: TimedLine[] = [
      line('君の瞳', '', 1, 3),
      line('夜の中', '', 3, 5),
    ]
    const result = await smartAttachSecondLanguage(primary, 'Your eyes\nIn the night', async () => [])
    expect(result.lines).toHaveLength(2)
    expect(result.lines.map((l) => l.translation)).toEqual(['Your eyes', 'In the night'])
  })
})

describe('smartAttachSecondLanguage — AKFG excerpt', () => {
  const primary: TimedLine[] = [
    line('転がる岩、君に朝が降る'),
    line(''),
    line('出来れば世界を僕は塗り変えたい'),
    line('戦争をなくすような大逸れたことじゃない'),
    line('ローリング ローリング'),
    line('初めから持ってないのに胸が痛んだ 僕らはきっとこの先も'),
  ]

  const english = [
    "If possible, I'd like to repaint the world",
    "It's nothing outrageous like ending wars",
    'Rolling, rolling',
    "Even though I never had it from the start, my chest hurt — we'll surely continue on",
  ]

  const vec = (id: number): number[] => {
    const v = new Array(8).fill(0)
    v[id % 8] = 1
    return v
  }

  const embedMap: Record<string, number> = {
    '転がる岩、君に朝が降る': 0,
    '出来れば世界を僕は塗り変えたい': 1,
    '戦争をなくすような大逸れたことじゃない': 2,
    'ローリング ローリング': 3,
    '初めから持ってないのに胸が痛んだ 僕らはきっとこの先も': 4,
    "If possible, I'd like to repaint the world": 1,
    "It's nothing outrageous like ending wars": 2,
    'Rolling, rolling': 3,
    "Even though I never had it from the start, my chest hurt — we'll surely continue on": 4,
  }

  const embedFn = async (texts: string[]) =>
    texts.map((t) => vec(embedMap[t.trim()] ?? 7))

  it('semantically pairs lines instead of attaching the whole song to the title row', async () => {
    const secondary = english.join('\n')
    const result = await smartAttachSecondLanguage(primary, secondary, embedFn)
    expect(result.method).toBe('semantic')
    expect(result.mismatchedBlocks).toEqual([])
    expect(result.lines[0].translation).toBe('')
    expect(result.lines[2].translation).toBe("If possible, I'd like to repaint the world")
    expect(result.lines[4].translation).toBe('Rolling, rolling')
  })

  it('does not assign translations to blank primary rows during semantic alignment', async () => {
    const secondary = english.join('\n')
    const result = await smartAttachSecondLanguage(primary, secondary, embedFn)
    expect(result.lines[1].original).toBe('')
    expect(result.lines[1].translation).toBe('')
    expect(result.lines[2].translation).toBe("If possible, I'd like to repaint the world")
  })

  it('does not use naive index pairing when JA and EN line counts match but content is offset', () => {
    const originals = primary.map((l) => l.original)
    const paddedEnglish = ['Rock and roll morning light falls on you', ...english]
    const { method } = pairTranslationsToPrimary(primary, paddedEnglish)
    expect(method).not.toBe('index')
  })

  it('does not use index pairing when counts match but primary has blank rows', () => {
    const withBlank: TimedLine[] = [
      line(''),
      line('出来れば世界を僕は塗り変えたい'),
      line('ローリング ローリング'),
    ]
    const trans = [
      "If possible, I'd like to repaint the world",
      'Rolling, rolling',
    ]
    const { method, lines } = pairTranslationsToPrimary(withBlank, trans)
    expect(method).not.toBe('index')
    expect(lines[0].translation).toBe('')
  })

  it('smartAttach defers blind plain-slot pairing to semantic alignment', async () => {
    // 5 pure-JA non-empty lines + 5 English lines = plain 1:1 slots with no
    // mixed/dual-phrase structure. Must run semantic, not blind slot pairing.
    const offsetEnglish = ['Rock and roll morning light falls on you', ...english.slice(0, 4)]
    const embedFn = vi.fn(async (texts: string[]) => texts.map(() => new Array(4).fill(0)))
    const result = await smartAttachSecondLanguage(primary, offsetEnglish.join('\n'), embedFn)
    expect(result.method).toBe('semantic')
    expect(embedFn).toHaveBeenCalled()
  })

  it('preferFast skips semantic alignment and uses index fallback when counts match', async () => {
    const equalPrimary = english.map((t) => line(t))
    const embedFn = vi.fn(async () => [])
    const result = await smartAttachSecondLanguage(equalPrimary, english.join('\n'), embedFn, {
      preferFast: true,
    })
    expect(embedFn).not.toHaveBeenCalled()
    expect(result.method).toBe('index')
    expect(result.mismatchedBlocks).toEqual([])
  })

  it('preferFast returns mismatch for count-offset AKFG-style lyrics without embedding', async () => {
    const embedFn = vi.fn(async () => [])
    const result = await smartAttachSecondLanguage(primary, english.join('\n'), embedFn, {
      preferFast: true,
    })
    expect(embedFn).not.toHaveBeenCalled()
    expect(result.method).toBe('mismatch')
    expect(result.mismatchedBlocks).toEqual([0])
  })
})

describe('smartAttachSecondLanguage — semantic guards', () => {
  it('skips embedding when line budget exceeds maxSemanticLines', async () => {
    const primary = Array.from({ length: 30 }, (_, i) => line(`行${i}`))
    const secondary = Array.from({ length: 20 }, (_, i) => `Line ${i}`).join('\n')
    const embedFn = vi.fn(async () => [])
    const result = await smartAttachSecondLanguage(primary, secondary, embedFn, {
      maxSemanticLines: 40,
    })
    expect(embedFn).not.toHaveBeenCalled()
    expect(result.method).toBe('mismatch')
  })

  it('runs semantic alignment for full-song line counts under the default budget', async () => {
    const primary = Array.from({ length: 30 }, (_, i) => line(`行${i}`))
    const secondary = Array.from({ length: 20 }, (_, i) => `Line ${i}`).join('\n')
    const embedFn = vi.fn(async (texts: string[]) => texts.map(() => new Array(4).fill(0)))
    await smartAttachSecondLanguage(primary, secondary, embedFn, {
      maxSemanticLines: DEFAULT_MAX_SEMANTIC_LINES,
    })
    expect(embedFn).toHaveBeenCalled()
  })

  it('falls back when semantic alignment exceeds timeout', async () => {
    const primary: TimedLine[] = [
      line('転がる岩、君に朝が降る'),
      line(''),
      line('出来れば世界を僕は塗り変えたい'),
      line('ローリング ローリング'),
    ]
    const secondary = [
      "If possible, I'd like to repaint the world",
      'Rolling, rolling',
    ].join('\n')
    const slowEmbed = vi.fn(
      () => new Promise<number[][]>((resolve) => setTimeout(() => resolve([]), 500)),
    )
    const result = await smartAttachSecondLanguage(primary, secondary, slowEmbed, {
      semanticTimeoutMs: 30,
    })
    expect(slowEmbed).toHaveBeenCalled()
    expect(result.method).toBe('mismatch')
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

  it('accepts an attempted alignment with no pairs (empty index arrays)', () => {
    const timed = line('謎', 'mystery')
    timed.tokens = [{ surface: '謎', pos: '名詞', startIndex: 0, endIndex: 1, alignmentIndices: [] }]
    expect(alignmentIndicesAreValid(timed)).toBe(true)
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

describe('trimTranslationForRepetitionLine', () => {
  it('detects repetition-only Japanese lines', () => {
    expect(isRepetitionOnlyLine('ローリング ローリング')).toBe(true)
    expect(isRepetitionOnlyLine('心絡まって ローリング ローリング')).toBe(false)
  })

  it('keeps only the repeated English tail for chorus rows', () => {
    expect(trimTranslationForRepetitionLine(
      'ローリング ローリング',
      "I don't understand, rolling, rolling",
    )).toBe('rolling, rolling')
  })
})

describe('autoAlignLines — adjacent EN merge', () => {
  const vec = (id: number): number[] => {
    const v = new Array(8).fill(0)
    v[id % 8] = 1
    return v
  }

  it('merges two short English lines onto one long Japanese line', async () => {
    const originals = [
      '岩は転がって 僕たちを何処かに連れて行くように ように',
      '凍てつく世界を転がるように走り出した',
    ]
    const translations = [
      'The rocks roll us',
      'As if taking us somewhere',
      'We started running as if rolling on the freezing world',
    ]
    const embedMap: Record<string, number> = {
      [originals[0]]: 0,
      [originals[1]]: 1,
      [translations[0]]: 2,
      [translations[1]]: 3,
      [translations[2]]: 1,
      [`${translations[0]}\n${translations[1]}`]: 0,
    }
    const embedFn = async (texts: string[]) => texts.map((t) => vec(embedMap[t.trim()] ?? 7))
    const { aligned, extras } = await autoAlignLines(originals, translations, embedFn)
    expect(aligned[0]).toBe('The rocks roll us\nAs if taking us somewhere')
    expect(aligned[1]).toBe('We started running as if rolling on the freezing world')
    expect(extras).toEqual([])
  })
})

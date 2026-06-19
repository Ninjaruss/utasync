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

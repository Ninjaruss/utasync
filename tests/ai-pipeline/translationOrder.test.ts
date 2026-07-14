import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import kuromoji, { type Tokenizer } from 'kuromoji'
import type { TimedLine, Token } from '../../src/core/types'
import { adjacentTranslationsSwapped, fixAdjacentTranslationOrder } from '../../src/ai-pipeline/translationOrder'
import { buildAlignJob, buildAlignJobs } from '../../src/lyrics/lineAligner'
import { setJmdictGlossForTests } from '../../src/ai-pipeline/jmdictGloss'
import { applyReadingCorrections } from '../../src/language/japanese/readingCorrections'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = join(here, '../..')

function tok(surface: string, reading: string, pos = '名詞'): Token {
  return {
    surface,
    reading,
    pos,
    startIndex: 0,
    endIndex: surface.length,
  }
}

describe('adjacentTranslationsSwapped', () => {
  it('detects Veil-style clause swap on lines 20–21', () => {
    const line0: TimedLine = {
      startTime: 0,
      endTime: 1,
      original: '触れない思いの色なんて',
      translation: "I didn't want to know",
      tokens: [
        tok('触れ', 'フレ', '動詞'),
        tok('ない', 'ナイ', '助動詞'),
        tok('思い', 'オモイ'),
        tok('の', 'ノ', '助詞'),
        tok('色', 'イロ'),
        tok('なんて', 'ナンテ'),
      ],
    }
    const line1: TimedLine = {
      startTime: 1,
      endTime: 2,
      original: '知りたくはないと思っていた',
      translation: 'the color of untouchable memories',
      tokens: [
        tok('知り', 'シリ', '動詞'),
        tok('たく', 'タク', '助動詞'),
        tok('は', 'ハ', '助詞'),
        tok('ない', 'ナイ', '形容詞'),
        tok('と', 'ト', '助詞'),
        tok('思っ', 'オモッ', '動詞'),
        tok('て', 'テ', '助動詞'),
        tok('いた', 'イタ', '動詞'),
      ],
    }
    expect(adjacentTranslationsSwapped(line0, line1)).toBe(true)
  })

  it('does not flag correctly ordered translations', () => {
    const line0: TimedLine = {
      startTime: 0,
      endTime: 1,
      original: '熱を持つ夜に変わっていく',
      translation: 'The heat-bearing night will still arrive',
      tokens: [tok('熱', 'ネツ'), tok('夜', 'ヨル')],
    }
    const line1: TimedLine = {
      startTime: 1,
      endTime: 2,
      original: 'この手が離れても',
      translation: 'Even if this hand is released',
      tokens: [tok('手', 'テ'), tok('離れ', 'ハナレ', '動詞')],
    }
    expect(adjacentTranslationsSwapped(line0, line1)).toBe(false)
  })
})

describe('fixAdjacentTranslationOrder', () => {
  it('swaps EN text on inverted adjacent rows (Veil lines 20–21)', () => {
    const lines: TimedLine[] = [
      {
        startTime: 0,
        endTime: 1,
        original: '触れない思いの色なんて',
        translation: "I didn't want to know",
        tokens: [tok('色', 'イロ'), tok('思い', 'オモイ')],
      },
      {
        startTime: 1,
        endTime: 2,
        original: '知りたくはないと思っていた',
        translation: 'the color of untouchable memories',
        tokens: [tok('知り', 'シリ', '動詞')],
      },
    ]
    const fixed = fixAdjacentTranslationOrder(lines)
    expect(fixed[0].translation).toBe('the color of untouchable memories')
    expect(fixed[1].translation).toBe("I didn't want to know")
    expect(adjacentTranslationsSwapped(fixed[0], fixed[1])).toBe(false)
  })

  it('leaves correctly ordered lines unchanged', () => {
    const lines: TimedLine[] = [
      {
        startTime: 0,
        endTime: 1,
        original: '熱を持つ夜に変わっていく',
        translation: 'The heat-bearing night will still arrive',
        tokens: [tok('熱', 'ネツ')],
      },
      {
        startTime: 1,
        endTime: 2,
        original: 'この手が離れても',
        translation: 'Even if this hand is released',
        tokens: [tok('手', 'テ')],
      },
    ]
    const fixed = fixAdjacentTranslationOrder(lines)
    expect(fixed[0].translation).toBe(lines[0].translation)
    expect(fixed[1].translation).toBe(lines[1].translation)
  })
})

// Round-5 CLASS-P1: with real tokens + full JMdict glosses, a single spurious
// gloss hit on ONE side (状態→"want") must not swap a correctly ordered pair
// whose direct affinity is zero. Uses the committed guitar-loneliness fixtures
// and the same tokenization as the production pipeline / audit-corpus.mjs.
describe('adjacentTranslationsSwapped — real tokens + JMdict (guitar-loneliness rows 43/44)', () => {
  let tokenizer: Tokenizer

  beforeAll(async () => {
    setJmdictGlossForTests(JSON.parse(readFileSync(join(ROOT, 'public/jmdict-gloss.json'), 'utf8')))
    tokenizer = await new Promise((resolve, reject) => {
      kuromoji.builder({ dicPath: join(ROOT, 'public/dict') }).build((err, t) => (err ? reject(err) : resolve(t!)))
    })
  }, 60_000)

  function tokenizeJa(text: string) {
    let index = 0
    const tokens = tokenizer.tokenize(text).map((t) => {
      const startIndex = index
      index += t.surface_form.length
      return {
        surface: t.surface_form,
        reading: t.reading,
        pos: t.pos,
        posDetail1: t.pos_detail_1 && t.pos_detail_1 !== '*' ? t.pos_detail_1 : undefined,
        startIndex,
        endIndex: index,
      }
    })
    return applyReadingCorrections(tokens)
  }

  function fixtureLine(jaRows: string[], enRows: string[], row: number): TimedLine {
    // row is the 1-indexed fixture line number
    return {
      startTime: row,
      endTime: row + 1,
      original: jaRows[row - 1]!,
      translation: enRows[row - 1]!,
      tokens: tokenizeJa(jaRows[row - 1]!),
    }
  }

  it('does not swap the correctly attached 2nd-chorus pair (one-sided spurious gloss hit)', () => {
    const jaRows = readFileSync(join(here, 'fixtures/guitar-loneliness/lyrics.ja.txt'), 'utf8')
      .trim()
      .split('\n')
    const enRows = readFileSync(join(here, 'fixtures/guitar-loneliness/lyrics.en.txt'), 'utf8')
      .trim()
      .split('\n')
    const line0 = fixtureLine(jaRows, enRows, 43) // 出せない状態で叫んだよ
    const line1 = fixtureLine(jaRows, enRows, 44) // なんかになりたい
    expect(line0.original).toBe('出せない状態で叫んだよ')
    expect(line1.original).toBe('なんかになりたい')

    expect(adjacentTranslationsSwapped(line0, line1)).toBe(false)

    const fixed = fixAdjacentTranslationOrder([line0, line1])
    expect(fixed[0].translation).toBe(enRows[42])
    expect(fixed[1].translation).toBe(enRows[43])
  })

  it('still detects the Veil clause swap with real tokens + JMdict (true positive)', () => {
    const line0: TimedLine = {
      startTime: 0,
      endTime: 1,
      original: '触れない思いの色なんて',
      translation: "I didn't want to know",
      tokens: tokenizeJa('触れない思いの色なんて'),
    }
    const line1: TimedLine = {
      startTime: 1,
      endTime: 2,
      original: '知りたくはないと思っていた',
      translation: 'the color of untouchable memories',
      tokens: tokenizeJa('知りたくはないと思っていた'),
    }
    expect(adjacentTranslationsSwapped(line0, line1)).toBe(true)
  })
})

describe('buildAlignJobs', () => {
  it('builds per-line jobs after translation order is corrected', () => {
    const lines = fixAdjacentTranslationOrder([
      {
        startTime: 0,
        endTime: 1,
        original: '触れない思いの色なんて',
        translation: "I didn't want to know",
        tokens: [tok('色', 'イロ'), tok('思い', 'オモイ')],
      },
      {
        startTime: 1,
        endTime: 2,
        original: '知りたくはないと思っていた',
        translation: 'the color of untouchable memories',
        tokens: [tok('知り', 'シリ', '動詞')],
      },
    ])
    const [job0, job1] = buildAlignJobs(lines)
    expect(job0.targetWords).toContain('color')
    expect(job0.targetWords).toContain('memories')
    expect(job1.targetWords.some((w) => w === 'know' || w === 'want')).toBe(true)
  })

  it('maps chunk indices to the corresponding lines', () => {
    const lines: TimedLine[] = Array.from({ length: 3 }, (_, i) => ({
      startTime: i,
      endTime: i + 1,
      original: `行${i}`,
      translation: `line ${i}`,
      tokens: [tok('行', 'ギョウ')],
    }))
    const jobs = buildAlignJobs(lines, [1])
    expect(jobs).toHaveLength(1)
    expect(jobs[0].targetWords).toEqual(buildAlignJob(lines[1]).targetWords)
  })
})

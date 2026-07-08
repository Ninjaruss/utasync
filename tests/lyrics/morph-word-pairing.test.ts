import { describe, it, expect } from 'vitest'
import { alignLineTokens, alignLinesTokens, buildAlignmentUnits } from '../../src/ai-pipeline/wordAligner'
import { buildAlignJob } from '../../src/lyrics/lineAligner'
import { splitTranslationWords } from '../../src/language/wordColors'
import type { Token } from '../../src/core/types'

const glossEmbed = async (texts: string[]): Promise<number[][]> =>
  texts.map(() => [0.12, 0.12, 0.12, 0.12])

const tok = (
  surface: string,
  pos: string,
  reading?: string,
  posDetail1?: string,
  startIndex = 0,
): Token => ({
  surface,
  pos,
  reading,
  posDetail1,
  startIndex,
  endIndex: startIndex + surface.length,
})

function wordIndex(translation: string, word: string): number {
  return splitTranslationWords(translation).indexOf(word)
}

describe('morphological word pairing (general rules)', () => {
  it('merges verb+past and keeps content words as separate units', () => {
    const tokens: Token[] = [
      tok('宙', '名詞,一般,*,*,*,*,*', 'チュウ', undefined, 0),
      tok('に', '助詞,格助詞,*,*,*,*,*', 'ニ', undefined, 1),
      tok('舞っ', '動詞,自立,*,*,*,*,*', 'マッ', undefined, 2),
      tok('た', '助動詞,*,*,*,*,*,*', 'タ', undefined, 4),
      tok('言葉', '名詞,一般,*,*,*,*,*', 'コトバ', undefined, 5),
    ]
    const units = buildAlignmentUnits(tokens)
    expect(units.map((u) => u.embedText)).toEqual(['宙', '舞った', '言葉'])
  })

  it('pairs sky/motion vocabulary on a mid-air line', async () => {
    const tokens: Token[] = [
      tok('宙', '名詞,一般,*,*,*,*,*', 'チュウ'),
      tok('に', '助詞,格助詞,*,*,*,*,*', 'ニ'),
      tok('舞っ', '動詞,自立,*,*,*,*,*', 'マッ'),
      tok('た', '助動詞,*,*,*,*,*,*', 'タ'),
      tok('言葉', '名詞,一般,*,*,*,*,*', 'コトバ'),
    ]
    const translation = 'The words dancing in mid-air'
    const result = await alignLineTokens(tokens, splitTranslationWords(translation), glossEmbed)
    expect(result[0].alignmentIndices).toEqual([wordIndex(translation, 'mid-air')])
    expect(result[2].alignmentIndices).toEqual([wordIndex(translation, 'dancing')])
    expect(result[4].alignmentIndices).toEqual([wordIndex(translation, 'words')])
  })

  it('merges concessive and te-auxiliary morphology on any adjective/verb stem', () => {
    const tokens: Token[] = [
      tok('どんなに', '副詞,一般,*,*,*,*,*', 'ドンナニ'),
      tok('冷たく', '形容詞,自立,*,*,*,*,*', 'ツメタク'),
      tok('たっ', '動詞,自立,*,*,*,*,*', 'タッ'),
      tok('て', '助詞,接続助詞,*,*,*,*,*', 'テ'),
      tok('愛し', '動詞,自立,*,*,*,*,*', 'アイシ'),
      tok('て', '助詞,接続助詞,*,*,*,*,*', 'テ'),
      tok('みせる', '動詞,非自立,*,*,*,*,*', 'ミセル'),
    ]
    expect(buildAlignmentUnits(tokens).map((u) => u.embedText)).toEqual([
      'どんなに',
      '冷たくたって',
      '愛してみせる',
    ])
  })

  it('pairs degree adverbs and merged morphology on a different English line', async () => {
    const tokens: Token[] = [
      tok('どんなに', '副詞,一般,*,*,*,*,*', 'ドンナニ'),
      tok('暑く', '形容詞,自立,*,*,*,*,*', 'アツク'),
      tok('たっ', '動詞,自立,*,*,*,*,*', 'タッ'),
      tok('て', '助詞,接続助詞,*,*,*,*,*', 'テ'),
      tok('書い', '動詞,自立,*,*,*,*,*', 'カイ'),
      tok('て', '助詞,接続助詞,*,*,*,*,*', 'テ'),
      tok('みせる', '動詞,非自立,*,*,*,*,*', 'ミセル'),
    ]
    const translation = 'No matter how hot it gets I will show you'
    const result = await alignLineTokens(tokens, splitTranslationWords(translation), glossEmbed)
    expect(result[0].alignmentIndices).toEqual([wordIndex(translation, 'matter')])
    // 暑くたって prefers the stem's content gloss (hot, 1.0) over the たって
    // suffix's function gloss (gets, MORPH_GLOSS_SCORE).
    expect(result[1].alignmentIndices).toEqual([wordIndex(translation, 'hot')])
    expect(result[4].alignmentIndices).toEqual([wordIndex(translation, 'show')])
  })

  it('merges negative te on a different verb and pairs connective のに', async () => {
    const tokens: Token[] = [
      tok('彼', '名詞,代名詞,*,*,*,*,*', 'カレ'),
      tok('が', '助詞,格助詞,*,*,*,*,*', 'ガ'),
      tok('知ら', '動詞,自立,*,*,*,*,*', 'シラ'),
      tok('なく', '助動詞,*,*,*,*,*,*', 'ナク'),
      tok('て', '助詞,接続助詞,*,*,*,*,*', 'テ'),
      tok('も', '助詞,係助詞,*,*,*,*,*', 'モ'),
      tok('のに', '助詞,接続助詞,*,*,*,*,*', 'ノニ'),
    ]
    const translation = 'Even though he did not know'
    const result = await alignLineTokens(tokens, splitTranslationWords(translation), glossEmbed)
    const words = splitTranslationWords(translation)
    expect(result[2].alignmentIndices).toEqual([words.indexOf('not')])
    expect(result[6].alignmentIndices).toEqual([words.indexOf('though')])
  })

  it('merges negative potential 触れない via morph span', () => {
    const tokens: Token[] = [
      tok('触れ', '動詞,自立,*,*,*,*,*', 'フレ', undefined, 0),
      tok('ない', '助動詞,*,*,*,*,*,*', 'ナイ', undefined, 2),
      tok('思い', '名詞,一般,*,*,*,*,*', 'オモイ', undefined, 4),
      tok('色', '名詞,一般,*,*,*,*,*', 'イロ', undefined, 7),
    ]
    expect(buildAlignmentUnits(tokens).map((u) => u.embedText)).toEqual(['触れない', '思い', '色'])
  })

  it('merges negative desire 知りたくはない and pairs know via gloss', async () => {
    const tokens: Token[] = [
      tok('知り', '動詞,自立,*,*,*,*,*', 'シリ', undefined, 0),
      tok('たく', '助動詞,*,*,*,*,*,*', 'タク', undefined, 2),
      tok('は', '助詞,係助詞,*,*,*,*,*', 'ハ', undefined, 4),
      tok('ない', '形容詞,自立,*,*,*,*,*', 'ナイ', undefined, 5),
      tok('と', '助詞,格助詞,*,*,*,*,*', 'ト', undefined, 7),
      tok('思っ', '動詞,自立,*,*,*,*,*', 'オモッ', undefined, 8),
      tok('て', '助詞,接続助詞,*,*,*,*,*', 'テ', undefined, 10),
      tok('い', '動詞,非自立,*,*,*,*,*', 'イ', undefined, 11),
      tok('た', '助動詞,*,*,*,*,*,*', 'タ', undefined, 12),
    ]
    expect(buildAlignmentUnits(tokens).map((u) => u.embedText)).toEqual([
      '思っていた',
      '知りたくはない',
    ])
    const translation = "I didn't want to know"
    const line = { original: '知りたくはないと思っていた', translation, tokens, startTime: 0, endTime: 1 }
    const [result] = await alignLinesTokens([buildAlignJob(line)], glossEmbed)
    const words = splitTranslationWords(translation)
    expect(words[result[0].alignmentIndices![0]]).toBe('know')
    const thinkWord = words[result[5].alignmentIndices![0]]
    expect(['know', 'want']).toContain(thinkWord)
  })

  it('pairs untouchable memories on Veil color line via gloss', async () => {
    const tokens: Token[] = [
      tok('触れ', '動詞,自立,*,*,*,*,*', 'フレ', undefined, 0),
      tok('ない', '助動詞,*,*,*,*,*,*', 'ナイ', undefined, 2),
      tok('思い', '名詞,一般,*,*,*,*,*', 'オモイ', undefined, 4),
      tok('色', '名詞,一般,*,*,*,*,*', 'イロ', undefined, 7),
    ]
    const translation = 'the color of untouchable memories'
    const result = await alignLineTokens(tokens, splitTranslationWords(translation), glossEmbed)
    expect(result[0].alignmentIndices).toEqual([wordIndex(translation, 'untouchable')])
    expect(result[2].alignmentIndices).toEqual([wordIndex(translation, 'memories')])
    expect(result[3].alignmentIndices).toEqual([wordIndex(translation, 'color')])
  })
})

import { describe, it, expect } from 'vitest'
import { smartAttachSecondLanguage, buildAlignJob } from '../../src/lyrics/lineAligner'
import { alignLineTokens, alignLinesTokens } from '../../src/ai-pipeline/wordAligner'
import { splitTranslationWords } from '../../src/language/wordColors'
import type { Token } from '../../src/core/types'
import {
  AKFG_EN_BLOCK,
  akfgEmbed,
  buildAkfgPrimaryTimed,
  rowForJa,
  rowsForEn,
} from './fixtures/akfg-korogaru'

const tok = (
  surface: string,
  pos = '名詞',
  reading?: string,
  startIndex?: number,
  endIndex?: number,
): Token => ({
  surface,
  pos,
  reading,
  startIndex: startIndex ?? 0,
  endIndex: endIndex ?? surface.length,
})

const glossEmbed = async (texts: string[]): Promise<number[][]> =>
  texts.map(() => [0.15, 0.15, 0.15, 0.15])

function pairedWords(line: { tokens?: Token[]; translation?: string }) {
  if (!line.tokens?.length || !line.translation) return []
  const words = splitTranslationWords(line.translation)
  return line.tokens
    .filter((t) => t.alignmentIndices?.length)
    .map((t) => ({
      ja: t.surface,
      en: words[t.alignmentIndices![0]] ?? '?',
      idx: t.alignmentIndices![0],
    }))
}

describe('AKFG Korogaru Iwa — line pairing (user paste)', () => {
  const primary = buildAkfgPrimaryTimed()

  it('semantically pairs opening, chorus, and rock-bridge lines (not blind index)', async () => {
    const result = await smartAttachSecondLanguage(primary, AKFG_EN_BLOCK, akfgEmbed)
    expect(result.mismatchedBlocks).toEqual([])
    expect(['semantic', 'slots', 'timeline', 'index']).toContain(result.method)

    const world = rowForJa(result.lines, '世界を僕は塗り')
    expect(world?.translation.toLowerCase()).toMatch(/repaint the world/)

    const wars = rowForJa(result.lines, '戦争をなくす')
    expect(wars?.translation.toLowerCase()).toMatch(/eliminating wars/)

    const rolling1 = rowForJa(result.lines, 'ローリング ローリング')
    expect(rolling1?.translation.toLowerCase()).toMatch(/rolling/)

    const rocks = rowForJa(result.lines, '岩は転が')
    expect(rocks?.translation.toLowerCase()).toMatch(/rocks roll/)

    const morning = rowForJa(result.lines, '君の孤独')
    expect(morning?.translation.toLowerCase()).toMatch(/loneliness|morning/)

    const endRun = rowForJa(result.lines, '凍てつく世界を転が')
    expect(endRun?.translation.toLowerCase()).toMatch(/freezing world/)

    expect(world?.translation.toLowerCase()).not.toMatch(/eliminating wars/)
  })

  it('does not duplicate the same English chorus on every Japanese row', async () => {
    const result = await smartAttachSecondLanguage(primary, AKFG_EN_BLOCK, akfgEmbed)
    const rollingRows = rowsForEn(result.lines, 'rolling, rolling')
    expect(rollingRows.length).toBeLessThan(8)
  })

  it('maps both chorus passes to rolling lines', async () => {
    const result = await smartAttachSecondLanguage(primary, AKFG_EN_BLOCK, akfgEmbed)
    const jaRolling = result.lines.filter((l) => l.original.trim() === 'ローリング ローリング')
    expect(jaRolling.length).toBe(2)
    for (const row of jaRolling) {
      expect(row.translation.toLowerCase()).toMatch(/rolling/)
      expect(row.translation.toLowerCase()).not.toMatch(/understand/)
    }
  })
})

describe('AKFG Korogaru Iwa — word pairing (user paste)', () => {
  it('pairs 世界→world and 塗り→repaint on the opening line', async () => {
    const tokens: Token[] = [
      tok('出来', '副詞', 'デキ', 0, 2),
      tok('れ', '非自立', 'レ', 2, 3),
      tok('ば', '助詞', 'バ', 3, 4),
      tok('世界', '名詞', 'セカイ', 4, 6),
      tok('を', '助詞', 'ヲ', 6, 7),
      tok('僕', '名詞', 'ボク', 7, 8),
      tok('は', '助詞', 'ハ', 8, 9),
      tok('塗り', '動詞', 'ヌリ', 9, 11),
      tok('変え', '動詞', 'カエ', 11, 13),
      tok('たい', '助詞', 'タイ', 13, 15),
    ]
    const targetWords = ['If', 'possible', 'I', 'want', 'to', 'repaint', 'the', 'world']
    const result = await alignLineTokens(tokens, targetWords, glossEmbed)
    const worldIdx = targetWords.findIndex((w) => w.toLowerCase() === 'world')
    const repaintIdx = targetWords.findIndex((w) => w.toLowerCase() === 'repaint')
    expect(result.find((t) => t.surface === '世界')?.alignmentIndices).toEqual([worldIdx])
    expect(result.find((t) => t.surface === '塗り')?.alignmentIndices?.[0]).toBe(repaintIdx)
  })

  it('pairs ローリング→rolling on chorus line', async () => {
    const tokens: Token[] = [
      tok('ローリング', '名詞', 'ローリング', 0, 5),
      tok('ローリング', '名詞', 'ローリング', 6, 11),
    ]
    const targetWords = ["I", "don't", 'understand', 'rolling', 'rolling']
    const result = await alignLineTokens(tokens, targetWords, glossEmbed)
    const aligned = result.filter((t) => t.alignmentIndices?.length)
    expect(aligned.length).toBeGreaterThanOrEqual(1)
    for (const t of aligned) {
      expect(t.alignmentIndices!.every((i) => targetWords[i]?.toLowerCase() === 'rolling')).toBe(true)
    }
  })

  it('pairs 岩 on the rock-bridge line', async () => {
    const original = '岩は転がって 僕たちを何処かに連れて行くように ように'
    const translation = 'The rocks roll us\nAs if taking us somewhere'
    const tokens: Token[] = [
      tok('岩', '名詞', 'イワ', 0, 1),
      tok('は', '助詞', 'ハ', 1, 2),
      tok('転が', '動詞', 'コロガ', 2, 4),
      tok('って', '助詞', 'ッテ', 4, 6),
    ]
    const line = { startTime: 0, endTime: 1, original, translation, tokens }
    const job = buildAlignJob(line)
    const [result] = await alignLinesTokens([job], glossEmbed)
    const words = splitTranslationWords(translation)
    const iwa = result.find((t) => t.surface === '岩')
    expect(iwa?.alignmentIndices?.length).toBeGreaterThan(0)
    expect(['rocks', 'roll', 'us'].includes(words[iwa!.alignmentIndices![0]]?.toLowerCase())).toBe(true)
  })

  it('pairs 胸→heart and 痛→ached on heartache line', async () => {
    const tokens: Token[] = [
      tok('胸', '名詞', 'ムネ', 11, 12),
      tok('が', '助詞', 'ガ', 12, 13),
      tok('痛ん', '動詞', 'イタン', 13, 15),
      tok('だ', '助詞', 'ダ', 15, 16),
    ]
    const targetWords = ['My', 'heart', 'ached', 'even', 'though', 'beginning']
    const result = await alignLineTokens(tokens, targetWords, glossEmbed)
    expect(result.find((t) => t.surface === '胸')?.alignmentIndices).toEqual([1])
    expect(result.find((t) => t.surface === '痛ん')?.alignmentIndices).toEqual([2])
  })

  it('end-to-end: attach then word-pair opening row', async () => {
    const primary = buildAkfgPrimaryTimed()
    const attached = await smartAttachSecondLanguage(primary, AKFG_EN_BLOCK, akfgEmbed)
    const row = rowForJa(attached.lines, '世界を僕は塗り')
    expect(row?.translation).toBeTruthy()
    const tokens: Token[] = [
      tok('世界', '名詞', 'セカイ', 4, 6),
      tok('塗り', '動詞', 'ヌリ', 9, 11),
    ]
    const job = buildAlignJob({ ...row!, tokens })
    const [paired] = await alignLinesTokens([job], glossEmbed)
    const words = splitTranslationWords(row!.translation!)
    const worldTok = paired.find((t) => t.surface === '世界')
    expect(words[worldTok!.alignmentIndices![0]]?.toLowerCase()).toBe('world')
  })
})

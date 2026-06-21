import { describe, it } from 'vitest'
import { smartAttachSecondLanguage, buildAlignJob } from '../../src/lyrics/lineAligner'
import { alignLinesTokens } from '../../src/ai-pipeline/wordAligner'
import { splitTranslationWords } from '../../src/language/wordColors'
import type { Token } from '../../src/core/types'
import {
  AKFG_EN_BLOCK,
  akfgEmbed,
  buildAkfgPrimaryTimed,
} from './fixtures/akfg-korogaru'

const glossEmbed = async (texts: string[]): Promise<number[][]> =>
  texts.map(() => [0.15, 0.15, 0.15, 0.15])

const tok = (surface: string, pos = '名詞', reading?: string): Token => ({
  surface,
  pos,
  reading,
  startIndex: 0,
  endIndex: surface.length,
})

describe('AKFG report (console)', () => {
  it('prints line + word pairing table', async () => {
    const primary = buildAkfgPrimaryTimed()
    const attached = await smartAttachSecondLanguage(primary, AKFG_EN_BLOCK, akfgEmbed)
    console.log('\n=== LINE PAIRING (method:', attached.method, ') ===\n')
    for (let i = 0; i < attached.lines.length; i++) {
      const l = attached.lines[i]
      console.log(`${String(i + 1).padStart(2)} JA: ${l.original}`)
      console.log(`   EN: ${l.translation ?? ''}\n`)
    }

    const sampleLines: { ja: string; tokens: Token[] }[] = [
      {
        ja: '出来れば世界を僕は塗り変えたい',
        tokens: [
          tok('世界', '名詞', 'セカイ'),
          tok('塗り', '動詞', 'ヌリ'),
        ],
      },
      {
        ja: 'ローリング ローリング',
        tokens: [tok('ローリング', '名詞', 'ローリング'), tok('ローリング', '名詞', 'ローリング')],
      },
      {
        ja: '初めから持ってないのに胸が痛んだ',
        tokens: [tok('胸', '名詞', 'ムネ'), tok('痛ん', '動詞', 'イタン')],
      },
      {
        ja: '岩は転がって 僕たちを何処かに連れて行くように ように',
        tokens: [tok('岩', '名詞', 'イワ'), tok('転が', '動詞', 'コロガ')],
      },
    ]

    console.log('=== WORD PAIRING (gloss + embed) ===\n')
    for (const sample of sampleLines) {
      const row = attached.lines.find((l) => l.original === sample.ja)
      if (!row?.translation) continue
      const line = { ...row, tokens: sample.tokens }
      const [paired] = await alignLinesTokens([buildAlignJob(line)], glossEmbed)
      const words = splitTranslationWords(row.translation)
      const pairs = paired
        .filter((t) => t.alignmentIndices?.length)
        .map((t) => `${t.surface}→${words[t.alignmentIndices![0]] ?? '?'}`)
      console.log(`JA: ${sample.ja}`)
      console.log(`EN: ${row.translation.replace(/\n/g, ' / ')}`)
      console.log(`Pairs: ${pairs.length ? pairs.join(', ') : '(none)'}\n`)
    }
  })
})

import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import kuromoji, { type Tokenizer } from 'kuromoji'
import { alignLyrics, type TranscriptWord } from '../../src/ai-pipeline/aligner'
import { alignLinesTokens } from '../../src/ai-pipeline/wordAligner'
import { fixAdjacentTranslationOrder } from '../../src/ai-pipeline/translationOrder'
import {
  buildAlignJob,
  smartAttachSecondLanguage,
} from '../../src/lyrics/lineAligner'
import { splitTranslationWords } from '../../src/language/wordColors'
import type { TimedLine } from '../../src/core/types'

const here = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(here, 'fixtures/veil')
const dictPath = join(here, '../../public/dict')
const WORDS = join(FIXTURES, 'transcript.words.json')

const glossOnlyEmbed = async (texts: string[]): Promise<number[][]> =>
  texts.map(() => [0.2, 0.2, 0.2, 0.2])

function toTokens(text: string, tokenizer: Tokenizer) {
  let index = 0
  return tokenizer.tokenize(text).map((t) => {
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
}

describe('Veil — word pairing integration', () => {
  let tokenizer: Tokenizer
  let lines: TimedLine[]

  beforeAll(async () => {
    tokenizer = await new Promise((resolve, reject) => {
      kuromoji.builder({ dicPath: dictPath }).build((err, t) => (err ? reject(err) : resolve(t!)))
    })

    const jaLines = readFileSync(join(FIXTURES, 'lyrics.ja.txt'), 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
    const enBlock = readFileSync(join(FIXTURES, 'lyrics.en.txt'), 'utf8').trim()
    const words: TranscriptWord[] = existsSync(WORDS)
      ? JSON.parse(readFileSync(WORDS, 'utf8'))
      : []

    const aligned = alignLyrics(jaLines, words, undefined, 'ja')
    const attached = await smartAttachSecondLanguage(aligned.lines, enBlock, glossOnlyEmbed)
    lines = fixAdjacentTranslationOrder(
      attached.lines.map((line) => ({ ...line, tokens: toTokens(line.original, tokenizer) })),
    )
  }, 30_000)

  it('fixes swapped translations on lines 20–21 before pairing', () => {
    const colorLine = lines.find((l) => l.original === '触れない思いの色なんて')
    const knowLine = lines.find((l) => l.original === '知りたくはないと思っていた')
    expect(colorLine?.translation).toContain('color')
    expect(colorLine?.translation).toContain('memories')
    expect(knowLine?.translation?.toLowerCase()).toContain('know')
  })

  it('pairs gloss-covered tokens on representative Veil lines', async () => {
    const samples: Array<{
      original: string
      translation: string
      pairs: Array<{ surface: string; english: string }>
    }> = [
      {
        original: '触れない思いの色なんて',
        translation: 'the color of untouchable memories',
        pairs: [
          { surface: '触れ', english: 'untouchable' },
          { surface: '思い', english: 'memories' },
          { surface: '色', english: 'color' },
        ],
      },
      {
        original: '知りたくはないと思っていた',
        translation: "I didn't want to know",
        pairs: [
          { surface: '知り', english: 'know' },
          { surface: '思っ', english: 'know' },
        ],
      },
      {
        original: 'ふと気付く度に増えていた',
        translation: 'they increase every time I notice them',
        pairs: [
          { surface: 'ふと', english: 'every' },
          { surface: '気付く', english: 'notice' },
          { surface: '増え', english: 'increase' },
        ],
      },
      {
        original: '救えないくらいの憂だって',
        translation: "Even if it's this near-unsalvageable melancholy",
        pairs: [{ surface: '救え', english: 'near-unsalvageable' }],
      },
    ]

    for (const sample of samples) {
      const row = lines.find((l) => l.original === sample.original)
      expect(row, sample.original).toBeDefined()
      const [paired] = await alignLinesTokens(
        [buildAlignJob({ ...row!, translation: sample.translation })],
        glossOnlyEmbed,
      )
      const words = splitTranslationWords(sample.translation)
      for (const { surface, english } of sample.pairs) {
        const token = paired.find((t) => t.surface === surface)
        expect(token?.alignmentIndices?.[0], `${sample.original} :: ${surface}`).toBeDefined()
        const pairedWord = words[token!.alignmentIndices![0]]
        if (sample.original === '知りたくはないと思っていた' && surface === '思っ') {
          expect(['know', 'want']).toContain(pairedWord)
        } else {
          expect(pairedWord).toBe(english)
        }
      }
    }
  })
})

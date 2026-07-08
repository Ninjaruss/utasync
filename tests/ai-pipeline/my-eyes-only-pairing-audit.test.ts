import { describe, it, expect, beforeAll } from 'vitest'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import kuromoji, { type Tokenizer } from 'kuromoji'
import { alignLinesTokens, tokenGlossText } from '../../src/ai-pipeline/wordAligner'
import {
  buildAlignJob,
  japaneseTokenIndices,
} from '../../src/lyrics/lineAligner'
import { splitTranslationWords } from '../../src/language/wordColors'
import { isAlignableToken, isParticleToken } from '../../src/core/language'

const here = dirname(fileURLToPath(import.meta.url))
const dictPath = join(here, '../../public/dict')

const SONG_LINES = [
  { original: 'You always make me so happy 青空に溶けて', translation: 'You always make me so happy\nMelt into the blue sky' },
  { original: 'I promise for my eyes only キミの隣で', translation: 'I promise for my eyes only\nNext to you' },
  { original: 'ねえ いつか', translation: 'Hey someday' },
  { original: 'ねえ いつも', translation: 'Hey always' },
  { original: '滑り込むキミの横 隣り合わせのハート', translation: 'Beside you as you slide in\nAdjacent hearts' },
  { original: '一歩ずつ進んでも', translation: 'One step at a time' },
  { original: '視線に困るあたし', translation: "I'm having trouble looking at you" },
  { original: '「どうした？」なんて', translation: "What's up Oh my God" },
  { original: '覗き込まれて 爆発寸前', translation: "She peeks in and she's on the verge of exploding" },
  { original: '迷い子の粉雪が', translation: 'A stray powder snowflake' },
  { original: '恋に溶けてく', translation: 'Dissolving in love' },
  { original: '滑り出すキミの事', translation: 'About you slipping away' },
  { original: '慌てて追いかけるよ', translation: "I'll rush after you" },
  { original: '一歩だけ遅れてる', translation: 'Only one step behind' },
  { original: 'いつも通りのあたし', translation: "I'm the same as always" },
  { original: '「大丈夫？」なんて', translation: 'Are you okay Oh my God' },
  { original: '振り返るから 転倒寸前', translation: "I'm turning around I'm about to fall over" },
  { original: '恋心溶けて', translation: 'Dissolving in love' },
  { original: 'キミの背中に', translation: 'On your back' },
  { original: '風に溶けてく', translation: 'Dissolving in the wind' },
  { original: 'また 来ようね', translation: "I'll come back for you" },
]

function toTokens(text: string, tokenizer: Tokenizer, baseOffset = 0) {
  let index = baseOffset
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

/** Gloss-only embed — surfaces embedding false positives; pairs need curated glosses. */
const glossOnlyEmbed = async (texts: string[]) => texts.map(() => [0.2, 0.2, 0.2, 0.2])

describe('My Eyes Only — word pairing audit (gloss-only)', () => {
  let tokenizer: Tokenizer

  beforeAll(async () => {
    tokenizer = await new Promise((resolve, reject) => {
      kuromoji.builder({ dicPath: dictPath }).build((err, t) => (err ? reject(err) : resolve(t!)))
    })
  }, 30_000)

  it('reports pairings for every Japanese lyric line', async () => {
    const jobs = SONG_LINES.map((line) => {
      const tokens = toTokens(line.original, tokenizer)
      return { line, tokens, job: buildAlignJob({ ...line, tokens, startTime: 0, endTime: 1 }) }
    })

    const aligned = await alignLinesTokens(
      jobs.map((j) => j.job),
      glossOnlyEmbed,
    )

    const unpaired: string[] = []
    const invalid: string[] = []
    const paired: string[] = []

    jobs.forEach(({ line, tokens }, li) => {
      const result = aligned[li]
      const words = splitTranslationWords(line.translation)
      const jaSet = new Set(japaneseTokenIndices(line.original, tokens))

      for (let ti = 0; ti < result.length; ti++) {
        if (!jaSet.has(ti)) continue
        const t = result[ti]
        if (isParticleToken(t) || !t.surface.trim() || t.pos?.startsWith('記号')) continue
        if (!isAlignableToken(t)) continue
        const idx = t.alignmentIndices
        if (!idx?.length) {
          unpaired.push(`${line.original} :: ${t.surface} (${tokenGlossText(t)})`)
        } else {
          const en = idx.map((i) => words[i] ?? `?${i}?`).join('+')
          if (idx.some((i) => !words[i])) invalid.push(`${line.original} :: ${t.surface} → ${en}`)
          else paired.push(`${line.original} :: ${t.surface} → ${en}`)
        }
      }
    })

    console.log('\n=== PAIRED ===\n' + paired.join('\n'))
    console.log('\n=== UNPAIRED ===\n' + unpaired.join('\n'))
    console.log('\n=== INVALID INDEX ===\n' + invalid.join('\n'))

    expect(invalid).toEqual([])
    // 進んでも has no counterpart in "One step at a time" (ずつ carries "at a
    // time"); the removed susumu→time gloss was an overfitted wrong pairing,
    // and unpaired is the correct gloss-only outcome for 進ん.
    expect(unpaired).toEqual(['一歩ずつ進んでも :: 進ん (susumu)'])
  })
})

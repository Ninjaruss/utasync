import { describe, it, expect } from 'vitest'
import { smartAttachSecondLanguage } from '../../src/lyrics/lineAligner'
import { lineWeight } from '../../src/ai-pipeline/aligner'
import type { TimedLine } from '../../src/core/types'
import { akfgEmbed, rowsForEn } from './fixtures/akfg-korogaru'

/** Exact lyrics from user paste (29 JA lines; EN has 30 content lines). */
export const USER_JA_LINES = `
出来れば世界を僕は塗り変えたい
戦争をなくすような大逸れたことじゃない
だけどちょっと それもあるよな
俳優や映画スターには成れない
それどころか 君の前でさえも上手に笑えない
そんな僕に術はないよな
嗚呼...
何を間違った それさえもわからないんだ
ローリング ローリング
初めから持ってないのに胸が痛んだ
僕らはきっとこの先も
心絡まって ローリング ローリング
凍てつく地面を転がるように走り出した
理由もないのに何だか悲しい
泣けやしないから 余計に救いがない
そんな夜を温めるように歌うんだ
岩は転がって 僕たちを何処かに連れて行くように ように
固い地面を分けて命が芽生えた
あの丘を越えたその先は
光輝いたように ように
君の孤独も全て暴き出す朝だ
赤い 赤い小さな車は君を乗せて
遠く向こうの角を曲がって
此処からは見えなくなった
何をなくした それさえもわからないんだ
ローリング ローリング
初めから持ってないのに胸が痛んだ
僕らはきっとこの先も
心絡まって ローリング ローリング
`.trim().split('\n')

export const USER_EN_BLOCK = `
If possible, I want to repaint the world
It's not a grand thing like eliminating wars
But there's a bit of that too

I can't become an actor or a movie star, in fact
I can't even smile well in front of you
There's no way for me

What did I do wrong? Even that
I don't understand, rolling, rolling
My heart ached even though I didn't have it from the beginning

Surely we will continue
Our hearts entwined, rolling, rolling
We started running as if rolling on the freezing ground

For no reason, I feel somewhat sad
I can't cry, so there's even less comfort
I sing to warm up such nights

The rocks roll us
As if taking us somewhere
Life sprouted breaking through the hard ground

Beyond that hill
Shining brightly
It's a morning that exposes all your loneliness

The small red car carries you
Turning the corner far away
It disappeared from view from here

What did we lose? Even that
I don't understand, rolling, rolling
My heart ached even though I didn't have it from the beginning

Surely we will continue
Our hearts entwined, rolling, rolling
We started running as if rolling on the freezing world
`.trim()

function buildUserPrimaryTimed(): TimedLine[] {
  const songStart = 12
  const songEnd = 272
  const duration = songEnd - songStart
  const weights = USER_JA_LINES.map((t) => Math.max(1, lineWeight(t, 'ja')))
  const total = weights.reduce((a, b) => a + b, 0)
  let cum = 0
  return USER_JA_LINES.map((original, i) => {
    cum += weights[i]
    const startFrac = (cum - weights[i]) / total
    const endFrac = cum / total
    return {
      original,
      translation: '',
      startTime: songStart + startFrac * duration,
      endTime: songStart + endFrac * duration,
    }
  })
}

describe('AKFG user paste — line pairing', () => {
  const primary = buildUserPrimaryTimed()

  it('semantically pairs without duplicating chorus English on every row', async () => {
    const result = await smartAttachSecondLanguage(primary, USER_EN_BLOCK, akfgEmbed)
    expect(result.mismatchedBlocks).toEqual([])
    expect(['semantic', 'slots', 'index']).toContain(result.method)

    const world = result.lines.find((l) => l.original.includes('世界を僕は塗り'))
    expect(world?.translation.toLowerCase()).toMatch(/repaint the world/)

    const rollingOnly = result.lines.filter((l) => l.original.trim() === 'ローリング ローリング')
    expect(rollingOnly).toHaveLength(2)
    for (const row of rollingOnly) {
      expect(row.translation.toLowerCase()).toMatch(/rolling/)
      expect(row.translation.toLowerCase()).not.toMatch(/understand/)
    }

    const entwined = result.lines.filter((l) => l.original.includes('心絡まって'))
    expect(entwined).toHaveLength(2)
    for (const row of entwined) {
      expect(row.translation.toLowerCase()).toMatch(/entwined|rolling/)
    }

    const rollingRows = rowsForEn(result.lines, 'rolling, rolling')
    expect(rollingRows.length).toBeLessThan(8)
  })

  it('leaves 嗚呼 interjection without a forced English line', async () => {
    const result = await smartAttachSecondLanguage(primary, USER_EN_BLOCK, akfgEmbed)
    const sigh = result.lines.find((l) => l.original.startsWith('嗚呼'))
    expect(sigh?.translation?.trim() ?? '').toBe('')
  })

  it('does not assign the final English-only line when JA is missing it', async () => {
    const result = await smartAttachSecondLanguage(primary, USER_EN_BLOCK, akfgEmbed)
    const freezingWorld = result.lines.filter((l) =>
      l.translation.toLowerCase().includes('freezing world'),
    )
    expect(freezingWorld.length).toBeLessThanOrEqual(1)
  })
})

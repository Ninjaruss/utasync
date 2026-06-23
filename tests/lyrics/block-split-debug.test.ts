import { describe, it, expect } from 'vitest'
import { splitPrimaryIntoBlocks, extractSecondLanguageBlocks } from '../../src/lyrics/bilingual'
import { smartAttachSecondLanguage } from '../../src/lyrics/lineAligner'
import { AKFG_EN_BLOCK, akfgEmbed, buildAkfgPrimaryTimed } from './fixtures/akfg-korogaru'
import type { TimedLine } from '../../src/core/types'

/** LRCLIB-style: ~2s within stanzas, ~6s between stanzas. */
function buildTightTimedPrimary(jaLines: string[]): TimedLine[] {
  const stanzaBreakAfter = new Set([3, 6, 9, 12, 15, 18, 21, 24, 27, 30])
  let t = 12
  return jaLines.map((original, i) => {
    const start = t
    t += stanzaBreakAfter.has(i + 1) ? 6 : 2
    return { original, startTime: start, endTime: t, translation: '' }
  })
}

function buildLrcLikePrimary(): TimedLine[] {
  const ja = buildAkfgPrimaryTimed().map((l) => l.original)
  return [
    { original: 'Rock n Roll Morning Light Falls On You', startTime: 0, endTime: 4, translation: '' },
    { original: 'ASIAN KUNG FU GENERATION', startTime: 4, endTime: 8, translation: '' },
    { original: '転がる岩、君に朝が降る', startTime: 8, endTime: 14, translation: '' },
    ...buildTightTimedPrimary(ja),
  ]
}

describe('timed plain paste — stanza block misalignment', () => {
  it('uses full-song semantic pairing even when time-gap blocks match blank-line blocks', () => {
    const primary = buildLrcLikePrimary()
    const pBlocks = splitPrimaryIntoBlocks(primary)
    const sBlocks = extractSecondLanguageBlocks(AKFG_EN_BLOCK)
    expect(pBlocks.length).toBe(sBlocks.length)
  })

  it('pairs actor / smile / no-way on the correct Japanese lines (screenshot repro)', async () => {
    const primary = buildLrcLikePrimary()
    const result = await smartAttachSecondLanguage(primary, AKFG_EN_BLOCK, akfgEmbed, {
      songTitle: 'Rock n Roll Morning Light Falls On You',
      artist: 'ASIAN KUNG FU GENERATION',
    })

    expect(result.lines.filter((l) => l.original.includes('戦争をなくす'))).toHaveLength(1)
    expect(result.lines.filter((l) => l.original.includes('俳優'))).toHaveLength(1)

    const but = result.lines.find((l) => l.original.includes('だけどちょっと'))
    const actor = result.lines.find((l) => l.original.includes('俳優'))
    const smile = result.lines.find((l) => l.original.includes('君の前でさえも'))
    const noWay = result.lines.find((l) => l.original.includes('術はない'))
    const sigh = result.lines.find((l) => l.original.trim() === '嗚呼...')

    expect(but?.translation?.toLowerCase()).toMatch(/bit of that too/)
    expect(actor?.translation?.toLowerCase()).toMatch(/actor or a movie star/)
    expect(smile?.translation?.toLowerCase()).toMatch(/smile well in front/)
    expect(noWay?.translation?.toLowerCase()).toMatch(/no way for me/)
    expect(sigh?.translation?.trim() ?? '').toBe('')

    const titleJa = result.lines.find((l) => l.original.includes('転がる岩'))
    expect(titleJa?.translation?.trim() ?? '').toBe('')
    expect(result.lines.find((l) => l.original.includes('世界を僕は塗り'))?.translation?.toLowerCase())
      .toMatch(/repaint the world/)
  })

  it('ignores duplicate LRC rows and keeps translations in order', async () => {
    const ja = buildAkfgPrimaryTimed().map((l) => l.original)
    const dupIdx = ja.findIndex((l) => l.includes('戦争をなくす'))
    const withDup = [...ja.slice(0, dupIdx + 1), ja[dupIdx], ...ja.slice(dupIdx + 1)]
    const primary = [
      { original: 'Rock n Roll Morning Light Falls On You', startTime: 0, endTime: 4, translation: '' },
      ...buildTightTimedPrimary(withDup),
    ]
    const result = await smartAttachSecondLanguage(primary, AKFG_EN_BLOCK, akfgEmbed, {
      songTitle: 'Rock n Roll Morning Light Falls On You',
    })
    expect(result.lines.filter((l) => l.original.includes('戦争をなくす'))).toHaveLength(2)
    const warsRows = result.lines.filter((l) => l.original.includes('戦争をなくす'))
    expect(warsRows.filter((l) => l.translation?.toLowerCase().includes('eliminating wars'))).toHaveLength(1)
    expect(result.lines.find((l) => l.original.includes('俳優'))?.translation?.toLowerCase())
      .toMatch(/actor or a movie star/)
  })
})

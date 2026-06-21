import { describe, it, expect, vi } from 'vitest'
import { smartAttachSecondLanguage } from '../../src/lyrics/lineAligner'
import type { TimedLine } from '../../src/core/types'

const line = (original: string, translation = ''): TimedLine =>
  ({ original, startTime: 0, endTime: 0, translation })

/**
 * Repro: pure Japanese lines whose English translation has the SAME line count
 * but is offset (title row has no translation). Semantic alignment must place
 * each translation on the right Japanese line instead of blind 1:1 pairing.
 */
describe('semantic pairing repro — equal-count offset', () => {
  const primary: TimedLine[] = [
    line('転がる岩、君に朝が降る'),
    line('出来れば世界を僕は塗り変えたい'),
    line('戦争をなくすような大逸れたことじゃない'),
    line('ローリング ローリング'),
  ]

  // 4 English lines, but the title has no translation so everything is shifted.
  const english = [
    "If possible, I'd like to repaint the world",
    "It's nothing outrageous like ending wars",
    'Rolling, rolling',
    'Our hearts entwined',
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
    "If possible, I'd like to repaint the world": 1,
    "It's nothing outrageous like ending wars": 2,
    'Rolling, rolling': 3,
    'Our hearts entwined': 6,
  }
  const embedFn = vi.fn(async (texts: string[]) => texts.map((t) => vec(embedMap[t.trim()] ?? 7)))

  it('runs semantic alignment (not blind slot/index pairing) and offsets translations correctly', async () => {
    const result = await smartAttachSecondLanguage(primary, english.join('\n'), embedFn)
    expect(result.method).toBe('semantic')
    expect(embedFn).toHaveBeenCalled()
    expect(result.lines[0].translation).toBe('')
    expect(result.lines[1].translation).toBe("If possible, I'd like to repaint the world")
    expect(result.lines[2].translation).toBe("It's nothing outrageous like ending wars")
    expect(result.lines[3].translation).toBe('Rolling, rolling')
  })
})

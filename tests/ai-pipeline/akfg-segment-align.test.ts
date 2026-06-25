import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { alignLyrics, sanitizeTranscript } from '../../src/ai-pipeline/aligner'

const here = dirname(fileURLToPath(import.meta.url))
const SEGMENT_CACHE = join(here, '../../.cache/auto-align-audit/AKFG_FirstTake_segment.json')
const LYRICS = join(here, 'fixtures/akfg-user-ja.txt')

describe.skipIf(!existsSync(SEGMENT_CACHE))('AKFG First Take segment transcript', () => {
  const lineTexts = readFileSync(LYRICS, 'utf8').trim().split('\n')
  const words = sanitizeTranscript(
    JSON.parse(readFileSync(SEGMENT_CACHE, 'utf8')).chunks.flatMap(
      (c: { text?: string; timestamp?: number[] }) => {
        const [start, end] = c.timestamp ?? []
        const word = c.text?.trim()
        if (!word || !Number.isFinite(start)) return []
        return [{ word, startTime: start, endTime: end }]
      },
    ),
  )

  it('keeps 赤い car lines anchored after the bridge', () => {
    const { lines, anchorSources } = alignLyrics(lineTexts, words, undefined, 'ja')
    const red = lines.find((l) => l.original.includes('赤い 赤い'))
    const corner = lines.find((l) => l.original.includes('角を曲が'))
    expect(red?.startTime).toBeGreaterThan(255)
    expect(red?.startTime).toBeLessThan(270)
    expect(red?.endTime! - red!.startTime).toBeLessThan(12)
    expect(corner?.startTime).toBeGreaterThan(red!.startTime)
    const redIdx = lineTexts.findIndex((t) => t.includes('赤い 赤い'))
    expect(anchorSources?.[redIdx]).toBe('lcs')
  })

  it('anchors あの丘 line at the sung phrase onset', () => {
    const { lines } = alignLyrics(lineTexts, words, undefined, 'ja')
    const hill = lines.find((l) => l.original.includes('あの丘'))
    expect(hill?.startTime).toBeGreaterThan(215)
    expect(hill?.startTime).toBeLessThan(218)
    expect(hill?.endTime! - hill!.startTime).toBeLessThan(6)
  })
})

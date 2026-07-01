import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sanitizeTranscript } from '../../src/ai-pipeline/aligner'
import { refineAlignmentWithPhrases } from '../../src/lyrics/phraseAlignment'
import type { TimedLine } from '../../src/core/types'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = JSON.parse(readFileSync(join(here, 'fixtures/akfg/transcript.word.json'), 'utf8'))

const rawWords = (fixture.chunks ?? []).flatMap((c: { text?: string; timestamp?: number[] }) => {
  const [start, end] = c.timestamp ?? []
  const word = c.text?.trim()
  if (!word || !Number.isFinite(start) || !Number.isFinite(end)) return []
  return [{ word, startTime: start, endTime: end }]
})
const words = sanitizeTranscript(rawWords)

const allLines = readFileSync(join(here, 'fixtures/akfg/lyrics.ja.txt'), 'utf8').trim().split('\n')

/**
 * Regression: findNextVocalOnset was falsely matching common kana (なく from
 * 見えなくなった against なく from なくした) and trimming 此処からは見えなくなった
 * ~2 seconds early. Fixed by requiring the next phrase's first character to be
 * present before counting shared-char overlap.
 */
describe('AKFG — 此処からは見えなくなった timing regression', () => {
  it('retains correct end time through full refineAlignmentWithPhrases pipeline', () => {
    const sheetRows: TimedLine[] = allLines.map((original) => ({
      original, translation: '', startTime: 0, endTime: 0,
    }))
    const refined = refineAlignmentWithPhrases(sheetRows, words, 'ja')
    const { lines } = refined

    const corner = lines.find((l) => l.original.includes('角を曲が'))!
    const vanish = lines.find((l) => l.original.includes('見えなく'))!
    const lost   = lines.find((l) => l.original.includes('なくした'))!

    // All three lines should have positive duration
    expect(corner.endTime).toBeGreaterThan(corner.startTime)
    expect(vanish.endTime).toBeGreaterThan(vanish.startTime)
    expect(lost.endTime).toBeGreaterThan(lost.startTime)

    // They should be in order
    expect(vanish.startTime).toBeGreaterThan(corner.startTime)
    expect(lost.startTime).toBeGreaterThan(vanish.startTime)

    // 此処からは見えなくなった should span to the actual end of なった in the transcript
    // (chunk ending ~288.12s) — not clipped to the start of え (285.96s)
    expect(vanish.endTime).toBeGreaterThanOrEqual(287)

    // 何をなくした should start no earlier than 292s (its actual transcript onset)
    expect(lost.startTime).toBeGreaterThanOrEqual(292)
  })
})

import { describe, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { alignLyrics, sanitizeTranscript } from '../../src/ai-pipeline/aligner'

const here = dirname(fileURLToPath(import.meta.url))
const SEGMENT_CACHE = join(here, '../../.cache/auto-align-audit/AKFG_FirstTake_segment.json')
const LYRICS = join(here, 'fixtures/akfg-user-ja.txt')

describe('repro', () => {
  it('dump', () => {
    const lineTexts = readFileSync(LYRICS, 'utf8').trim().split('\n')
    const words = sanitizeTranscript(
      JSON.parse(readFileSync(SEGMENT_CACHE, 'utf8')).chunks.flatMap(
        (c: any) => {
          const [start, end] = c.timestamp ?? []
          const word = c.text?.trim()
          if (!word || !Number.isFinite(start)) return []
          return [{ word, startTime: start, endTime: end }]
        },
      ),
    )
    const { lines, anchorSources, mode, confidence } = alignLyrics(lineTexts, words, undefined, 'ja')
    console.log('mode', mode, 'conf', confidence.toFixed(2))
    lines.forEach((l, i) => {
      console.log(`${String(i+1).padStart(2)} [${l.startTime.toFixed(1)}-${l.endTime.toFixed(1)}] ${anchorSources?.[i]?.padEnd(12)} ${l.original}`)
    })
  })
})

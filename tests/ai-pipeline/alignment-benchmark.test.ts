import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { alignLyrics } from '../../src/ai-pipeline/aligner'
import type { TranscriptWord } from '../../src/ai-pipeline/aligner'

const here = dirname(fileURLToPath(import.meta.url))
const words: TranscriptWord[] = JSON.parse(
  readFileSync(join(here, 'fixtures/my-eyes-only.transcript.json'), 'utf8'),
)
const lineTexts = readFileSync(join(here, 'fixtures/my-eyes-only.lyrics.txt'), 'utf8')
  .split('\n').map((l) => l.trim()).filter(Boolean)

// Ground-truth sung start times (seconds), read off the Whisper word timeline.
const truth = [0.0, 4.8, 7.6, 11.9, 14.5, 21.3, 29.1, 33.0, 36.2, 39.8, 43.0, 48.7,
  56.9, 61.3, 64.0, 68.3, 71.1, 75.4, 78.2, 82.4, 85.1, 91.9, 99.5, 103.3, 106.7,
  110.4, 113.7, 120.0, 127.6, 133.7, 136.4, 140.6, 143.4, 147.8, 150.5, 154.9,
  157.4, 167.0, 171.3, 178.3]

describe('alignment benchmark (My Eyes Only)', () => {
  it('selects content mode and keeps mean error under 1.0s', () => {
    expect(lineTexts).toHaveLength(truth.length)
    const r = alignLyrics(lineTexts, words, undefined, 'ja')
    expect(r.mode).toBe('content')
    const mae = r.lines.reduce((a, l, i) => a + Math.abs(l.startTime - truth[i]), 0) / truth.length
    expect(mae).toBeLessThan(1.0)
  })
})

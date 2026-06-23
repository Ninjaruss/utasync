import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { alignLyrics } from '../../src/ai-pipeline/aligner'
import { transcribeAudio, resetWhisperTranscriber } from '../../src/ai-pipeline/whisperTranscriber'
import { readWavMono } from './helpers/readWavMono'
import { USER_JA_LINES } from '../lyrics/akfg-user-paste.test'

const here = dirname(fileURLToPath(import.meta.url))
const WAV = join(here, 'fixtures/akfg-short.wav')

function row(lines: { original: string; startTime: number }[], fragment: string) {
  return lines.find((l) => l.original.includes(fragment))
}

describe.skipIf(!process.env.RUN_AKFG_MP3 || !existsSync(WAV))('AKFG MP3 — whisper + content align', () => {
  it('anchors rolling and sigh lines without large drift', async () => {
    resetWhisperTranscriber()
    const { data, sampleRate } = readWavMono(WAV)
    const transcript = await transcribeAudio(data, sampleRate, { language: 'ja' })
    const words = (transcript.chunks ?? []).flatMap((c) => {
      const [start, end] = c.timestamp
      const parts = c.text.trim().split(/\s+/).filter(Boolean)
      return parts.map((word, i, arr) => {
        const span = (end - start) / Math.max(1, arr.length)
        return { word, startTime: start + i * span, endTime: start + (i + 1) * span }
      })
    })

    const result = alignLyrics(USER_JA_LINES, words, undefined, 'ja')
    expect(result.lines).toHaveLength(USER_JA_LINES.length)

    const rolling = result.lines.filter((l) => l.original.trim() === 'ローリング ローリング')
    expect(rolling.length).toBe(2)
    if (rolling[0].startTime > 0 && rolling[1].startTime > 0) {
      expect(rolling[1].startTime).toBeGreaterThan(rolling[0].startTime + 30)
    }

    const sigh = row(result.lines, '嗚呼')
    const wrong = row(result.lines, '何を間違')
    if (sigh && wrong && sigh.startTime > 0 && wrong.startTime > 0) {
      expect(wrong.startTime).toBeGreaterThan(sigh.startTime)
      expect(sigh.endTime).toBeLessThanOrEqual(wrong.startTime + 2)
    }

    console.log('\n=== ALIGN MODE:', result.mode, 'confidence:', result.confidence.toFixed(2), '===\n')
    for (let i = 0; i < result.lines.length; i++) {
      const l = result.lines[i]
      console.log(
        `${String(i + 1).padStart(2)} [${l.startTime.toFixed(1)}s] ${l.original.slice(0, 44)}`,
      )
    }
  }, 600_000)
})

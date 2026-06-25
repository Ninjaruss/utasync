import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { alignLyrics, type TranscriptWord } from '../../src/ai-pipeline/aligner'

const here = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(here, 'fixtures/veil')
const WORDS = join(FIXTURES, 'transcript.words.json')

const lineTexts = readFileSync(join(FIXTURES, 'lyrics.ja.txt'), 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter(Boolean)

function line(lines: { original: string; startTime: number; endTime: number }[], fragment: string) {
  return lines.find((l) => l.original.includes(fragment))
}

describe('Veil (Keina Suda) — real Whisper transcript alignment', () => {
  it.skipIf(!existsSync(WORDS))('keeps chorus lines separated and avoids gap-stretched durations', () => {
    const words: TranscriptWord[] = JSON.parse(readFileSync(WORDS, 'utf8'))
    const { lines, mode, confidence } = alignLyrics(lineTexts, words, undefined, 'ja')
    expect(mode).toBe('content')
    expect(confidence).toBeGreaterThan(0.5)
    expect(lines).toHaveLength(lineTexts.length)

    const saveYou = line(lines, 'あなたを救えない')
    expect(saveYou).toBeDefined()
    expect(saveYou!.endTime - saveYou!.startTime).toBeLessThan(15)
    expect(saveYou!.endTime - saveYou!.startTime).toBeGreaterThan(0.5)

    const finger = line(lines, 'この指がもがく')
    expect(finger).toBeDefined()
    expect(finger!.endTime).toBeGreaterThan(finger!.startTime)

    const chorus1 = lines.filter((l) => l.original === '変わらない今を呪ったって')
    expect(chorus1.length).toBe(3)
    if (chorus1[0].startTime > 0 && chorus1[2].startTime > 0) {
      expect(chorus1[2].startTime).toBeGreaterThan(chorus1[0].startTime + 60)
    }

    for (let i = 1; i < lines.length; i++) {
      expect(lines[i].startTime).toBeGreaterThanOrEqual(lines[i - 1].startTime)
    }
  })
})

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { alignLyrics, sanitizeTranscript, type TranscriptWord } from '../../src/ai-pipeline/aligner'
import { computeSyncState } from '../../src/core/db/migrations'
import { fixAdjacentTranslationOrder } from '../../src/ai-pipeline/translationOrder'
import type { Song, TimedLine } from '../../src/core/types'

const here = dirname(fileURLToPath(import.meta.url))
const VEIL = join(here, 'fixtures/veil')

function loadVeilFixture() {
  const jaLines = readFileSync(join(VEIL, 'lyrics.ja.txt'), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const enBlock = readFileSync(join(VEIL, 'lyrics.en.txt'), 'utf8').trim()
  const words: TranscriptWord[] = JSON.parse(readFileSync(join(VEIL, 'transcript.words.json'), 'utf8'))
  return { jaLines, enBlock, words }
}

function auditLines(lines: TimedLine[]) {
  const issues: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const dur = lines[i].endTime - lines[i].startTime
    if (dur <= 0) issues.push(`line ${i + 1}: zero duration`)
    if (dur > 15) issues.push(`line ${i + 1}: long duration ${dur.toFixed(1)}s`)
    if (i > 0 && lines[i].startTime < lines[i - 1].startTime) {
      issues.push(`line ${i + 1}: non-monotonic start`)
    }
  }
  return issues
}

describe.skipIf(!existsSync(join(VEIL, 'transcript.words.json')))('auto-align e2e (Veil fixture)', () => {
  it('sanitizes music symbols then aligns with content mode and marks song synced', () => {
    const { jaLines, words } = loadVeilFixture()
    const clean = sanitizeTranscript(words)
    expect(clean.some((w) => w.word === '♪' || w.word === '~')).toBe(false)

    const existing: TimedLine[] = jaLines.map((original, i) => ({
      startTime: 0,
      endTime: 0,
      original,
      translation: `en line ${i}`,
    }))
    const { lines, mode, confidence } = alignLyrics(jaLines, words, existing, 'ja')
    expect(mode).toBe('content')
    expect(confidence).toBeGreaterThan(0.5)
    expect(lines).toHaveLength(jaLines.length)
    expect(lines.every((l, i) => l.translation === `en line ${i}`)).toBe(true)

    const issues = auditLines(lines)
    expect(issues, issues.join('; ')).toEqual([])

    const song: Song = {
      id: 'veil',
      title: 'Veil',
      artist: 'Keina Suda',
      audioStoredPath: '/audio/veil',
      lyrics: {
        lines,
        sourceLanguage: 'ja',
        translationLanguage: 'en',
        alignmentMode: 'auto',
        alignmentConfidence: confidence,
      },
      createdAt: new Date(),
      isTrialSong: false,
    }
    expect(computeSyncState(song)).toBe('synced')
  })

  it('keeps chorus repetitions separated in time', () => {
    const { jaLines, words } = loadVeilFixture()
    const { lines } = alignLyrics(jaLines, words, undefined, 'ja')
    const chorus = lines.filter((l) => l.original === '変わらない今を呪ったって')
    expect(chorus).toHaveLength(3)
    if (chorus[0].startTime > 0 && chorus[2].startTime > 0) {
      expect(chorus[2].startTime).toBeGreaterThan(chorus[0].startTime + 60)
    }
  })

  it('fixes swapped adjacent EN translations on the known Veil inversion', () => {
    const lines: TimedLine[] = [
      {
        startTime: 0,
        endTime: 1,
        original: '触れない思いの色なんて',
        translation: "I didn't want to know",
        tokens: [{ surface: '色', reading: 'イロ', pos: '名詞', startIndex: 0, endIndex: 1 }],
      },
      {
        startTime: 1,
        endTime: 2,
        original: '知りたくはないと思っていた',
        translation: 'the color of untouchable memories',
        tokens: [{ surface: '知り', reading: 'シリ', pos: '動詞', startIndex: 0, endIndex: 2 }],
      },
    ]
    const fixed = fixAdjacentTranslationOrder(lines)
    expect(fixed[0].translation).toBe('the color of untouchable memories')
    expect(fixed[1].translation).toBe("I didn't want to know")
  })
})

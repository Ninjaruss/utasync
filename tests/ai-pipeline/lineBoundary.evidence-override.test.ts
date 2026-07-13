import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { refineAlignmentWithPhrases } from '../../src/lyrics/phraseAlignment'
import { sanitizeTranscript, type TranscriptWord } from '../../src/ai-pipeline/aligner'
import { computeLineMatchedSpans } from '../../src/ai-pipeline/contentAligner'
import type { AlignmentLanguage } from '../../src/core/types'

const here = dirname(fileURLToPath(import.meta.url))

function loadWords(p: string): TranscriptWord[] {
  const raw = JSON.parse(readFileSync(p, 'utf8'))
  if (Array.isArray(raw)) {
    return raw.flatMap((w: { word?: string; startTime?: number; endTime?: number }) => {
      const word = w.word?.trim()
      if (!word || !Number.isFinite(w.startTime) || !Number.isFinite(w.endTime)) return []
      return [{ word, startTime: w.startTime as number, endTime: w.endTime as number }]
    })
  }
  return (raw.chunks ?? []).flatMap((c: { text?: string; timestamp?: number[] }) => {
    const [start, end] = c.timestamp ?? []
    const word = c.text?.trim()
    if (!word || !Number.isFinite(start) || !Number.isFinite(end)) return []
    return [{ word, startTime: start as number, endTime: end as number }]
  })
}

function loadLines(p: string): string[] {
  return readFileSync(p, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)
}

function refineFor(lyricsPath: string, transcriptPath: string, lang: AlignmentLanguage) {
  const lineTexts = loadLines(lyricsPath)
  const words = loadWords(transcriptPath)
  const sheetRows = lineTexts.map((original) => ({ original, translation: '', startTime: 0, endTime: 0 }))
  const refined = refineAlignmentWithPhrases(sheetRows, words, lang)
  const spans = computeLineMatchedSpans(lineTexts, sanitizeTranscript(words))
  return { lineTexts, refined, spans }
}

// CLASS-T2 (round-5 findings): the aligner places a line seconds AFTER its own
// good matched-span evidence — making Whisper's output worse. Ground truth
// (LRC audit): guitar segment #46 placed +4.6s vs truth while its evidence err
// is 0.3s; stranger segment #16 placed +2.0s while its evidence err is 0.0s.
// Root cause: backfillLateStartsToMatchedSpan gated these lines out because
// their span coverage (6/11 = 0.545, 10/20 = 0.50) sat just under the 0.55
// floor, while the LRC audit itself counts coverage >= 0.5 as real evidence.
describe('line boundary: matched-span evidence must not be overridden (CLASS-T2)', () => {
  it('guitar-loneliness (segment): ぶちまけちゃおうか 星に starts on its matched span', { timeout: 20_000 }, () => {
    const dir = join(here, 'fixtures/guitar-loneliness')
    const { lineTexts, refined, spans } = refineFor(
      join(dir, 'lyrics.ja.txt'),
      join(dir, 'transcript.segment.json'),
      'ja',
    )
    // The line repeats (#17 first chorus, #46 last chorus); the defect is on
    // the LATE occurrence, whose evidence sits in the 204s window.
    const i = lineTexts.lastIndexOf('ぶちまけちゃおうか 星に')
    expect(i).toBe(46)
    const span = spans[i]!
    expect(span).not.toBeNull()
    // Evidence is real: half the line's glyphs match at this window.
    expect(span.matchedChars / span.totalChars).toBeGreaterThanOrEqual(0.5)
    expect(
      Math.abs(refined.lines[i].startTime - span.firstTime),
      `"${lineTexts[i]}" start vs span evidence`,
    ).toBeLessThanOrEqual(1.0)
  })

  it('stranger-than-heaven (segment): 錆ひとつない… starts on its matched span', { timeout: 20_000 }, () => {
    const dir = join(here, 'fixtures/stranger-than-heaven')
    const { lineTexts, refined, spans } = refineFor(
      join(dir, 'lyrics.txt'),
      join(dir, 'transcript.segment.json'),
      'mixed',
    )
    const i = lineTexts.indexOf('錆ひとつない 触らせやしない 媚びる気はない')
    expect(i).toBeGreaterThanOrEqual(0)
    const span = spans[i]!
    expect(span).not.toBeNull()
    expect(span.matchedChars / span.totalChars).toBeGreaterThanOrEqual(0.5)
    expect(
      Math.abs(refined.lines[i].startTime - span.firstTime),
      `"${lineTexts[i]}" start vs span evidence`,
    ).toBeLessThanOrEqual(1.0)
  })
})

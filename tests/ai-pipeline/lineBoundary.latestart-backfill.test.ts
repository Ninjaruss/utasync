import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { refineAlignmentWithPhrases } from '../../src/lyrics/phraseAlignment'
import { sanitizeTranscript } from '../../src/ai-pipeline/aligner'
import { computeLineMatchedSpans } from '../../src/ai-pipeline/contentAligner'

const here = dirname(fileURLToPath(import.meta.url))

function loadWords(p: string) {
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

function refineFor(lyricsPath: string, transcriptPath: string) {
  const lineTexts = loadLines(lyricsPath)
  const words = loadWords(transcriptPath)
  const sheetRows = lineTexts.map((original) => ({ original, translation: '', startTime: 0, endTime: 0 }))
  const refined = refineAlignmentWithPhrases(sheetRows, words, 'ja')
  const spans = computeLineMatchedSpans(lineTexts, sanitizeTranscript(words))
  return { lineTexts, refined, spans }
}

// D3: pass-1/projection late-starts on well-matched lines. The LCS places the
// line's first reliably-matched char (spanFirst) well before the assigned
// start, but no tuner pulled the start back — the silence-gap backfill only
// fires when the onset follows >= 1s of silence, and these onsets sit inside
// continuous singing (findings 2026-07-line-boundary-findings.md).
describe('line boundary: late-start backfill to own matched span (D3)', () => {
  it('veil: fully-matched lines start within 0.35s of their first sung glyph', { timeout: 20_000 }, () => {
    const dir = join(here, 'fixtures/veil')
    const { lineTexts, refined, spans } = refineFor(join(dir, 'lyrics.ja.txt'), join(dir, 'transcript.words.json'))
    // Baseline late-starts: L1 +0.83s, L3 +2.34s, both with full span coverage.
    for (const text of ['変わらない今を呪ったって', 'あなたを救えないのだろう']) {
      const i = lineTexts.indexOf(text)
      expect(i).toBeGreaterThanOrEqual(0)
      const span = spans[i]!
      expect(span).not.toBeNull()
      expect(
        refined.lines[i].startTime - span.firstTime,
        `"${text}" lateStart`,
      ).toBeLessThanOrEqual(0.35)
    }
  })

  it('guitar-loneliness (word): 出せない状態で叫んだよ starts within 0.35s of its span', { timeout: 20_000 }, () => {
    const dir = join(here, 'fixtures/guitar-loneliness')
    const { lineTexts, refined, spans } = refineFor(join(dir, 'lyrics.ja.txt'), join(dir, 'transcript.word.json'))
    const i = lineTexts.indexOf('出せない状態で叫んだよ')
    expect(i).toBeGreaterThanOrEqual(0)
    const span = spans[i]!
    expect(span).not.toBeNull()
    expect(refined.lines[i].startTime - span.firstTime).toBeLessThanOrEqual(0.35)
  })
})

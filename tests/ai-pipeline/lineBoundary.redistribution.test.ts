import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { refineAlignmentWithPhrases } from '../../src/lyrics/phraseAlignment'

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

function refineFor(lyricsPath: string, transcriptPath: string) {
  const lineTexts = readFileSync(lyricsPath, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)
  const words = loadWords(transcriptPath)
  const sheetRows = lineTexts.map((original) => ({ original, translation: '', startTime: 0, endTime: 0 }))
  return { lineTexts, refined: refineAlignmentWithPhrases(sheetRows, words, 'ja') }
}

// Graceful degradation (spec C1): runs of unanchorable lines must not pile up
// at a point, get squeezed to slivers, or absorb an instrumental. Stranger's
// bridge (rows 44-50) piled six lines into 153.88-154.18; row 53 absorbed 39s.
describe('line boundary: degenerate-run redistribution', () => {
  const dir = join(here, 'fixtures/stranger-than-heaven')
  it('stranger word-mode: no two consecutive non-blank lines share a start (pileups spread)', { timeout: 30_000 }, () => {
    const { refined } = refineFor(join(dir, 'lyrics.txt'), join(dir, 'transcript.word.json'))
    let pileups = 0
    for (let i = 1; i < refined.lines.length; i++) {
      if (!refined.lines[i].original.trim() || !refined.lines[i - 1].original.trim()) continue
      if (refined.lines[i].startTime - refined.lines[i - 1].startTime < 0.4) pileups++
    }
    expect(pileups).toBeLessThanOrEqual(2)
  })
  it('stranger word-mode: no line lasts longer than 18s (absorption shrunk)', { timeout: 30_000 }, () => {
    const { refined } = refineFor(join(dir, 'lyrics.txt'), join(dir, 'transcript.word.json'))
    for (const l of refined.lines) {
      expect(l.endTime - l.startTime, `"${l.original}"`).toBeLessThanOrEqual(18)
    }
  })
  it('stranger word-mode: phrase timings track the redistributed lines', { timeout: 30_000 }, () => {
    const { refined } = refineFor(join(dir, 'lyrics.txt'), join(dir, 'transcript.word.json'))
    for (const p of refined.phrases) {
      if (p.sourceLineIndices.length !== 1) continue
      const l = refined.lines[p.sourceLineIndices[0]]
      expect(p.startTime).toBeCloseTo(l.startTime, 2)
      expect(p.endTime).toBeCloseTo(l.endTime, 2)
    }
  })
})

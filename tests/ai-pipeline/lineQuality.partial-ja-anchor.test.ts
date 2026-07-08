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

// Class-B follow-up (2026-07-line-boundary-findings.md): short JA lines whose
// reliable matched span is small but real — enough matched chars, minimum
// coverage, time-consistent with the assigned window, well-anchored neighbours
// — are placed correctly, yet the matched-fraction floor kept flagging them
// needs_review (stranger rows 9/11).
describe('line quality: partial-JA anchor upgrade (stranger rows 9/11)', () => {
  for (const transcript of ['transcript.word.json', 'transcript.segment.json']) {
    it(`upgrades rows 9/11 to approximate (${transcript})`, { timeout: 20_000 }, () => {
      const dir = join(here, 'fixtures/stranger-than-heaven')
      const lineTexts = readFileSync(join(dir, 'lyrics.txt'), 'utf8')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
      const words = loadWords(join(dir, transcript))
      const sheetRows = lineTexts.map((original) => ({ original, translation: '', startTime: 0, endTime: 0 }))
      const refined = refineAlignmentWithPhrases(sheetRows, words, 'ja')
      const quality = refined.lineAlignmentQuality ?? []
      expect(lineTexts[9]).toContain('滾らせる')
      expect(lineTexts[11]).toContain('明かりの灯し方')
      expect(quality[9], 'row 9').toBe('approximate')
      expect(quality[11], 'row 11').toBe('approximate')
    })
  }
})

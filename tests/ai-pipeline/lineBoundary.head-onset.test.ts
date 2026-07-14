import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { refineAlignmentWithPhrases } from '../../src/lyrics/phraseAlignment'

const here = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(here, 'fixtures/guitar-loneliness')

// LRC ground truth (tests/ai-pipeline/fixtures/lrc-truth/guitar-loneliness.json,
// LRCLIB id 996372): line 0 「突然降る夕立 あぁ傘もないや嫌」 starts at 14.83s.
// The audit's median version offset for this fixture is +0.31s (word) / +0.36s
// (segment), and Whisper's own (garbled) evidence for the line starts at
// 14.74s (word) / 15.00s (segment) — so any evidence-following placement lands
// in ~[14.7, 15.6]. Round-5 CLASS-T3 (finding A3): the head line was placed at
// 18.1–18.2s (+3s) because its garbled span coverage (6/14 = 0.43) sat under
// the late-start backfill floor while the vocal-onset backfill's 2.5s cap
// rejected the 3.1–3.5s pull, despite the onset being corroborated by the
// line's own matched span.
const LINE0_LRC_ONSET = 14.83
const LINE0_TOL_EARLY = 1.0 // evidence itself is 0.1s before LRC truth
const LINE0_TOL_LATE = 1.6 // LRC truth + version offset + breathing room
const LINE1_LRC_ONSET = 20.74
const LINE1_TOL = 2.0

function loadWords(file: string) {
  const raw = JSON.parse(readFileSync(join(FIXTURES, file), 'utf8'))
  const chunks: { text?: string; timestamp?: [number, number] }[] = raw.chunks ?? raw
  return chunks
    .map((c) => ({ word: (c.text ?? '').trim(), startTime: c.timestamp?.[0], endTime: c.timestamp?.[1] }))
    .filter((w): w is { word: string; startTime: number; endTime: number } =>
      Boolean(w.word) && Number.isFinite(w.startTime) && Number.isFinite(w.endTime))
}

const lineTexts = readFileSync(join(FIXTURES, 'lyrics.ja.txt'), 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter(Boolean)

describe.each([
  ['word', 'transcript.word.json'],
  ['segment', 'transcript.segment.json'],
])('guitar-loneliness %s: head line placement (CLASS-T3 / A3)', (_label, transcript) => {
  const words = loadWords(transcript)
  const sheetRows = lineTexts.map((original) => ({ original, translation: '', startTime: 0, endTime: 0 }))
  const { lines } = refineAlignmentWithPhrases(sheetRows, words, 'ja')

  it('starts line 0 at its vocal-onset evidence, not interpolated ~3s late', () => {
    expect(lines[0].startTime, 'line 0 start not early').toBeGreaterThan(LINE0_LRC_ONSET - LINE0_TOL_EARLY)
    expect(lines[0].startTime, 'line 0 start not late').toBeLessThan(LINE0_LRC_ONSET + LINE0_TOL_LATE)
  })

  it('keeps line 1 anchored and the head monotonic', () => {
    expect(lines[1].startTime).toBeGreaterThan(LINE1_LRC_ONSET - LINE1_TOL)
    expect(lines[1].startTime).toBeLessThan(LINE1_LRC_ONSET + LINE1_TOL)
    expect(lines[0].endTime).toBeLessThanOrEqual(lines[1].startTime + 0.001)
    expect(lines[1].startTime - lines[0].startTime, 'line 0 keeps a real duration').toBeGreaterThan(1.0)
  })
})

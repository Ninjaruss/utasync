import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { alignLyrics } from '../../src/ai-pipeline/aligner'
import type { TranscriptWord } from '../../src/ai-pipeline/aligner'

/**
 * My Eyes Only — TRANSCRIPT-DOMAIN stability check. NOT ground truth.
 *
 * The array below was "read off the Whisper word timeline", i.e. it is Whisper's
 * own output, and the mp3 it came from is no longer on disk. Two consequences
 * that must be understood before citing this file:
 *
 *  - It CANNOT detect a Whisper timing error. If Whisper's timestamps are skewed,
 *    this test happily locks the aligner onto the skew.
 *  - It therefore PENALISES the aligner for correcting Whisper, which is the
 *    aligner's job: a genuine accuracy improvement that disagrees with Whisper
 *    registers here as a regression.
 *
 * Round 5 validated a shipped fix against `truth[37]` from this array, i.e.
 * certified a correction against the artifact it was meant to correct
 * (docs/superpowers/audits/2026-07-13-round5-findings.md, finding A4).
 *
 * The real accuracy gate is `tests/ai-pipeline/lrc-truth.test.ts`, which scores
 * ABSOLUTE error against human-synced LRC timestamps — including the systematic
 * offset — and partitions lines by whether the transcript carried evidence. This
 * file is kept only as a cheap stability check on a heavily garbled transcript:
 * content mode must still be selected, the timeline must stay monotonic, and
 * lines must stay long enough to read and to loop.
 *
 * Plan item W0.2 (docs/superpowers/plans/2026-09-28-automatic-sync-accuracy.md)
 * calls for replacing this with human-verified onsets once audio the project can
 * legally commit exists (W0.5). Until then it is labelled honestly.
 */

const here = dirname(fileURLToPath(import.meta.url))
const words: TranscriptWord[] = JSON.parse(
  readFileSync(join(here, 'fixtures/my-eyes-only.transcript.json'), 'utf8'),
)
const lineTexts = readFileSync(join(here, 'fixtures/my-eyes-only.lyrics.txt'), 'utf8')
  .split('\n').map((l) => l.trim()).filter(Boolean)

// Whisper-domain reference starts (seconds) — Whisper's word times, not a
// measurement of the song. Named to make that unmistakable at every call site.
const whisperDomainRef = [0.0, 4.8, 7.6, 11.9, 14.5, 21.3, 29.1, 33.0, 36.2, 39.8, 43.0, 48.7,
  56.9, 61.3, 64.0, 68.3, 71.1, 75.4, 78.2, 82.4, 85.1, 91.9, 99.5, 103.3, 106.7,
  110.4, 113.7, 120.0, 127.6, 133.7, 136.4, 140.6, 143.4, 147.8, 150.5, 154.9,
  157.4, 167.0, 171.3, 178.3]

describe('aligner stability on a garbled transcript (transcript domain, not truth)', () => {
  it('selects content mode and stays within 1.0s of its own evidence', () => {
    expect(lineTexts).toHaveLength(whisperDomainRef.length)
    const r = alignLyrics(lineTexts, words, undefined, 'ja')
    expect(r.mode).toBe('content')
    const mae = r.lines.reduce((a, l, i) => a + Math.abs(l.startTime - whisperDomainRef[i]), 0) / whisperDomainRef.length
    expect(mae).toBeLessThan(1.0)
  })

  it('keeps every line long enough to read and to loop', () => {
    const r = alignLyrics(lineTexts, words, undefined, 'ja')
    r.lines.forEach((l, i) => {
      expect(l.endTime - l.startTime, `line ${i} duration`).toBeGreaterThan(0.3)
    })
  })

  it('keeps the timeline monotonic', () => {
    const r = alignLyrics(lineTexts, words, undefined, 'ja')
    for (let i = 0; i < r.lines.length - 1; i++) {
      expect(r.lines[i].startTime, `line ${i} start`).toBeLessThanOrEqual(r.lines[i + 1].startTime + 0.001)
    }
  })
})

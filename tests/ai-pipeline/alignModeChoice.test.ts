import { describe, it, expect } from 'vitest'
import {
  acceptEscalatedRun,
  countUnverifiedLines,
  modeRunVerdict,
  shouldEscalateTimestampMode,
  MODE_ESCALATION_MAX_VERDICT,
  type EscalationInput,
} from '../../src/ai-pipeline/alignModeChoice'
import type { LineAlignmentQuality } from '../../src/core/types'

const base: EscalationInput = {
  timestampMode: 'word',
  verdict: 0.5,
  unverifiedLines: 20,
  lineCount: 60,
  labelledLines: 60,
  tier: 'full',
  alreadyEscalated: false,
  canRerun: true,
}

describe('modeRunVerdict', () => {
  it('grades good 1, approximate 0.5, needs_review 0', () => {
    expect(modeRunVerdict(['good', 'good'])).toBe(1)
    expect(modeRunVerdict(['approximate', 'approximate'])).toBe(0.5)
    expect(modeRunVerdict(['needs_review'])).toBe(0)
    expect(modeRunVerdict(['good', 'needs_review'])).toBe(0.5)
  })

  it('is 0 rather than NaN for a missing quality array', () => {
    // A run with no labels has no evidence behind it; it must not out-score a
    // labelled run by accident.
    expect(modeRunVerdict(undefined)).toBe(0)
    expect(modeRunVerdict([])).toBe(0)
  })
})

describe('countUnverifiedLines', () => {
  it('counts content-bearing lines that are not labelled good', () => {
    const lines = [{ original: 'a' }, { original: 'b' }, { original: 'c' }, { original: '' }]
    const quality: LineAlignmentQuality[] = ['good', 'approximate', 'needs_review', 'needs_review']
    expect(countUnverifiedLines(lines, quality)).toBe(2)
  })

  it('ignores lines with no text, and tolerates a short quality array', () => {
    expect(countUnverifiedLines([{ original: '' }, { translation: '' }], ['needs_review'])).toBe(0)
    expect(countUnverifiedLines([{ original: 'a' }], [])).toBe(1)
  })
})

describe('shouldEscalateTimestampMode', () => {
  it('escalates a weak word-mode run', () => {
    expect(shouldEscalateTimestampMode({ ...base, verdict: 0.4 })).toBe(true)
  })

  it('escalates on unverified-line share even when the aggregate verdict looks fine', () => {
    // The word-mode long-form failure ramps whole sections late while aggregate
    // confidence stays plausible — this is the trigger that catches it.
    expect(shouldEscalateTimestampMode({ ...base, verdict: 0.95, unverifiedLines: 25 })).toBe(true)
  })

  it('does not escalate a word-mode run that is already healthy', () => {
    expect(
      shouldEscalateTimestampMode({ ...base, verdict: 0.95, unverifiedLines: 2 }),
    ).toBe(false)
  })

  it('never escalates segment mode (it is the last rung)', () => {
    expect(shouldEscalateTimestampMode({ ...base, timestampMode: 'segment', verdict: 0.1 })).toBe(false)
  })

  it('never escalates twice', () => {
    expect(shouldEscalateTimestampMode({ ...base, alreadyEscalated: true })).toBe(false)
  })

  it('never escalates on the manual tier, where transcription is unavailable', () => {
    expect(shouldEscalateTimestampMode({ ...base, tier: 'manual' })).toBe(false)
  })

  it('does not escalate when the caller cannot re-run', () => {
    expect(shouldEscalateTimestampMode({ ...base, canRerun: false })).toBe(false)
  })

  it('does not escalate an empty sheet', () => {
    expect(shouldEscalateTimestampMode({ ...base, lineCount: 0, unverifiedLines: 0 })).toBe(false)
  })

  it('ignores a small absolute unverified count on a long song', () => {
    // 5 unverified lines is below the absolute floor, and 5/200 is below the share
    // floor: a handful of stray rows belongs to the off-timing banner, not to a
    // second transcription pass.
    expect(
      shouldEscalateTimestampMode({ ...base, verdict: 0.95, unverifiedLines: 5, lineCount: 200 }),
    ).toBe(false)
  })
})

describe('shouldEscalateTimestampMode — calibrated on the measured corpus', () => {
  // 2026-09-28, scripts/align-mode-choice.mjs. These are the app's own verdicts and
  // unverified counts for a real word-mode run, and the decision each must produce.
  it('leaves guitar-loneliness word mode alone (word IS the better mode there)', () => {
    expect(
      shouldEscalateTimestampMode({
        ...base, verdict: 0.904, unverifiedLines: 7, lineCount: 47, labelledLines: 47,
      }),
    ).toBe(false)
  })

  it('escalates stranger-than-heaven word mode (47% of lines unverified)', () => {
    expect(
      shouldEscalateTimestampMode({
        ...base, verdict: 0.729, unverifiedLines: 28, lineCount: 59, labelledLines: 59,
      }),
    ).toBe(true)
  })

  it('escalates recollect word mode (81% unverified, verdict 0.453)', () => {
    expect(
      shouldEscalateTimestampMode({
        ...base, verdict: 0.453, unverifiedLines: 43, lineCount: 53, labelledLines: 53,
      }),
    ).toBe(true)
  })

  it('does not escalate when the run produced no per-line evidence at all', () => {
    // Nothing to judge the run by, and nothing for a second pass to be compared
    // against — so a mis-wired caller cannot buy a transcription pass for free.
    expect(
      shouldEscalateTimestampMode({ ...base, verdict: 0, labelledLines: 0, unverifiedLines: 60 }),
    ).toBe(false)
  })

  it('keeps the escalation threshold a genuine doubt line, not a rubber stamp', () => {
    // A run at exactly the verdict ceiling with no unverified lines must pass.
    expect(
      shouldEscalateTimestampMode({
        ...base, verdict: MODE_ESCALATION_MAX_VERDICT, unverifiedLines: 0,
      }),
    ).toBe(false)
  })
})

describe('acceptEscalatedRun', () => {
  it('accepts a decisive improvement', () => {
    expect(acceptEscalatedRun(0.453, 0.736)).toBe(true)
  })

  it('rejects a tie, so the extra pass cannot change an equally good result', () => {
    expect(acceptEscalatedRun(0.729, 0.729)).toBe(false)
  })

  it('rejects a marginal improvement, keeping the run already in hand', () => {
    expect(acceptEscalatedRun(0.8, 0.81)).toBe(false)
  })

  it('rejects a worse run', () => {
    expect(acceptEscalatedRun(0.904, 0.755)).toBe(false)
  })
})

import { describe, it, expect } from 'vitest'
import { assessAlignmentTrust, isBetterAlignment, isWorseAlignment } from '../../src/ai-pipeline/alignmentTrust'
import type { LineMatchedSpan } from '../../src/ai-pipeline/contentAligner'
import type { VocalActivitySignal } from '../../src/ai-pipeline/vocalActivity'
import type { TimedLine } from '../../src/core/types'

/**
 * The truth-free verdict a correction loop needs an acceptance test from (product intent:
 * "align as best it can, then auto-correct until the sync is accurate").
 *
 * The calibration against real truth lives in `scripts/align-trust-calibration.mjs` and the
 * numbers are recorded in the measurement ledger; these tests pin the CONTRACT, and in
 * particular the two demotions that make the verdict worth anything:
 *
 *  - a line sitting on its own textual evidence is NOT verified unless the audio agrees;
 *  - a line the audio does not support is NEVER verified, however well it matches the
 *    transcript. This is the fix for the measured case where text-only evidence called a
 *    line "verified" while it sat 12.35s from truth, because the evidence itself was wrong.
 */

const line = (original: string, startTime: number, duration = 2): TimedLine => ({
  original, translation: '', startTime, endTime: startTime + duration,
})
const span = (coverage: number, firstTime: number | null): LineMatchedSpan => ({
  firstTime: firstTime as number,
  lastEndTime: firstTime == null ? null as unknown as number : firstTime + 1,
  matchedChars: Math.round(coverage * 100),
  totalChars: 100,
})

/** An envelope whose activity RISES at each of `onsets`, flat elsewhere. `false` means it
 * never rises anywhere (the masked-carrier case). */
function envelope(onsets: number[], durSec: number, rises = true): VocalActivitySignal {
  const hop = 0.02
  const frames = Math.round(durSec / hop)
  const activity = new Float32Array(frames)
  const onset = new Float32Array(frames)
  activity.fill(0.05)
  if (rises) {
    for (const t of onsets) {
      const start = Math.round(t / hop)
      for (let f = start; f < start + Math.round(0.8 / hop) && f < frames; f++) activity[f] = 0.9
      if (start >= 0 && start < frames) onset[start] = 1
    }
  }
  return { hopSec: hop, activity, onset, source: 'mix' }
}

const ON = [3, 5, 7, 9]

describe('assessAlignmentTrust — the text-evidence tier', () => {
  it('verifies a line with good coverage sitting on its own evidence', () => {
    const r = assessAlignmentTrust({
      lines: [line('a', 3)],
      spans: [span(0.9, 3)],
    })
    expect(r.lines[0].trust).toBe('verified')
    expect(r.lines[0].reasons).not.toContain('off-evidence')
  })

  it('downgrades a thinly-evidenced line to weak, and marks why', () => {
    // Coverage 0.1 with the fragment sitting at the placement is thin corroboration: not
    // contradicted, so not `unverified`, but nowhere near enough to verify.
    const r = assessAlignmentTrust({ lines: [line('a', 3)], spans: [span(0.1, 3)] })
    expect(r.lines[0].trust).toBe('weak')
    expect(r.lines[0].reasons).toContain('no-evidence')
    expect(r.repairableLineIndices).toEqual([0])
  })

  it('calls a line with no evidence AT ALL unverified', () => {
    const r = assessAlignmentTrust({ lines: [line('a', 3)], spans: [null] })
    expect(r.lines[0].trust).toBe('unverified')
    expect(r.lines[0].reasons).toContain('no-evidence')
  })

  it('flags a line that sits far from its OWN matched evidence', () => {
    const r = assessAlignmentTrust({ lines: [line('a', 3)], spans: [span(0.9, 12)] })
    expect(r.lines[0].reasons).toContain('contradicts-own-evidence')
    expect(r.lines[0].trust).not.toBe('verified')
    expect(r.converged).toBe(false)
  })

  it('targets such a line for repair', () => {
    const r = assessAlignmentTrust({
      lines: [line('a', 3), line('b', 5)],
      spans: [span(0.9, 12), span(0.9, 5)],
    })
    expect(r.repairableLineIndices).toEqual([0])
  })

  it('flags zero-duration rows as unverified', () => {
    const r = assessAlignmentTrust({ lines: [line('a', 3, 0)], spans: [span(0.9, 3)] })
    expect(r.lines[0].trust).toBe('unverified')
    expect(r.lines[0].reasons).toContain('zero-duration')
  })

  it('never PROMOTES a line the shipped honesty pass would not vouch for', () => {
    const r = assessAlignmentTrust({
      lines: [line('a', 3)],
      spans: [span(0.9, 3)],
      quality: ['needs_review'],
    })
    expect(r.lines[0].reasons).toContain('label-not-good')
  })
})

describe('assessAlignmentTrust — acoustic corroboration is what makes it a verdict', () => {
  it('demotes a line whose own evidence is good but where no vocal starts', () => {
    // The measured failure: text evidence perfect, placement 12s wrong because the
    // EVIDENCE was wrong. Only the envelope can see it.
    const sig = envelope(ON, 20)
    const r = assessAlignmentTrust({
      lines: [line('a', 12)],
      spans: [span(0.9, 12)],
      sig,
      durationSec: 20,
    })
    expect(r.lines[0].reasons).toContain('no-acoustic-onset')
    expect(r.lines[0].trust).toBe('weak')
    expect(r.converged).toBe(false)
  })

  it('keeps a line verified when the audio agrees with it', () => {
    const sig = envelope(ON, 20)
    const r = assessAlignmentTrust({
      lines: ON.map((t) => line('x', t)),
      spans: ON.map((t) => span(0.9, t)),
      sig,
      durationSec: 20,
    })
    expect(r.lines.every((l) => l.trust === 'verified')).toBe(true)
    expect(r.acousticallyChecked).toBe(4)
  })

  it('cannot certify a song from text evidence alone', () => {
    // A perfect text-only verdict must still refuse to converge: it cannot see evidence
    // that is itself wrong, so certifying on it would be a false guarantee.
    const r = assessAlignmentTrust({ lines: [line('a', 3)], spans: [span(0.9, 3)] })
    expect(r.acousticallyChecked).toBe(0)
    expect(r.converged).toBe(false)
  })

  it('records how many lines the audio could actually judge', () => {
    const sig = envelope(ON, 20)
    const r = assessAlignmentTrust({ lines: [line('a', 3)], spans: [span(0.9, 3)], sig, durationSec: 20 })
    expect(r.acousticallyChecked).toBe(1)
    // A line too close to an edge has no window on one side, so it is not judged rather
    // than judged on missing data.
    const edge = assessAlignmentTrust({
      lines: [line('a', 0.1)], spans: [span(0.9, 0.1)], sig, durationSec: 20,
    })
    expect(edge.acousticallyChecked).toBe(0)
    expect(edge.lines[0].acousticRise).toBeNull()
  })
})

describe('assessAlignmentTrust — reported shares and targets', () => {
  it('measures the verified share over ELIGIBLE lines, not all lines', () => {
    // A line the transcript never reached can never be verified, whatever the audio says,
    // so counting it in the share would make convergence unreachable on any song with
    // transcript holes — and holes are this corpus's dominant error term. Measured:
    // stranger-than-heaven's coverage caps convergence at 59% against a 70% requirement.
    const r = assessAlignmentTrust({
      lines: [line('a', 3), line('', 5), line('b', 7), line('c', 9)],
      // 'a' eligible and verified; blank row excluded; 'b' thinly evidenced (ineligible);
      // 'c' has no evidence at all (ineligible).
      spans: [span(0.9, 3), span(0, null), span(0.4, 7), null],
    })
    expect(r.verifiedShare).toBe(1) // 1 of 1 eligible line
    // ...and the ineligible ones are named separately rather than blended in.
    expect(r.noEvidenceShare).toBeCloseTo(1 / 3) // 'b' and 'c' of 3 content lines
  })

  it('refuses to converge when too many lines were never reached', () => {
    const sig = envelope(ON, 20)
    const r = assessAlignmentTrust({
      lines: [line('a', 3), line('b', 5), line('c', 7), line('d', 9)],
      spans: [span(0.9, 3), null, null, null],
      sig,
      durationSec: 20,
    })
    // A third of the lines are unreachable, so the song is not converged however well
    // the reachable one is placed: the user still sees those lines mistimed.
    expect(r.noEvidenceShare).toBeGreaterThan(0.25)
    expect(r.converged).toBe(false)
  })

  it('ranks repair targets worst-evidence-first', () => {
    const r = assessAlignmentTrust({
      lines: [line('a', 3), line('b', 5), line('c', 7)],
      spans: [span(0.45, 3), span(0.1, 5), span(0, null)],
    })
    expect(r.repairableLineIndices).toEqual([2, 1, 0])
  })
})

describe('isBetterAlignment — how a correction loop accepts a round', () => {
  const verdictOf = (lines: TimedLine[], spans: Array<LineMatchedSpan | null>, sig?: VocalActivitySignal) =>
    assessAlignmentTrust({ lines, spans, sig, durationSec: 20 })

  it('prefers fewer acoustically unsupported lines above all else', () => {
    const sig = envelope(ON, 20)
    const worse = verdictOf([line('a', 12), line('b', 3)], [span(0.9, 12), span(0.9, 3)], sig)
    const better = verdictOf([line('a', 3), line('b', 3)], [span(0.9, 3), span(0.9, 3)], sig)
    expect(isBetterAlignment(better, worse)).toBe(true)
    expect(isBetterAlignment(worse, better)).toBe(false)
  })

  it('returns false on a tie, so a no-op round changes nothing', () => {
    const v = verdictOf([line('a', 3)], [span(0.9, 3)])
    expect(isBetterAlignment(v, v)).toBe(false)
  })

  it('treats LOSING evidence as worse, never as an improvement', () => {
    // The first version of this comparator got this backwards: a repair that garbled the
    // lyric rows left no evidence, and a line with no evidence cannot contradict its
    // evidence, so "fewer contradicted lines" scored the garble as a win.
    const before = verdictOf([line('hello', 11)], [span(0.9, 0)])
    const garbled = verdictOf([line('zzzz', 999)], [span(0, null)])
    expect(isBetterAlignment(garbled, before)).toBe(false)
    expect(isWorseAlignment(garbled, before)).toBe(true)
  })

  it('prefers a higher verified share when unsupported counts match', () => {
    const sig = envelope(ON, 20)
    const more = verdictOf(ON.map((t) => line('x', t)), ON.map((t) => span(0.9, t)), sig)
    const fewer = verdictOf(ON.map((t) => line('x', t)), ON.map((t) => span(0.1, t)), sig)
    expect(isBetterAlignment(more, fewer)).toBe(true)
    expect(isBetterAlignment(fewer, more)).toBe(false)
  })
})

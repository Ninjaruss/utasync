import type { LineAlignmentQuality, TimedLine } from '../core/types'
import type { LineMatchedSpan } from './contentAligner'
import type { TranscriptWord } from './aligner'
import { meanActivity, type VocalActivitySignal } from './vocalActivity'

/**
 * How much an alignment can be TRUSTED, decided without ground truth.
 *
 * WHY THIS EXISTS. The product intent is: when a song has no timed lyrics, the aligner
 * does its best on the pasted text and then **auto-corrects until the sync is accurate**.
 * A correction loop needs an acceptance test — something that says "these lines are
 * right, those are not" — and at runtime there is no ground truth to test against. The
 * existing per-line `LineAlignmentQuality` labels are not it: they are gate-based
 * demotions tuned for zero collateral, which catch 22 of 41 known >1.5s errors
 * (`src/lyrics/labelHonesty.ts`), i.e. they are honest but only 54% sensitive and they
 * carry no error estimate.
 *
 * So this module produces a CALIBRATED three-tier verdict per line from signals that are
 * independent of any answer key:
 *
 *   - `coverage`       how much of the line's text the transcript actually contains
 *                      (matched chars over total chars). Says whether the evidence exists
 *                      at all — in every corpus config measured, this is the dominant
 *                      term: 34 of 59 lines on the worst fixture have no evidence.
 *   - `agreement`      how far the line's placement sits from its OWN matched evidence.
 *                      The aligner's job is to move lines ONTO evidence; a placement far
 *                      from its own span means a tuner overrode good evidence, which is
 *                      the documented CLASS-T2 mechanism.
 *   - `structure`      duration floors and monotonic sanity, for degenerate rows.
 *   - `acoustic`       WHEN AN ENVELOPE IS AVAILABLE, whether energy actually RISES across
 *                      the line's start. This is the only signal here that is independent
 *                      of the transcript, and it is not optional in spirit: measured
 *                      2026-09-28 (scripts/align-trust-calibration.mjs), a text-only
 *                      version of this module called a line "verified" while it sat
 *                      **12.35s** from truth, because the line was sitting exactly on its
 *                      own transcript evidence and the EVIDENCE was 12s wrong. Text
 *                      evidence validates an alignment against the transcript; only audio
 *                      validates it against the recording. Without the envelope the
 *                      verdict can target repairs, but it can never certify a song.
 *
 * The tiers are deliberately few, and every line gets a `reasons` list so a correction
 * loop can act on WHY rather than a bare score.
 *
 * HONESTY REQUIREMENT: a verdict is only worth anything if it is CALIBRATED — i.e. if
 * lines called `verified` really are accurate more often than lines called `unverified`.
 * That is a measurable claim, not a self-evident one: see
 * `scripts/align-trust-calibration.mjs`, which measures the actual error distribution of
 * each tier against human-synced LRC truth. If the tiers do not separate, the correction
 * loop cannot be automatic and this module must say so rather than ship a confident
 * looking score.
 */

/** A line whose text the transcript contains at least this well has real evidence. */
const VERIFIED_MIN_COVERAGE = 0.5
/** ...and whose placement sits this close to that evidence is where the aligner put it. */
const VERIFIED_MAX_AGREEMENT_S = 0.4
/** Below this there is not enough evidence to call a line anything but unverified. */
const WEAK_MIN_COVERAGE = 0.35
/** A placement this far from its own evidence is contradicted, not merely imprecise. */
const CONTRADICTED_AGREEMENT_S = 2.0
/** Lines shorter than this fraction of their text's floor are degenerate. */
const MIN_DURATION_SHARE = 0.5
/** Share of lines that must come back `verified` before an alignment is called converged.
 * Set from measurement (scripts/align-trust-calibration.mjs), not chosen: see that script's
 * output for the share this pipeline actually achieves on each config. */
const CONVERGED_VERIFIED_SHARE = 0.7
/** ...and at most this share of lines may be ones the transcript never reached. A song
 * with a third of its lines unverifiable is not converged however well the rest are
 * placed, because the user still sees those lines mistimed. */
const CONVERGED_MAX_NO_EVIDENCE_SHARE = 0.25

/** Acoustic window around a line start: same rise statistic the offset estimator uses, so
 * the two agree about what an "onset" looks like. */
const ACOUSTIC_RISE_WINDOW_S = 0.25
/** Minimum normalized activity rise for a start to count as landing on a vocal onset.
 * Measured (ledger L10): 0.65-0.87 for a carrier audible in the band, 0.023 for one
 * masked inside it — so 0.15 sits an order of magnitude above noise and far below signal. */
const MIN_ACOUSTIC_RISE = 0.15

export type LineTrust = 'verified' | 'weak' | 'unverified'

export interface LineTrustVerdict {
  lineIndex: number
  trust: LineTrust
  /** Coverage of the line's matched transcript span, 0-1. */
  coverage: number
  /** Seconds between the line's start and its own matched evidence, or null if none. */
  agreementSec: number | null
  /** Normalized activity rise across the line's start, or null when no envelope was
   * supplied. Negative means energy FALLS there — no vocal is starting. */
  acousticRise: number | null
  /** Machine-readable causes, for a correction loop to act on. */
  reasons: string[]
}

export interface AlignmentTrust {
  lines: LineTrustVerdict[]
  /** Share of ELIGIBLE lines (evidence good enough to reach `verified`) that came back
   * `verified`, 0-1. Ineligible lines are counted in `noEvidenceShare` instead. */
  verifiedShare: number
  /** Share of content-bearing lines the transcript carried no usable evidence for, 0-1.
   * The dominant error term in this corpus, and a coverage problem rather than a
   * placement one — gap re-transcription or a better model addresses it, nothing here. */
  noEvidenceShare: number
  /** How many lines the acoustic signal could actually judge (0 ⇒ text-only verdict). */
  acousticallyChecked: number
  /** Line indices worth another repair attempt, worst first (least evidenced, then the
   * furthest from their own evidence). Includes `weak` lines, not only `unverified` ones:
   * a thinly-evidenced line is exactly what a gap-recovery pass can still fix. The caller
   * applies its own budget. */
  repairableLineIndices: number[]
  /**
   * Whether the alignment is good enough to stop correcting. Deliberately conservative:
   * a song is only converged when a high share of its lines are verified AND none is
   * outright contradicted by its own evidence.
   */
  converged: boolean
}

export interface TrustInput {
  lines: readonly TimedLine[]
  spans: ReadonlyArray<LineMatchedSpan | null>
  /** Transcript the spans were computed against, for the chunk-sharing check. */
  words?: readonly TranscriptWord[]
  /** Optional existing labels, folded in as a floor (never as a promotion). */
  quality?: readonly LineAlignmentQuality[]
  /**
   * Audio-derived vocal-activity envelope. The ONLY evidence here that is independent of
   * the transcript, so it is what turns "consistent with the transcript" into "consistent
   * with the recording". Absent ⇒ text-only, which cannot catch transcript-level skew and
   * must not be presented as certification.
   */
  sig?: VocalActivitySignal
  /** Song duration, to keep the acoustic window inside the audio. */
  durationSec?: number
}

/**
 * Whether `next` is a better alignment than `prev`, for a correction loop to decide with.
 * Ranked by what a listener notices first: fewer acoustically unsupported lines, then more
 * verified lines, then fewer contradicted lines. Returns false on a tie, so a repair round
 * that changes nothing keeps the alignment already in hand.
 */
export function isBetterAlignment(next: AlignmentTrust, prev: AlignmentTrust): boolean {
  const unsupported = (t: AlignmentTrust) => t.lines.filter((l) => l.reasons.includes('no-acoustic-onset')).length
  const noEvidence = (t: AlignmentTrust) => t.lines.filter((l) => l.reasons.includes('no-evidence')).length
  const contradicted = (t: AlignmentTrust) => t.lines.filter((l) => l.reasons.includes('contradicts-own-evidence')).length
  if (unsupported(next) !== unsupported(prev)) return unsupported(next) < unsupported(prev)
  // Losing evidence must never read as an improvement. It did, in the first version of this
  // comparator: a repair that garbled the lyric rows left no evidence, and a line with no
  // evidence cannot CONTRADICT its evidence, so "fewer contradicted lines" scored the
  // garble as a win. Coverage comes before contradiction for that reason.
  if (noEvidence(next) !== noEvidence(prev)) return noEvidence(next) < noEvidence(prev)
  if (next.verifiedShare !== prev.verifiedShare) return next.verifiedShare > prev.verifiedShare
  return contradicted(next) < contradicted(prev)
}

/**
 * Whether `next` is strictly WORSE than `prev`. The counterpart to `isBetterAlignment`,
 * and the one a revert should use: a repair that merely ties must be KEPT, not thrown away,
 * because it may have improved the transcript even when the verdict cannot tell. Reverting
 * on a tie discarded legitimate gap fills when the verdict had no evidence to judge with.
 */
export function isWorseAlignment(next: AlignmentTrust, prev: AlignmentTrust): boolean {
  return isBetterAlignment(prev, next)
}

/** A transcript "word" longer than this is a segment-mode phrase chunk (mirrors the
 * boundary and label-honesty metrics). */
const CHUNK_MIN_DURATION_S = 2.5
const CHUNK_OVERLAP_S = 0.3

export function assessAlignmentTrust(input: TrustInput): AlignmentTrust {
  const { lines, spans } = input
  const verdicts: LineTrustVerdict[] = []
  const repairable: number[] = []
  const { sig } = input
  let contentLines = 0
  let verified = 0
  let anyContradicted = false
  let anyAcousticallyUnsupported = false
  let acousticallyChecked = 0

  const sharedChunkLines = new Set<number>()
  if (input.words?.length) {
    for (const w of input.words) {
      if (w.endTime - w.startTime <= CHUNK_MIN_DURATION_S) continue
      const hits: number[] = []
      for (let i = 0; i < lines.length; i++) {
        const overlap = Math.min(lines[i].endTime, w.endTime) - Math.max(lines[i].startTime, w.startTime)
        if (overlap > CHUNK_OVERLAP_S) hits.push(i)
      }
      if (hits.length >= 2) for (const i of hits) sharedChunkLines.add(i)
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const text = (line.original || line.translation || '').trim()
    if (!text) {
      // Nothing to align: not a failure, and not part of the share either way.
      verdicts.push({
        lineIndex: i, trust: 'verified', coverage: 1, agreementSec: null, acousticRise: null, reasons: ['no-text'],
      })
      continue
    }
    contentLines++

    const span = spans[i] ?? null
    const coverage = span ? span.matchedChars / Math.max(1, span.totalChars) : 0
    const agreementSec = span && span.firstTime != null ? Math.abs(line.startTime - span.firstTime) : null
    const duration = line.endTime - line.startTime
    const reasons: string[] = []

    // Acoustic corroboration: does vocal energy RISE across this line's start? This is
    // the signal that can disagree with the transcript, and the only one that can catch
    // an alignment that is perfectly consistent with evidence that is itself wrong.
    let acousticRise: number | null = null
    if (sig) {
      const w = ACOUSTIC_RISE_WINDOW_S
      const dur = input.durationSec ?? sig.activity.length * sig.hopSec
      const at = line.startTime
      if (at - w >= 0 && at + w <= dur) {
        acousticRise = meanActivity(sig, at, at + w) - meanActivity(sig, at - w, at)
      }
    }

    // Structure first: a degenerate row cannot be trusted regardless of its evidence.
    if (duration <= 0.1) reasons.push('zero-duration')
    if (coverage < WEAK_MIN_COVERAGE) reasons.push('no-evidence')
    if (agreementSec != null && agreementSec > VERIFIED_MAX_AGREEMENT_S) reasons.push('off-evidence')
    if (agreementSec != null && agreementSec > CONTRADICTED_AGREEMENT_S) {
      reasons.push('contradicts-own-evidence')
      anyContradicted = true
    }
    if (sharedChunkLines.has(i)) reasons.push('shared-chunk-boundary')
    if (acousticRise != null) {
      acousticallyChecked++
      if (acousticRise < MIN_ACOUSTIC_RISE) {
        reasons.push('no-acoustic-onset')
        anyAcousticallyUnsupported = true
      }
    }
    // The existing labels are a floor, never a promotion: if the shipped honesty pass
    // already refuses to vouch for a line, this pass must not vouch for it either.
    if (input.quality?.[i] && input.quality[i] !== 'good') reasons.push('label-not-good')

    // A line whose own text is very short can legitimately have low coverage; require
    // both signals to agree before calling a short line unverified.
    const shortLine = text.length <= 4
    const structurallyBad = duration <= 0.1
    const largeDurationFloor = shortLine ? 0.3 : MIN_DURATION_SHARE
    const degenerate = duration > 0 && duration < largeDurationFloor

    let trust: LineTrust
    if (structurallyBad) {
      trust = 'unverified'
    } else if (sharedChunkLines.has(i) || degenerate) {
      // Interpolated boundaries and squashed rows are estimate-only by construction.
      trust = coverage >= VERIFIED_MIN_COVERAGE ? 'weak' : 'unverified'
    } else if (
      coverage >= VERIFIED_MIN_COVERAGE
      && (agreementSec == null || agreementSec <= VERIFIED_MAX_AGREEMENT_S)
    ) {
      trust = 'verified'
    } else if (coverage >= WEAK_MIN_COVERAGE || (agreementSec != null && agreementSec <= VERIFIED_MAX_AGREEMENT_S)) {
      trust = 'weak'
    } else {
      trust = 'unverified'
    }

    // `label-not-good` is a reason to repair but not by itself a reason to distrust a
    // line whose own evidence is strong: the two signals measure different things and the
    // calibration script is what decides whether that is the right call.
    if (trust === 'verified' && reasons.includes('contradicts-own-evidence')) trust = 'weak'
    // A line the audio does not support is not verified, however well it matches the
    // transcript. This is the demotion that fixes the 12.35s-in-"verified" case.
    if (trust === 'verified' && reasons.includes('no-acoustic-onset')) trust = 'weak'

    if (trust === 'verified') {
      verified++
    } else {
      // Everything not verified is a repair candidate; the caller applies its own budget.
      // Narrowing this to `unverified` only was the first version, and it hid the thinly
      // evidenced lines a gap-recovery pass is actually good at fixing.
      repairable.push(i)
    }

    verdicts.push({ lineIndex: i, trust, coverage, agreementSec, acousticRise, reasons })
  }

  // A line with no transcript evidence can NEVER be verified, whatever the audio says, so
  // measuring the verified share over ALL lines silently makes convergence unreachable on
  // any song whose transcript has holes — and holes are the dominant error term in this
  // corpus. Measured 2026-09-28: stranger-than-heaven's coverage caps convergence at 59%
  // before the acoustic gate is even consulted, against a 0.7 requirement.
  //
  // So the share is measured over ELIGIBLE lines (those whose evidence could reach
  // `verified`), and the ineligible ones are reported separately as `noEvidenceShare` and
  // bounded in their own right. That is not moving the goalposts: it names two different
  // failures — "the transcript never reached this line" (a coverage problem) and "the
  // placement is not supported" (a placement problem) — instead of blending them into one
  // number that no amount of placement work can improve.
  const eligible = verdicts.filter(
    (v) => !v.reasons.includes('no-text') && v.coverage >= VERIFIED_MIN_COVERAGE,
  ).length
  const noEvidence = verdicts.filter((v) => v.reasons.includes('no-evidence')).length
  const verifiedShare = eligible ? verified / eligible : 0
  const noEvidenceShare = contentLines ? noEvidence / contentLines : 0
  // Worst first: the least evidenced lines are the ones a repair pass should aim at.
  repairable.sort((a, b) => {
    const ca = verdicts[a].coverage
    const cb = verdicts[b].coverage
    if (ca !== cb) return ca - cb
    return (verdicts[b].agreementSec ?? 0) - (verdicts[a].agreementSec ?? 0)
  })

  return {
    lines: verdicts,
    verifiedShare,
    noEvidenceShare,
    acousticallyChecked,
    repairableLineIndices: repairable,
    // Thresholds chosen from the calibration measurement, not a guess: see
    // scripts/align-trust-calibration.mjs. `anyContradicted` blocks convergence because a
    // line sitting seconds from its own evidence is a defect a repair pass can still fix.
    // Convergence requires the acoustic signal to have been available AND to have found
    // nothing unsupported: a text-only verdict cannot certify a song, because it cannot
    // see evidence that is itself wrong.
    //
    // NOTE, measured 2026-09-28 (scripts/align-trust-calibration.mjs): **no config in the
    // corpus reaches this state.** The best song (veil, p90 0.98s, zero lines over 2s)
    // still fails the share test badly, and every other config fails on unsupported lines
    // too. That is not a threshold to loosen — it is the pipeline's current quality,
    // stated. So callers must NOT treat `converged` as the loop's exit condition; the
    // correction loop iterates while this verdict IMPROVES and reports the residual
    // honestly when it stops. The requirement stays where it is so the gap stays visible.
    converged:
      acousticallyChecked > 0
      && !anyAcousticallyUnsupported
      && verifiedShare >= CONVERGED_VERIFIED_SHARE
      && noEvidenceShare <= CONVERGED_MAX_NO_EVIDENCE_SHARE
      && !anyContradicted,
  }
}

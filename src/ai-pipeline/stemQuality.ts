/**
 * Stem-sanity guard for default-on vocal isolation.
 *
 * Demucs usually helps transcription, but on some tracks it destroys the vocal
 * (annihilates it into near-silence, or leaves musical-noise artifacts) and
 * transcribing that stem would be strictly worse than the raw mix. This guard
 * runs a cheap, pre-transcription check and lets the flow fall back to the mix.
 *
 * SAFETY: rejecting the stem falls back to transcribing the raw mix — exactly
 * the behavior when isolation is off. So the guard can never do worse than the
 * status quo; its only failure mode is *not* catching a subtly-degraded stem
 * (left to the downstream label-honesty gates), or over-rejecting a good stem
 * (which merely forfeits the isolation benefit for that song). That asymmetry is
 * why the floor is set conservatively low — only near-total vocal destruction
 * is caught, so a genuinely quiet/sparse-but-real vocal is never thrown away.
 *
 * The signal is the same vocal-activity envelope the onset anchor already
 * computes on the stem, so the guard adds no new heavy DSP — the flow computes
 * it once and shares it.
 */
import type { LineAlignmentQuality, TimedLine } from '../core/types'
import { voicedFraction, type VocalActivitySignal } from './vocalActivity'

/** Global voiced fraction below which a stem is treated as destroyed. Set well
 * under any plausible real vocal track (even a mostly-instrumental song sings
 * far more than this) so the guard only fires on catastrophic separation. */
export const STEM_VOICED_FLOOR = 0.05

export type StemQualityReason = 'ok' | 'silent-stem' | 'unassessable'

export interface StemQualityVerdict {
  /** True when the stem should feed transcription; false to fall back to mix. */
  usable: boolean
  reason: StemQualityReason
  /** Fraction of the whole track that reads as voiced on the stem. */
  voicedFraction: number
}

/**
 * Decide whether a Demucs vocal stem is trustworthy enough to transcribe.
 * Decisive only for `source: 'stem'` — a mix signal (the fallback itself) is
 * always reported usable. An empty/unassessable signal is reported usable too,
 * so a too-short clip is never blocked from the stem it would have used anyway.
 */
export function assessStemQuality(
  signal: VocalActivitySignal,
  durationSec: number,
): StemQualityVerdict {
  if (signal.source !== 'stem' || signal.activity.length === 0 || durationSec <= 0) {
    return { usable: true, reason: 'unassessable', voicedFraction: 0 }
  }
  const frac = voicedFraction(signal, 0, durationSec)
  if (frac < STEM_VOICED_FLOOR) {
    return { usable: false, reason: 'silent-stem', voicedFraction: frac }
  }
  return { usable: true, reason: 'ok', voicedFraction: frac }
}

/**
 * Operator log for a rejected stem — the guard fell back to the raw mix. Since
 * STEM_VOICED_FLOOR is set conservatively and hasn't been calibrated against a
 * corpus of real mangled separations, logging every rejection (with the measured
 * voiced fraction and where it fired) is how we learn whether it's firing too
 * eagerly or not enough. No-op when the stem was accepted. Kept out of
 * `assessStemQuality` so that function stays pure/side-effect-free for testing.
 */
export function warnIfStemRejected(where: string, verdict: StemQualityVerdict): void {
  if (verdict.usable) return
  console.warn(
    `[stemQuality] ${where}: vocal stem rejected (voiced fraction ${verdict.voicedFraction.toFixed(3)} < ${STEM_VOICED_FLOOR}) — aligning on the raw mix.`,
  )
}

/** Minimum share of content-bearing lines that must come back VERIFIED ('good')
 * for a stem run to be trusted.
 *
 * `assessStemQuality` above answers "is there a vocal at all?" BEFORE
 * transcription; it cannot see the failure that actually costs users, which is a
 * stem that contains plenty of vocal-*band* energy (bleed) and transcribes
 * badly. Measured on AKFG "Rock'n'Roll, Morning Light Falls on You" (THE FIRST
 * TAKE), live in Firefox on the real 6:33 recording, same lyrics/model, only the
 * isolation switch differing:
 *   stem : 0 of 30 rows 'good', mean|err| 15.41s, p90 37.8s
 *   mix  : 21 of 30 rows 'good', mean|err|  2.82s, p90  7.6s
 * Every other song measured keeps a good-share between 0.36 and 0.70
 * (stranger stem 0.41, veil stem 0.40, stranger mix 0.47, guitar 0.67), so a 0.25
 * floor separates that catastrophe from a merely-approximate run — the same
 * conservative posture as STEM_VOICED_FLOOR: only catastrophic cases fire, and
 * the fallback is the mix, which is exactly what isolation-off would have done. */
export const STEM_GOOD_SHARE_FLOOR = 0.25

/** Below this many content-bearing lines there is not enough signal to judge a
 * stem pass on its labels — a short clip is reported 'ok' rather than re-run. */
const STEM_PASS_MIN_SCOREABLE = 6

export type StemPassReason = 'ok' | 'unverifiable-stem' | 'too-few-lines'

export interface StemPassVerdict {
  /** True when this stem run should be discarded in favour of re-aligning the mix. */
  weak: boolean
  reason: StemPassReason
  /** Share of content-bearing lines the honesty pass could verify as 'good'. */
  goodShare: number
  scoreable: number
}

/**
 * Judge a FINISHED stem pass by how much of the alignment its own honesty pass
 * could verify. A stem whose transcription garbles the vocal produces an
 * alignment in which almost no line can be corroborated — the labels say so
 * (0 'good' rows on the measured case), which is the only signal available
 * without a second reference alignment. Returns `weak: false` for a mix pass
 * (the fallback itself must never trigger another fallback).
 */
export function assessStemPass(
  lines: readonly TimedLine[],
  quality: readonly LineAlignmentQuality[] | undefined,
  source: 'stem' | 'mix',
): StemPassVerdict {
  if (source !== 'stem' || !quality || quality.length === 0) {
    return { weak: false, reason: 'ok', goodShare: 1, scoreable: 0 }
  }
  let scoreable = 0
  let good = 0
  for (let i = 0; i < lines.length; i++) {
    if (!(lines[i]?.original || lines[i]?.translation || '').trim()) continue
    scoreable++
    if (quality[i] === 'good') good++
  }
  const goodShare = scoreable > 0 ? good / scoreable : 1
  if (scoreable < STEM_PASS_MIN_SCOREABLE) {
    return { weak: false, reason: 'too-few-lines', goodShare, scoreable }
  }
  return goodShare < STEM_GOOD_SHARE_FLOOR
    ? { weak: true, reason: 'unverifiable-stem', goodShare, scoreable }
    : { weak: false, reason: 'ok', goodShare, scoreable }
}

/** Operator log for a stem pass discarded after transcription (mirrors
 * `warnIfStemRejected`, which fires before it). */
export function warnIfStemPassWeak(where: string, verdict: StemPassVerdict): void {
  if (!verdict.weak) return
  console.warn(
    `[stemQuality] ${where}: stem pass unverifiable (only ${verdict.goodShare.toFixed(2)} of ${verdict.scoreable} lines verified, floor ${STEM_GOOD_SHARE_FLOOR}) — re-aligning on the raw mix.`,
  )
}

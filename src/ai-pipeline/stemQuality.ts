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

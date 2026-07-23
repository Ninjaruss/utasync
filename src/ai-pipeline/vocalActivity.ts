/**
 * Vocal-activity envelope: an audio-derived, per-frame "is a voice present?"
 * curve the aligner uses to demote confident lyric labels that sit on non-vocal
 * audio (intros, instrumental breaks, Whisper break-hallucinations). Pure DSP,
 * deterministic (no RNG) so it can back committed fixtures. See
 * docs/superpowers/specs/2026-07-17-acoustic-vocal-activity-aligner-design.md.
 */
import { hannWindow, stft } from './fft'

export interface VocalActivitySignal {
  /** Frame period in seconds (hop / sampleRate). */
  hopSec: number
  /** Per-frame vocal-band energy, robust-normalized to 0..1. */
  activity: Float32Array
  /** Per-frame onset strength (half-wave-rectified spectral flux), 0..1. Phase 2. */
  onset: Float32Array
  /** Provenance: 'stem' (Demucs vocal isolate — trustworthy) or 'mix' (weaker prior). */
  source: 'stem' | 'mix'
}

const VOCAL_LO_HZ = 150
const VOCAL_HI_HZ = 4000
/** A frame counts as voiced when its normalized activity exceeds this. Set low
 * (relative to the track-loudest p95 anchor) so genuinely-sung but quiet/breathy
 * passages — commonly 12–20 dB below a loud chorus — still register as voiced;
 * only near-silence (a true instrumental break/intro on a clean vocal stem)
 * falls below it. Conservative by design: prefer missing a break over demoting a
 * correctly-aligned quiet line. */
export const VOICED_THRESHOLD = 0.04

/** Nearest power of two ≥ n. */
function nextPow2(n: number): number { let p = 1; while (p < n) p <<= 1; return p }

/** p-th percentile of the positive values of `arr` (p in 0..1); 0 when all-zero. */
function percentile(arr: Float32Array, p: number): number {
  const pos = Array.from(arr).filter((v) => v > 0).sort((a, b) => a - b)
  if (pos.length === 0) return 0
  return pos[Math.min(pos.length - 1, Math.floor(p * (pos.length - 1)))]
}

export function computeVocalActivity(
  pcm: Float32Array,
  sampleRate: number,
  opts: { source: 'stem' | 'mix' },
): VocalActivitySignal {
  // window ≈46ms; hop = nFft/2 (≈23ms at 44.1kHz, ≈32ms at 16kHz).
  const nFft = Math.max(256, nextPow2(Math.round(0.046 * sampleRate)))
  const hop = Math.max(1, Math.round(nFft / 2))
  const hopSec = hop / sampleRate
  if (pcm.length < nFft) {
    return { hopSec, activity: new Float32Array(0), onset: new Float32Array(0), source: opts.source }
  }
  const { real, imag, frames } = stft(pcm, nFft, hop, hannWindow(nFft))
  const binLo = Math.max(1, Math.floor((VOCAL_LO_HZ * nFft) / sampleRate))
  const binHi = Math.min(real.length - 1, Math.ceil((VOCAL_HI_HZ * nFft) / sampleRate))

  // Per-frame vocal-band and total power.
  const vocalPow = new Float32Array(frames)
  const totalPow = new Float32Array(frames)
  const totalMag = new Float32Array(frames)
  for (let f = 0; f < frames; f++) {
    let vp = 0, tp = 0
    for (let b = 0; b < real.length; b++) {
      const p = real[b][f] * real[b][f] + imag[b][f] * imag[b][f]
      tp += p
      if (b >= binLo && b <= binHi) vp += p
    }
    vocalPow[f] = vp
    totalPow[f] = tp
    totalMag[f] = Math.sqrt(tp)
  }

  // activity = vocal-band concentration × loudness.
  //  - concentration (vocalPow/totalPow, 0..1) distinguishes vocal-band-dominant
  //    energy from bass/percussion — amplitude-invariant.
  //  - loudness (totalMag vs a high percentile) is an ABSOLUTE-energy anchor so
  //    faint out-of-band leakage in near-silence can't read as "fully voiced".
  const loudNorm = percentile(totalMag, 0.95) || 1e-9
  const EPS = 1e-9
  const activity = new Float32Array(frames)
  for (let f = 0; f < frames; f++) {
    const concentration = vocalPow[f] / (totalPow[f] + EPS)
    const loudness = Math.min(1, totalMag[f] / loudNorm)
    activity[f] = concentration * loudness
  }
  // Onset strength (phase 2): half-wave rise in activity.
  const onset = new Float32Array(frames)
  for (let f = 1; f < frames; f++) onset[f] = Math.max(0, activity[f] - activity[f - 1])

  return { hopSec, activity, onset, source: opts.source }
}

/** Fraction of frames in [startSec, endSec) whose activity ≥ VOICED_THRESHOLD. */
export function voicedFraction(sig: VocalActivitySignal, startSec: number, endSec: number): number {
  if (sig.activity.length === 0 || endSec <= startSec) return 0
  const a = Math.max(0, Math.floor(startSec / sig.hopSec))
  const b = Math.min(sig.activity.length, Math.ceil(endSec / sig.hopSec))
  if (b <= a) return 0
  let voiced = 0
  for (let f = a; f < b; f++) if (sig.activity[f] >= VOICED_THRESHOLD) voiced++
  return voiced / (b - a)
}

/** The first vocal onset AFTER an instrumental intro: the earliest time where a
 * sustained voiced run begins that is preceded by a genuine quiet region. Returns
 * null when there is no such intro→onset transition (voicing from the start), on a
 * 'mix' source (too noisy for a leading-edge decision — stem only), or empty signal. */
export function firstVocalOnset(
  sig: VocalActivitySignal,
  opts?: { minOnsetSec?: number; sustainSec?: number; preDipSec?: number },
): number | null {
  if (sig.source !== 'stem' || sig.activity.length === 0) return null
  const minOnset = opts?.minOnsetSec ?? 2.0
  const sustain = opts?.sustainSec ?? 1.0
  const preDip = opts?.preDipSec ?? 1.5
  const VOICED_RUN = 0.5
  const QUIET = 0.12
  const totalDur = sig.activity.length * sig.hopSec
  for (let t = minOnset; t + sustain <= totalDur; t += sig.hopSec) {
    if (
      voicedFraction(sig, t, t + sustain) >= VOICED_RUN &&
      voicedFraction(sig, Math.max(0, t - preDip), t) <= QUIET
    ) {
      return t
    }
  }
  return null
}

/** Mean activity over [startSec, endSec). */
export function meanActivity(sig: VocalActivitySignal, startSec: number, endSec: number): number {
  if (sig.activity.length === 0 || endSec <= startSec) return 0
  const a = Math.max(0, Math.floor(startSec / sig.hopSec))
  const b = Math.min(sig.activity.length, Math.ceil(endSec / sig.hopSec))
  if (b <= a) return 0
  let sum = 0
  for (let f = a; f < b; f++) sum += sig.activity[f]
  return sum / (b - a)
}

/** The strongest onset-envelope peak near targetSec. Searches
 * [targetSec - maxBefore, targetSec + slackAfter) and returns the time of the
 * frame with the highest onset strength >= minStrength, or null if none clears
 * the bar. Used to pull a late line start back to the nearest genuine acoustic
 * vocal onset, so the search reaches back before the target. */
export function nearestOnset(
  sig: VocalActivitySignal,
  targetSec: number,
  opts: { maxBefore: number; slackAfter: number; minStrength: number },
): number | null {
  if (sig.onset.length === 0) return null
  const a = Math.max(0, Math.floor((targetSec - opts.maxBefore) / sig.hopSec))
  const b = Math.min(sig.onset.length, Math.ceil((targetSec + opts.slackAfter) / sig.hopSec))
  let bestF = -1
  let best = opts.minStrength
  for (let f = a; f < b; f++) {
    if (sig.onset[f] >= best) { best = sig.onset[f]; bestF = f }
  }
  return bestF < 0 ? null : bestF * sig.hopSec
}

/** True when a genuine low-activity lull precedes onsetSec (a real phrase onset
 * emerging from silence, not a mid-word bump): mean activity in
 * [onsetSec - dipWindow, onsetSec) is below dipMaxActivity. */
export function hasPreOnsetDip(
  sig: VocalActivitySignal,
  onsetSec: number,
  opts: { dipWindow: number; dipMaxActivity: number },
): boolean {
  if (onsetSec - opts.dipWindow < 0) return false
  return meanActivity(sig, onsetSec - opts.dipWindow, onsetSec) < opts.dipMaxActivity
}

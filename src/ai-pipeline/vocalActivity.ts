/**
 * Vocal-activity envelope: an audio-derived, per-frame "is a voice present?"
 * curve the aligner uses to demote confident lyric labels that sit on non-vocal
 * audio (intros, instrumental breaks, Whisper break-hallucinations). Pure DSP,
 * deterministic (no RNG) so it can back committed fixtures. See
 * docs/superpowers/specs/2026-07-17-acoustic-vocal-activity-aligner-design.md.
 */
import { fft, hannWindow } from './fft'
import { yieldToEventLoop } from '../core/idle'

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

/**
 * A vocal-activity computation split so the frame loop can be driven in slices.
 * The FFT math dominates — measured ~128ms per minute of audio, so a 6:33 track
 * holds the thread for ~810ms on a fast machine and multiples of that on the
 * `lite` tier — and it runs on the MAIN thread from the align flow, where it
 * froze the progress UI and its cancel button.
 */
interface VocalActivityRun {
  frames: number
  /** Processes frames in [from, to). */
  processFrames(from: number, to: number): void
  finish(): VocalActivitySignal
}

function beginVocalActivity(
  pcm: Float32Array,
  sampleRate: number,
  opts: { source: 'stem' | 'mix' },
): VocalActivityRun {
  // window ≈46ms; hop = nFft/2 (≈23ms at 44.1kHz, ≈32ms at 16kHz).
  const nFft = Math.max(256, nextPow2(Math.round(0.046 * sampleRate)))
  const hop = Math.max(1, Math.round(nFft / 2))
  const hopSec = hop / sampleRate
  if (pcm.length < nFft) {
    const empty: VocalActivitySignal = { hopSec, activity: new Float32Array(0), onset: new Float32Array(0), source: opts.source }
    return { frames: 0, processFrames: () => {}, finish: () => empty }
  }
  // Framing is inlined rather than calling stft(), which materializes the whole
  // spectrogram as 2*nBins separate Float32Arrays — 144MB across 4098 arrays for
  // a 6:33 track at 48kHz — only for this function to reduce each frame to three
  // scalars. Fusing the reduction into the frame loop drops that allocation
  // entirely and reads each FFT result while it is still in cache, instead of
  // scattering it column-wise across thousands of arrays.
  //
  // stft() itself is unchanged: demucs.worker genuinely needs the full
  // spectrogram to run the model and invert it.
  const win = hannWindow(nFft)
  const nBins = Math.floor(nFft / 2) + 1
  const pad = Math.floor(nFft / 2)
  const padded = new Float32Array(pcm.length + nFft)
  padded.set(pcm, pad)
  const frames = Math.floor((padded.length - nFft) / hop) + 1

  const binLo = Math.max(1, Math.floor((VOCAL_LO_HZ * nFft) / sampleRate))
  const binHi = Math.min(nBins - 1, Math.ceil((VOCAL_HI_HZ * nFft) / sampleRate))

  // Per-frame vocal-band and total power.
  const vocalPow = new Float32Array(frames)
  const totalPow = new Float32Array(frames)
  const totalMag = new Float32Array(frames)
  const re = new Float64Array(nFft)
  const im = new Float64Array(nFft)
  const processFrames = (from: number, to: number): void => {
  for (let f = from; f < to; f++) {
    const offset = f * hop
    re.fill(0)
    im.fill(0)
    for (let i = 0; i < nFft && offset + i < padded.length; i++) re[i] = padded[offset + i] * win[i]
    fft(re, im)
    let vp = 0, tp = 0
    for (let b = 0; b < nBins; b++) {
      // fround because stft() stored these bins into Float32Arrays before they
      // were squared; keeping the same rounding keeps the activity values — and
      // every VOICED_THRESHOLD comparison downstream — bit-identical.
      const rb = Math.fround(re[b])
      const ib = Math.fround(im[b])
      const p = rb * rb + ib * ib
      tp += p
      if (b >= binLo && b <= binHi) vp += p
    }
    vocalPow[f] = vp
    totalPow[f] = tp
    totalMag[f] = Math.sqrt(tp)
  }
  }

  const finish = (): VocalActivitySignal => {
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

  return { frames, processFrames, finish }
}

/** Synchronous whole-song analysis. Fine for short buffers and tests. */
export function computeVocalActivity(
  pcm: Float32Array,
  sampleRate: number,
  opts: { source: 'stem' | 'mix' },
): VocalActivitySignal {
  const run = beginVocalActivity(pcm, sampleRate, opts)
  run.processFrames(0, run.frames)
  return run.finish()
}

/** Frames processed between clock checks — small enough that one batch is well
 * under a frame budget even on a slow device, large enough that the check costs
 * nothing next to the FFTs. */
const FRAME_BATCH = 32
/** Hold the thread no longer than this before letting the UI breathe. */
const YIELD_BUDGET_MS = 12

/**
 * Same analysis, yielding to the event loop so the align progress UI keeps
 * painting and its cancel button keeps responding. Byte-for-byte identical to
 * the synchronous version — it is the same loop, just interrupted.
 *
 * The budget is wall-clock rather than a fixed frame count so a slow device
 * yields more often instead of freezing for longer. Yielding goes through
 * `yieldToEventLoop`, not `yieldToMainThread`: the latter waits for idle, which
 * a background tab may not grant for a second at a time, and align often runs
 * while the user is on another tab.
 */
export async function computeVocalActivityAsync(
  pcm: Float32Array,
  sampleRate: number,
  opts: { source: 'stem' | 'mix' },
): Promise<VocalActivitySignal> {
  const run = beginVocalActivity(pcm, sampleRate, opts)
  let f = 0
  while (f < run.frames) {
    const sliceStart = performance.now()
    while (f < run.frames && performance.now() - sliceStart < YIELD_BUDGET_MS) {
      const to = Math.min(f + FRAME_BATCH, run.frames)
      run.processFrames(f, to)
      f = to
    }
    if (f < run.frames) await yieldToEventLoop()
  }
  return run.finish()
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

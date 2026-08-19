/**
 * Coarse amplitude peaks for the re-timing waveform.
 *
 * Re-timing by ear alone gave no visual anchor: a bare slider and a number tell
 * you nothing about where the vocal actually is, so the drag was usable but a poor
 * experience to sync with. Drawing the audio gives the eye something to aim at,
 * and the ear only has to confirm.
 *
 * Deliberately amplitude peaks off the raw mix rather than the vocal-activity
 * envelope: that envelope only exists when a Demucs stem was produced, which
 * excludes every lite-tier browser (Firefox forks have no WebGPU) — exactly the
 * setups that would benefit most. A mix waveform is a weaker signal, but it is
 * ADVISORY here. The user's eyes do the judging, so "weaker" costs nothing, where
 * for snapping it would have meant committing a drum transient as a vocal entry.
 *
 * Pure and DOM-free.
 */

/** Buckets per second. 100 gives 10ms columns — finer than any pixel we draw. */
export const PEAKS_PER_SEC = 100

export interface Peaks {
  /** Peak absolute amplitude per bucket, normalized so the track maximum is 1. */
  data: Float32Array
  perSec: number
}

/**
 * Reduce PCM to per-bucket peak amplitude, normalized to the track's own maximum.
 *
 * Peak rather than RMS: a vocal entry is a sharp transient, and RMS averaging
 * smears exactly the edge the user is trying to line up with.
 */
export function computePeaks(pcm: Float32Array, sampleRate: number, perSec = PEAKS_PER_SEC): Peaks {
  if (!(sampleRate > 0) || pcm.length === 0) return { data: new Float32Array(0), perSec }
  const per = perSec > 0 ? perSec : PEAKS_PER_SEC
  const samplesPerBucket = Math.max(1, Math.round(sampleRate / per))
  const buckets = Math.ceil(pcm.length / samplesPerBucket)
  const data = new Float32Array(buckets)
  let max = 0
  for (let b = 0; b < buckets; b++) {
    const from = b * samplesPerBucket
    const to = Math.min(pcm.length, from + samplesPerBucket)
    let peak = 0
    for (let i = from; i < to; i++) {
      const v = pcm[i] < 0 ? -pcm[i] : pcm[i]
      if (v > peak) peak = v
    }
    data[b] = peak
    if (peak > max) max = peak
  }
  // Normalize to the track's own loudest moment, so a quietly-mastered song is
  // still legible. A silent track stays all-zero rather than dividing by zero.
  if (max > 0) for (let b = 0; b < buckets; b++) data[b] /= max
  return { data, perSec: per }
}

/**
 * Resample a time span down to exactly `columns` values for drawing.
 *
 * Takes the MAXIMUM across each column's buckets, not the mean: at these widths a
 * column covers tens of milliseconds, and averaging would flatten a transient into
 * the quiet around it — losing the one feature being aimed at.
 */
export function peaksWindow(
  peaks: Peaks | null | undefined,
  startSec: number,
  endSec: number,
  columns: number,
): Float32Array {
  const cols = Math.max(1, Math.floor(columns))
  const out = new Float32Array(cols)
  if (!peaks || peaks.data.length === 0 || !(endSec > startSec)) return out
  const span = endSec - startSec
  for (let c = 0; c < cols; c++) {
    const t0 = startSec + (span * c) / cols
    const t1 = startSec + (span * (c + 1)) / cols
    const b0 = Math.max(0, Math.floor(t0 * peaks.perSec))
    const b1 = Math.min(peaks.data.length, Math.max(b0 + 1, Math.ceil(t1 * peaks.perSec)))
    let peak = 0
    for (let b = b0; b < b1; b++) if (peaks.data[b] > peak) peak = peaks.data[b]
    out[c] = peak
  }
  return out
}

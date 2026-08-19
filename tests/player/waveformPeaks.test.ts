import { describe, it, expect } from 'vitest'
import { computePeaks, peaksWindow, PEAKS_PER_SEC } from '../../src/player/waveformPeaks'

/** Silence, then a loud burst from burstSec for 0.5s. */
function pcmWithBurst(burstSec: number, durSec = 10, sampleRate = 1000): Float32Array {
  const pcm = new Float32Array(durSec * sampleRate)
  const from = Math.floor(burstSec * sampleRate)
  const to = Math.floor((burstSec + 0.5) * sampleRate)
  for (let i = from; i < to; i++) pcm[i] = i % 2 === 0 ? 0.8 : -0.8
  return pcm
}

describe('computePeaks', () => {
  it('normalizes to the track loudest moment', () => {
    const { data } = computePeaks(pcmWithBurst(3), 1000)
    expect(Math.max(...data)).toBeCloseTo(1, 5)
  })

  it('puts the energy where the sound is and silence everywhere else', () => {
    const p = computePeaks(pcmWithBurst(3), 1000)
    const at = (t: number) => p.data[Math.floor(t * p.perSec)]
    expect(at(3.2)).toBeGreaterThan(0.9)
    expect(at(1)).toBe(0)
    expect(at(8)).toBe(0)
  })

  // A quietly-mastered track must still be legible, so normalization is relative.
  it('makes a quiet track as legible as a loud one', () => {
    const quiet = pcmWithBurst(3)
    for (let i = 0; i < quiet.length; i++) quiet[i] *= 0.02
    expect(Math.max(...computePeaks(quiet, 1000).data)).toBeCloseTo(1, 5)
  })

  it('survives silence without dividing by zero', () => {
    const { data } = computePeaks(new Float32Array(1000), 1000)
    expect(data.every((v) => v === 0)).toBe(true)
  })

  it('returns nothing for empty or nonsense input', () => {
    expect(computePeaks(new Float32Array(0), 44100).data.length).toBe(0)
    expect(computePeaks(pcmWithBurst(1), 0).data.length).toBe(0)
  })

  it('defaults to a resolution finer than any pixel drawn', () => {
    expect(PEAKS_PER_SEC).toBeGreaterThanOrEqual(50)
  })
})

describe('peaksWindow', () => {
  const peaks = computePeaks(pcmWithBurst(3), 1000)

  it('returns exactly the columns asked for', () => {
    expect(peaksWindow(peaks, 0, 10, 64).length).toBe(64)
    expect(peaksWindow(peaks, 0, 10, 1).length).toBe(1)
  })

  it('places the burst in the right part of the window', () => {
    const cols = peaksWindow(peaks, 0, 10, 100)
    // Burst spans 3.0-3.5s of a 10s window drawn across 100 columns.
    expect(Math.max(...cols.slice(30, 35))).toBeGreaterThan(0.9)
    expect(Math.max(...cols.slice(0, 25))).toBe(0)
    expect(Math.max(...cols.slice(60, 100))).toBe(0)
  })

  // The whole point of the waveform is seeing the transient. Averaging a column
  // would flatten a 10ms attack into the silence around it and hide it.
  it('keeps a narrow transient visible in a wide window', () => {
    const spike = new Float32Array(10 * 1000)
    for (let i = 5000; i < 5010; i++) spike[i] = 1 // 10ms of sound in 10s
    const cols = peaksWindow(computePeaks(spike, 1000), 0, 10, 50)
    expect(Math.max(...cols)).toBeCloseTo(1, 5)
  })

  it('is inert without peaks, rather than throwing', () => {
    expect(peaksWindow(null, 0, 10, 8).every((v) => v === 0)).toBe(true)
    expect(peaksWindow(peaks, 5, 5, 8).every((v) => v === 0)).toBe(true)
  })
})

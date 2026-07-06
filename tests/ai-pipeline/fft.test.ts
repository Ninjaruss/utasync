import { describe, it, expect } from 'vitest'
import { hannWindow, stft, istft } from '../../src/ai-pipeline/fft'

describe('hannWindow', () => {
  it('has unit sum-of-squares suitable for overlap-add', () => {
    const n = 7680
    const hop = 1024
    const w = hannWindow(n)
    // For 75% overlap, sum of squared windows at any position ≈ 1
    const wSq = new Float64Array(n)
    for (let i = 0; i < w.length; i++) wSq[i] = w[i] * w[i]
    let total = 0
    for (let i = 0; i < hop; i++) {
      for (let k = 0; k * hop + i < n; k++) total += wSq[k * hop + i]
    }
    const avg = total / hop
    // n=7680, hop=1024 gives ~7.5x overlap; avg(wSq) * 7.5 ≈ 2.81
    expect(avg).toBeGreaterThan(1.5)
    expect(avg).toBeLessThan(4.0)
  })
})

describe('stft / istft roundtrip', () => {
  it('recovers a 440 Hz sine wave within 0.001 RMS error (n_fft=512, power-of-2)', () => {
    const sr = 44100
    const n = sr  // 1 second
    const audio = new Float32Array(n)
    for (let i = 0; i < n; i++) audio[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / sr)
    const nFft = 512
    const hop = 128
    const win = hannWindow(nFft)
    const spec = stft(audio, nFft, hop, win)
    const recovered = istft(spec.real, spec.imag, nFft, hop, win, n)
    let sumSqErr = 0
    const guard = nFft
    for (let i = guard; i < n - guard; i++) sumSqErr += (audio[i] - recovered[i]) ** 2
    const rms = Math.sqrt(sumSqErr / (n - 2 * guard))
    expect(rms).toBeLessThan(0.001)
  })

  it('recovers a 440 Hz sine wave within 0.001 RMS error (n_fft=7680, non-power-of-2)', () => {
    const sr = 44100
    const n = sr
    const audio = new Float32Array(n)
    for (let i = 0; i < n; i++) audio[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / sr)
    const nFft = 7680
    const hop = 1024
    const win = hannWindow(nFft)
    const spec = stft(audio, nFft, hop, win)
    const recovered = istft(spec.real, spec.imag, nFft, hop, win, n)
    let sumSqErr = 0
    const guard = nFft
    for (let i = guard; i < n - guard; i++) sumSqErr += (audio[i] - recovered[i]) ** 2
    const rms = Math.sqrt(sumSqErr / (n - 2 * guard))
    expect(rms).toBeLessThan(0.001)
  })

  it('roundtrip preserves silence as silence', () => {
    const audio = new Float32Array(44100)  // all zeros
    const win = hannWindow(512)
    const spec = stft(audio, 512, 128, win)
    const recovered = istft(spec.real, spec.imag, 512, 128, win, audio.length)
    const maxAbs = recovered.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
    expect(maxAbs).toBeLessThan(1e-6)
  })
})

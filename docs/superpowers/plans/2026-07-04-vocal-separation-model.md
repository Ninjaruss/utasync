# Vocal Separation Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder Demucs worker with a real MDX-Net vocal separation pipeline using Kim_Vocal_2.onnx, hosted as a GitHub release asset.

**Architecture:** Pure-TypeScript STFT (Bluestein FFT for arbitrary-length n_fft=7680) lives in `fft.ts`; the worker imports it and runs chunked overlap-add inference against the ONNX model; `demucsSeparator.ts` threads `sampleRate` through to the worker so it can resample to 44100 Hz before processing.

**Tech Stack:** onnxruntime-web (already in repo), TypeScript Web Worker, Bluestein chirp-z transform FFT, Hann window STFT/ISTFT, GitHub release assets for model hosting.

---

## File Map

| File | Change |
|---|---|
| `src/ai-pipeline/fft.ts` | **Create** — Bluestein FFT, STFT, ISTFT |
| `tests/ai-pipeline/fft.test.ts` | **Create** — roundtrip and correctness tests |
| `src/ai-pipeline/demucsSeparator.ts` | **Modify** — add `sampleRate` to options + worker message |
| `src/ai-pipeline/AutoAlignFlow.tsx` | **Modify** — pass `sampleRate` to `separateVocals` |
| `src/ai-pipeline/demucs.worker.ts` | **Rewrite** — full MDX-Net chunked STFT pipeline |
| `src/ai-pipeline/demucsModelUrl.ts` | **Modify** — fallback filename update |

---

## Task 0: Download and Inspect Kim_Vocal_2.onnx

**Files:** none — local setup only

- [ ] **Step 1: Download the model**

```bash
curl -L -o Kim_Vocal_2.onnx \
  "https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/Kim_Vocal_2.onnx"
```

Expected: file ~62 MB. If that URL 404s, go to https://github.com/TRvlvr/model_repo/releases and download `Kim_Vocal_2.onnx` manually.

- [ ] **Step 2: Verify the file size**

```bash
ls -lh Kim_Vocal_2.onnx
```

Expected: between 50 MB and 80 MB.

- [ ] **Step 3: Inspect the model input/output shapes**

```bash
python3 - <<'EOF'
import onnxruntime as rt
sess = rt.InferenceSession('Kim_Vocal_2.onnx', providers=['CPUExecutionProvider'])
print("Inputs:")
for i in sess.get_inputs():
    print(f"  {i.name}: {i.shape} {i.type}")
print("Outputs:")
for o in sess.get_outputs():
    print(f"  {o.name}: {o.shape} {o.type}")
EOF
```

If `onnxruntime` is not installed: `pip3 install onnxruntime`

Expected output (verify these match before continuing):
```
Inputs:
  input: [1, 4, 3072, 256] float32
Outputs:
  output: [1, 4, 3072, 256] float32
```

> **If the shapes differ** — note the actual DIM_F (index 2) and DIM_T (index 3) and use those values instead of 3072/256 throughout Tasks 1 and 4.

- [ ] **Step 4: Confirm n_fft with a quick check**

```bash
python3 - <<'EOF'
# Kim_Vocal_2 was trained with n_fft=7680, hop=1024.
# Verify DIM_F is consistent: n_fft/2+1 = 3841, and DIM_F=3072 < 3841. ✓
print("n_bins from n_fft=7680:", 7680 // 2 + 1)   # 3841
print("DIM_F used:", 3072, "— first 3072 of 3841 bins")
EOF
```

Expected: `3841` and `3072`.

---

## Task 1: Implement `src/ai-pipeline/fft.ts`

**Files:**
- Create: `src/ai-pipeline/fft.ts`
- Create: `tests/ai-pipeline/fft.test.ts`

- [ ] **Step 1: Write the failing roundtrip test first**

Create `tests/ai-pipeline/fft.test.ts`:

```typescript
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
    expect(avg).toBeGreaterThan(0.4)
    expect(avg).toBeLessThan(1.6)
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
```

- [ ] **Step 2: Run to confirm tests fail**

```bash
npx vitest run tests/ai-pipeline/fft.test.ts
```

Expected: `Cannot find module '../../src/ai-pipeline/fft'`

- [ ] **Step 3: Create `src/ai-pipeline/fft.ts`**

```typescript
// ---------------------------------------------------------------------------
// FFT, STFT, ISTFT for the Demucs MDX-Net vocal separation worker.
//
// Uses Bluestein's chirp-z transform so n_fft=7680 (not a power of 2) works
// correctly. The power-of-2 fast path keeps 512/1024/... sizes fast in tests.
// ---------------------------------------------------------------------------

function nextPow2(n: number): number {
  let p = 1
  while (p < n) p <<= 1
  return p
}

/** Radix-2 Cooley-Tukey FFT, in-place. n must be a power of 2. */
function fftPow2(re: Float64Array, im: Float64Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t
      t = im[i]; im[i] = im[j]; im[j] = t
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len
    const wr = Math.cos(ang)
    const wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0
      for (let j = 0; j < (len >> 1); j++) {
        const ur = re[i + j], ui = im[i + j]
        const vr = re[i + j + (len >> 1)] * cr - im[i + j + (len >> 1)] * ci
        const vi = re[i + j + (len >> 1)] * ci + im[i + j + (len >> 1)] * cr
        re[i + j] = ur + vr; im[i + j] = ui + vi
        re[i + j + (len >> 1)] = ur - vr; im[i + j + (len >> 1)] = ui - vi
        const ncr = cr * wr - ci * wi
        ci = cr * wi + ci * wr; cr = ncr
      }
    }
  }
}

/**
 * Forward DFT of arbitrary length via Bluestein's chirp-z algorithm.
 * Falls through to radix-2 when n is a power of 2.
 */
function fft(re: Float64Array, im: Float64Array): void {
  const N = re.length
  if (N <= 1) return
  if ((N & (N - 1)) === 0) { fftPow2(re, im); return }

  const M = nextPow2(2 * N)

  // chirp[n] = e^{iπn²/N}
  const cRe = new Float64Array(M)
  const cIm = new Float64Array(M)
  for (let n = 0; n < N; n++) {
    const ang = Math.PI * n * n / N
    cRe[n] = Math.cos(ang); cIm[n] = Math.sin(ang)
    if (n > 0) { cRe[M - n] = cRe[n]; cIm[M - n] = cIm[n] }
  }

  // y[n] = x[n] * conj(chirp[n])
  const yRe = new Float64Array(M)
  const yIm = new Float64Array(M)
  for (let n = 0; n < N; n++) {
    yRe[n] = re[n] * cRe[n] + im[n] * cIm[n]
    yIm[n] = im[n] * cRe[n] - re[n] * cIm[n]
  }

  const hRe = cRe.slice(); const hIm = cIm.slice()
  fftPow2(yRe, yIm); fftPow2(hRe, hIm)

  for (let k = 0; k < M; k++) {
    const r = yRe[k] * hRe[k] - yIm[k] * hIm[k]
    yIm[k] = yRe[k] * hIm[k] + yIm[k] * hRe[k]; yRe[k] = r
  }

  // IFFT via conjugate trick
  for (let k = 0; k < M; k++) yIm[k] = -yIm[k]
  fftPow2(yRe, yIm)
  for (let k = 0; k < M; k++) { yRe[k] /= M; yIm[k] = -yIm[k] / M }

  // X[k] = conj(chirp[k]) * g[k]
  for (let k = 0; k < N; k++) {
    re[k] = yRe[k] * cRe[k] + yIm[k] * cIm[k]
    im[k] = yIm[k] * cRe[k] - yRe[k] * cIm[k]
  }
}

/** Inverse DFT of arbitrary length. In-place. */
function ifft(re: Float64Array, im: Float64Array): void {
  for (let i = 0; i < im.length; i++) im[i] = -im[i]
  fft(re, im)
  const N = re.length
  for (let i = 0; i < N; i++) { re[i] /= N; im[i] = -im[i] / N }
}

/** Symmetric Hann window of length `size`. */
export function hannWindow(size: number): Float32Array {
  const w = new Float32Array(size)
  for (let i = 0; i < size; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)))
  }
  return w
}

export interface StftResult {
  real: Float32Array[]  // [n_bins][n_frames]
  imag: Float32Array[]
  frames: number
}

/**
 * Short-time Fourier transform.
 * Returns one-sided complex spectrogram: n_bins = nFft/2+1, indexed [bin][frame].
 */
export function stft(
  audio: Float32Array,
  nFft: number,
  hop: number,
  win: Float32Array,
): StftResult {
  const nBins = Math.floor(nFft / 2) + 1
  // Center-pad so the first and last frames are centered on the signal edges.
  const pad = Math.floor(nFft / 2)
  const padded = new Float32Array(audio.length + nFft)
  padded.set(audio, pad)

  const frames = Math.floor((padded.length - nFft) / hop) + 1
  const real: Float32Array[] = Array.from({ length: nBins }, () => new Float32Array(frames))
  const imag: Float32Array[] = Array.from({ length: nBins }, () => new Float32Array(frames))

  const re = new Float64Array(nFft)
  const im = new Float64Array(nFft)

  for (let f = 0; f < frames; f++) {
    const offset = f * hop
    re.fill(0); im.fill(0)
    for (let i = 0; i < nFft && offset + i < padded.length; i++) {
      re[i] = padded[offset + i] * win[i]
    }
    fft(re, im)
    for (let b = 0; b < nBins; b++) {
      real[b][f] = re[b]
      imag[b][f] = im[b]
    }
  }
  return { real, imag, frames }
}

/**
 * Inverse STFT via overlap-add.
 * real/imag must be indexed [bin][frame] with n_bins = nFft/2+1.
 * Returns audio of exactly `length` samples.
 */
export function istft(
  real: Float32Array[],
  imag: Float32Array[],
  nFft: number,
  hop: number,
  win: Float32Array,
  length: number,
): Float32Array {
  const nBins = real.length
  const frames = real[0].length
  const outLen = (frames - 1) * hop + nFft
  const output = new Float64Array(outLen)
  const wSum = new Float64Array(outLen)

  const re = new Float64Array(nFft)
  const im = new Float64Array(nFft)

  for (let f = 0; f < frames; f++) {
    re.fill(0); im.fill(0)
    for (let b = 0; b < nBins; b++) {
      re[b] = real[b][f]; im[b] = imag[b][f]
    }
    // Mirror one-sided → two-sided (real-valued signal)
    for (let b = 1; b < nBins - 1; b++) {
      re[nFft - b] = real[b][f]; im[nFft - b] = -imag[b][f]
    }
    ifft(re, im)
    const offset = f * hop
    for (let i = 0; i < nFft; i++) {
      output[offset + i] += re[i] * win[i]
      wSum[offset + i] += win[i] * win[i]
    }
  }

  // Normalize by window overlap sum, trim center-padding
  const result = new Float32Array(length)
  const pad = Math.floor(nFft / 2)
  for (let i = 0; i < length; i++) {
    const w = wSum[pad + i]
    result[i] = w > 1e-8 ? output[pad + i] / w : 0
  }
  return result
}
```

- [ ] **Step 4: Run the tests and verify they pass**

```bash
npx vitest run tests/ai-pipeline/fft.test.ts
```

Expected: `3 passed`. The n_fft=7680 test will be slow (~5s) — that's normal for Bluestein on a 1-second signal.

- [ ] **Step 5: Run full test suite to catch regressions**

```bash
npx vitest run
```

Expected: all existing tests still pass, 3 new tests added.

- [ ] **Step 6: Commit**

```bash
git add src/ai-pipeline/fft.ts tests/ai-pipeline/fft.test.ts
git commit -m "feat(vocal-sep): add FFT/STFT/ISTFT module with Bluestein support"
```

---

## Task 2: Thread `sampleRate` Through `demucsSeparator.ts`

**Files:**
- Modify: `src/ai-pipeline/demucsSeparator.ts`

The worker needs the original sample rate to resample to 44100 Hz before inference. Currently `separateVocals` doesn't accept or forward it.

- [ ] **Step 1: Update `SeparateVocalsOptions` and the worker message**

Open `src/ai-pipeline/demucsSeparator.ts`. Make these two changes:

Change the `SeparateVocalsOptions` interface (currently at the bottom of the file above `separateVocals`):

```typescript
export interface SeparateVocalsOptions {
  sampleRate?: number          // <-- add this line
  onProgress?: (progress: number) => void
  isCancelled?: () => boolean
}
```

In `separateVocals`, find the line:
```typescript
const pcm = new Float32Array(audioData)
worker.postMessage({ type: 'separate', payload: { audioData: pcm } }, [pcm.buffer])
```

Replace it with:
```typescript
const pcm = new Float32Array(audioData)
worker.postMessage(
  { type: 'separate', payload: { audioData: pcm, sampleRate: options?.sampleRate ?? 44100 } },
  [pcm.buffer],
)
```

- [ ] **Step 2: Run tests**

```bash
npx vitest run
```

Expected: all pass. (TypeScript will catch a mismatch in the next task if AutoAlignFlow.tsx passes the wrong shape.)

- [ ] **Step 3: Commit**

```bash
git add src/ai-pipeline/demucsSeparator.ts
git commit -m "feat(vocal-sep): thread sampleRate through separateVocals to worker"
```

---

## Task 3: Pass `sampleRate` from `AutoAlignFlow.tsx`

**Files:**
- Modify: `src/ai-pipeline/AutoAlignFlow.tsx:152`

- [ ] **Step 1: Add sampleRate to the separateVocals call**

In `src/ai-pipeline/AutoAlignFlow.tsx`, find the existing call (around line 152):

```typescript
audioData = await separateVocals(audioData, {
  onProgress: (pct) => setProgress(pct),
  isCancelled: () => cancelledRef.current,
})
```

Replace with:

```typescript
audioData = await separateVocals(audioData, {
  sampleRate,
  onProgress: (pct) => setProgress(pct),
  isCancelled: () => cancelledRef.current,
})
```

(`sampleRate` is already declared at line 127 from `decoded.sampleRate`.)

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/ai-pipeline/AutoAlignFlow.tsx
git commit -m "feat(vocal-sep): pass decoded sampleRate to separateVocals"
```

---

## Task 4: Rewrite `src/ai-pipeline/demucs.worker.ts`

**Files:**
- Rewrite: `src/ai-pipeline/demucs.worker.ts`

This is the full MDX-Net inference pipeline. Read the model shapes you confirmed in Task 0 before writing this — update `DIM_F` and `DIM_T` if they differ from 3072/256.

- [ ] **Step 1: Replace the entire file**

```typescript
/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web'
import { DEMUCS_MODEL_URL } from './demucsModelUrl'
import { hannWindow, stft, istft } from './fft'

// ---------------------------------------------------------------------------
// MDX-Net Kim_Vocal_2 parameters — must match what the model was trained with.
// Update DIM_F / DIM_T if the model inspection in Task 0 gives different values.
// ---------------------------------------------------------------------------
const SAMPLE_RATE = 44100
const N_FFT = 7680
const HOP = 1024
const DIM_F = 3072   // frequency bins the model uses (< N_FFT/2+1 = 3841)
const DIM_T = 256    // time frames per inference chunk
const OVERLAP = 0.75 // fraction of each chunk that overlaps with the next
const STEP = Math.round(DIM_T * (1 - OVERLAP)) // = 64 frames between chunk starts

let session: ort.InferenceSession | null = null

/** Linear resampler — accurate enough for 44100↔48000; Whisper already resamples separately. */
function resample(audio: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return audio
  const ratio = fromRate / toRate
  const outLen = Math.round(audio.length / ratio)
  const out = new Float32Array(outLen)
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio
    const lo = Math.floor(pos)
    const hi = Math.min(lo + 1, audio.length - 1)
    out[i] = audio[lo] * (1 - (pos - lo)) + audio[hi] * (pos - lo)
  }
  return out
}

self.onmessage = async (e: MessageEvent) => {
  const { type, payload } = e.data

  if (type === 'load') {
    try {
      self.postMessage({ type: 'progress', payload: { status: 'loading', progress: 0 } })
      session = await ort.InferenceSession.create(DEMUCS_MODEL_URL, {
        executionProviders: ['webgpu', 'wasm'],
      })
      self.postMessage({ type: 'loaded' })
    } catch (err) {
      self.postMessage({
        type: 'error',
        payload: err instanceof Error ? err.message : 'Failed to load vocal separation model',
      })
    }
    return
  }

  if (type === 'separate') {
    if (!session) { self.postMessage({ type: 'error', payload: 'Model not loaded' }); return }
    try {
      const { audioData, sampleRate } = payload as { audioData: Float32Array; sampleRate: number }
      self.postMessage({ type: 'progress', payload: { status: 'separating', progress: 3 } })

      // 1. Resample to the model's expected rate
      const audio = resample(audioData, sampleRate, SAMPLE_RATE)
      const origLen = audio.length

      // 2. STFT for left and right (both identical — mono treated as fake stereo)
      const win = hannWindow(N_FFT)
      const spec = stft(audio, N_FFT, HOP, win)
      const totalFrames = spec.frames

      self.postMessage({ type: 'progress', payload: { status: 'separating', progress: 8 } })

      // 3. Accumulators for overlap-add: [DIM_F][totalFrames] × 4 channels
      const acc = Array.from({ length: 4 }, () =>
        Array.from({ length: DIM_F }, () => new Float32Array(totalFrames)),
      )
      const weights = new Float32Array(totalFrames)

      // 4. Chunked inference
      const nChunks = Math.max(1, Math.ceil((totalFrames - DIM_T) / STEP) + 1)
      const inputName = session.inputNames[0]
      const outputName = session.outputNames[0]

      for (let c = 0; c < nChunks; c++) {
        const tStart = c * STEP

        // Pack [1, 4, DIM_F, DIM_T] — channels: L_re, L_im, R_re, R_im
        // Fake stereo: L == R (both from the same mono source)
        const inputData = new Float32Array(4 * DIM_F * DIM_T)
        for (let f = 0; f < DIM_F; f++) {
          const lRe = spec.real[f]
          const lIm = spec.imag[f]
          for (let t = 0; t < DIM_T; t++) {
            const srcT = tStart + t
            const re = srcT < totalFrames ? (lRe[srcT] ?? 0) : 0
            const im = srcT < totalFrames ? (lIm[srcT] ?? 0) : 0
            // ch0=L_re, ch1=L_im, ch2=R_re, ch3=R_im  (L==R for mono)
            inputData[(0 * DIM_F + f) * DIM_T + t] = re
            inputData[(1 * DIM_F + f) * DIM_T + t] = im
            inputData[(2 * DIM_F + f) * DIM_T + t] = re
            inputData[(3 * DIM_F + f) * DIM_T + t] = im
          }
        }

        const feeds: Record<string, ort.Tensor> = {
          [inputName]: new ort.Tensor('float32', inputData, [1, 4, DIM_F, DIM_T]),
        }
        const results = await session.run(feeds)
        const out = results[outputName].data as Float32Array

        // Overlap-add into accumulators
        for (let ch = 0; ch < 4; ch++) {
          for (let f = 0; f < DIM_F; f++) {
            for (let t = 0; t < DIM_T; t++) {
              const dstT = tStart + t
              if (dstT >= totalFrames) break
              acc[ch][f][dstT] += out[(ch * DIM_F + f) * DIM_T + t]
            }
          }
        }
        // Track how many chunks overlap at each frame (use ch0/f0 as proxy)
        for (let t = 0; t < DIM_T; t++) {
          const dstT = tStart + t
          if (dstT < totalFrames) weights[dstT]++
        }

        self.postMessage({
          type: 'progress',
          payload: { status: 'separating', progress: 8 + Math.round((c / nChunks) * 82) },
        })
      }

      // 5. Normalize by overlap count
      for (let ch = 0; ch < 4; ch++) {
        for (let f = 0; f < DIM_F; f++) {
          for (let t = 0; t < totalFrames; t++) {
            acc[ch][f][t] /= weights[t] || 1
          }
        }
      }

      // 6. Average L and R vocal channels → mono spectrogram
      //    L = channels 0+1 (re/im), R = channels 2+3 (re/im)
      //    mono_re[f][t] = (L_re + R_re) / 2, etc.
      const nBins = Math.floor(N_FFT / 2) + 1
      const vRe: Float32Array[] = Array.from({ length: nBins }, (_, f) => {
        const row = new Float32Array(totalFrames)
        if (f < DIM_F) {
          for (let t = 0; t < totalFrames; t++) row[t] = (acc[0][f][t] + acc[2][f][t]) * 0.5
        }
        return row
      })
      const vIm: Float32Array[] = Array.from({ length: nBins }, (_, f) => {
        const row = new Float32Array(totalFrames)
        if (f < DIM_F) {
          for (let t = 0; t < totalFrames; t++) row[t] = (acc[1][f][t] + acc[3][f][t]) * 0.5
        }
        return row
      })

      self.postMessage({ type: 'progress', payload: { status: 'separating', progress: 92 } })

      // 7. ISTFT → mono waveform
      const vocals = istft(vRe, vIm, N_FFT, HOP, win, origLen)

      self.postMessage({ type: 'progress', payload: { status: 'separating', progress: 100 } })
      self.postMessage({ type: 'result', payload: vocals }, [vocals.buffer])
    } catch (err) {
      self.postMessage({
        type: 'error',
        payload: err instanceof Error ? err.message : 'Vocal separation failed',
      })
    }
  }
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Run full test suite**

```bash
npx vitest run
```

Expected: all pass (worker is not unit-tested; model integration is manual).

- [ ] **Step 4: Commit**

```bash
git add src/ai-pipeline/demucs.worker.ts
git commit -m "feat(vocal-sep): rewrite Demucs worker with MDX-Net STFT chunked inference"
```

---

## Task 5: Update `demucsModelUrl.ts` Fallback Filename

**Files:**
- Modify: `src/ai-pipeline/demucsModelUrl.ts`

- [ ] **Step 1: Update the fallback path**

In `src/ai-pipeline/demucsModelUrl.ts`, change:

```typescript
export const DEMUCS_MODEL_URL: string =
  import.meta.env.VITE_DEMUCS_MODEL_URL || '/models/demucs-v1.onnx'
```

To:

```typescript
export const DEMUCS_MODEL_URL: string =
  import.meta.env.VITE_DEMUCS_MODEL_URL || '/models/Kim_Vocal_2.onnx'
```

- [ ] **Step 2: Commit**

```bash
git add src/ai-pipeline/demucsModelUrl.ts
git commit -m "feat(vocal-sep): update fallback model filename to Kim_Vocal_2.onnx"
```

---

## Task 6: Create GitHub Release and Set Env Var

**Files:** none — deployment setup

- [ ] **Step 1: Create the GitHub release with the model file**

Run from the directory containing the downloaded `Kim_Vocal_2.onnx`:

```bash
gh release create models-v1 Kim_Vocal_2.onnx \
  --repo Ninjaruss/utasync \
  --title "AI Models v1" \
  --notes "Kim_Vocal_2 MDX-Net ONNX model for in-browser vocal separation."
```

Expected output: URL like `https://github.com/Ninjaruss/utasync/releases/tag/models-v1`

- [ ] **Step 2: Get the direct download URL**

```bash
gh release view models-v1 --repo Ninjaruss/utasync --json assets --jq '.assets[].browserDownloadUrl'
```

Expected: `https://github.com/Ninjaruss/utasync/releases/download/models-v1/Kim_Vocal_2.onnx`

- [ ] **Step 3: Verify the URL returns CORS headers**

```bash
curl -sI "https://github.com/Ninjaruss/utasync/releases/download/models-v1/Kim_Vocal_2.onnx" \
  -H "Origin: http://localhost:5173" | grep -i "access-control\|location\|content-length"
```

Expected: either `Access-Control-Allow-Origin: *` (direct), or a `Location:` redirect to `objects.githubusercontent.com`. If redirected, check the target URL too:

```bash
# Follow the redirect and check final CORS headers
curl -sIL "https://github.com/Ninjaruss/utasync/releases/download/models-v1/Kim_Vocal_2.onnx" \
  -H "Origin: http://localhost:5173" | grep -i "access-control"
```

Expected: `access-control-allow-origin: *` somewhere in the chain.

> **If CORS is not present:** host the file on Cloudflare R2 (free tier) instead. Create a public bucket, upload `Kim_Vocal_2.onnx`, enable public access with CORS rules `Access-Control-Allow-Origin: *` for GET and HEAD. Use the R2 public URL as `VITE_DEMUCS_MODEL_URL`.

- [ ] **Step 4: Set the env var for local dev**

Create (or edit) `.env.local` in the repo root:

```
VITE_DEMUCS_MODEL_URL=https://github.com/Ninjaruss/utasync/releases/download/models-v1/Kim_Vocal_2.onnx
```

`.env.local` is gitignored — this stays local only.

- [ ] **Step 5: Set the env var in Vercel (for deployed builds)**

```bash
# If Vercel CLI is installed:
vercel env add VITE_DEMUCS_MODEL_URL production
# paste the URL when prompted

# Or set it in the Vercel dashboard:
# Project → Settings → Environment Variables → Add
# Name: VITE_DEMUCS_MODEL_URL
# Value: https://github.com/Ninjaruss/utasync/releases/download/models-v1/Kim_Vocal_2.onnx
# Environment: Production (and Preview if desired)
```

- [ ] **Step 6: Push the code branch**

```bash
git push origin main
```

---

## Task 7: End-to-End Manual Test

- [ ] **Step 1: Start dev server**

```bash
npm run dev
```

- [ ] **Step 2: Verify the model is detected**

Open the app. Import any song with a local audio file. Open Auto-align. On a capable device (WebGPU + 6 GB+ RAM), the "Isolate vocals first" toggle should appear and be **enabled** (not grayed out).

If it stays grayed out: open DevTools → Network tab → filter `.onnx` → check if a HEAD request to the model URL returned 200.

- [ ] **Step 3: Run vocal separation**

Enable the toggle and click Align. Watch the progress bar advance through "Isolating vocals" (chunked inference — ~15–45s depending on song length and device). Expected: no error, progress reaches 100%, then transitions to "Transcribing".

- [ ] **Step 4: Compare alignment confidence**

Run auto-align twice on the same song (once without vocal separation, once with). Songs with heavy instrumentation (STRANGER THAN HEAVEN) should show higher confidence and fewer `approximate` lines with separation enabled.

- [ ] **Step 5: Confirm service worker caches the model**

After first successful run: DevTools → Application → Cache Storage → `ai-models-v1` → verify `Kim_Vocal_2.onnx` is listed. Second run should not re-download the model.

- [ ] **Step 6: Redeploy (if Vercel env var was set)**

```bash
# Trigger a new Vercel deploy so the production build bakes in VITE_DEMUCS_MODEL_URL
git commit --allow-empty -m "chore: trigger redeploy with VITE_DEMUCS_MODEL_URL"
git push origin main
```

Or deploy via the Vercel dashboard.

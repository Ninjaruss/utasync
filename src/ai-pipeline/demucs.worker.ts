/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web'
import { describeWorkerError } from './workerError'
import { DEMUCS_MODEL_URL } from './demucsModelUrl'
import { hannWindow, stft, istft } from './fft'

// ---------------------------------------------------------------------------
// MDX-Net Kim_Vocal_2 parameters — must match what the model was trained with.
// ---------------------------------------------------------------------------
const SAMPLE_RATE = 44100
const N_FFT = 7680
const HOP = 1024
const DIM_F = 3072   // frequency bins the model uses (< N_FFT/2+1 = 3841)
const DIM_T = 256    // time frames per inference chunk
const OVERLAP = 0.75 // fraction of each chunk that overlaps with the next
const STEP = Math.round(DIM_T * (1 - OVERLAP)) // = 64 frames between chunk starts

let session: ort.InferenceSession | null = null

/** Where this worker's onnxruntime-web (1.26) loads its jsep runtime (.wasm +
 * dynamically-imported .mjs) from. Vite emits those files to /onnx-wasm-demucs/
 * (see vite.config). Without an explicit path, ORT resolves to a CDN/relative
 * URL that 404s in production, so vocal separation fails there. Mirrors what
 * configureWhisperEnv does for the transformers ORT (a different version). */
function demucsOrtWasmBaseUrl(): string {
  const origin = typeof self !== 'undefined' && 'location' in self ? self.location.origin : ''
  const base = (import.meta.env?.BASE_URL as string | undefined) ?? '/'
  return new URL(`${base}onnx-wasm-demucs/`, origin || undefined).href
}

/** Linear resampler — accurate enough for 44100↔48000. */
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

/** Same union as `SeparationProvider` in demucsSeparator.ts. Declared locally
 * rather than imported: this file is a worker entry point and must not pull in
 * the host module. Keep the two in sync. */
type ProviderName = 'webgpu' | 'wasm'

/**
 * Creates the session and returns which provider actually backs it.
 *
 * Passing `['webgpu', 'wasm']` lets onnxruntime fall back silently, and ORT
 * exposes no way to ask which one it chose — so a WASM run (hours, not minutes)
 * was indistinguishable from a WebGPU one. Trying each provider alone makes the
 * answer knowable, which is the whole point.
 */
async function createSession(): Promise<{ session: ort.InferenceSession; provider: ProviderName }> {
  const gpu = (self.navigator as WorkerNavigator & { gpu?: { requestAdapter?: () => Promise<unknown> } }).gpu
  if (gpu?.requestAdapter) {
    try {
      if (await gpu.requestAdapter()) {
        const session = await ort.InferenceSession.create(DEMUCS_MODEL_URL, {
          executionProviders: ['webgpu'],
        })
        return { session, provider: 'webgpu' }
      }
    } catch (err) {
      console.warn('[demucs.worker] WebGPU session failed, falling back to WASM:', err)
    }
  }
  const session = await ort.InferenceSession.create(DEMUCS_MODEL_URL, {
    executionProviders: ['wasm'],
  })
  return { session, provider: 'wasm' }
}

self.onmessage = async (e: MessageEvent) => {
  const { type, payload } = e.data

  if (type === 'load') {
    try {
      self.postMessage({ type: 'progress', payload: { status: 'loading', progress: 0 } })
      // Serve the ORT runtime locally (offline-first) and never spawn a nested
      // proxy worker — we're already inside a worker. Must run before the first
      // InferenceSession.create.
      ort.env.wasm.wasmPaths = demucsOrtWasmBaseUrl()
      ort.env.wasm.proxy = false
      const created = await createSession()
      session = created.session
      self.postMessage({ type: 'loaded', payload: { provider: created.provider } })
    } catch (err) {
      self.postMessage({
        type: 'error',
        payload: describeWorkerError(err, 'Failed to load vocal separation model'),
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

      // 2. STFT (mono — both L and R will be the same)
      const win = hannWindow(N_FFT)
      const spec = stft(audio, N_FFT, HOP, win)
      const totalFrames = spec.frames

      self.postMessage({ type: 'progress', payload: { status: 'separating', progress: 8 } })

      // 3. Accumulators for overlap-add: [4 channels][DIM_F bins][totalFrames]
      const acc = Array.from({ length: 4 }, () =>
        Array.from({ length: DIM_F }, () => new Float32Array(totalFrames)),
      )
      const weights = new Float32Array(totalFrames)

      // 4. Chunked inference
      const nChunks = Math.max(1, Math.ceil((totalFrames - DIM_T) / STEP) + 1)
      const inputData = new Float32Array(4 * DIM_F * DIM_T) // reused each chunk

      // Wall-clock since inference began, so the host can extrapolate a real ETA
      // from the first completed chunk rather than guessing from a percentage.
      const runStartMs = Date.now()

      for (let c = 0; c < nChunks; c++) {
        const tStart = c * STEP

        // Pack [1, 4, DIM_F, DIM_T] — channels: L_re, L_im, R_re, R_im
        // Fake stereo: L == R (duplicate mono)
        for (let f = 0; f < DIM_F; f++) {
          const binRe = spec.real[f]
          const binIm = spec.imag[f]
          for (let t = 0; t < DIM_T; t++) {
            const srcT = tStart + t
            const re = srcT < totalFrames ? (binRe[srcT] ?? 0) : 0
            const im = srcT < totalFrames ? (binIm[srcT] ?? 0) : 0
            // ch0=L_re, ch1=L_im, ch2=R_re, ch3=R_im
            inputData[(0 * DIM_F + f) * DIM_T + t] = re
            inputData[(1 * DIM_F + f) * DIM_T + t] = im
            inputData[(2 * DIM_F + f) * DIM_T + t] = re
            inputData[(3 * DIM_F + f) * DIM_T + t] = im
          }
        }

        const feeds = { input: new ort.Tensor('float32', inputData, [1, 4, DIM_F, DIM_T]) }
        const results = await session.run(feeds)
        const outTensor = results['output'] ?? results[Object.keys(results)[0]]
        if (!outTensor) throw new Error(`Model returned no output. Keys: ${Object.keys(results).join(', ')}`)
        const out = outTensor.data as Float32Array

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
        for (let t = 0; t < DIM_T; t++) {
          const dstT = tStart + t
          if (dstT < totalFrames) weights[dstT]++
        }

        self.postMessage({
          type: 'progress',
          payload: {
            status: 'separating',
            progress: 8 + Math.round((c / nChunks) * 82),
            chunk: c + 1,
            nChunks,
            elapsedMs: Date.now() - runStartMs,
          },
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
      //    ch0=L_re, ch1=L_im, ch2=R_re, ch3=R_im
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

      // 7. ISTFT → mono vocals waveform
      const vocals = istft(vRe, vIm, N_FFT, HOP, win, origLen)

      self.postMessage({ type: 'progress', payload: { status: 'separating', progress: 100 } })
      self.postMessage({ type: 'result', payload: vocals }, [vocals.buffer])
    } catch (err) {
      self.postMessage({
        type: 'error',
        payload: describeWorkerError(err, 'Vocal separation failed'),
      })
    }
  }
}

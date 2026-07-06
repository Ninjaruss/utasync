/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web'
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

      for (let c = 0; c < nChunks; c++) {
        const tStart = c * STEP

        // Pack [1, 4, DIM_F, DIM_T] — channels: L_re, L_im, R_re, R_im
        // Fake stereo: L == R (duplicate mono)
        const inputData = new Float32Array(4 * DIM_F * DIM_T)
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
        const out = results['output'].data as Float32Array

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
        payload: err instanceof Error ? err.message : 'Vocal separation failed',
      })
    }
  }
}

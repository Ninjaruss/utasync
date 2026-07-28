/**
 * Offline vocal separation — a faithful Node port of src/ai-pipeline/demucs.worker.ts
 * (MDX-Net Kim_Vocal_2, public/models/Kim_Vocal_2.onnx), run through onnxruntime-web's
 * wasm backend. Produces the isolated-vocal stem the app feeds to Whisper when "Isolate
 * vocals" is ON, so the isolation-ON alignment path can be measured OFFLINE (previously
 * browser-only — Whisper timing on a clean stem is far better than on the raw mix, and
 * the acoustic onset anchors in leadingEdgeAnchor.ts are stem-only).
 *
 * Two-step by design (separation is the slow part — ~15 min CPU for a 4 min track):
 *   npx tsx scripts/separate-vocals.mjs <mp3> <out.pcm>     # separate once, cache the stem
 *   npx tsx scripts/e2e-align-stem.mjs <out.pcm> <lyrics.txt> <truth.json>   # align many times
 *
 * Output: raw Float32LE mono PCM @ 44100 Hz (the model's rate). Read it back with
 * `new Float32Array(readFileSync(path).buffer)` at sampleRate 44100.
 */
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as ort from 'onnxruntime-web'
import { hannWindow, stft, istft } from '../src/ai-pipeline/fft.ts'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const { decodeMp3ToMono } = await import(pathToFileURL(join(root, 'scripts/lib/nodeAudio.mjs')).href)

const [, , mp3Path, outPath] = process.argv
if (!mp3Path || !outPath) {
  console.error('Usage: npx tsx scripts/separate-vocals.mjs <mp3> <out.pcm>')
  process.exit(1)
}

// MDX-Net Kim_Vocal_2 params — must match src/ai-pipeline/demucs.worker.ts.
const SAMPLE_RATE = 44100, N_FFT = 7680, HOP = 1024, DIM_F = 3072, DIM_T = 256, OVERLAP = 0.75
const STEP = Math.round(DIM_T * (1 - OVERLAP))
try { ort.env.wasm.numThreads = 4 } catch { /* single-threaded fallback is fine */ }

/** Linear resampler — accurate enough for 44100↔48000 (mirrors the worker). */
function resample(audio, fromRate, toRate) {
  if (fromRate === toRate) return audio
  const ratio = fromRate / toRate
  const outLen = Math.round(audio.length / ratio)
  const out = new Float32Array(outLen)
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio, lo = Math.floor(pos), hi = Math.min(lo + 1, audio.length - 1)
    out[i] = audio[lo] * (1 - (pos - lo)) + audio[hi] * (pos - lo)
  }
  return out
}

const t0 = Date.now()
const session = await ort.InferenceSession.create(join(root, 'public/models/Kim_Vocal_2.onnx'), {
  executionProviders: ['wasm'],
})
console.log(`model loaded ${Date.now() - t0}ms`)

const { data: audioData, sampleRate } = await decodeMp3ToMono(mp3Path)
console.log(`decoded ${(audioData.length / sampleRate).toFixed(1)}s @${sampleRate}`)
const audio = resample(audioData, sampleRate, SAMPLE_RATE)
const origLen = audio.length

const win = hannWindow(N_FFT)
const spec = stft(audio, N_FFT, HOP, win)
const totalFrames = spec.frames

const acc = Array.from({ length: 4 }, () => Array.from({ length: DIM_F }, () => new Float32Array(totalFrames)))
const weights = new Float32Array(totalFrames)
const nChunks = Math.max(1, Math.ceil((totalFrames - DIM_T) / STEP) + 1)
const inputData = new Float32Array(4 * DIM_F * DIM_T)
console.log(`stft frames=${totalFrames} chunks=${nChunks}`)

const tInf = Date.now()
for (let c = 0; c < nChunks; c++) {
  const tStart = c * STEP
  for (let f = 0; f < DIM_F; f++) {
    const binRe = spec.real[f], binIm = spec.imag[f]
    for (let t = 0; t < DIM_T; t++) {
      const srcT = tStart + t
      const re = srcT < totalFrames ? (binRe[srcT] ?? 0) : 0
      const im = srcT < totalFrames ? (binIm[srcT] ?? 0) : 0
      inputData[(0 * DIM_F + f) * DIM_T + t] = re
      inputData[(1 * DIM_F + f) * DIM_T + t] = im
      inputData[(2 * DIM_F + f) * DIM_T + t] = re
      inputData[(3 * DIM_F + f) * DIM_T + t] = im
    }
  }
  const results = await session.run({ input: new ort.Tensor('float32', inputData, [1, 4, DIM_F, DIM_T]) })
  const out = (results['output'] ?? results[Object.keys(results)[0]]).data
  for (let ch = 0; ch < 4; ch++)
    for (let f = 0; f < DIM_F; f++)
      for (let t = 0; t < DIM_T; t++) {
        const dstT = tStart + t
        if (dstT >= totalFrames) break
        acc[ch][f][dstT] += out[(ch * DIM_F + f) * DIM_T + t]
      }
  for (let t = 0; t < DIM_T; t++) { const dstT = tStart + t; if (dstT < totalFrames) weights[dstT]++ }
  if (c % 20 === 0 || c === nChunks - 1) console.log(`  chunk ${c + 1}/${nChunks} (${Math.round((Date.now() - tInf) / 1000)}s)`)
}

for (let ch = 0; ch < 4; ch++)
  for (let f = 0; f < DIM_F; f++)
    for (let t = 0; t < totalFrames; t++) acc[ch][f][t] /= weights[t] || 1

const nBins = Math.floor(N_FFT / 2) + 1
const vRe = Array.from({ length: nBins }, (_, f) => {
  const row = new Float32Array(totalFrames)
  if (f < DIM_F) for (let t = 0; t < totalFrames; t++) row[t] = (acc[0][f][t] + acc[2][f][t]) * 0.5
  return row
})
const vIm = Array.from({ length: nBins }, (_, f) => {
  const row = new Float32Array(totalFrames)
  if (f < DIM_F) for (let t = 0; t < totalFrames; t++) row[t] = (acc[1][f][t] + acc[3][f][t]) * 0.5
  return row
})
const vocals = istft(vRe, vIm, N_FFT, HOP, win, origLen)
writeFileSync(outPath, Buffer.from(vocals.buffer, vocals.byteOffset, vocals.byteLength))
console.log(`WROTE ${outPath}  ${(vocals.length / SAMPLE_RATE).toFixed(1)}s @${SAMPLE_RATE}Hz f32le mono  (${Math.round((Date.now() - t0) / 1000)}s total)`)

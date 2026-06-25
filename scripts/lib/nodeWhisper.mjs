/**
 * Direct (non-worker) Whisper ASR loader mirroring the transcription call in
 * src/ai-pipeline/whisper.worker.ts, for running real-model auto-align audits
 * from Node (no browser Worker available here).
 */
import { pipeline, env } from '@xenova/transformers'

env.allowLocalModels = false
env.useBrowserCache = false

const WHISPER_MODEL = 'Xenova/whisper-small'
const CHUNK_LENGTH_S = 30
const STRIDE_LENGTH_S = 5

let asrPromise = null

function getAsr() {
  if (!asrPromise) {
    asrPromise = pipeline('automatic-speech-recognition', WHISPER_MODEL, { quantized: true })
  }
  return asrPromise
}

function resampleTo16k(data, fromRate) {
  if (fromRate === 16000) return data
  const ratio = fromRate / 16000
  const out = new Float32Array(Math.floor(data.length / ratio))
  for (let i = 0; i < out.length; i++) out[i] = data[Math.floor(i * ratio)]
  return out
}

/** Same shape as src/ai-pipeline/whisperTranscriber.ts transcribeAudio. */
export async function transcribeAudio(audioData, sampleRate, options = {}) {
  const asr = await getAsr()
  const resampled = resampleTo16k(audioData, sampleRate)
  const totalChunks = Math.max(
    1,
    Math.ceil(resampled.length / ((CHUNK_LENGTH_S - 2 * STRIDE_LENGTH_S) * 16000)),
  )
  let doneChunks = 0
  const timestampMode = options.timestampMode ?? 'word'
  const useWordTimestamps = timestampMode !== 'segment'
  return asr(resampled, {
    return_timestamps: useWordTimestamps ? 'word' : true,
    language: options.language ?? 'japanese',
    task: 'transcribe',
    chunk_length_s: CHUNK_LENGTH_S,
    stride_length_s: STRIDE_LENGTH_S,
    chunk_callback: () => {
      doneChunks++
      options.onProgress?.(Math.min(100, Math.round((doneChunks / totalChunks) * 100)))
    },
  })
}

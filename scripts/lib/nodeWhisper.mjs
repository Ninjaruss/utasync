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

const asrPromises = new Map()

function getAsr(modelId) {
  if (!asrPromises.has(modelId)) {
    asrPromises.set(modelId, pipeline('automatic-speech-recognition', modelId, { quantized: true }))
  }
  return asrPromises.get(modelId)
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
  const modelId = options.model ?? WHISPER_MODEL
  const asr = await getAsr(modelId)
  const resampled = resampleTo16k(audioData, sampleRate)
  const totalChunks = Math.max(
    1,
    Math.ceil(resampled.length / ((CHUNK_LENGTH_S - 2 * STRIDE_LENGTH_S) * 16000)),
  )
  let doneChunks = 0
  const timestampMode = options.timestampMode ?? 'word'
  const useWordTimestamps = timestampMode !== 'segment'
  const lang = options.language ?? 'japanese'
  const asrOpts = {
    return_timestamps: useWordTimestamps ? 'word' : true,
    task: 'transcribe',
    chunk_length_s: CHUNK_LENGTH_S,
    stride_length_s: STRIDE_LENGTH_S,
    chunk_callback: () => {
      doneChunks++
      options.onProgress?.(Math.min(100, Math.round((doneChunks / totalChunks) * 100)))
    },
  }
  // For auto-detect, OMIT the language key entirely: @xenova/transformers
  // treats an explicit `language: null` differently from an absent key in its
  // generation-config merge, which can break long-form chunk merging.
  if (lang !== 'auto') asrOpts.language = lang
  return asr(resampled, asrOpts)
}

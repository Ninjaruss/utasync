/// <reference lib="webworker" />
import { pipeline, env } from '@xenova/transformers'

env.allowLocalModels = false
env.useBrowserCache = true

let asr: Awaited<ReturnType<typeof pipeline>> | null = null

self.onmessage = async (e: MessageEvent) => {
  const { type, payload } = e.data

  if (type === 'load') {
    self.postMessage({ type: 'progress', payload: { status: 'loading', progress: 0 } })
    asr = await pipeline('automatic-speech-recognition', 'Xenova/whisper-small', {
      progress_callback: (p: { status?: string; progress?: number }) =>
        self.postMessage({ type: 'progress', payload: p }),
    })
    self.postMessage({ type: 'loaded' })
    return
  }

  if (type === 'transcribe') {
    if (!asr) { self.postMessage({ type: 'error', payload: 'Model not loaded' }); return }
    const { audioData, sampleRate } = payload as { audioData: Float32Array; sampleRate: number }

    const resampled = sampleRate === 16000 ? audioData : resampleTo16k(audioData, sampleRate)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (asr as any)(resampled, {
      return_timestamps: 'word',
      language: 'japanese',
      task: 'transcribe',
      // Without chunking, Whisper only processes the first 30s of audio, so a
      // full song gets no word timestamps past ~30s. Chunk across the whole
      // track (30s windows, 5s overlap so words at boundaries aren't lost).
      chunk_length_s: 30,
      stride_length_s: 5,
    })

    self.postMessage({ type: 'result', payload: result })
  }
}

function resampleTo16k(data: Float32Array, fromRate: number): Float32Array {
  const ratio = fromRate / 16000
  const out = new Float32Array(Math.floor(data.length / ratio))
  for (let i = 0; i < out.length; i++) out[i] = data[Math.floor(i * ratio)]
  return out
}

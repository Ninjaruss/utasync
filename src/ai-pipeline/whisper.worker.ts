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
      progress_callback: (p: any) => self.postMessage({ type: 'progress', payload: p }),
    })
    self.postMessage({ type: 'loaded' })
    return
  }

  if (type === 'transcribe') {
    if (!asr) { self.postMessage({ type: 'error', payload: 'Model not loaded' }); return }
    const { audioData, sampleRate } = payload as { audioData: Float32Array; sampleRate: number }

    const resampled = sampleRate === 16000 ? audioData : resampleTo16k(audioData, sampleRate)

    const result = await asr(resampled, {
      return_timestamps: 'word',
      language: 'japanese',
      task: 'transcribe',
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

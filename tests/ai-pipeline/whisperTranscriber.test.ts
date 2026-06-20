import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { resetWhisperTranscriber } from '../../src/ai-pipeline/whisperTranscriber'

vi.mock('../../src/ai-pipeline/capability', () => ({ getDeviceTier: () => 'lite' }))

class FakeWhisperWorker {
  listeners: Array<(e: MessageEvent) => void> = []
  lastLoadModel: string | undefined

  addEventListener(_type: string, fn: (e: MessageEvent) => void) {
    this.listeners.push(fn)
  }

  removeEventListener(_type: string, fn: (e: MessageEvent) => void) {
    this.listeners = this.listeners.filter((l) => l !== fn)
  }

  postMessage(msg: { type: string; payload?: { model?: string; audioData?: Float32Array; sampleRate?: number } }) {
    if (msg.type === 'load') {
      this.lastLoadModel = msg.payload?.model
      queueMicrotask(() => {
        for (const fn of this.listeners) {
          fn({ data: { type: 'loaded' } } as MessageEvent)
        }
      })
    } else if (msg.type === 'transcribe') {
      queueMicrotask(() => {
        for (const fn of this.listeners) {
          fn({
            data: {
              type: 'result',
              payload: { chunks: [{ text: 'hi', timestamp: [0, 1] }] },
            },
          } as MessageEvent)
        }
      })
    }
  }

  terminate() {}
}

let whisperWorkerInstance: FakeWhisperWorker | null = null

vi.stubGlobal(
  'Worker',
  vi.fn(function FakeWorker() {
    whisperWorkerInstance = new FakeWhisperWorker()
    return whisperWorkerInstance
  }),
)

describe('whisperTranscriber', () => {
  beforeEach(() => {
    resetWhisperTranscriber()
    whisperWorkerInstance = null
    vi.resetModules()
  })

  afterEach(() => {
    resetWhisperTranscriber()
  })

  it('reuses the same worker across consecutive transcribe calls', async () => {
    const { transcribeAudio } = await import('../../src/ai-pipeline/whisperTranscriber')
    const audio = new Float32Array(100)
    await transcribeAudio(audio, 44100)
    const firstWorker = whisperWorkerInstance
    await transcribeAudio(audio, 44100)
    expect(whisperWorkerInstance).toBe(firstWorker)
    expect(whisperWorkerInstance?.lastLoadModel).toBe('Xenova/whisper-small')
  })
})

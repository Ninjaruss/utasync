import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resetWhisperTranscriber } from '../../src/ai-pipeline/whisperTranscriber'

// Full tier so canUseHighAccuracy(tier) is true and highAccuracy=true actually
// resolves to the medium model (see src/ai-pipeline/inferenceBackend.ts).
vi.mock('../../src/ai-pipeline/capability', () => ({
  getDeviceTier: () => 'full',
}))

class MockWorker {
  static instances: MockWorker[] = []
  onmessage: ((e: MessageEvent) => void) | null = null
  private listeners = new Set<(e: MessageEvent) => void>()
  loadPayloads: { model: string; device: string; dtype: string }[] = []

  constructor() {
    MockWorker.instances.push(this)
  }

  addEventListener(_type: string, fn: (e: MessageEvent) => void) {
    this.listeners.add(fn)
  }

  removeEventListener(_type: string, fn: (e: MessageEvent) => void) {
    this.listeners.delete(fn)
  }

  postMessage(data: unknown) {
    queueMicrotask(() => {
      const msg = data as { type?: string; payload?: { model: string; device: string; dtype: string } }
      if (msg.type === 'load') {
        if (msg.payload) this.loadPayloads.push(msg.payload)
        this.emit({ type: 'load-progress', payload: { status: 'progress', file: 'a.onnx', progress: 50, aggregateProgress: 50, phase: 'download' } })
        this.emit({ type: 'load-progress', payload: { status: 'initializing', phase: 'init' } })
        this.emit({ type: 'loaded' })
      }
      if (msg.type === 'transcribe') {
        this.emit({ type: 'result', payload: { text: 'hi', chunks: [] } })
      }
    })
  }

  emit(event: { type: string; payload?: unknown }) {
    const message = { data: event } as MessageEvent
    this.listeners.forEach((fn) => fn(message))
    this.onmessage?.(message)
  }

  terminate() {}
}

vi.stubGlobal('Worker', MockWorker)

describe('whisperTranscriber load progress', () => {
  beforeEach(() => {
    resetWhisperTranscriber()
    MockWorker.instances = []
  })

  it('broadcasts load progress to listeners attached while load is in flight', async () => {
    const { transcribeAudio } = await import('../../src/ai-pipeline/whisperTranscriber')
    const events: string[] = []

    const pending = transcribeAudio(new Float32Array(8), 16000, {
      onLoadProgress: (p) => {
        events.push(p.phase ?? p.status ?? 'unknown')
      },
    })

    await pending.catch(() => {})
    expect(events).toContain('download')
    expect(events).toContain('init')
  })

  it('reloads with the medium model when a highAccuracy request follows a warm small-model worker', async () => {
    const { transcribeAudio } = await import('../../src/ai-pipeline/whisperTranscriber')

    // Warm the worker with the small (default) model first, e.g. via preloadWhisper().
    await transcribeAudio(new Float32Array(8), 16000)
    expect(MockWorker.instances).toHaveLength(1)
    expect(MockWorker.instances[0]?.loadPayloads).toEqual([
      expect.objectContaining({ model: 'Xenova/whisper-small' }),
    ])

    // A later highAccuracy=true request must not silently reuse the warm small-model
    // worker — it should reset and post a fresh load for the medium model.
    await transcribeAudio(new Float32Array(8), 16000, { highAccuracy: true })
    expect(MockWorker.instances).toHaveLength(2)
    expect(MockWorker.instances[1]?.loadPayloads).toEqual([
      expect.objectContaining({ model: 'Xenova/whisper-medium' }),
    ])
  })
})

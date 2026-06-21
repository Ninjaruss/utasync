import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resetWhisperTranscriber } from '../../src/ai-pipeline/whisperTranscriber'

class MockWorker {
  static instances: MockWorker[] = []
  onmessage: ((e: MessageEvent) => void) | null = null
  private listeners = new Set<(e: MessageEvent) => void>()

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
      const msg = data as { type?: string }
      if (msg.type === 'load') {
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
})

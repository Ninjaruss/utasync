import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resetWhisperTranscriber } from '../../src/ai-pipeline/whisperTranscriber'

/**
 * Cancel during "Loading AI model" used to leave the run in limbo forever:
 * `ensureLoaded`'s promise was resolved or rejected ONLY from worker messages, and
 * resetWhisperTranscriber() terminates that worker — so the awaiting `start()`
 * neither continued nor threw, and its stage froze with no timeout to end it.
 */

vi.mock('../../src/ai-pipeline/capability', () => ({
  getDeviceTier: () => 'full',
}))

/** A worker that starts the load and then never answers it. */
class SilentLoadWorker {
  static instances: SilentLoadWorker[] = []
  private listeners = new Set<(e: MessageEvent) => void>()
  terminated = false

  constructor() {
    SilentLoadWorker.instances.push(this)
  }
  addEventListener(_type: string, fn: (e: MessageEvent) => void) {
    this.listeners.add(fn)
  }
  removeEventListener(_type: string, fn: (e: MessageEvent) => void) {
    this.listeners.delete(fn)
  }
  postMessage() {
    // Deliberately silent: the model fetch never completes.
  }
  terminate() {
    this.terminated = true
  }
}

vi.stubGlobal('Worker', SilentLoadWorker)

describe('resetWhisperTranscriber during a model load', () => {
  beforeEach(() => {
    resetWhisperTranscriber()
    SilentLoadWorker.instances = []
  })

  it('rejects the in-flight load instead of leaving it pending forever', async () => {
    const { transcribeAudio } = await import('../../src/ai-pipeline/whisperTranscriber')

    let settled = 'pending'
    const pending = transcribeAudio(new Float32Array(16), 16000, { language: 'en' }).then(
      () => { settled = 'resolved' },
      () => { settled = 'rejected' },
    )
    // Let the worker be created and 'load' be posted.
    await Promise.resolve()
    expect(SilentLoadWorker.instances.length).toBe(1)
    expect(settled).toBe('pending')

    resetWhisperTranscriber()
    await pending
    expect(settled).toBe('rejected')
    expect(SilentLoadWorker.instances[0].terminated).toBe(true)
  })

  it('a load started after the reset proceeds on its own worker', async () => {
    const { resetWhisperTranscriber: reset } = await import('../../src/ai-pipeline/whisperTranscriber')
    const { transcribeAudio } = await import('../../src/ai-pipeline/whisperTranscriber')

    const first = transcribeAudio(new Float32Array(16), 16000, { language: 'en' })
    first.catch(() => {})
    await Promise.resolve()
    reset()

    // Second attempt must not be stuck on the promise the reset tore down.
    const second = transcribeAudio(new Float32Array(16), 16000, { language: 'en' })
    second.catch(() => {})
    await Promise.resolve()
    await Promise.resolve()
    expect(SilentLoadWorker.instances.length).toBe(2)

    // Clean up the second run so its worker is not left loaded for other specs.
    reset()
    await second.catch(() => {})
    await first.catch(() => {})
  })
})

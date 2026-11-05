import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetWhisperTranscriber, transcribeAudio, preloadWhisper } from '../../src/ai-pipeline/whisperTranscriber'
import { transcriptionBudgetMs, TranscriptionTimeoutError } from '../../src/ai-pipeline/transcriptionBudget'

vi.mock('../../src/ai-pipeline/capability', () => ({ getDeviceTier: () => 'lite' }))
vi.mock('../../src/core/idle', () => ({ runWhenIdle: (work: () => void) => { work(); return () => {} } }))
class ControlledWorker {
  static instances: ControlledWorker[] = []
  static autoLoad = true
  terminated = false
  listeners = new Map<string, Set<(e: MessageEvent) => void>>()
  constructor() { ControlledWorker.instances.push(this) }
  addEventListener(type: string, fn: (e: MessageEvent) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type)!.add(fn)
  }
  removeEventListener(type: string, fn: (e: MessageEvent) => void) { this.listeners.get(type)?.delete(fn) }
  postMessage(data: { type: string }) { if (data.type === 'load' && ControlledWorker.autoLoad) this.emit({ type: 'loaded' }) }
  emit(data: unknown) { this.listeners.get('message')?.forEach(fn => fn({ data } as MessageEvent)) }
  terminate() { this.terminated = true }
}
const audio = new Float32Array(120)
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('Worker', ControlledWorker); ControlledWorker.instances = []; ControlledWorker.autoLoad = true })
afterEach(() => { resetWhisperTranscriber(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('bounded transcription', () => {
  it('shares a same-model idle prewarm instead of replacing an in-flight load', async () => {
    ControlledWorker.autoLoad = false
    preloadWhisper()
    const pending = transcribeAudio(audio, 1)
    await vi.advanceTimersByTimeAsync(0)
    expect(ControlledWorker.instances).toHaveLength(1)
    const worker = ControlledWorker.instances[0]
    expect(worker.terminated).toBe(false)
    worker.emit({ type: 'loaded' })
    await vi.advanceTimersByTimeAsync(0)
    worker.emit({ type: 'result', payload: { text: 'shared model' } })
    expect((await pending).text).toBe('shared model')
  })

  it('caps ordinary long-track word and segment passes and gives small slices a bounded budget', () => {
    expect(transcriptionBudgetMs(393, 'word')).toBe(240_000)
    expect(transcriptionBudgetMs(393, 'segment')).toBe(360_000)
    expect(transcriptionBudgetMs(30, 'segment')).toBe(60_000)
    expect(transcriptionBudgetMs(128, 'word')).toBe(192_000)
    expect(transcriptionBudgetMs(393, 'segment', true)).toBe(540_000)
  })

  it('rejects an overlapping request without disturbing the owner', async () => {
    const first = transcribeAudio(audio, 1)
    await expect(transcribeAudio(audio, 1)).rejects.toMatchObject({ name: 'TranscriptionBusyError' })
    await vi.advanceTimersByTimeAsync(0)
    const worker = ControlledWorker.instances[0]
    expect(worker.terminated).toBe(false)
    worker.emit({ type: 'result', payload: { text: 'owner' } })
    expect((await first).text).toBe('owner')
  })

  it('aborts a pending model load through the owning signal', async () => {
    ControlledWorker.autoLoad = false
    const controller = new AbortController()
    const pending = transcribeAudio(audio, 1, { signal: controller.signal })
    const rejected = expect(pending).rejects.toThrow(/cancelled/)
    await vi.advanceTimersByTimeAsync(0)
    controller.abort(); await rejected
    expect(ControlledWorker.instances[0].terminated).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('aborts inference and allows a new owner to use a fresh worker', async () => {
    const controller = new AbortController()
    const pending = transcribeAudio(audio, 1, { signal: controller.signal })
    const rejected = expect(pending).rejects.toThrow(/cancelled/)
    await vi.advanceTimersByTimeAsync(0)
    controller.abort(); await rejected
    const next = transcribeAudio(audio, 1)
    await vi.advanceTimersByTimeAsync(0)
    expect(ControlledWorker.instances).toHaveLength(2)
    ControlledWorker.instances[0].emit({ type: 'result', payload: { text: 'stale' } })
    ControlledWorker.instances[1].emit({ type: 'result', payload: { text: 'new owner' } })
    expect((await next).text).toBe('new owner')
  })

  it('does not start another worker if ownership was cancelled in the ready callback', async () => {
    await expect(transcribeAudio(audio, 1, { onModelLoaded: resetWhisperTranscriber })).rejects.toThrow(/cancelled/)
    expect(ControlledWorker.instances).toHaveLength(1)
  })

  it('times out a silent setup even if initialization hints repeat', async () => {
    ControlledWorker.autoLoad = false
    const pending = transcribeAudio(audio, 1)
    const rejected = expect(pending).rejects.toMatchObject({ phase: 'load' })
    await vi.advanceTimersByTimeAsync(80_000)
    ControlledWorker.instances[0].emit({ type: 'load-progress', payload: { status: 'initializing', phase: 'init' } })
    await vi.advanceTimersByTimeAsync(40_000); await rejected
    expect(ControlledWorker.instances[0].terminated).toBe(true)
  })

  it('renews the setup inactivity deadline when download activity arrives', async () => {
    ControlledWorker.autoLoad = false
    const pending = transcribeAudio(audio, 1)
    await vi.advanceTimersByTimeAsync(100_000)
    const worker = ControlledWorker.instances[0]
    worker.emit({ type: 'load-progress', payload: { status: 'progress', progress: 50 } })
    await vi.advanceTimersByTimeAsync(100_000)
    expect(worker.terminated).toBe(false)
    worker.emit({ type: 'loaded' })
    await vi.advanceTimersByTimeAsync(0)
    worker.emit({ type: 'result', payload: { text: 'loaded' } })
    expect((await pending).text).toBe('loaded')
  })

  it('terminates a timed-out worker before a retry and ignores its stale result', async () => {
    const first = transcribeAudio(audio, 1, { timeoutMs: 100 })
    const rejected = expect(first).rejects.toBeInstanceOf(TranscriptionTimeoutError)
    await vi.advanceTimersByTimeAsync(100); await rejected
    const retired = ControlledWorker.instances[0]
    expect(retired.terminated).toBe(true)
    const next = transcribeAudio(audio, 1, { timestampMode: 'segment', timeoutMs: 1000 })
    await vi.advanceTimersByTimeAsync(0)
    const replacement = ControlledWorker.instances[1]
    let resolved = false
    void next.then(() => { resolved = true })
    retired.emit({ type: 'result', payload: { text: 'stale' } })
    await vi.advanceTimersByTimeAsync(0)
    expect(resolved).toBe(false)
    replacement.emit({ type: 'result', payload: { text: 'fresh' } })
    expect((await next).text).toBe('fresh')
  })

  it('does not let repeated finalization events extend the deadline', async () => {
    const pending = transcribeAudio(audio, 1, { timeoutMs: 180_000 })
    const rejected = expect(pending).rejects.toMatchObject({ phase: 'finalization' })
    await vi.advanceTimersByTimeAsync(0)
    const worker = ControlledWorker.instances[0]
    worker.emit({ type: 'progress', payload: { status: 'merging' } })
    await vi.advanceTimersByTimeAsync(80_000)
    worker.emit({ type: 'progress', payload: { status: 'finalizing' } })
    await vi.advanceTimersByTimeAsync(10_000); await rejected
    expect(worker.terminated).toBe(true)
  })

  it('clears cancelled-call timers so they cannot kill the next worker', async () => {
    const pending = transcribeAudio(audio, 1, { timeoutMs: 100 })
    const rejected = expect(pending).rejects.toThrow(/cancelled/)
    await vi.advanceTimersByTimeAsync(0)
    resetWhisperTranscriber(); await rejected
    const next = transcribeAudio(audio, 1, { timeoutMs: 1000 })
    await vi.advanceTimersByTimeAsync(101)
    const current = ControlledWorker.instances[1]
    expect(current.terminated).toBe(false)
    current.emit({ type: 'result', payload: { text: 'safe' } })
    expect((await next).text).toBe('safe')
  })

  it('clears the finalization timer when real decoding resumes', async () => {
    const pending = transcribeAudio(audio, 1, { timeoutMs: 200_000 })
    await vi.advanceTimersByTimeAsync(0)
    const worker = ControlledWorker.instances[0]
    worker.emit({ type: 'progress', payload: { status: 'merging' } })
    await vi.advanceTimersByTimeAsync(80_000)
    worker.emit({ type: 'progress', payload: { progress: 80, status: 'transcribing' } })
    await vi.advanceTimersByTimeAsync(20_000)
    expect(worker.terminated).toBe(false)
    worker.emit({ type: 'result', payload: { text: 'continued' } })
    expect((await pending).text).toBe('continued')
  })
})

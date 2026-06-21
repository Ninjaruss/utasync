import { describe, it, expect } from 'vitest'
import {
  aggregateModelFileProgress,
  ModelLoadProgressTracker,
} from '../../src/ai-pipeline/modelLoadProgress'

describe('aggregateModelFileProgress', () => {
  it('averages progress across all reported files', () => {
    const files = new Map([
      ['encoder.onnx', 100],
      ['decoder.onnx', 50],
    ])
    expect(aggregateModelFileProgress(files)).toBe(75)
  })
})

describe('ModelLoadProgressTracker', () => {
  it('does not treat a single finished file as fully complete', () => {
    const tracker = new ModelLoadProgressTracker()
    tracker.ingest({ status: 'progress', file: 'a.onnx', progress: 100 })
    const second = tracker.ingest({ status: 'done', file: 'b.onnx', progress: 100 })
    expect(second.aggregateProgress).toBe(100)
    expect(second.filesCompleted).toBe(2)
  })

  it('tracks partial downloads across multiple files', () => {
    const tracker = new ModelLoadProgressTracker()
    tracker.ingest({ status: 'progress', file: 'encoder.onnx', progress: 100 })
    const update = tracker.ingest({ status: 'progress', file: 'decoder.onnx', progress: 40 })
    expect(update.aggregateProgress).toBe(70)
  })
})

import { describe, it, expect } from 'vitest'
import { describeWorkerError, isRecoverableTranscriptionError } from '../../src/ai-pipeline/workerError'

describe('describeWorkerError', () => {
  it('translates onnxruntime numeric WASM exceptions (the "1261431424" bug)', () => {
    const msg = describeWorkerError(1261431424)
    expect(msg).toContain('1261431424')
    expect(msg).toContain('ran out of memory')
  })

  it('translates numeric strings the same way', () => {
    expect(describeWorkerError('1261431424')).toContain('ran out of memory')
  })

  it('passes real Error messages through unchanged', () => {
    expect(describeWorkerError(new Error('Model not loaded'))).toBe('Model not loaded')
  })

  it('stringifies other throwables', () => {
    expect(describeWorkerError({ toString: () => 'weird' })).toBe('weird')
  })
})

describe('isRecoverableTranscriptionError', () => {
  it('treats crashes and timeouts as recoverable', () => {
    expect(isRecoverableTranscriptionError(new Error(describeWorkerError(1261431424)))).toBe(true)
    expect(isRecoverableTranscriptionError(new Error('Transcription timed out — try a shorter clip'))).toBe(true)
  })

  it('never retries a user cancellation', () => {
    expect(isRecoverableTranscriptionError(new Error('Transcription cancelled'))).toBe(false)
  })

  it('ignores non-Error rejections', () => {
    expect(isRecoverableTranscriptionError('boom')).toBe(false)
  })
})

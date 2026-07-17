import { describe, it, expect } from 'vitest'
import { describeWorkerError, isRecoverableTranscriptionError, classifyAlignError } from '../../src/ai-pipeline/workerError'

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

describe('classifyAlignError', () => {
  it('maps network / model-download / module-load failures to connection guidance', () => {
    for (const m of [
      'Failed to fetch model weights',
      'NetworkError when attempting to fetch resource',
      'Failed to load model',
      'importScripts blew up',
      'net::ERR_INTERNET_DISCONNECTED',
    ]) {
      expect(classifyAlignError(new Error(m))).toMatch(/couldn't download the speech model/i)
    }
  })

  it('maps out-of-memory / WASM aborts to memory guidance', () => {
    expect(classifyAlignError(new Error('Aborted(). Build with -sASSERTIONS: out of memory'))).toMatch(/ran out of memory/i)
    expect(classifyAlignError(new Error('memory allocation failed'))).toMatch(/ran out of memory/i)
    // Bare numeric WASM aborts (the onnxruntime "1261431424" pathology) are OOM.
    expect(classifyAlignError(1261431424)).toMatch(/ran out of memory/i)
  })

  it('falls back to reassuring generic copy for anything unclassified', () => {
    const msg = classifyAlignError(new Error('Unexpected token < in JSON at position 0'))
    expect(msg).toMatch(/something went wrong during auto-align/i)
    expect(msg).toMatch(/your song is saved/i)
    // The raw text is never the surfaced message.
    expect(msg).not.toContain('Unexpected token')
  })
})

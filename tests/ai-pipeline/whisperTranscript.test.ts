import { describe, it, expect } from 'vitest'
import { slimWhisperTranscript } from '../../src/ai-pipeline/whisperTranscript'

describe('slimWhisperTranscript', () => {
  it('keeps text and timestamped chunks only', () => {
    const slim = slimWhisperTranscript({
      text: 'hello world',
      chunks: [
        { text: ' hello ', timestamp: [0, 0.5], logits: [1, 2, 3] },
        { text: 'world', timestamp: [0.5, 1], extra: true },
        { text: '  ', timestamp: [1, 2] },
        { text: 'bad', timestamp: 'nope' },
      ],
    })
    expect(slim.text).toBe('hello world')
    expect(slim.chunks).toEqual([
      { text: 'hello', timestamp: [0, 0.5] },
      { text: 'world', timestamp: [0.5, 1] },
    ])
  })
})

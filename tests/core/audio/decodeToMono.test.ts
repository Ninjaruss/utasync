import { describe, it, expect, vi } from 'vitest'
import { decodeAudioFileToMono } from '../../../src/core/audio/decodeToMono'

class MockAudioContext {
  async decodeAudioData() {
    const left = new Float32Array([0.5, -0.5])
    const right = new Float32Array([1, 1])
    return {
      numberOfChannels: 2,
      length: 2,
      sampleRate: 48000,
      getChannelData: (i: number) => (i === 0 ? left : right),
    }
  }
  async close() {}
}

describe('decodeAudioFileToMono', () => {
  it('averages stereo channels into an owned mono buffer', async () => {
    vi.stubGlobal('AudioContext', MockAudioContext)
    const file = new File([new ArrayBuffer(16)], 'song.mp3', { type: 'audio/mpeg' })
    const { data, sampleRate } = await decodeAudioFileToMono(file)
    expect(sampleRate).toBe(48000)
    expect(data).toEqual(new Float32Array([0.75, 0.25]))
    expect(data.buffer).not.toBe((file as unknown as { buffer?: ArrayBuffer }).buffer)
  })
})

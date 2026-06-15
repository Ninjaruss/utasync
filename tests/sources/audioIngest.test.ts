// tests/sources/audioIngest.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const saveAudio = vi.fn()
vi.mock('../../src/core/opfs/audio', () => ({
  saveAudio: (id: string, buf: ArrayBuffer) => saveAudio(id, buf),
  audioStoragePath: (id: string) => `songs/${id}.mp3`,
}))

import { ingestAudioFile } from '../../src/sources/audioIngest'

describe('ingestAudioFile', () => {
  beforeEach(() => saveAudio.mockReset())

  it('saves the file bytes and returns a matching path', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'song.mp3', { type: 'audio/mpeg' })
    const { songId, audioStoredPath } = await ingestAudioFile(file)
    expect(songId).toBeTruthy()
    expect(audioStoredPath).toBe(`songs/${songId}.mp3`)
    expect(saveAudio).toHaveBeenCalledTimes(1)
    expect(saveAudio.mock.calls[0][0]).toBe(songId)
    expect(saveAudio.mock.calls[0][1].byteLength).toBe(3)
  })
})

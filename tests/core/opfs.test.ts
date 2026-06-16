import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock OPFS since jsdom doesn't support it
const mockWritable = { write: vi.fn(), close: vi.fn() }
const mockFileHandle = {
  createWritable: vi.fn().mockResolvedValue(mockWritable),
  getFile: vi.fn().mockResolvedValue(new File([new ArrayBuffer(8)], 'test.mp3')),
}
const mockSongsDir = {
  getFileHandle: vi.fn().mockResolvedValue(mockFileHandle),
  removeEntry: vi.fn().mockResolvedValue(undefined),
}
const mockRoot = {
  getDirectoryHandle: vi.fn().mockResolvedValue(mockSongsDir),
}

vi.stubGlobal('navigator', {
  storage: {
    getDirectory: vi.fn().mockResolvedValue(mockRoot),
    persist: vi.fn().mockResolvedValue(true),
  },
})

import { saveAudio, getAudioFile, deleteAudio } from '../../src/core/opfs/audio'

describe('OPFS audio utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRoot.getDirectoryHandle.mockResolvedValue(mockSongsDir)
    mockSongsDir.getFileHandle.mockResolvedValue(mockFileHandle)
    mockSongsDir.removeEntry.mockResolvedValue(undefined)
    mockFileHandle.createWritable.mockResolvedValue(mockWritable)
  })

  it('saveAudio writes buffer to OPFS', async () => {
    const buffer = new ArrayBuffer(8)
    await saveAudio('song-1', buffer)
    expect(mockWritable.write).toHaveBeenCalledWith(buffer)
    expect(mockWritable.close).toHaveBeenCalled()
  })

  it('getAudioFile retrieves File from OPFS', async () => {
    const file = await getAudioFile('song-1')
    expect(file).toBeInstanceOf(File)
  })

  it('deleteAudio removes the file via removeEntry', async () => {
    await deleteAudio('song-1')
    expect(mockSongsDir.removeEntry).toHaveBeenCalledWith('song-1.mp3')
  })

  it('deleteAudio ignores an already-missing file', async () => {
    const notFound = Object.assign(new Error('missing'), { name: 'NotFoundError' })
    mockSongsDir.removeEntry.mockRejectedValueOnce(notFound)
    await expect(deleteAudio('song-1')).resolves.toBeUndefined()
  })
})

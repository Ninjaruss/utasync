import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../src/core/db/schema'
import type { Song } from '../../src/core/types'

const mockSong: Song = {
  id: 'test-1',
  title: 'Test Song',
  artist: 'Test Artist',
  lyrics: {
    lines: [{ startTime: 0, endTime: 2, original: 'こんにちは', translation: 'Hello' }],
    sourceLanguage: 'ja',
    translationLanguage: 'en',
    alignmentMode: 'manual',
  },
  createdAt: new Date(),
  isTrialSong: false,
}

beforeEach(async () => {
  await db.songs.clear()
})

describe('db.songs', () => {
  it('stores and retrieves a song by id', async () => {
    await db.songs.put(mockSong)
    const result = await db.songs.get('test-1')
    expect(result?.title).toBe('Test Song')
  })

  it('lists all songs', async () => {
    await db.songs.put(mockSong)
    const all = await db.songs.toArray()
    expect(all).toHaveLength(1)
  })

  it('deletes a song', async () => {
    await db.songs.put(mockSong)
    await db.songs.delete('test-1')
    const result = await db.songs.get('test-1')
    expect(result).toBeUndefined()
  })
})

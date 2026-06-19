import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '../../../src/core/db/schema'

beforeEach(async () => {
  await db.songs.clear()
})

describe('Dexie v2 backfill', () => {
  it('backfills sources and syncState on read for a legacy YouTube song', async () => {
    await db.songs.put({
      id: 'leg1', title: 'T', artist: 'A',
      sourceUrl: 'https://youtu.be/abc123',
      lyrics: { lines: [{ startTime: 0, endTime: 3, original: 'a', translation: '' }], sourceLanguage: 'ja', translationLanguage: 'en', alignmentMode: 'manual' },
      createdAt: new Date(), isTrialSong: false,
    } as never)

    const got = await db.songs.get('leg1')
    expect(got!.sources?.[0]).toMatchObject({ provider: 'youtube', ref: 'abc123', hasAudio: false })
    expect(got!.syncState).toBe('synced')
  })
})

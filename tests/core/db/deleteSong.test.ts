import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../../src/core/db/schema'
import { deleteSong } from '../../../src/core/db/deleteSong'
import type { Song } from '../../../src/core/types'

function makeSong(id: string): Song {
  return {
    id,
    title: `Title ${id}`,
    artist: 'Artist',
    lyrics: { lines: [], sourceLanguage: 'ja', translationLanguage: 'en', alignmentMode: 'manual' },
    createdAt: new Date(),
    isTrialSong: false,
  }
}

describe('deleteSong', () => {
  beforeEach(async () => { await db.songs.clear() })

  it('removes the song row from the database', async () => {
    const song = makeSong('a')
    await db.songs.put(song)
    expect(await db.songs.get('a')).toBeDefined()

    await deleteSong(song)

    expect(await db.songs.get('a')).toBeUndefined()
  })
})

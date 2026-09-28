import { describe, it, expect, beforeEach, vi } from 'vitest'
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
  }
}

// Hoisted so the module mock below can close over it.
const { removedIds } = vi.hoisted(() => ({ removedIds: [] as string[] }))

vi.mock('../../../src/core/opfs/audio', () => ({
  deleteAudio: async (songId: string) => {
    removedIds.push(songId)
    if (songId === 'audio-fails') throw new Error('OPFS removeEntry failed')
  },
}))

/** Replaces db.songs.delete for one call, so a row-delete failure is testable. */
async function withFailingRowDelete(run: () => Promise<void>) {
  const realDelete = db.songs.delete
  db.songs.delete = (async () => {
    throw new Error('IndexedDB write failed')
  }) as unknown as typeof db.songs.delete
  try {
    await run()
  } finally {
    db.songs.delete = realDelete
  }
}

describe('deleteSong', () => {
  beforeEach(async () => {
    await db.songs.clear()
    removedIds.length = 0
  })

  it('removes the song row from the database', async () => {
    const song = makeSong('a')
    await db.songs.put(song)
    expect(await db.songs.get('a')).toBeDefined()

    await deleteSong(song)

    expect(await db.songs.get('a')).toBeUndefined()
  })

  // The row goes first, so a failed row delete destroys nothing: the audio file
  // is still there and a retry can finish the job. In the old order the audio
  // was already gone while the row survived, so the library kept advertising a
  // song whose audio was unrecoverable and "Remove orphaned audio" could not
  // reclaim it either (its row still referenced the file).
  it('leaves the audio intact when the row delete fails', async () => {
    const song = { ...makeSong('b'), audioStoredPath: 'songs/b.mp3' }
    await db.songs.put(song)

    await withFailingRowDelete(async () => {
      await expect(deleteSong(song)).rejects.toThrow('IndexedDB write failed')
    })

    expect(removedIds).toEqual([])
    expect(await db.songs.get('b')).toBeDefined()
  })

  it('still removes the row when the audio delete fails, and reports it', async () => {
    const song = { ...makeSong('audio-fails'), audioStoredPath: 'songs/audio-fails.mp3' }
    await db.songs.put(song)

    const result = await deleteSong(song)

    expect(result.audioDeleteFailed).toBe(true)
    expect(removedIds).toEqual(['audio-fails'])
    expect(await db.songs.get('audio-fails')).toBeUndefined()
  })

  it('does not treat a song with no stored audio as an audio failure', async () => {
    const song = makeSong('c')
    await db.songs.put(song)

    expect(await deleteSong(song)).toEqual({ audioDeleteFailed: false })
    expect(removedIds).toEqual([])
  })
})

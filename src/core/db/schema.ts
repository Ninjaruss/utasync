import Dexie, { type Table } from 'dexie'
import type { Song } from '../types'
import { deriveSources, computeSyncState } from './migrations'

class UtasyncDB extends Dexie {
  songs!: Table<Song, string>

  constructor() {
    super('utasync')
    this.version(1).stores({
      songs: 'id, title, artist, createdAt',
    })
    // v2: index syncState for the Library badge filter. Backfill the unified
    // source list + sync state for every existing row, non-destructively.
    this.version(2).stores({
      songs: 'id, title, artist, createdAt, syncState',
    }).upgrade(async (tx) => {
      await tx.table('songs').toCollection().modify((song: Song) => {
        song.sources = deriveSources(song)
        song.syncState = computeSyncState(song)
      })
    })

    // Rows written by older code paths (or restored) still get filled on read.
    this.songs.hook('reading', (song: Song) => {
      if (!song) return song
      if (!song.sources) song.sources = deriveSources(song)
      if (!song.syncState) song.syncState = computeSyncState(song)
      return song
    })
  }
}

export const db = new UtasyncDB()

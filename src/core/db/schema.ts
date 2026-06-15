import Dexie, { type Table } from 'dexie'
import type { Song } from '../types'

class UtasyncDB extends Dexie {
  songs!: Table<Song, string>

  constructor() {
    super('utasync')
    this.version(1).stores({
      songs: 'id, title, artist, createdAt',
    })
  }
}

export const db = new UtasyncDB()

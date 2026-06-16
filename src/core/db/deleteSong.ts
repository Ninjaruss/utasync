import { db } from './schema'
import { deleteAudio } from '../opfs/audio'
import type { Song } from '../types'

// Deletes a song: its stored audio file (if any) and its database row.
export async function deleteSong(song: Song): Promise<void> {
  if (song.audioStoredPath) await deleteAudio(song.id)
  await db.songs.delete(song.id)
}

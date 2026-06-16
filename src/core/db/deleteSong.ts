import { db } from './schema'
import { deleteAudio } from '../opfs/audio'
import type { Song } from '../types'

// Deletes a song: its stored audio file (if any) and its database row.
// Audio cleanup is best-effort — a failure there must not leave the song
// stranded in the library, so the row is always removed.
export async function deleteSong(song: Song): Promise<void> {
  if (song.audioStoredPath) {
    try {
      await deleteAudio(song.id)
    } catch (e) {
      console.warn(`Failed to delete audio for song ${song.id}; removing row anyway.`, e)
    }
  }
  await db.songs.delete(song.id)
}

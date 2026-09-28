import { db } from './schema'
import { deleteAudio } from '../opfs/audio'
import type { Song } from '../types'

// Deletes a song: its database row first, then its stored audio file (if any).
//
// The row goes first on purpose. Deleting the audio first meant a failed row
// delete left the song listed and playable-looking while its audio was already
// unrecoverable — the library advertised a song that could never play again,
// "Remove orphaned audio" could not reclaim the file (the surviving row still
// referenced it), and the error message told the user the delete had failed.
// In this order a rejected row delete destroys nothing: the song and its audio
// are exactly as they were, so the caller's "could not delete" is true and a
// retry works.
//
// Audio cleanup stays best-effort: once the row is gone the song never comes
// back, and a failed audio delete leaves exactly the orphan that the storage
// cleanup tool reclaims.
//
// Rejects only if the row could not be deleted (nothing was destroyed).
// Resolves with { audioDeleteFailed: true } when the row is gone but its audio
// file is still in OPFS.
export async function deleteSong(song: Song): Promise<{ audioDeleteFailed: boolean }> {
  await db.songs.delete(song.id)
  let audioDeleteFailed = false
  if (song.audioStoredPath) {
    try {
      await deleteAudio(song.id)
    } catch (e) {
      console.warn(`Failed to delete audio for song ${song.id}; it is now orphaned in OPFS.`, e)
      audioDeleteFailed = true
    }
  }
  return { audioDeleteFailed }
}

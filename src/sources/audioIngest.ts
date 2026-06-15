// src/sources/audioIngest.ts
import { v4 as uuidv4 } from 'uuid'
import { saveAudio, audioStoragePath } from '../core/opfs/audio'

export async function ingestAudioFile(file: File): Promise<{ songId: string; audioStoredPath: string }> {
  const songId = uuidv4()
  const buffer = await file.arrayBuffer()
  await saveAudio(songId, buffer)
  return { songId, audioStoredPath: audioStoragePath(songId) }
}

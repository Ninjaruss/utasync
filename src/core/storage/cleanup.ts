import { deleteAudio } from '../opfs/audio'

/** Lists OPFS audio file ids that have no matching song row. */
export async function findOrphanedAudioIds(knownSongIds: Iterable<string>): Promise<string[]> {
  const known = new Set(knownSongIds)
  try {
    const root = await navigator.storage.getDirectory()
    const dir = await root.getDirectoryHandle('songs')
    const orphans: string[] = []
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind === 'file' && name.endsWith('.mp3')) {
        const id = name.slice(0, -4)
        if (!known.has(id)) orphans.push(id)
      }
    }
    return orphans
  } catch {
    return []
  }
}

/** Deletes orphaned OPFS audio left behind by interrupted uploads or deleted rows. */
export async function deleteOrphanedAudio(knownSongIds: Iterable<string>): Promise<number> {
  const orphans = await findOrphanedAudioIds(knownSongIds)
  await Promise.all(orphans.map((id) => deleteAudio(id)))
  return orphans.length
}

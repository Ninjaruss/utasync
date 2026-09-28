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

/** Deletes orphaned OPFS audio left behind by interrupted uploads or deleted rows.
 *  Returns how many files were actually removed. A file whose deletion fails is
 *  left in place, logged and not counted — the call never rejects for one file,
 *  so a single unremovable entry cannot turn a partial cleanup into a silent
 *  unhandled failure or into a claimed success. */
export async function deleteOrphanedAudio(knownSongIds: Iterable<string>): Promise<number> {
  const orphans = await findOrphanedAudioIds(knownSongIds)
  const results = await Promise.all(
    orphans.map(async (id) => {
      try {
        await deleteAudio(id)
        return true
      } catch (e) {
        console.warn(`Failed to delete orphaned audio ${id}.`, e)
        return false
      }
    }),
  )
  return results.filter(Boolean).length
}

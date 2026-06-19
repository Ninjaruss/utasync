// The File System Access API surface we rely on isn't fully covered by TS's
// DOM lib (createWritable is partial, remove() is non-standard), so describe it.
interface OPFSWritable {
  write(data: ArrayBuffer | Blob): Promise<void>
  close(): Promise<void>
}
interface OPFSFileHandle {
  createWritable(): Promise<OPFSWritable>
  getFile(): Promise<File>
}

async function getSongsDir() {
  const root = await navigator.storage.getDirectory()
  return root.getDirectoryHandle('songs', { create: true })
}

export async function saveAudio(songId: string, buffer: ArrayBuffer): Promise<void> {
  const dir = await getSongsDir()
  const file = await dir.getFileHandle(`${songId}.mp3`, { create: true }) as unknown as OPFSFileHandle
  const writable = await file.createWritable()
  await writable.write(buffer)
  await writable.close()
}

export async function getAudioFile(songId: string): Promise<File> {
  const dir = await getSongsDir()
  const file = await dir.getFileHandle(`${songId}.mp3`) as unknown as OPFSFileHandle
  return file.getFile()
}

export async function deleteAudio(songId: string): Promise<void> {
  const dir = await getSongsDir()
  // removeEntry is the standard, broadly-supported way to delete a file (the
  // per-handle remove() is non-standard). Tolerate an already-missing file so
  // deletion stays idempotent and never blocks removing the song row.
  try {
    await dir.removeEntry(`${songId}.mp3`)
  } catch (e: unknown) {
    if ((e as DOMException)?.name !== 'NotFoundError') throw e
  }
}

export function audioStoragePath(songId: string): string {
  return `songs/${songId}.mp3`
}

/** Total bytes of uploaded song audio stored in OPFS. */
export async function estimateOpfsAudioBytes(): Promise<number> {
  if (!navigator.storage?.getDirectory) return 0
  try {
    const root = await navigator.storage.getDirectory()
    const dir = await root.getDirectoryHandle('songs')
    let total = 0
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind !== 'file' || !name.endsWith('.mp3')) continue
      total += (await handle.getFile()).size
    }
    return total
  } catch {
    return 0
  }
}

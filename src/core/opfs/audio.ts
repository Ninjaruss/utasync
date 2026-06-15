// The File System Access API surface we rely on isn't fully covered by TS's
// DOM lib (createWritable is partial, remove() is non-standard), so describe it.
interface OPFSWritable {
  write(data: ArrayBuffer | Blob): Promise<void>
  close(): Promise<void>
}
interface OPFSFileHandle {
  createWritable(): Promise<OPFSWritable>
  getFile(): Promise<File>
  remove(): Promise<void>
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
  const file = await dir.getFileHandle(`${songId}.mp3`) as unknown as OPFSFileHandle
  await file.remove()
}

export function audioStoragePath(songId: string): string {
  return `songs/${songId}.mp3`
}

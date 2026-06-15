async function getSongsDir() {
  const root = await navigator.storage.getDirectory()
  return root.getDirectoryHandle('songs', { create: true })
}

export async function saveAudio(songId: string, buffer: ArrayBuffer): Promise<void> {
  const dir = await getSongsDir()
  const file = await dir.getFileHandle(`${songId}.mp3`, { create: true })
  const writable = await (file as any).createWritable()
  await writable.write(buffer)
  await writable.close()
}

export async function getAudioFile(songId: string): Promise<File> {
  const dir = await getSongsDir()
  const file = await dir.getFileHandle(`${songId}.mp3`)
  return (file as any).getFile()
}

export async function deleteAudio(songId: string): Promise<void> {
  const dir = await getSongsDir()
  const file = await dir.getFileHandle(`${songId}.mp3`)
  await (file as any).remove()
}

export function audioStoragePath(songId: string): string {
  return `songs/${songId}.mp3`
}

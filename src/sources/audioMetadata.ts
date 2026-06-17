export interface AudioMetadata {
  title?: string
  artist?: string
}

// Filename without its final extension, e.g. "My Song.mp3" -> "My Song".
export function deriveTitle(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return (dot > 0 ? filename.slice(0, dot) : filename).trim()
}

// Best-effort read of embedded title/artist tags. Lazily loads music-metadata
// so it never affects initial page load, and never throws — a parse failure
// yields {} and the caller falls back (e.g. to the filename).
export async function extractAudioMetadata(file: File): Promise<AudioMetadata> {
  try {
    const { parseBlob } = await import('music-metadata')
    const { common } = await parseBlob(file)
    const result: AudioMetadata = {}
    const title = common.title?.trim()
    const artist = common.artist?.trim()
    if (title) result.title = title
    if (artist) result.artist = artist
    return result
  } catch {
    return {}
  }
}

/**
 * Best-effort parse of an "Artist - Title" filename (also en/em-dash). Used as a
 * fallback when embedded tags lack an artist. Splits on the first separator so
 * dashes inside the title are preserved. No separator → title-only.
 */
export function parseFilename(filename: string): { title?: string; artist?: string } {
  const base = deriveTitle(filename)
  const m = base.match(/^(.*?)\s+[-–—]\s+(.*)$/)
  if (!m) return base ? { title: base } : {}
  const artist = m[1].trim()
  const title = m[2].trim()
  if (!artist || !title) return { title: base }
  return { artist, title }
}

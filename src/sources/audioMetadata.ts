export interface AudioMetadata {
  title?: string
  artist?: string
}

export type MetadataFieldSource = 'tag' | 'filename'

export interface ResolvedTrackMetadata {
  title: string
  artist: string
  titleSource: MetadataFieldSource | null
  artistSource: MetadataFieldSource | null
  /** True when the filename split could be Artist–Title or Title–Artist. */
  filenameAmbiguous: boolean
}

// Filename without its final extension, e.g. "My Song.mp3" -> "My Song".
export function deriveTitle(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return (dot > 0 ? filename.slice(0, dot) : filename).trim()
}

// Clues that a segment is the song title rather than the artist name.
function scoreAsTitle(segment: string): number {
  let score = 0
  if (/\b(feat\.?|ft\.?|featuring)\b/i.test(segment)) score += 4
  if (/\((official|remix|live|version|edit|mv|ver\.|acoustic|instrumental)\)/i.test(segment)) score += 3
  if (/\b(remix|live|version|edit|acoustic|instrumental|cover)\b/i.test(segment)) score += 2
  if (segment.length > 35) score += 1
  return score
}

function scoreAsArtist(segment: string): number {
  let score = 0
  if (segment.length <= 30) score += 1
  if (!/\b(feat\.|ft\.|remix|live|version)\b/i.test(segment)) score += 1
  return score
}

function splitOnSeparator(text: string): { left: string; right: string } | null {
  const m = text.match(/^(.*?)\s+[-–—]\s+(.*)$/)
  if (!m) return null
  const left = m[1].trim()
  const right = m[2].trim()
  if (!left || !right) return null
  return { left, right }
}

/**
 * When tags store "Artist - Title" in a single field, split into both parts.
 */
export function unpackCombinedTags(tags: AudioMetadata): AudioMetadata {
  let title = tags.title?.trim()
  let artist = tags.artist?.trim()

  if (title && !artist) {
    const split = splitOnSeparator(title)
    if (split) {
      return { artist: split.left, title: split.right }
    }
  }

  if (artist && !title) {
    const split = splitOnSeparator(artist)
    if (split) {
      return { artist: split.left, title: split.right }
    }
  }

  if (title && artist) {
    const split = splitOnSeparator(title)
    if (split && namesLikelyMatch(split.left, artist)) {
      return { artist: split.left, title: split.right }
    }
  }

  return { title, artist }
}

function namesLikelyMatch(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\u3040-\u9fff]/g, '')
  const na = norm(a)
  const nb = norm(b)
  if (!na || !nb) return false
  return na === nb || na.includes(nb) || nb.includes(na)
}

export interface FilenameParse {
  title?: string
  artist?: string
  ambiguous?: boolean
}

/**
 * Best-effort parse of an "Artist - Title" or "Title - Artist" filename.
 * Uses lightweight heuristics when both orderings are plausible.
 */
export function parseFilename(filename: string): FilenameParse {
  const base = deriveTitle(filename)
  const split = splitOnSeparator(base)
  if (!split) return base ? { title: base } : {}

  const { left, right } = split
  const artistFirstScore = scoreAsArtist(left) + scoreAsTitle(right)
  const titleFirstScore = scoreAsTitle(left) + scoreAsArtist(right)

  if (titleFirstScore > artistFirstScore + 1) {
    return { title: left, artist: right, ambiguous: artistFirstScore === titleFirstScore }
  }
  if (artistFirstScore > titleFirstScore + 1) {
    return { artist: left, title: right, ambiguous: false }
  }

  // Default to the common "Artist - Title" convention, but flag ambiguity.
  return { artist: left, title: right, ambiguous: true }
}

/**
 * Merge embedded tags and filename into title/artist with source labels.
 * Tags win over filename; filename fills only empty fields.
 */
export function resolveTrackMetadata(
  rawTags: AudioMetadata,
  filename: string,
): ResolvedTrackMetadata {
  const tags = unpackCombinedTags(rawTags)
  const fromName = parseFilename(filename)

  let title = tags.title ?? ''
  let artist = tags.artist ?? ''
  let titleSource: MetadataFieldSource | null = title ? 'tag' : null
  let artistSource: MetadataFieldSource | null = artist ? 'tag' : null

  if (!title && fromName.title) {
    title = fromName.title
    titleSource = 'filename'
  }
  if (!artist && fromName.artist) {
    artist = fromName.artist
    artistSource = 'filename'
  }
  if (!title) {
    title = deriveTitle(filename)
    titleSource = 'filename'
  }

  let ambiguous = !!(fromName.ambiguous && (titleSource === 'filename' || artistSource === 'filename'))
  if (tags.title && fromName.title && namesLikelyMatch(tags.title, fromName.title) && fromName.artist) {
    ambiguous = false
  }
  if (tags.artist && fromName.artist && namesLikelyMatch(tags.artist, fromName.artist)) {
    ambiguous = false
  }

  return {
    title,
    artist,
    titleSource,
    artistSource,
    filenameAmbiguous: ambiguous,
  }
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
    const artist =
      common.artist?.trim()
      || common.artists?.[0]?.trim()
      || common.albumartist?.trim()
    if (title) result.title = title
    if (artist) result.artist = artist
    return result
  } catch {
    return {}
  }
}

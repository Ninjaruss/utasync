export interface AudioMetadata {
  title?: string
  artist?: string
  /** Decoded track length in seconds, when the file's format header exposes it. */
  durationSec?: number
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
  const title = tags.title?.trim()
  const artist = tags.artist?.trim()

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

// Extensions we treat as plausibly playable audio when the browser doesn't
// supply an `audio/*` MIME type (some pickers report an empty or generic type).
const AUDIO_EXTENSIONS = ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'flac', 'opus', 'webm']

/**
 * Cheap, synchronous check that a picked file is plausibly playable audio.
 * Accepts anything with an `audio/*` MIME type OR a known audio extension —
 * enough to catch an obviously-wrong pick (a .txt, a PDF) up front without a
 * full decode probe.
 */
export function isPlausibleAudioFile(file: File): boolean {
  if (file.type && file.type.toLowerCase().startsWith('audio/')) return true
  const dot = file.name.lastIndexOf('.')
  if (dot < 0) return false
  const ext = file.name.slice(dot + 1).toLowerCase()
  return AUDIO_EXTENSIONS.includes(ext)
}

/**
 * Container/codec signatures covering every extension AUDIO_EXTENSIONS accepts.
 * Read from the first bytes only — no decode, no full-file buffering.
 */
function hasAudioSignature(head: Uint8Array): boolean {
  const at = (offset: number, ascii: string) =>
    ascii.split('').every((c, i) => head[offset + i] === c.charCodeAt(0))
  if (head.length < 4) return false
  if (at(0, 'ID3')) return true // MP3 carrying an ID3 tag
  if (head[0] === 0xff && (head[1] & 0xe0) === 0xe0) return true // MPEG / AAC frame sync
  if (at(0, 'RIFF') && at(8, 'WAVE')) return true // WAV
  if (at(0, 'OggS')) return true // Ogg Vorbis / Opus
  if (at(0, 'fLaC')) return true // FLAC
  if (at(4, 'ftyp')) return true // MP4 / M4A
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return true // Matroska / WebM
  return false
}

/**
 * True when the picked file actually carries a known audio container signature.
 *
 * `isPlausibleAudioFile` cannot catch a non-audio file renamed to `.mp3`: the
 * browser derives `file.type` from the extension, so `file.type.startsWith('audio/')`
 * is true for garbage. Without this, such a file was stored, a song row was
 * written, and the user was told the song was added — then it would not play or
 * align. Reads 16 bytes, so it works for large files and never blocks on a decode.
 * An unreadable file is allowed through rather than rejected on our own failure.
 */
export async function hasPlayableAudioHeader(file: File): Promise<boolean> {
  try {
    return hasAudioSignature(new Uint8Array(await file.slice(0, 16).arrayBuffer()))
  } catch {
    return true
  }
}

/**
 * Full up-front validation: the cheap extension/MIME check, then the container
 * signature for the extensions we advertise.
 *
 * The signature is enforced only for `AUDIO_EXTENSIONS`. A file the browser
 * types `audio/*` under some other extension (`.aiff`, say) keeps the old
 * MIME-only behaviour rather than being rejected by a signature list it was
 * never part of.
 */
export async function isPlayableAudioFile(file: File): Promise<boolean> {
  if (!isPlausibleAudioFile(file)) return false
  const ext = fileExtension(file.name)
  if (!ext || !AUDIO_EXTENSIONS.includes(ext)) return true
  return hasPlayableAudioHeader(file)
}

/** Lowercased extension without the dot, or null when there is none. */
export function fileExtension(name: string): string | null {
  const dot = name.lastIndexOf('.')
  return dot < 0 ? null : name.slice(dot + 1).toLowerCase()
}

// Best-effort read of embedded title/artist tags. Lazily loads music-metadata
// so it never affects initial page load, and never throws — a parse failure
// yields {} and the caller falls back (e.g. to the filename).
export async function extractAudioMetadata(file: File): Promise<AudioMetadata> {
  try {
    const { parseBlob } = await import('music-metadata')
    const { common, format } = await parseBlob(file)
    const result: AudioMetadata = {}
    const title = common.title?.trim()
    const artist =
      common.artist?.trim()
      || common.artists?.[0]?.trim()
      || common.albumartist?.trim()
    if (title) result.title = title
    if (artist) result.artist = artist
    if (format?.duration) result.durationSec = format.duration
    return result
  } catch {
    return {}
  }
}

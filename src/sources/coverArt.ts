import { artistSimilarity, titleSimilarity } from './lyricsMatch'
import { fetchJson } from './fetchJson'

const MAX_EMBEDDED_COVER_BYTES = 512 * 1024
const ITUNES_MATCH_THRESHOLD = 0.55
/** Cover art is a nice-to-have — never let a slow lookup stall the save overlay. */
const ITUNES_LOOKUP_TIMEOUT_MS = 5_000

export interface ResolveCoverArtInput {
  title: string
  artist: string
  audioFile?: File | null
  youtubeThumbnailUrl?: string | null
}

interface ItunesTrackResult {
  trackName?: string
  artistName?: string
  artworkUrl100?: string
}

function pictureToDataUrl(picture: { format: string; data: Uint8Array }): string {
  const mime = picture.format.startsWith('image/') ? picture.format : `image/${picture.format}`
  const bytes = picture.data
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
  return `data:${mime};base64,${btoa(binary)}`
}

/** Read album art embedded in an audio file's tags. Returns a data URL or null. */
export async function extractEmbeddedCoverArt(file: File): Promise<string | null> {
  try {
    const { parseBlob } = await import('music-metadata')
    const { common } = await parseBlob(file)
    const picture = common.picture?.[0]
    if (!picture?.data?.length) return null
    if (picture.data.length > MAX_EMBEDDED_COVER_BYTES) return null
    return pictureToDataUrl(picture)
  } catch {
    return null
  }
}

/** Upgrade iTunes artwork URLs to a larger size (default 600×600). */
export function itunesArtworkUrl(url: string, size = 600): string {
  return url.replace(/\d+x\d+bb\.jpg/, `${size}x${size}bb.jpg`)
}

function scoreItunesMatch(result: ItunesTrackResult, title: string, artist: string): number {
  const track = result.trackName ?? ''
  const trackArtist = result.artistName ?? ''
  if (!track || !result.artworkUrl100) return 0
  const titleScore = titleSimilarity(track, title)
  const artistScore = artist.trim() ? artistSimilarity(trackArtist, artist) : 0.5
  return titleScore * 0.65 + artistScore * 0.35
}

/**
 * Look up cover art from the iTunes Search API (no API key required).
 * Bounded by a short timeout — resolves null instead of hanging the caller.
 */
export async function fetchItunesCoverArt(title: string, artist: string): Promise<string | null> {
  const term = `${artist} ${title}`.trim()
  if (!term) return null

  const params = new URLSearchParams({ term, entity: 'song', limit: '8' })
  const data = await fetchJson<{ results?: ItunesTrackResult[] }>(
    `https://itunes.apple.com/search?${params}`,
    undefined,
    ITUNES_LOOKUP_TIMEOUT_MS,
  )
  const results = data?.results ?? []
  if (results.length === 0) return null

  let best: { url: string; score: number } | null = null
  for (const result of results) {
    const score = scoreItunesMatch(result, title, artist)
    if (score < ITUNES_MATCH_THRESHOLD || !result.artworkUrl100) continue
    if (!best || score > best.score) {
      best = { url: itunesArtworkUrl(result.artworkUrl100), score }
    }
  }
  return best?.url ?? null
}

/**
 * Resolve cover art for a song. Tries embedded tags first, then a YouTube
 * thumbnail URL, then an iTunes lookup from title and artist.
 */
export async function resolveCoverArt(input: ResolveCoverArtInput): Promise<string | undefined> {
  const { title, artist, audioFile, youtubeThumbnailUrl } = input

  if (audioFile) {
    const embedded = await extractEmbeddedCoverArt(audioFile)
    if (embedded) return embedded
  }

  if (youtubeThumbnailUrl) return youtubeThumbnailUrl

  const lookedUp = await fetchItunesCoverArt(title, artist)
  return lookedUp ?? undefined
}

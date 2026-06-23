export interface YouTubeMeta {
  /** Raw video title from oEmbed. */
  rawTitle: string
  /** Cleaned song title, with junk like "(Official Video)" removed. */
  title: string
  artist: string
  videoId: string
  thumbnailUrl: string
}

// Noise commonly appended to music-video titles that defeats lyric lookups.
const TITLE_NOISE = /\s*[([]\s*(official|lyric|lyrics|audio|video|music video|m\/?v|mv|hd|4k|visualizer|color coded|live|performance|explicit|clean|full version|remaster(ed)?(\s*\d{4})?)\b[^)\]]*[)\]]/gi

/** Strip "(Official Video)", "[MV]", trailing "feat." noise, etc. */
export function cleanTitle(raw: string): string {
  return raw
    .replace(TITLE_NOISE, '')
    .replace(/\s*[-–|]\s*(official|topic)\s*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/**
 * Music videos are usually titled "Artist - Song". Split on the first dash so
 * LRCLIB gets a real artist/track pair instead of the channel name + full title.
 * Falls back to the provided channel author when no dash is present.
 */
export function parseArtistTitle(rawTitle: string, channelAuthor: string): { artist: string; title: string } {
  const cleaned = cleanTitle(rawTitle)
  const m = cleaned.match(/^(.+?)\s*[-–—]\s*(.+)$/)
  if (m) {
    return { artist: m[1].trim(), title: cleanTitle(m[2]) }
  }
  // No dash — strip "VEVO"/"- Topic" suffixes from the channel name for the artist.
  const artist = channelAuthor.replace(/\s*-\s*topic$/i, '').replace(/vevo$/i, '').trim()
  return { artist, title: cleaned }
}

export function extractVideoId(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.hostname.includes('youtube.com')) return u.searchParams.get('v')
    if (u.hostname === 'youtu.be') return u.pathname.slice(1)
    return null
  } catch {
    return null
  }
}

export async function fetchYouTubeMeta(url: string): Promise<YouTubeMeta> {
  const videoId = extractVideoId(url)
  if (!videoId) throw new Error('That doesn\'t look like a YouTube link. Paste a full youtube.com or youtu.be URL.')

  const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`
  let res: Response
  try {
    res = await fetch(oembedUrl)
  } catch {
    throw new Error('Could not reach YouTube. Check your connection and try again.')
  }
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error('This video is private or has embedding disabled. Try a different link, or add audio + lyrics manually.')
    }
    if (res.status === 404) {
      throw new Error('Video not found — it may have been removed or the link is incorrect.')
    }
    throw new Error('Could not load video info from YouTube. Try again in a moment.')
  }
  const data = await res.json()

  const { artist, title } = parseArtistTitle(data.title, data.author_name ?? '')

  return {
    rawTitle: data.title,
    title,
    artist,
    videoId,
    thumbnailUrl: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
  }
}

export interface YouTubeMeta {
  title: string
  artist: string
  videoId: string
  thumbnailUrl: string
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
  if (!videoId) throw new Error('Not a YouTube URL')

  const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`
  const res = await fetch(oembedUrl)
  if (!res.ok) throw new Error(`oEmbed fetch failed: ${res.status}`)
  const data = await res.json()

  return {
    title: data.title,
    artist: data.author_name,
    videoId,
    thumbnailUrl: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
  }
}

export interface LRCLIBResult {
  id: number
  name: string
  artistName: string
  albumName?: string
  duration?: number
  syncedLyrics: string | null
  plainLyrics: string | null
}

export async function searchLRCLIB(
  trackName: string,
  artistName: string
): Promise<LRCLIBResult[]> {
  try {
    const params = new URLSearchParams({ track_name: trackName, artist_name: artistName })
    const res = await fetch(`https://lrclib.net/api/search?${params}`)
    if (!res.ok) return []
    return res.json()
  } catch {
    return []
  }
}

export async function fetchLRCFromLRCLIB(
  trackName: string,
  artistName: string
): Promise<string | null> {
  try {
    const params = new URLSearchParams({ track_name: trackName, artist_name: artistName })
    const res = await fetch(`https://lrclib.net/api/get?${params}`)
    if (!res.ok) return null
    const data: LRCLIBResult = await res.json()
    return data.syncedLyrics ?? null
  } catch {
    return null
  }
}

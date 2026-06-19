import type { TimedLine } from '../core/types'
import { parseSubtitle } from '../lyrics/subtitle-parser'

export interface YouTubeCaptionTrack {
  langCode: string
  name: string
  /** Present on auto-generated captions. */
  kind?: string
  baseUrl: string
}

const INNERTUBE_CLIENT = {
  clientName: 'WEB',
  clientVersion: '2.20240214.08.00',
}

/** Prefer creator/uploaded captions over auto-generated, then language hints. */
export function pickCaptionTrack(
  tracks: YouTubeCaptionTrack[],
  preferLangs: string[] = ['ja', 'en'],
): YouTubeCaptionTrack | null {
  if (tracks.length === 0) return null

  const manual = tracks.filter((t) => t.kind !== 'asr')
  const pool = manual.length > 0 ? manual : tracks

  for (const lang of preferLangs) {
    const exact = pool.find((t) => t.langCode === lang || t.langCode.startsWith(`${lang}-`))
    if (exact) return exact
  }

  return pool[0] ?? null
}

/** Fetch caption track list via YouTube's innertube player endpoint (browser-friendly). */
export async function listYouTubeCaptionTracks(videoId: string): Promise<YouTubeCaptionTrack[]> {
  try {
    const res = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        context: { client: INNERTUBE_CLIENT },
        videoId,
      }),
    })
    if (!res.ok) return []
    const data = await res.json()
    const raw = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks
    if (!Array.isArray(raw)) return []
    return raw
      .map((t: { languageCode?: string; name?: { simpleText?: string }; kind?: string; baseUrl?: string }) => ({
        langCode: t.languageCode ?? '',
        name: t.name?.simpleText ?? '',
        kind: t.kind,
        baseUrl: t.baseUrl ?? '',
      }))
      .filter((t: YouTubeCaptionTrack) => t.baseUrl && t.langCode)
  } catch {
    return []
  }
}

export function parseYouTubeTranscriptXml(xml: string): TimedLine[] {
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  const texts = doc.querySelectorAll('text')
  const lines: TimedLine[] = []
  for (const el of texts) {
    const start = parseFloat(el.getAttribute('start') ?? '0')
    const dur = parseFloat(el.getAttribute('dur') ?? '0')
    const original = (el.textContent ?? '').replace(/\s+/g, ' ').trim()
    if (!original) continue
    lines.push({
      startTime: start,
      endTime: start + (dur > 0 ? dur : 0.5),
      original,
      translation: '',
    })
  }
  return lines
}

async function fetchCaptionLines(track: YouTubeCaptionTrack): Promise<TimedLine[]> {
  const vttUrl = `${track.baseUrl}${track.baseUrl.includes('?') ? '&' : '?'}fmt=vtt`
  const vttRes = await fetch(vttUrl)
  if (vttRes.ok) {
    const vtt = await vttRes.text()
    const parsed = parseSubtitle(vtt, 'captions.vtt')
    if (parsed.length > 0) return parsed
  }

  const xmlRes = await fetch(track.baseUrl)
  if (!xmlRes.ok) return []
  const xml = await xmlRes.text()
  return parseYouTubeTranscriptXml(xml)
}

/**
 * Best-effort synced lyrics from the video's native captions.
 * Returns null when the video has no caption tracks or fetch fails.
 */
export async function fetchYouTubeCaptionLines(
  videoId: string,
  preferLangs?: string[],
): Promise<TimedLine[] | null> {
  const tracks = await listYouTubeCaptionTracks(videoId)
  const track = pickCaptionTrack(tracks, preferLangs)
  if (!track) return null
  const lines = await fetchCaptionLines(track)
  return lines.length > 0 ? lines : null
}

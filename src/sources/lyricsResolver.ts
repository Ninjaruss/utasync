import type { TimedLine, Language } from '../core/types'
import { findLyrics, type LyricsLookup, type LyricsLookupMatch } from './lrclib'
import { parseLRC } from '../lyrics/lrc-parser'
import { linesFromPlainText } from './songBuilder'
import { fetchYouTubeCaptionLines } from './youtubeCaptions'
import { detectLanguage } from '../lyrics/bilingual'
import { inferPreferredLyricsLanguage } from './lyricsMatch'

export type { LyricsLookupMatch }

export type LyricsResolveSource =
  | 'youtube-captions'
  | 'lrclib-synced'
  | 'lrclib-plain'
  | 'none'

/** Source when lyrics were actually found (excludes `'none'`). */
export type LyricsResolveFoundSource = Exclude<LyricsResolveSource, 'none'>

export interface LyricsResolveResult {
  lines: TimedLine[]
  synced: boolean
  source: LyricsResolveSource
  /** Set for LRCLIB hits — title/artist of the entry lyrics came from. */
  match?: LyricsLookupMatch
}

function fromLrcLookup(lookup: LyricsLookup): LyricsResolveResult {
  const lines = lookup.synced ? parseLRC(lookup.lrc) : linesFromPlainText(lookup.lrc)
  return {
    lines,
    synced: lookup.synced,
    source: lookup.synced ? 'lrclib-synced' : 'lrclib-plain',
    match: lookup.match,
  }
}

function languageHints(sourceLanguage?: Language): string[] {
  if (sourceLanguage === 'ja') return ['ja', 'en']
  if (sourceLanguage === 'en') return ['en', 'ja']
  return ['ja', 'en']
}

export type ResolveLyricsStage = 'youtube' | 'lrclib-exact' | 'lrclib-search'

/**
 * Resolve lyrics for a song. YouTube native captions are tried first when a
 * video id is available; LRCLIB is the fallback.
 */
export async function resolveLyricsForSong(opts: {
  title: string
  artist: string
  videoId?: string | null
  sourceLanguage?: Language
  onStage?: (stage: ResolveLyricsStage) => void
}): Promise<LyricsResolveResult> {
  const { title, artist, videoId, sourceLanguage, onStage } = opts
  const preferLangs = languageHints(sourceLanguage)

  if (videoId) {
    onStage?.('youtube')
    const captions = await fetchYouTubeCaptionLines(videoId, preferLangs)
    if (captions && captions.length > 0) {
      return { lines: captions, synced: true, source: 'youtube-captions' }
    }
  }

  const preferredLanguage = inferPreferredLyricsLanguage(
    title.trim(),
    artist.trim(),
    sourceLanguage ?? 'ja',
  )
  const found = await findLyrics(title.trim(), artist.trim(), (stage) => {
    onStage?.(stage === 'exact' ? 'lrclib-exact' : 'lrclib-search')
  }, undefined, preferredLanguage)
  if (found) return fromLrcLookup(found)

  return { lines: [], synced: false, source: 'none' }
}

export function lyricsSourceLabel(source: LyricsResolveSource): string {
  switch (source) {
    case 'youtube-captions': return 'YouTube captions'
    case 'lrclib-synced': return 'LRCLIB (synced)'
    case 'lrclib-plain': return 'LRCLIB (plain)'
    default: return 'No match'
  }
}

/** Infer source language from lyric text when not already known. */
export function inferSourceLanguage(lines: TimedLine[]): Language {
  if (lines.length === 0) return 'ja'
  const lang = detectLanguage(lines.map((l) => l.original).join('\n'))
  return lang === 'ja' ? 'ja' : 'en'
}

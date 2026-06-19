import type { Song, SourceRef, SyncState } from '../types'
import { extractVideoId } from '../../sources/youtube'

/**
 * Forward-fill the unified source list from a song's legacy single-source
 * fields. Idempotent: songs that already carry `sources` are returned as-is.
 */
export function deriveSources(song: Song): SourceRef[] {
  if (song.sources && song.sources.length > 0) return song.sources
  if (song.sourceUrl) {
    const videoId = extractVideoId(song.sourceUrl)
    if (videoId) return [{ provider: 'youtube', ref: videoId, url: song.sourceUrl, hasAudio: false }]
  }
  if (song.audioStoredPath) {
    return [{ provider: 'upload', ref: song.audioStoredPath, hasAudio: true }]
  }
  return []
}

/** A song is `synced` only when every line has a positive start time. */
export function computeSyncState(song: Song): SyncState {
  const lines = song.lyrics.lines
  if (lines.length === 0) return 'needs-sync'
  // Synced only when every line has a positive start time; the first line is
  // allowed to start at exactly 0.
  return lines.every((l, i) => l.startTime > 0 || (i === 0 && l.startTime === 0)) ? 'synced' : 'needs-sync'
}

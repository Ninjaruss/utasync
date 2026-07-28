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

/** Above this share of unverifiable (needs_review) lines, a fully-timed song is
 * not honestly "synced" — its calm badge would hide real misalignment. Tuned so
 * a stray flag on a long song doesn't flip it, but a substantially-off song does
 * (1/10 stays synced, 2/10 flips). */
const NEEDS_REVIEW_SYNC_TOLERANCE = 0.1

/**
 * A song is `synced` only when (a) every line has a positive start time and
 * (b) the aligner did not flag a meaningful share of lines as unverifiable.
 *
 * The structural check alone answers "does every line carry a timestamp?", so a
 * song the aligner already marked `needs_review` on many lines still wore a calm
 * "synced" chip — a false positive the badge is meant to prevent. We gate on
 * `needs_review` (the aligner's explicit "couldn't verify this") only: routine
 * `approximate` line-ends on long segment-mode tracks are still fine to sing
 * along to, and counting them would flip every long song to needs-sync. Quality
 * is consulted only when present and length-matched to the lines; otherwise (old
 * songs, phrase-layout mismatch, manual timing) we fall back to the structural
 * check. Because stale quality can only make a hand-fixed song read conservatively
 * as needs-sync — never the reverse — this never resurrects a false "synced".
 */
export function computeSyncState(song: Song): SyncState {
  const lines = song.lyrics.lines
  if (lines.length === 0) return 'needs-sync'
  // Synced only when every line has a positive start time; the first line is
  // allowed to start at exactly 0.
  const structurallyTimed = lines.every((l, i) => l.startTime > 0 || (i === 0 && l.startTime === 0))
  if (!structurallyTimed) return 'needs-sync'

  const quality = song.lyrics.lineAlignmentQuality
  if (quality && quality.length === lines.length) {
    let nonBlank = 0
    let unverified = 0
    for (let i = 0; i < lines.length; i++) {
      if (!(lines[i].original || lines[i].translation || '').trim()) continue
      nonBlank++
      if (quality[i] === 'needs_review') unverified++
    }
    if (nonBlank > 0 && unverified / nonBlank > NEEDS_REVIEW_SYNC_TOLERANCE) return 'needs-sync'
  }
  return 'synced'
}

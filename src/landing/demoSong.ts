import type { Song, TimedLine } from '../core/types'
import { db } from '../core/db/schema'
import { computeSyncState } from '../core/db/migrations'
import { ALIGNMENT_PIPELINE_VERSION } from '../lyrics/phraseAlignment'
import demoData from './demoSong.data.json'

/** Stable id so seeding is idempotent and the landing CTA can always open it. */
export const DEMO_SONG_ID = 'demo-veil-excerpt'

/**
 * YouTube source for the demo. The app streams playback from here (no audio is
 * bundled). The baked timings come from a YouTube-sourced rip of this video.
 *
 * TODO(verify): this video id is a placeholder and MUST be confirmed to be the
 * exact Veil (Keina Suda) video the fixture transcript was made from — otherwise
 * playback will be the wrong video / out of sync. The lyric, furigana, and
 * word-pairing showcase works regardless of this URL; only playback depends on it.
 */
export const DEMO_YOUTUBE_URL = 'https://www.youtube.com/watch?v=2pZ69aLZ4qw'

function demoLines(): TimedLine[] {
  return demoData.lines.map((l) => ({
    original: l.original,
    translation: l.translation,
    startTime: l.startTime,
    endTime: l.endTime,
  }))
}

/** Build the demo Song. `alignmentMode: 'auto'` + transcriptWords let the app
 * enrich furigana/readings/word-pairings live on open — the live engine is the
 * showcase, so nothing is pre-baked beyond timing + translation. */
export function buildDemoSong(): Song {
  return {
    id: DEMO_SONG_ID,
    title: demoData.title,
    artist: demoData.artist,
    sourceUrl: DEMO_YOUTUBE_URL,
    lyrics: {
      lines: demoLines(),
      sourceLanguage: demoData.sourceLanguage as 'ja',
      translationLanguage: demoData.translationLanguage as 'en',
      alignmentMode: 'auto',
      alignmentConfidence: demoData.alignmentConfidence,
      alignmentPipelineVersion: ALIGNMENT_PIPELINE_VERSION,
      transcriptWords: demoData.transcriptWords,
    },
    createdAt: new Date(),
    isTrialSong: false,
  }
}

/** Idempotently seed the demo song and return its id. Safe to call repeatedly;
 * if the user deleted it, this restores it. */
export async function ensureDemoSong(): Promise<string> {
  const existing = await db.songs.get(DEMO_SONG_ID)
  if (existing) return DEMO_SONG_ID
  const song = buildDemoSong()
  await db.songs.put({ ...song, syncState: computeSyncState(song) })
  return DEMO_SONG_ID
}

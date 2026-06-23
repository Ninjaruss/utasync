// src/sources/songBuilder.ts
import { v4 as uuidv4 } from 'uuid'
import type { Song, TimedLine, AlignmentMode, Language } from '../core/types'

export interface BuildSongInput {
  id?: string
  title: string
  artist: string
  sourceUrl?: string
  audioStoredPath?: string
  lines: TimedLine[]
  sourceLanguage?: Language
  translationLanguage?: Language
  alignmentMode?: AlignmentMode
  isTrialSong?: boolean
  albumArtUrl?: string
}

export function buildSong(input: BuildSongInput): Song {
  return {
    id: input.id ?? uuidv4(),
    title: input.title,
    artist: input.artist,
    sourceUrl: input.sourceUrl,
    audioStoredPath: input.audioStoredPath,
    albumArtUrl: input.albumArtUrl,
    lyrics: {
      lines: input.lines,
      sourceLanguage: input.sourceLanguage ?? 'ja',
      translationLanguage: input.translationLanguage ?? 'en',
      alignmentMode: input.alignmentMode ?? 'manual',
    },
    createdAt: new Date(),
    isTrialSong: input.isTrialSong ?? false,
  }
}

export function linesFromPlainText(text: string): TimedLine[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((original): TimedLine => ({ startTime: 0, endTime: 0, original, translation: '' }))
}

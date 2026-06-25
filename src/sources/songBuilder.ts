// src/sources/songBuilder.ts
import { v4 as uuidv4 } from 'uuid'
import type { Song, TimedLine, AlignmentMode, Language } from '../core/types'
import { getDefaultSongLanguage } from '../payment/SettingsStore'

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
  const defaultLang = getDefaultSongLanguage()
  const sourceLanguage = input.sourceLanguage ?? defaultLang
  const translationLanguage = input.translationLanguage ?? (sourceLanguage === 'ja' ? 'en' : 'ja')
  return {
    id: input.id ?? uuidv4(),
    title: input.title,
    artist: input.artist,
    sourceUrl: input.sourceUrl,
    audioStoredPath: input.audioStoredPath,
    albumArtUrl: input.albumArtUrl,
    lyrics: {
      lines: input.lines,
      sourceLanguage,
      translationLanguage,
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

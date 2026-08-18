// src/sources/songBuilder.ts
import { v4 as uuidv4 } from 'uuid'
import type { Song, TimedLine, AlignmentMode, Language } from '../core/types'
import { getDefaultSongLanguage } from '../payment/SettingsStore'
import { cleanPastedLyrics, stripInlineFurigana } from '../lyrics/lyricCleanup'
import { hasLrcTimestamps, parseLRC } from '../lyrics/lrc-parser'

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
  albumArtUrl?: string
  durationSec?: number
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
    // Guard here rather than at every call site: metadata parsers return 0 or NaN
    // for unreadable files, and a bogus duration is worse than none — it would
    // actively push the matcher toward the wrong master.
    durationSec:
      Number.isFinite(input.durationSec) && (input.durationSec as number) > 0
        ? input.durationSec
        : undefined,
    lyrics: {
      lines: input.lines,
      sourceLanguage,
      translationLanguage,
      alignmentMode: input.alignmentMode ?? 'manual',
    },
    createdAt: new Date(),
  }
}

export function linesFromPlainText(text: string): TimedLine[] {
  return cleanPastedLyrics(text)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((original): TimedLine => ({ startTime: 0, endTime: 0, original, translation: '' }))
}

/**
 * The timed lines a paste would contribute IF its LRC timings are used, or null
 * when the paste is not a timed LRC or its timing is too partial to trust
 * (parseLRC yields fewer usable lines than plain text). Single source of truth
 * shared by linesFromPaste (resolution) and the "using your timings" UI (display
 * + count), so the two can never disagree.
 */
export function pastedLrcTimedLines(pasted: string): TimedLine[] | null {
  if (!hasLrcTimestamps(pasted)) return null
  const timed = parseLRC(pasted)
    .map((l) => ({ ...l, original: stripInlineFurigana(l.original) }))
    .filter((l) => l.original.trim().length > 0)
  const plain = linesFromPlainText(pasted)
  if (timed.length > 0 && timed.length >= plain.length) return timed
  return null
}

/**
 * Resolve pasted lyrics into timed lines. When the paste is a usable timed LRC
 * (and the user has not overridden with ignoreLrcTimings), use the LRC times —
 * the non-zero startTimes make the resulting song "synced", which skips the
 * Whisper align step (see src/core/db/migrations.ts sync derivation). Otherwise
 * fall back to plain text at t=0.
 */
export function linesFromPaste(
  pasted: string,
  opts?: { ignoreLrcTimings?: boolean },
): TimedLine[] {
  if (!opts?.ignoreLrcTimings) {
    const timed = pastedLrcTimedLines(pasted)
    if (timed) return timed
  }
  return linesFromPlainText(pasted)
}

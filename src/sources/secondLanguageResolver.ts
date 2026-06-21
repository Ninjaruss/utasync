import type { Language } from '../core/types'
import { findSecondLanguageInLRCLIB, type LyricsLookup } from './lrclib'
import {
  findSecondLanguageInLyricsOvh,
  type LyricsOvhSearchAttempt,
} from './lyricsOvh'

export type SecondLanguageSearchStage = 'lrclib' | 'lyrics-ovh'

export type SecondLanguageSource = 'lrclib-synced' | 'lrclib-plain' | 'lyrics-ovh'

export type SecondLanguageLookup = LyricsLookup & { source: SecondLanguageSource }

export type SecondLanguageProviderOutcome = 'found' | 'not-found' | 'skipped'

export interface SecondLanguageSearchAttempt {
  provider: SecondLanguageSearchStage
  outcome: SecondLanguageProviderOutcome
  detail?: string
}

export type SecondLanguageSearchReport = SecondLanguageSearchAttempt[]

export interface SecondLanguageSearchOptions {
  /** Skip lyrics.ovh (Genius/AZLyrics aggregate) — LRCLIB only. */
  skipLyricsOvh?: boolean
  /** Cap lyrics.ovh fetch attempts during import/save. */
  maxOvhAttempts?: number
  /** Per-request lyrics.ovh timeout (default 55s). */
  ovhTimeoutMs?: number
}

function summarizeOvhAttempts(attempts: LyricsOvhSearchAttempt[]): string {
  if (attempts.some((a) => a.outcome === 'found')) return 'found translation'
  const timeouts = attempts.filter((a) => a.outcome === 'timeout').length
  const notFound = attempts.filter((a) => a.outcome === 'not-found').length
  const wrongLang = attempts.filter((a) => a.outcome === 'wrong-language').length
  const parts: string[] = []
  if (notFound) parts.push(`${notFound} not on lyric sites`)
  if (timeouts) parts.push(`${timeouts} timed out`)
  if (wrongLang) parts.push(`${wrongLang} same language as primary`)
  return parts.length ? parts.join(', ') : 'no matching lyrics'
}

/**
 * Cascade search for a different-language lyric version of a song.
 * LRCLIB is tried first (synced when available); lyrics.ovh aggregates
 * Genius/AZLyrics and other plain-text sources as a fallback.
 */
export async function findSecondLanguageLyrics(
  trackName: string,
  artistName: string,
  primaryLang: Language | 'other',
  onStage?: (stage: SecondLanguageSearchStage) => void,
  durationSec?: number,
  onReport?: (report: SecondLanguageSearchReport) => void,
  options?: SecondLanguageSearchOptions,
): Promise<SecondLanguageLookup | null> {
  const report: SecondLanguageSearchReport = []

  onStage?.('lrclib')
  const lrclib = await findSecondLanguageInLRCLIB(
    trackName,
    artistName,
    primaryLang,
    durationSec,
  )
  if (lrclib) {
    report.push({
      provider: 'lrclib',
      outcome: 'found',
      detail: lrclib.synced ? 'synced' : 'plain text',
    })
    onReport?.(report)
    return {
      ...lrclib,
      source: lrclib.synced ? 'lrclib-synced' : 'lrclib-plain',
    }
  }
  report.push({ provider: 'lrclib', outcome: 'not-found' })

  if (options?.skipLyricsOvh) {
    onReport?.(report)
    return null
  }

  onStage?.('lyrics-ovh')
  const ovhAttempts: LyricsOvhSearchAttempt[] = []
  const ovh = await findSecondLanguageInLyricsOvh(
    trackName,
    artistName,
    primaryLang,
    (attempt) => ovhAttempts.push(attempt),
    {
      maxAttempts: options?.maxOvhAttempts,
      timeoutMs: options?.ovhTimeoutMs,
    },
  )
  if (ovh) {
    report.push({ provider: 'lyrics-ovh', outcome: 'found' })
    onReport?.(report)
    return { ...ovh, source: 'lyrics-ovh' }
  }
  report.push({
    provider: 'lyrics-ovh',
    outcome: 'not-found',
    detail: summarizeOvhAttempts(ovhAttempts),
  })
  onReport?.(report)

  return null
}

export function formatSecondLanguageSearchReport(report: SecondLanguageSearchReport): string {
  return report
    .map((entry) => {
      const label = entry.provider === 'lrclib' ? 'LRCLIB' : 'Genius & lyric sites'
      if (entry.outcome === 'found') {
        return `${label}: found${entry.detail ? ` (${entry.detail})` : ''}`
      }
      return `${label}: ${entry.outcome}${entry.detail ? ` — ${entry.detail}` : ''}`
    })
    .join(' · ')
}

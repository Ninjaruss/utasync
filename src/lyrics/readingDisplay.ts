import type { ReadingMode, Token } from '../core/types'
import { katakanaToHiragana } from '../language/japanese/phonetics'

/** Below this an adopted sung reading is flagged "uncertain" in the tooltip. */
const UNCERTAIN_READING_CONFIDENCE = 0.5

export type ResolvedTokenReading = {
  /** Hiragana to render in the ruby, or null when the surface needs none. */
  ruby: string | null
  /** Tooltip text, or undefined when there is nothing extra to surface. */
  title: string | undefined
  /** Which reading the ruby is actually showing. */
  source: 'dictionary' | 'sung'
}

/** True when the sung alternate should replace the dictionary reading in ruby.
 *
 * Correct-standard-readings policy: the dictionary reading owns the ruby. Detected
 * sung alternates are too unreliable (mis-hearings, proportional segment slices) to
 * override the ruby, so they surface only in the tooltip unless the user opts into
 * sung mode. */
export function shouldPromoteSungReading(
  token: Pick<Token, 'audioReading' | 'readingVerified' | 'readingConfidence'>,
  readingMode: ReadingMode,
): boolean {
  if (!token.audioReading || token.readingVerified) return false
  return readingMode === 'sung'
}

/**
 * Reading precedence: dictionary by default; promote a detected sung alternate when
 * confidence is high enough or the user prefers sung readings. Low-confidence
 * alternates stay in the tooltip so noisy segment slices cannot override the ruby.
 */
export function resolveTokenReading(
  token: Token,
  readingMode: ReadingMode = 'dictionary',
): ResolvedTokenReading {
  const dict = token.reading ? katakanaToHiragana(token.reading) : null
  const sung = token.audioReading ? katakanaToHiragana(token.audioReading) : null
  const conf = token.readingConfidence ?? 0
  const showSung = shouldPromoteSungReading(token, readingMode)

  const chosen = showSung ? sung : dict
  const ruby = chosen && chosen !== token.surface ? chosen : null

  let title: string | undefined
  if (showSung && sung) {
    title = dict && dict !== sung
      ? `Sung: ${sung} · Dictionary: ${dict}${conf > 0 ? ` (${Math.round(conf * 100)}% audio match)` : ''}`
      : `Sung: ${sung}`
  } else if (sung) {
    const label = conf > 0 && conf < UNCERTAIN_READING_CONFIDENCE ? 'Sung (uncertain)' : 'Sung'
    title = dict ? `${label}: ${sung} · Dictionary: ${dict}` : `${label}: ${sung}`
  } else if (token.readingVerified && dict) {
    title = 'Verified from audio'
  } else if (token.readingMismatch && dict) {
    title = `Dictionary: ${dict} (audio differed)`
  }

  return { ruby, title, source: showSung ? 'sung' : 'dictionary' }
}

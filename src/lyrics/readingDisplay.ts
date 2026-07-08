import { toRomaji as kanaToRomaji } from 'wanakana'
import type { ReadingMode, Token } from '../core/types'
import { katakanaToHiragana } from '../language/japanese/phonetics'

const KANA_ONLY_RE = /^[぀-ゟ゠-ヿ]+$/u

/** Below this an adopted sung reading is flagged "uncertain" in the tooltip. */
const UNCERTAIN_READING_CONFIDENCE = 0.5

/** At/above this an adopted sung reading owns the ruby even in dictionary mode.
 * Kept equal to readingAlignment.ADOPT_MIN_CONFIDENCE (re-exported by
 * readingReconciler as its promotion threshold). */
export const HIGH_READING_CONFIDENCE = 0.8

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
 * Sing-what-you-hear policy: a detected sung alternate owns the ruby once its
 * audio-match confidence clears HIGH_READING_CONFIDENCE; weaker detections
 * (mis-hearings, proportional segment slices) stay in the tooltip. Sung mode
 * promotes every adopted alternate regardless of confidence. */
export function shouldPromoteSungReading(
  token: Pick<Token, 'audioReading' | 'readingVerified' | 'readingConfidence'>,
  readingMode: ReadingMode,
): boolean {
  if (!token.audioReading || token.readingVerified) return false
  if (readingMode === 'sung') return true
  return (token.readingConfidence ?? 0) >= HIGH_READING_CONFIDENCE
}

function resolveTokenKana(token: Token, readingMode: ReadingMode): string | null {
  const dict = token.reading ? katakanaToHiragana(token.reading) : null
  const sung = token.audioReading ? katakanaToHiragana(token.audioReading) : null
  return shouldPromoteSungReading(token, readingMode) ? sung : dict
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

  const chosen = resolveTokenKana(token, readingMode)
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

/** Resolved kana + romaji for one token (kana null when the surface has none). */
function tokenKanaRomaji(token: Token, readingMode: ReadingMode): { kana: string | null; romaji: string } {
  const kana = resolveTokenKana(token, readingMode) ?? (KANA_ONLY_RE.test(token.surface) ? token.surface : null)
  if (!kana) return { kana: null, romaji: token.surface }
  return { kana, romaji: kanaToRomaji(kana) }
}

/** Onsets a token-final っ geminates into (never vowels or n/y/w). */
const GEMINATING_ONSET_RE = /^[bcdfghjkmpqrstz]/

/** Build a line's romaji from its tokens' resolved readings (dictionary or
 * audio-adopted, per `readingMode`) instead of a static whole-line conversion,
 * so it stays in sync with reading corrections applied after initial enrichment.
 *
 * Cross-token gemination: wanakana silently drops a token-final っ (いっ →
 * "i"), so splits like 一[イッ]+歩[ポ] would read "i po". A っ-final token
 * fuses with a following consonant onset instead ("ippo"; "tch" before ch). */
export function lineRomajiFromTokens(tokens: Token[], readingMode: ReadingMode = 'dictionary'): string {
  const parts = tokens.map((t) => tokenKanaRomaji(t, readingMode))
  const words: string[] = []
  for (let i = 0; i < parts.length; i++) {
    let { kana, romaji: word } = parts[i]
    while (i + 1 < parts.length && kana && /[っッ]$/.test(kana)) {
      const next = parts[i + 1]
      if (!GEMINATING_ONSET_RE.test(next.romaji)) break
      word += (next.romaji.startsWith('ch') ? 't' : next.romaji.charAt(0)) + next.romaji
      kana = next.kana
      i++
    }
    words.push(word)
  }
  return words
    .join(' ')
    .replace(/\s+([、。！？,.!?])/g, '$1')
    .trim()
}

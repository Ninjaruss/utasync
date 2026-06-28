import type { TimedLine, TimedTranscriptWord, Token } from '../core/types'
import { katakanaToHiragana } from '../language/japanese/phonetics'
import { tokenizeJapanese } from '../language/japanese/tokenizer'
import { normalizeForMatch } from './contentAligner'

const KANJI_RE = /[㐀-鿿]/

/** Confidence at/above which an adopted sung reading is promoted into the ruby. */
export const HIGH_READING_CONFIDENCE = 0.8

/** A single transcript word longer than this is treated as a coarse segment chunk
 * (segment-mode Whisper) whose proportional slicing is too unreliable to adopt a
 * sung reading from — this is what produced 戦争→wrong-kana false positives. */
const SEGMENT_WORD_MAX_SEC = 8

/** Transcript words overlapping a token's [start, end] window. */
function coveringWords(
  words: TimedTranscriptWord[],
  tokenStart: number,
  tokenEnd: number,
): TimedTranscriptWord[] {
  return words.filter((w) => w.endTime > tokenStart && w.startTime < tokenEnd)
}

/**
 * True when the transcript words covering a token window are fine-grained enough
 * to trust a sliced sung reading. A window covered only by long (>8s) segment
 * chunks with no shorter word-level sibling is unreliable — skip adoption there.
 */
export function isReliableTranscriptWindow(
  words: TimedTranscriptWord[],
  tokenStart: number,
  tokenEnd: number,
): boolean {
  const covering = coveringWords(words, tokenStart, tokenEnd)
  if (covering.length === 0) return false
  return covering.some((w) => w.endTime - w.startTime <= SEGMENT_WORD_MAX_SEC)
}

/**
 * Confidence (0–1) that a sliced sung reading is a trustworthy alternate. Combines
 * how substantial the kana evidence is with how word-level the covering transcript
 * is — short word-level chunks score high enough to reach the ruby threshold.
 */
/** A covering chunk may be at most this many times the token's morae before it is
 * treated as a multi-token phrase whose proportional kana slice can't be trusted. */
const PHRASE_SLICE_MORA_RATIO = 2.5

export function readingAdoptionConfidence(
  sung: string,
  token: Token,
  covering: TimedTranscriptWord[],
): number {
  const morae = normalizeKanaForCompare(sung).length
  if (morae < 2) return 0
  // A trustworthy sung reading comes from a transcript word about this token's
  // size. Real transcripts (segment and coarse word mode) group whole sung phrases
  // into one short chunk; slicing that proportionally yields kana from neighbouring
  // tokens. Reject when the covering chunk is far longer than the token, so the
  // dictionary reading stays in the ruby (the 車→なは / 向こう→くに garbage fix).
  const tokenMorae = Math.max(2, tokenMoraWeight(token))
  const coveringMorae = covering.reduce((sum, w) => sum + normalizeKanaForCompare(w.word).length, 0)
  if (coveringMorae > tokenMorae * PHRASE_SLICE_MORA_RATIO) return 0
  const lenScore = Math.min(1, morae / Math.max(2, tokenMoraWeight(token)))
  const durs = covering.map((w) => w.endTime - w.startTime)
  const granularity = durs.length === 0
    ? 0
    : durs.every((d) => d <= 3)
      ? 1
      : durs.some((d) => d <= SEGMENT_WORD_MAX_SEC)
        ? 0.6
        : 0.2
  const score = 0.5 * lenScore + 0.5 * granularity
  return Math.round(Math.max(0, Math.min(1, score)) * 100) / 100
}

/** Longest-common-subsequence length of two strings (glyph similarity gate). */
function lcsLength(a: string, b: string): number {
  if (!a || !b) return 0
  const prev = new Array(b.length + 1).fill(0)
  for (let i = 1; i <= a.length; i++) {
    let diag = 0
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]
      prev[j] = a[i - 1] === b[j - 1] ? diag + 1 : Math.max(prev[j], prev[j - 1])
      diag = tmp
    }
  }
  return prev[b.length]
}

/** Hiragana/katakana morae used when comparing dictionary vs sung readings. */
export function normalizeKanaForCompare(text: string): string {
  let out = ''
  for (const ch of katakanaToHiragana(text).normalize('NFKC')) {
    if (ch === 'ー') continue
    if (/[ぁ-ん]/.test(ch)) out += ch
  }
  return out
}

export function hasKanji(surface: string): boolean {
  return KANJI_RE.test(surface)
}

function hiraganaToKatakana(text: string): string {
  return text.replace(/[ぁ-ん]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60))
}

function tokenMoraWeight(token: Token): number {
  const kanji = hasKanji(token.surface)
  const raw = kanji && token.reading ? katakanaToHiragana(token.reading) : token.surface
  const morae = normalizeKanaForCompare(raw)
  return Math.max(1, morae.length || token.surface.length)
}

function clipFraction(start: number, end: number, clipStart: number, clipEnd: number): [number, number] {
  const span = Math.max(0.001, end - start)
  return [
    Math.max(0, Math.min(1, (clipStart - start) / span)),
    Math.max(0, Math.min(1, (clipEnd - start) / span)),
  ]
}

function sliceByFraction(text: string, frac0: number, frac1: number): string {
  if (!text) return ''
  const i0 = Math.floor(frac0 * text.length)
  const i1 = Math.max(i0 + 1, Math.ceil(frac1 * text.length))
  return text.slice(i0, i1)
}

/** Pull hiragana morae out of mixed kanji/kana Whisper segment text. */
function extractTranscriptKana(text: string): string {
  return normalizeKanaForCompare(text)
}

/** Matchable glyph run from a transcript chunk (kana + kanji). */
function extractTranscriptGlyphs(text: string): string {
  return normalizeForMatch(text)
}

/**
 * Portion of a transcript word that overlaps [clipStart, clipEnd], first clipped
 * to the lyric line span so a multi-line segment only contributes kana for the
 * line it actually covers.
 */
function transcriptSliceForWindow(
  word: TimedTranscriptWord,
  clipStart: number,
  clipEnd: number,
  lineStart: number,
  lineEnd: number,
  mode: 'kana' | 'glyph',
): string {
  const lineClipStart = Math.max(word.startTime, lineStart)
  const lineClipEnd = Math.min(word.endTime, lineEnd)
  if (lineClipEnd <= lineClipStart) return ''

  const overlapStart = Math.max(clipStart, lineClipStart)
  const overlapEnd = Math.min(clipEnd, lineClipEnd)
  if (overlapEnd <= overlapStart) return ''

  const [lineFrac0, lineFrac1] = clipFraction(word.startTime, word.endTime, lineClipStart, lineClipEnd)
  const lineText = mode === 'kana'
    ? extractTranscriptKana(word.word)
    : extractTranscriptGlyphs(word.word)
  if (!lineText) return ''

  const [tokenFrac0, tokenFrac1] = clipFraction(lineClipStart, lineClipEnd, overlapStart, overlapEnd)
  return sliceByFraction(lineText, lineFrac0 + (lineFrac1 - lineFrac0) * tokenFrac0, lineFrac0 + (lineFrac1 - lineFrac0) * tokenFrac1)
}

/** A transcript word must spend at least this fraction of its own duration inside a
 * token's window before its kana are trusted as that token's reading. Below it, the
 * word mostly belongs to neighbouring tokens, so any kana sliced out are a fragment
 * (the 向こう→クニコ false positive). */
const WORD_OWNED_MIN_FRACTION = 0.7

/** Transcript words a token genuinely owns: mostly inside its window, not a phrase
 * chunk spanning several tokens that proportional slicing would mince into garbage. */
function ownedWordsInWindow(
  words: TimedTranscriptWord[],
  tokenStart: number,
  tokenEnd: number,
): TimedTranscriptWord[] {
  return words.filter((w) => {
    if (w.endTime <= tokenStart || w.startTime >= tokenEnd) return false
    const dur = Math.max(0.001, w.endTime - w.startTime)
    const overlap = Math.max(0, Math.min(w.endTime, tokenEnd) - Math.max(w.startTime, tokenStart))
    return overlap / dur >= WORD_OWNED_MIN_FRACTION
  })
}

/** Full kana of the words a token owns — never a proportional sub-slice, so a
 * fragment cut from a multi-token chunk can't masquerade as the token's reading. */
function ownedSungKanaInWindow(
  words: TimedTranscriptWord[],
  tokenStart: number,
  tokenEnd: number,
): string {
  return ownedWordsInWindow(words, tokenStart, tokenEnd)
    .map((w) => extractTranscriptKana(w.word))
    .join('')
}

function sungGlyphsInWindow(
  words: TimedTranscriptWord[],
  tokenStart: number,
  tokenEnd: number,
  lineStart: number,
  lineEnd: number,
): string {
  let out = ''
  for (const w of words) {
    if (w.endTime <= tokenStart || w.startTime >= tokenEnd) continue
    out += transcriptSliceForWindow(w, tokenStart, tokenEnd, lineStart, lineEnd, 'glyph')
  }
  return out
}

function sungMoraCap(sung: string, token: Token): string {
  // Kanji tokens: cap adoption to surface glyph count (わけ sung for 理由 → 2 morae).
  return sung.slice(0, Math.max(2, token.surface.length))
}

export function readingsEquivalent(expected: string, sung: string): boolean {
  const a = normalizeKanaForCompare(expected)
  const b = normalizeKanaForCompare(sung)
  if (!a || !b) return false
  if (a === b) return true
  const shorter = Math.min(a.length, b.length)
  if (shorter < 2) return false
  return a.includes(b) || b.includes(a)
}

/** True when audio gives a different but substantial kana reading worth adopting. */
export function shouldAdoptSungReading(expected: string, sung: string): boolean {
  const s = normalizeKanaForCompare(sung)
  const e = normalizeKanaForCompare(expected)
  if (!s || s.length < 2) return false
  if (!e) return true
  if (readingsEquivalent(expected, sung)) return false
  return true
}

export function wordsInLineWindow(
  words: TimedTranscriptWord[],
  line: TimedLine,
  padSec = 0.15,
): TimedTranscriptWord[] {
  if (!Number.isFinite(line.startTime) || !Number.isFinite(line.endTime)) return []
  const start = Math.max(0, line.startTime - padSec)
  const end = line.endTime + padSec
  return words.filter((w) => w.endTime > start && w.startTime < end)
}

/** Minimum overlap of the covering transcript word(s) with a token window before a
 * kanji-substitution reading may be adopted from them. */
const KANJI_ADOPT_MIN_OVERLAP = 0.6
/** Minimum normalized glyph-LCS similarity between the sung glyph slice and the
 * lyric surface before a substitution reading is trusted. */
const KANJI_ADOPT_MIN_GLYPH_LCS = 0.34

/** Fraction of a token window [start, end] covered by transcript words. */
function timingOverlapFraction(
  covering: TimedTranscriptWord[],
  tokenStart: number,
  tokenEnd: number,
): number {
  const span = Math.max(0.001, tokenEnd - tokenStart)
  let overlap = 0
  for (const w of covering) {
    overlap += Math.max(0, Math.min(w.endTime, tokenEnd) - Math.max(w.startTime, tokenStart))
  }
  return Math.min(1, overlap / span)
}

async function adoptReadingFromTranscriptKanji(
  token: Token,
  glyphSlice: string,
): Promise<string | null> {
  if (!hasKanji(token.surface) || !token.reading || !glyphSlice) return null
  const kanji = [...glyphSlice].filter((ch) => KANJI_RE.test(ch)).join('')
  if (!kanji || kanji === token.surface) return null
  // Glyph-similarity gate: the sung slice must resemble the lyric surface enough
  // that we believe it covers this token (not a neighbour bleeding in).
  const sim = lcsLength(kanji, token.surface) / Math.max(kanji.length, token.surface.length)
  if (sim < KANJI_ADOPT_MIN_GLYPH_LCS) return null
  const analyzed = await tokenizeJapanese(kanji)
  const match = analyzed.find((t) => t.surface === kanji) ?? analyzed[0]
  if (!match?.reading) return null
  if (!shouldAdoptSungReading(token.reading, match.reading)) return null
  return match.reading
}

/** True when the transcript text contains the token's kanji run — i.e. Whisper
 * wrote the standard word, so the dictionary reading (not a kana slice) applies. */
function transcriptKanjiCovers(windowText: string, surface: string): boolean {
  const kanji = [...surface].filter((ch) => KANJI_RE.test(ch)).join('')
  return kanji.length > 0 && windowText.includes(kanji)
}

export function reconcileTokenReadings(
  tokens: Token[],
  line: TimedLine,
  transcriptWords: TimedTranscriptWord[],
): Token[] {
  if (tokens.length === 0) return tokens
  const windowWords = wordsInLineWindow(transcriptWords, line)
  if (windowWords.length === 0) return tokens
  const windowText = windowWords.map((w) => w.word).join('')

  const lineStart = line.startTime
  const lineEnd = Math.max(line.endTime, lineStart + 0.01)
  const lineDur = lineEnd - lineStart
  const weights = tokens.map(tokenMoraWeight)
  const totalWeight = weights.reduce((a, b) => a + b, 0) || tokens.length

  let cursor = lineStart
  return tokens.map((token, i) => {
    const span = (weights[i] / totalWeight) * lineDur
    const tokenStart = cursor
    const tokenEnd = i === tokens.length - 1 ? lineEnd : cursor + span
    cursor = tokenEnd

    if (!hasKanji(token.surface) || !token.reading) return token

    // If Whisper spelled this token with its own kanji, the transcript recognized
    // the standard word — its dictionary reading applies. The kana sliced from that
    // window are surrounding okurigana/particles, not a reading, so never adopt
    // them (the 車→なは / 見え→はえ / 角→この garbage fix).
    if (transcriptKanjiCovers(windowText, token.surface)) return token

    // Only trust kana from words this token actually owns. A fragment sliced out of
    // a word spanning several tokens is garbage, so it must drive neither an adopted
    // sung reading (green) nor a mismatch flag (amber) — the token stays neutral on
    // the dictionary reading. This is the high-precision policy: corroborated
    // evidence or nothing.
    const owned = ownedWordsInWindow(windowWords, tokenStart, tokenEnd)
    const sung = ownedSungKanaInWindow(windowWords, tokenStart, tokenEnd)
    const capped = sungMoraCap(sung, token)
    const expected = token.reading
    if (capped && shouldAdoptSungReading(expected, capped)) {
      const confidence = readingAdoptionConfidence(capped, token, owned)
      if (confidence >= HIGH_READING_CONFIDENCE) {
        // Word-level evidence we trust enough to surface as a sung alternate (わけ/理由).
        return {
          ...token,
          audioReading: hiraganaToKatakana(capped),
          readingVerified: false,
          readingMismatch: false,
          readingConfidence: confidence,
        }
      }
      if (confidence > 0) {
        // Owned but uncertain: warn that the audio differs without overriding the ruby.
        return { ...token, readingMismatch: true, readingVerified: false, readingConfidence: confidence }
      }
    } else if (capped && readingsEquivalent(expected, capped)) {
      return { ...token, readingVerified: true, readingMismatch: false, readingConfidence: 1 }
    }

    // No trustworthy evidence: leave the dictionary reading unflagged.
    return { ...token, readingMismatch: false, readingVerified: false }
  })
}

/** Async pass: adopt readings when Whisper sang different kanji (顔 for 丘, etc.). */
export async function reconcileTokenReadingsAsync(
  tokens: Token[],
  line: TimedLine,
  transcriptWords: TimedTranscriptWord[],
): Promise<Token[]> {
  const base = reconcileTokenReadings(tokens, line, transcriptWords)
  const windowWords = wordsInLineWindow(transcriptWords, line)
  if (windowWords.length === 0) return base

  const lineStart = line.startTime
  const lineEnd = Math.max(line.endTime, lineStart + 0.01)
  const lineDur = lineEnd - lineStart
  const weights = base.map(tokenMoraWeight)
  const totalWeight = weights.reduce((a, b) => a + b, 0) || base.length

  let cursor = lineStart
  const out: Token[] = []
  for (let i = 0; i < base.length; i++) {
    const token = base[i]
    const span = (weights[i] / totalWeight) * lineDur
    const tokenStart = cursor
    const tokenEnd = i === base.length - 1 ? lineEnd : cursor + span
    cursor = tokenEnd

    if (
      token.audioReading
      || token.readingVerified
      || !hasKanji(token.surface)
      || !token.reading
      || !token.readingMismatch
    ) {
      out.push(token)
      continue
    }

    const covering = coveringWords(windowWords, tokenStart, tokenEnd)
    const overlap = timingOverlapFraction(covering, tokenStart, tokenEnd)
    if (overlap < KANJI_ADOPT_MIN_OVERLAP) {
      out.push(token)
      continue
    }
    const glyphSlice = sungGlyphsInWindow(windowWords, tokenStart, tokenEnd, lineStart, lineEnd)
    const adopted = await adoptReadingFromTranscriptKanji(token, glyphSlice)
    if (adopted) {
      out.push({
        ...token,
        audioReading: adopted,
        readingMismatch: false,
        readingVerified: false,
        readingConfidence: Math.round((0.4 + 0.5 * overlap) * 100) / 100,
      })
    } else {
      out.push(token)
    }
  }
  return out
}

export function reconcileLineReadings(
  line: TimedLine,
  transcriptWords: TimedTranscriptWord[],
): TimedLine {
  if (!line.tokens?.length) return line
  return {
    ...line,
    tokens: reconcileTokenReadings(line.tokens, line, transcriptWords),
  }
}

export async function reconcileLineReadingsAsync(
  line: TimedLine,
  transcriptWords: TimedTranscriptWord[],
): Promise<TimedLine> {
  if (!line.tokens?.length) return line
  return {
    ...line,
    tokens: await reconcileTokenReadingsAsync(line.tokens, line, transcriptWords),
  }
}

export function reconcileLinesReadings(
  lines: TimedLine[],
  transcriptWords: TimedTranscriptWord[] | undefined,
): TimedLine[] {
  if (!transcriptWords?.length) return lines
  return lines.map((line) => reconcileLineReadings(line, transcriptWords))
}

export async function reconcileLinesReadingsAsync(
  lines: TimedLine[],
  transcriptWords: TimedTranscriptWord[] | undefined,
): Promise<TimedLine[]> {
  if (!transcriptWords?.length) return lines
  return Promise.all(lines.map((line) => reconcileLineReadingsAsync(line, transcriptWords)))
}

import type { TimedLine, TimedTranscriptWord, Token } from '../core/types'
import { katakanaToHiragana } from '../language/japanese/phonetics'
import { tokenizeJapanese } from '../language/japanese/tokenizer'
import { normalizeForMatch } from './contentAligner'

const KANJI_RE = /[㐀-鿿]/

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

function sungKanaInWindow(
  words: TimedTranscriptWord[],
  tokenStart: number,
  tokenEnd: number,
  lineStart: number,
  lineEnd: number,
): string {
  let out = ''
  for (const w of words) {
    if (w.endTime <= tokenStart || w.startTime >= tokenEnd) continue
    out += transcriptSliceForWindow(w, tokenStart, tokenEnd, lineStart, lineEnd, 'kana')
  }
  return out
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

async function adoptReadingFromTranscriptKanji(
  token: Token,
  glyphSlice: string,
): Promise<string | null> {
  if (!hasKanji(token.surface) || !token.reading || !glyphSlice) return null
  const kanji = [...glyphSlice].filter((ch) => KANJI_RE.test(ch)).join('')
  if (!kanji || kanji === token.surface) return null
  const analyzed = await tokenizeJapanese(kanji)
  const match = analyzed.find((t) => t.surface === kanji) ?? analyzed[0]
  if (!match?.reading) return null
  if (!shouldAdoptSungReading(token.reading, match.reading)) return null
  return match.reading
}

export function reconcileTokenReadings(
  tokens: Token[],
  line: TimedLine,
  transcriptWords: TimedTranscriptWord[],
): Token[] {
  if (tokens.length === 0) return tokens
  const windowWords = wordsInLineWindow(transcriptWords, line)
  if (windowWords.length === 0) return tokens

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

    const sung = sungKanaInWindow(windowWords, tokenStart, tokenEnd, lineStart, lineEnd)
    const capped = sungMoraCap(sung, token)
    const expected = token.reading
    if (capped) {
      if (readingsEquivalent(expected, capped)) {
        return { ...token, readingVerified: true, readingMismatch: false }
      }
      if (shouldAdoptSungReading(expected, capped)) {
        return {
          ...token,
          audioReading: hiraganaToKatakana(capped),
          readingVerified: false,
          readingMismatch: false,
        }
      }
    }

    return { ...token, readingMismatch: capped.length > 0, readingVerified: false }
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

    const glyphSlice = sungGlyphsInWindow(windowWords, tokenStart, tokenEnd, lineStart, lineEnd)
    const adopted = await adoptReadingFromTranscriptKanji(token, glyphSlice)
    if (adopted) {
      out.push({
        ...token,
        audioReading: adopted,
        readingMismatch: false,
        readingVerified: false,
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

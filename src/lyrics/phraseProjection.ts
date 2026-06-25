import type { SungPhrase, TimedLine, Token } from '../core/types'
import { splitTranslationWords } from '../language/wordColors'

/** Re-base a phrase token onto a line by shifting its character offsets by `delta`
 * (the line's start offset within the phrase original, signed). */
function shiftToken(token: Token, delta: number): Token {
  if (delta === 0) return token
  return { ...token, startIndex: token.startIndex + delta, endIndex: token.endIndex + delta }
}

/** Which display row + local translation-word index a phrase target word maps to. */
interface TargetRef {
  lineIndex: number
  wordIndex: number
}

/** Index of the first position where `needle` appears as a contiguous run in `haystack`. */
function subsequenceOffset(haystack: string[], needle: string[]): number {
  if (needle.length === 0) return 0
  for (let i = 0; i + needle.length <= haystack.length; i++) {
    if (needle.every((w, j) => haystack[i + j] === w)) return i
  }
  return -1
}

/** Map each phrase translation word to the source row + local word index it came
 * from, so phrase-level `alignmentIndices` can be re-expressed in each display row's
 * own coordinate space. Split phrases slice one row's translation; merged phrases
 * concatenate their rows' translations in order. */
function buildPhraseTargetMap(phrase: SungPhrase, lines: TimedLine[]): (TargetRef | null)[] {
  const phraseWords = splitTranslationWords(phrase.translation)
  const src = phrase.sourceLineIndices

  if (src.length === 1) {
    const li = src[0]
    const rowWords = splitTranslationWords(lines[li]?.translation ?? '')
    const offset = subsequenceOffset(rowWords, phraseWords)
    const base = offset >= 0 ? offset : 0
    return phraseWords.map((_, k) => ({ lineIndex: li, wordIndex: base + k }))
  }

  const refs: TargetRef[] = []
  for (const li of src) {
    const rowWords = splitTranslationWords(lines[li]?.translation ?? '')
    rowWords.forEach((_, j) => refs.push({ lineIndex: li, wordIndex: j }))
  }
  return phraseWords.map((_, k) => refs[k] ?? null)
}

/** Re-express a token's phrase-level `alignmentIndices` in `lineIndex`'s local
 * translation-word space, dropping references that point at another row (those EN
 * words are not displayed on this row under the default sheet layout). */
function remapAlignment(token: Token, targetMap: (TargetRef | null)[], lineIndex: number): Token {
  if (token.alignmentIndices === undefined) return token
  const local = new Set<number>()
  for (const ai of token.alignmentIndices) {
    const ref = targetMap[ai]
    if (ref && ref.lineIndex === lineIndex) local.add(ref.wordIndex)
  }
  return { ...token, alignmentIndices: [...local].sort((a, b) => a - b) }
}

/** Project one phrase's tokens onto a single source line, returning the tokens that
 * belong to that line with offsets re-based into the line's own `original` string.
 *
 * Two containment directions occur:
 *  - merge / passthrough: the line text is a segment of the (joined) phrase original,
 *    so only the tokens inside that segment belong to the line.
 *  - split: the phrase original is a segment of the line text, so every phrase token
 *    belongs to the line, shifted forward by the phrase's offset within the line.
 */
function tokensForLine(phrase: SungPhrase, lineOriginal: string): Token[] {
  const tokens = phrase.tokens ?? []
  if (!tokens.length || !lineOriginal) return []

  // merge / passthrough: line ⊂ phrase
  const lineBase = phrase.original.indexOf(lineOriginal)
  if (lineBase >= 0) {
    const lineEnd = lineBase + lineOriginal.length
    return tokens
      .filter((t) => t.startIndex >= lineBase && t.endIndex <= lineEnd)
      .map((t) => shiftToken(t, -lineBase))
  }

  // split: phrase ⊂ line
  const phraseBase = lineOriginal.indexOf(phrase.original)
  if (phraseBase >= 0) {
    return tokens.map((t) => shiftToken(t, phraseBase))
  }

  return []
}

/** Project enriched phrase tokens (readings, audio readings, word-pair alignment)
 * back onto the display rows by `sourceLineIndices` and character offsets. The
 * pasted sheet text is preserved; only `tokens` are populated/updated. EN-only and
 * blank source rows receive no tokens. */
export function projectPhraseTokensToLines(lines: TimedLine[], phrases: SungPhrase[]): TimedLine[] {
  const byLine = new Map<number, Token[]>()
  for (const phrase of phrases) {
    if (!phrase.tokens?.length) continue
    const targetMap = buildPhraseTargetMap(phrase, lines)
    for (const li of phrase.sourceLineIndices) {
      const target = lines[li]
      if (!target || !target.original.trim()) continue
      const projected = tokensForLine(phrase, target.original).map((t) => remapAlignment(t, targetMap, li))
      if (!projected.length) continue
      const existing = byLine.get(li)
      if (existing) existing.push(...projected)
      else byLine.set(li, [...projected])
    }
  }

  return lines.map((line, i) => {
    const tokens = byLine.get(i)
    if (!tokens) return line
    tokens.sort((a, b) => a.startIndex - b.startIndex)
    return { ...line, tokens }
  })
}

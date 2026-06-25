import type { SungPhrase, TimedLine, Token } from '../core/types'

/** Re-base a phrase token onto a line by shifting its character offsets by `delta`
 * (the line's start offset within the phrase original, signed). */
function shiftToken(token: Token, delta: number): Token {
  if (delta === 0) return token
  return { ...token, startIndex: token.startIndex + delta, endIndex: token.endIndex + delta }
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
    for (const li of phrase.sourceLineIndices) {
      const target = lines[li]
      if (!target || !target.original.trim()) continue
      const projected = tokensForLine(phrase, target.original)
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

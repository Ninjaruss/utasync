/**
 * Translation-side noise detection. The PRIMARY side already has three
 * detectors (isPrimaryHeaderLine, isMetadataPrimaryLine, looksLikeJapaneseTitleLine
 * in lineAligner.ts); the translation side had only stripNonLyricLines, which
 * catches bracketed lines and bare section labels and nothing else. A pasted
 * title line therefore offset every row until the DP's skips absorbed it.
 */

const CREDIT_RE = /^(translat(ed|ion)\s*(by|:)|tl\s*by|lyrics?\s*by|romaji\s*by)/i
const NOTE_RE = /^[([]\s*(tn|t\.n\.|note|translator'?s? note)\b/i

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9぀-鿿]+/g, ' ').replace(/\s+/g, ' ').trim()
}

/** True when `line` is essentially just the metadata value, not a lyric mentioning it. */
function isMetadataEcho(line: string, metadata: string): boolean {
  const a = normalize(line)
  const b = normalize(metadata)
  if (!a || !b) return false
  if (a === b) return true
  // "Title - Artist" style: the line is the metadata plus a separator and little else.
  const stripped = a.replace(b, '').replace(/^[\s\-–—:|by]+|[\s\-–—:|]+$/g, '').trim()
  return a.includes(b) && stripped.length <= Math.max(4, b.length)
}

export function isTranslationNoiseLine(
  text: string,
  opts?: { songTitle?: string; artist?: string },
): boolean {
  const t = text.trim()
  if (!t) return false
  if (CREDIT_RE.test(t)) return true
  if (NOTE_RE.test(t)) return true
  if (opts?.songTitle && isMetadataEcho(t, opts.songTitle)) return true
  if (opts?.artist && isMetadataEcho(t, opts.artist)) return true
  if (opts?.songTitle && opts?.artist && isMetadataEcho(t, `${opts.songTitle} ${opts.artist}`)) return true
  return false
}

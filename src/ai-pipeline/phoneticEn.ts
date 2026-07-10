import type { TranscriptWord } from './aligner'

/** Similarity floor for claiming a phonetic anchor. */
export const PHONETIC_ANCHOR_MIN_SIMILARITY = 0.7

const VOICED_TO_UNVOICED: Record<string, string> = { b: 'p', d: 't', g: 'k', v: 'f', z: 's', j: 'c' }

/** Skeletonize a single already-lowercased, letters-only token. */
function skeletonizeToken(token: string): string {
  let s = token
    .replace(/ph/g, 'f')
    .replace(/wh/g, 'w')
    .replace(/ck/g, 'k')
    .replace(/qu/g, 'kw')
    .replace(/c(?=[eiy])/g, 's')
    .replace(/c/g, 'k')
    .replace(/x/g, 'ks')
    .replace(/q/g, 'k')
  s = s.replace(/[bdgvzj]/g, (ch) => VOICED_TO_UNVOICED[ch])
  // Drop vowels and glides entirely rather than collapsing them to a shared
  // placeholder symbol: a repeated wildcard-like symbol lets the LCS match
  // loosely across unrelated phrases (both skew toward alternating
  // consonant/vowel syllables), which collapses the similarity gap between
  // "related" and "unrelated" pairs. Dropping them keeps the consonant frame,
  // which is what actually survives sung-audio mishearing.
  s = s.replace(/[aeiouwhy]+/g, '')
  s = s.replace(/(.)\1+/g, '$1') // dedupe repeats
  return s
}

/**
 * Collapse an English phrase to a consonant skeleton so mishearings of the
 * same sung phrase land near each other: Whisper hears vowels and voicing
 * unreliably in sung audio, but the consonant frame usually survives
 * ("Strange in the heaven" / "Stranger than heaven").
 *
 * Each word is skeletonized independently, then the results are concatenated,
 * so the digraph rules (ph/wh/ck/qu) can never fire across an original word
 * boundary. Otherwise a phrase would skeletonize differently depending on how
 * its words were tokenized — e.g. a lyric line vs. a joined transcript span
 * where adjacent tokens form a spurious seam ("...di|p"+"h|erald..." -> ph).
 */
export function phoneticSkeletonEn(text: string): string {
  const tokens = text.toLowerCase().match(/[a-z]+/g)
  if (!tokens) return ''
  return tokens.map(skeletonizeToken).join('')
}

function lcsLength(a: string, b: string): number {
  const m = a.length
  const n = b.length
  const dp = new Uint16Array(n + 1)
  for (let i = 1; i <= m; i++) {
    let prevDiag = 0
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j]
      dp[j] = a[i - 1] === b[j - 1] ? prevDiag + 1 : Math.max(dp[j], dp[j - 1])
      prevDiag = tmp
    }
  }
  return dp[n]
}

/** Dice-style similarity of two phrases' phonetic skeletons, in [0, 1]. */
export function phoneticSimilarityEn(a: string, b: string): number {
  const sa = phoneticSkeletonEn(a)
  const sb = phoneticSkeletonEn(b)
  if (!sa || !sb) return 0
  return (2 * lcsLength(sa, sb)) / (sa.length + sb.length)
}

export interface PhoneticAnchor {
  startTime: number
  endTime: number
  similarity: number
}

/** Max silence allowed inside a candidate span — beyond this it crosses a phrase boundary. */
const MAX_INTERNAL_GAP_S = 2

/**
 * Find the transcript span inside [windowStart, windowEnd] that best matches
 * the line phonetically. Returns null unless similarity clears the floor —
 * this must never invent anchors on clean songs.
 */
export function findPhoneticAnchorEn(
  lineText: string,
  words: TranscriptWord[],
  windowStart: number,
  windowEnd: number,
): PhoneticAnchor | null {
  const lineWords = lineText.match(/[A-Za-z']+/g) ?? []
  if (lineWords.length < 3) return null
  // Requires the whole word inside the window; callers are expected to pad the
  // window slightly (Task 7 does) so a boundary word isn't silently dropped.
  const cand = words.filter(
    (w) => w.startTime >= windowStart && w.endTime <= windowEnd && /[a-z]/i.test(w.word),
  )
  if (cand.length === 0) return null
  const minLen = Math.max(2, Math.floor(lineWords.length * 0.6))
  const maxLen = Math.ceil(lineWords.length * 1.8)
  let best: PhoneticAnchor | null = null
  for (let s = 0; s < cand.length; s++) {
    for (let len = minLen; len <= maxLen && s + len <= cand.length; len++) {
      const span = cand.slice(s, s + len)
      let broken = false
      for (let k = 1; k < span.length; k++) {
        if (span[k].startTime - span[k - 1].endTime > MAX_INTERNAL_GAP_S) { broken = true; break }
      }
      if (broken) continue
      const similarity = phoneticSimilarityEn(lineText, span.map((w) => w.word).join(' '))
      if (similarity >= PHONETIC_ANCHOR_MIN_SIMILARITY && (!best || similarity > best.similarity)) {
        best = { startTime: span[0].startTime, endTime: span[span.length - 1].endTime, similarity }
      }
    }
  }
  return best
}

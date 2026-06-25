import type { Token } from './types'

/** Particles that carry lexical meaning and should still pair with English glosses. */
const ALIGNABLE_PARTICLE_SURFACES = new Set([
  'だけ', 'ばかり', 'しか', 'ほど', 'くらい', 'ぐらい',
  'のに', 'ても', 'でも', 'けれど', 'けれども',
  'から', 'まで', 'より',
  'かな', 'だろう', 'でしょう',
])

/** kuromoji tags particles as "助詞" (optionally with sub-category after a comma). */
export function isParticleToken(token: Token): boolean {
  return token.pos?.startsWith('助詞') ?? false
}

export function isDependentVerbStem(token: Token): boolean {
  const pos = token.pos ?? ''
  const detail = token.posDetail1 ?? ''
  return pos.includes('非自立') || detail.includes('非自立')
}

/**
 * Whether a token should participate in JA↔EN word-pair matching.
 * Particles, auxiliaries, dependent verb suffixes, and punctuation are skipped.
 */
export function isAlignableToken(token: Token): boolean {
  if (!token.surface.trim()) return false
  if (ALIGNABLE_PARTICLE_SURFACES.has(token.surface)) return true
  if (isParticleToken(token)) return false
  // Latin tokens in mixed-script lyric lines (e.g. "You" in "You always … 青空")
  if (/^[A-Za-z']+$/.test(token.surface.trim())) return false
  const pos = token.pos ?? ''
  if (pos.startsWith('助動詞')) return false
  if (pos.startsWith('記号')) return false
  if (pos.startsWith('接尾辞')) return false
  if (isDependentVerbStem(token)) return false
  return true
}

/** English function words excluded from JA↔EN alignment targets (still shown in lyrics). */
const ENGLISH_FUNCTION_WORDS = new Set([
  'a', 'an', 'the',
  'in', 'on', 'at', 'to', 'from', 'of', 'for', 'with', 'by', 'as', 'into', 'onto',
  'upon', 'about', 'over', 'under', 'between', 'through', 'during', 'before', 'after',
  'above', 'below', 'up', 'down', 'out', 'off', 'per', 'via', 'than',
  'and', 'or', 'but', 'nor', 'so', 'yet',
  'is', 'am', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did',
  'will', 'would', 'can', 'could', 'shall', 'should', 'may', 'might', 'must',
  'no', 'not',
])

const ENGLISH_CONTRACTION_BASE: Record<string, string> = {
  "i'm": 'i',
  "i'll": 'i',
  "i've": 'i',
  "i'd": 'i',
  "you're": 'you',
  "you'll": 'you',
  "you've": 'you',
  "you'd": 'you',
  "we're": 'we',
  "we'll": 'we',
  "we've": 'we',
  "we'd": 'we',
  "they're": 'they',
  "they'll": 'they',
  "they've": 'they',
  "they'd": 'they',
  "it's": 'it',
  "that's": 'that',
  "what's": 'what',
  "who's": 'who',
  "he's": 'he',
  "she's": 'she',
  "here's": 'here',
  "there's": 'there',
  "can't": 'can',
  "won't": 'will',
  "don't": 'do',
  "doesn't": 'do',
  "didn't": 'do',
  "isn't": 'is',
  "aren't": 'are',
  "wasn't": 'was',
  "weren't": 'were',
  "hasn't": 'has',
  "haven't": 'have',
  "hadn't": 'had',
  "shouldn't": 'should',
  "wouldn't": 'would',
  "couldn't": 'could',
  "mightn't": 'might',
  "mustn't": 'must',
}

function stripEnglishPunctuation(word: string): string {
  return word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
}

/** Lowercases and unwraps contractions (e.g. I'm → i) for embedding and gloss lookup. */
export function normalizeEnglishAlignmentWord(word: string): string {
  const stripped = stripEnglishPunctuation(word.trim())
  const lower = stripped.toLowerCase()
  return ENGLISH_CONTRACTION_BASE[lower] ?? lower
}

/** Whether an English translation word may be paired with a Japanese token. */
/** Function words that still participate in alignment when a curated JA gloss exists. */
const GLOSS_ALIGNED_FUNCTION_WORDS = new Set([
  'after', 'about', 'up', 'not',
  'if', 'when', 'even', 'still', 'from', 'until', 'because', 'since',
  'want', 'keep', 'without',
])

export function isAlignableEnglishWord(word: string): boolean {
  const stripped = stripEnglishPunctuation(word.trim())
  if (!stripped) return false
  const normalized = normalizeEnglishAlignmentWord(stripped)
  if (ENGLISH_FUNCTION_WORDS.has(normalized)) {
    return GLOSS_ALIGNED_FUNCTION_WORDS.has(normalized)
  }
  return true
}

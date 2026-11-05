import { createHash } from 'node:crypto'

// Bump when normalizeLyricLine changes: hashes from different versions are not comparable.
export const LYRIC_HASH_VERSION = '1'

const BRACKETED = /（[^）]*）|\([^)]*\)|［[^］]*］|\[[^\]]*\]|〈[^〉]*〉/g
const PUNCTUATION = /[、。，．！？!?,.…‥「」『』〈〉《》・:;"'“”‘’\-–—~〜]/g

// Fixed, significant order: strip annotations, fold width/compat forms, strip punctuation, collapse spaces.
export function normalizeLyricLine(line) {
  return line
    .replace(BRACKETED, '')
    .normalize('NFKC')
    .replace(PUNCTUATION, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function hashLyricLine(line) {
  return createHash('sha256').update(normalizeLyricLine(line), 'utf8').digest('hex')
}

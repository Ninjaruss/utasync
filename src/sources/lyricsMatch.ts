import type { Language } from '../core/types'
import { detectLanguage } from '../lyrics/bilingual'

/** Normalize artist names for fuzzy comparison (Latin + CJK). */
export function sameArtist(a: string, b: string): boolean {
  const norm = (s: string) =>
    s.normalize('NFKC').toLowerCase().replace(/[^a-z0-9\u3040-\u309f\u30a0-\u30ff\u4e00-\u9fff]/g, '')
  const na = norm(a)
  const nb = norm(b)
  if (!na || !nb) return false
  return na === nb || na.includes(nb) || nb.includes(na)
}

/** Normalize song titles for fuzzy comparison (Latin + CJK). */
export function sameTitle(a: string, b: string): boolean {
  const norm = (s: string) =>
    s
      .normalize('NFKC')
      .toLowerCase()
      .replace(/\([^)]*\)/g, '')
      .replace(/[^a-z0-9\u3040-\u309f\u30a0-\u30ff\u4e00-\u9fff]/g, '')
  const na = norm(a)
  const nb = norm(b)
  if (!na || !nb) return false
  return na === nb || na.includes(nb) || nb.includes(na)
}

/** True when lyric text is in a different script than the primary language. */
export function isAlternateLanguage(text: string, primaryLang: Language | 'other'): boolean {
  const lang = detectLanguage(text)
  if (primaryLang === 'ja') return lang !== 'ja'
  return lang === 'ja'
}

export function durationMatches(
  candidate: number | undefined,
  target: number | undefined,
  toleranceSec = 2,
): boolean {
  if (target == null || candidate == null) return true
  return Math.abs(candidate - target) <= toleranceSec
}

export function rankByDuration<T extends { duration?: number }>(
  items: T[],
  targetSec?: number,
): T[] {
  if (targetSec == null) return items
  return [...items].sort((a, b) => {
    const da = a.duration != null ? Math.abs(a.duration - targetSec) : Infinity
    const db = b.duration != null ? Math.abs(b.duration - targetSec) : Infinity
    return da - db
  })
}

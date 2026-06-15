import nlp from 'compromise'
import type { Token } from '../../core/types'

export function tokenizeEnglish(text: string): Token[] {
  const doc = nlp(text)
  const terms = doc.terms().json() as Array<{
    text: string
    offset: { start: number; length: number }
    tags: Record<string, boolean>
  }>
  return terms.map((t): Token => ({
    surface: t.text,
    pos: Object.keys(t.tags)[0] ?? 'unknown',
    startIndex: t.offset.start,
    endIndex: t.offset.start + t.offset.length,
  }))
}

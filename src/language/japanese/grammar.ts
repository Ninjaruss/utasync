import type { GrammarAnnotation, Token } from '../../core/types'
import {
  findMorphSpans,
  morphSpansToGrammarAnnotations,
  normalizeTokenOffsets,
  tokenIndicesInSpan,
} from './morphSpans'

interface GrammarRule {
  pattern: RegExp
  label: string
  explanation: string
}

/** Line-level patterns not covered by morph span rules (obligation, ability, etc.). */
const LINE_GRAMMAR_RULES: GrammarRule[] = [
  { pattern: /なければならない/g, label: '〜なければならない', explanation: 'Must do / have to (strong obligation)' },
  { pattern: /なくてはいけない/g, label: '〜なくてはいけない', explanation: 'Must do (obligation, slightly softer)' },
  { pattern: /ことができる/g, label: '〜ことができる', explanation: 'Ability to do something (can / be able to)' },
  { pattern: /たことがある/g, label: '〜たことがある', explanation: 'Have experience of doing (experiential perfect)' },
  { pattern: /[てで]から/g, label: '〜てから', explanation: 'After doing (sequential action)' },
  { pattern: /ために/g, label: '〜ために', explanation: 'For the purpose of / because of' },
  { pattern: /ような/g, label: '〜ような', explanation: 'Like / similar to (comparison)' },
  { pattern: /[かき]った/g, label: '〜た (past)', explanation: 'Past tense verb ending' },
  { pattern: /ない(?!で)/g, label: '〜ない', explanation: 'Negative verb form (plain negative)' },
]

export { MORPH_SPAN_RULES, findMorphSpans } from './morphSpans'

/**
 * Detect grammar patterns in lyric text. When `tokens` are supplied, each
 * annotation includes the token indices it spans (for tooltips and merging).
 */
export function detectGrammarPatterns(text: string, tokens?: Token[]): GrammarAnnotation[] {
  const normalized = tokens?.length ? normalizeTokenOffsets(tokens) : undefined
  const annotations: GrammarAnnotation[] = normalized
    ? morphSpansToGrammarAnnotations(text, normalized)
    : findMorphSpans(text).map((span) => ({
        tokenIndices: [],
        pattern: span.label,
        explanation: span.explanation,
      }))

  for (const rule of LINE_GRAMMAR_RULES) {
    rule.pattern.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = rule.pattern.exec(text)) !== null) {
      annotations.push({
        tokenIndices: normalized
          ? tokenIndicesInSpan(normalized, match.index, match.index + match[0].length)
          : [],
        pattern: rule.label,
        explanation: rule.explanation,
      })
    }
  }

  return annotations
}

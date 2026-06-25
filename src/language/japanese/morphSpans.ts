import type { GrammarAnnotation, Token } from '../../core/types'
import { isAlignableToken, isParticleToken } from '../../core/language'

/** Hiragana, katakana, and kanji — used in morph regexes. */
const JP = '[\\u3040-\\u309f\\u30a0-\\u30ff\\u4e00-\\u9faf'

export interface MorphSpan {
  start: number
  end: number
  label: string
  explanation: string
}

/** Shared morphology patterns — drive token merging and grammar tooltips. */
export const MORPH_SPAN_RULES: ReadonlyArray<{
  pattern: RegExp
  label: string
  explanation: string
}> = [
  {
    // Bounded stem (not `+`): an unbounded class here has no word-boundary
    // to stop at in unsegmented Japanese text, so it greedily swallows
    // preceding clauses (e.g. "ふと気付く度に増えて" + "いた" instead of just
    // "収まらなくて"). 6 chars covers real verb/adjective stems with margin.
    pattern: new RegExp(`${JP}]{1,6}なくて`, 'g'),
    label: '〜なくて',
    explanation: 'Not / without (negative te-form)',
  },
  {
    pattern: new RegExp(`${JP}]{1,6}ないで`, 'g'),
    label: '〜ないで',
    explanation: "Without doing / please don't",
  },
  {
    pattern: new RegExp(`${JP}]{1,6}(?:れ|え)ない`, 'g'),
    label: '〜れない',
    explanation: 'Cannot / negative potential',
  },
  {
    pattern: new RegExp(`${JP}]*[いく]?たって`, 'g'),
    label: '〜たって',
    explanation: 'Even if / even though (concessive)',
  },
  {
    pattern: new RegExp(`${JP}]{1,6}(?:て|で)(?:みせ|見せ)る`, 'g'),
    label: '〜てみせる',
    explanation: 'Show / prove (volitional)',
  },
  {
    pattern: new RegExp(`${JP}]{1,6}(?:て|で)(?:い|お)(?:る|た)?たい`, 'g'),
    label: '〜ていたい',
    explanation: 'Want to keep doing',
  },
  {
    pattern: new RegExp(`${JP}]{1,6}(?:て|で)(?:い|お)(?:る|た)`, 'g'),
    label: '〜ている',
    explanation: 'Ongoing action or resultant state',
  },
  {
    pattern: new RegExp(`${JP}]{1,6}(?:ちゃ|じゃ)った`, 'g'),
    label: '〜ちゃった',
    explanation: 'Did (casual contraction)',
  },
  {
    pattern: /[^\s]+寸前/g,
    label: '〜寸前',
    explanation: 'Verge of / about to',
  },
  {
    pattern: /どう(?:し|しょ)?(?:う|た)/g,
    label: 'どう…',
    explanation: 'What / how (question)',
  },
]

/** Assign contiguous char offsets when callers omit them (tests, legacy data). */
export function normalizeTokenOffsets(tokens: Token[]): Token[] {
  let cursor = 0
  return tokens.map((t) => {
    const len = t.surface.length
    const start = t.startIndex === t.endIndex ? cursor : t.startIndex
    const end = t.startIndex === t.endIndex ? cursor + len : t.endIndex
    cursor = Math.max(cursor, end)
    return { ...t, startIndex: start, endIndex: end }
  })
}

export function lineTextFromTokens(tokens: Token[]): string {
  if (tokens.length === 0) return ''
  const normalized = normalizeTokenOffsets(tokens)
  const maxEnd = normalized.reduce((m, t) => Math.max(m, t.endIndex), 0)
  const chars = new Array<string>(maxEnd).fill('')
  for (const t of normalized) {
    for (let i = t.startIndex; i < t.endIndex; i++) {
      chars[i] = t.surface[i - t.startIndex] ?? ''
    }
  }
  return chars.join('')
}

export function findMorphSpans(text: string): MorphSpan[] {
  const spans: MorphSpan[] = []
  for (const rule of MORPH_SPAN_RULES) {
    rule.pattern.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = rule.pattern.exec(text)) !== null) {
      spans.push({
        start: match.index,
        end: match.index + match[0].length,
        label: rule.label,
        explanation: rule.explanation,
      })
    }
  }
  return spans.sort((a, b) => {
    const lenA = a.end - a.start
    const lenB = b.end - b.start
    if (lenB !== lenA) return lenB - lenA
    return a.start - b.start
  })
}

export function tokenIndicesInSpan(tokens: Token[], start: number, end: number): number[] {
  const indices: number[] = []
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t.endIndex > start && t.startIndex < end) indices.push(i)
  }
  return indices
}

function areContiguous(indices: number[]): boolean {
  if (indices.length < 2) return false
  for (let i = 1; i < indices.length; i++) {
    if (indices[i] !== indices[i - 1] + 1) return false
  }
  return true
}

function spanGroupMergeable(tokens: Token[], indices: number[]): boolean {
  if (indices.length < 2) return false
  const first = tokens[indices[0]]
  const last = tokens[indices[indices.length - 1]]
  if (!first || !last) return false
  // Span must cover at least one alignable token or verb morphology part.
  return indices.some((i) => {
    const t = tokens[i]
    if (isAlignableToken(t)) return true
    if (isParticleToken(t)) return false
    const pos = t.pos ?? ''
    return pos.startsWith('動詞') || pos.startsWith('助動詞') || pos.startsWith('接尾辞')
  })
}

/** Patterns that aren't a verb/adjective inflection chain — the suffix trim doesn't apply. */
const VERB_CHAIN_FREE_LABELS = new Set(['〜寸前', 'どう…'])

function isVerbChainElement(token: Token): boolean {
  if (isParticleToken(token)) return false
  const pos = token.pos ?? ''
  return pos.startsWith('動詞') || pos.startsWith('助動詞') || pos.startsWith('接尾辞') || pos.startsWith('形容詞')
}

function isTeParticle(token: Token): boolean {
  return token.surface === 'て' && isParticleToken(token)
}

/**
 * Plain-text morph regexes have no word-boundary to stop at in unsegmented
 * Japanese, so a span can include unrelated leading words (e.g. a counter
 * phrase before an unconnected 〜ている tail). Trim back to just the
 * contiguous verb/adjective inflection chain — the last token (the suffix
 * that defined the span) anchors the walk, extending left through
 * verb/adjective morphology and て/で particles that bridge two such tokens.
 */
function trimToVerbChainSuffix(tokens: Token[], indices: number[]): number[] {
  if (indices.length === 0) return indices
  const kept: number[] = []
  for (let k = indices.length - 1; k >= 0; k--) {
    const token = tokens[indices[k]]
    if (kept.length === 0) {
      kept.unshift(indices[k])
      continue
    }
    if (isVerbChainElement(token)) {
      kept.unshift(indices[k])
      continue
    }
    if (isTeParticle(token)) {
      const prevToken = k - 1 >= 0 ? tokens[indices[k - 1]] : undefined
      if (prevToken && isVerbChainElement(prevToken)) {
        kept.unshift(indices[k])
        continue
      }
    }
    break
  }
  return kept
}

/**
 * Token index groups that should merge into one alignment unit.
 * Longer spans win when patterns overlap.
 */
export function morphMergeGroups(
  tokens: Token[],
  alignTokenIndices?: ReadonlySet<number>,
): number[][] {
  const normalized = normalizeTokenOffsets(tokens)
  const text = lineTextFromTokens(normalized)
  if (!text) return []

  const used = new Set<number>()
  const groups: number[][] = []

  for (const span of findMorphSpans(text)) {
    let indices = tokenIndicesInSpan(normalized, span.start, span.end)
    if (alignTokenIndices) indices = indices.filter((i) => alignTokenIndices.has(i))
    if (!VERB_CHAIN_FREE_LABELS.has(span.label)) indices = trimToVerbChainSuffix(normalized, indices)
    if (!areContiguous(indices) || indices.length < 2) continue
    if (indices.some((i) => used.has(i))) continue
    if (!spanGroupMergeable(normalized, indices)) continue
    groups.push(indices)
    indices.forEach((i) => used.add(i))
  }

  return groups.sort((a, b) => a[0] - b[0])
}

export function morphSpansToGrammarAnnotations(
  text: string,
  tokens: Token[],
): GrammarAnnotation[] {
  const normalized = normalizeTokenOffsets(tokens)
  return findMorphSpans(text).map((span) => ({
    pattern: span.label,
    explanation: span.explanation,
    tokenIndices: tokenIndicesInSpan(normalized, span.start, span.end),
  }))
}

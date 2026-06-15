import type { GrammarAnnotation } from '../../core/types'

const PHRASAL_VERBS = [
  'give up', 'look up', 'look for', 'put off', 'take off', 'turn on', 'turn off',
  'get up', 'go on', 'come back', 'find out', 'make up', 'pick up', 'set up',
  'run out', 'break down', 'carry on', 'hold on', 'move on', 'show up',
]

export function detectEnglishGrammar(text: string): GrammarAnnotation[] {
  const annotations: GrammarAnnotation[] = []
  const lower = text.toLowerCase()

  // Present perfect: has/have + past participle
  if (/\b(have|has|'ve)\s+\w+/.test(lower)) {
    const idx = lower.search(/(have|has|'ve)\s+\w/)
    if (idx >= 0) {
      annotations.push({
        tokenIndices: [],
        pattern: 'Present Perfect',
        explanation: 'Connects past action to the present. Japanese: 〜たことがある / 〜ている',
      })
    }
  }

  // Present perfect continuous: has/have been + -ing
  if (/\b(have|has|'ve)\s+been\s+\w+ing\b/.test(lower)) {
    annotations.push({
      tokenIndices: [],
      pattern: 'Present Perfect Continuous',
      explanation: 'Ongoing action that started in the past. Japanese: 〜し続けている',
    })
  }

  // Contractions
  const contractionMatches = [...lower.matchAll(/\b(i'm|you're|he's|she's|it's|we're|they're|i've|i'll|can't|won't|don't|doesn't|didn't)\b/g)]
  for (const m of contractionMatches) {
    annotations.push({
      tokenIndices: [],
      pattern: 'Contraction',
      explanation: `"${m[0]}" is a contraction`,
    })
  }

  // Phrasal verbs
  for (const pv of PHRASAL_VERBS) {
    if (lower.includes(pv)) {
      annotations.push({
        tokenIndices: [],
        pattern: `Phrasal Verb: "${pv}"`,
        explanation: `"${pv}" is a phrasal verb with a unique meaning`,
      })
    }
  }

  return annotations
}

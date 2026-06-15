import type { GrammarAnnotation } from '../../core/types'

interface GrammarRule {
  pattern: RegExp
  label: string
  explanation: string
}

const RULES: GrammarRule[] = [
  { pattern: /[てで]いる/g, label: '〜ている', explanation: 'Ongoing action or state (progressive/resultant state)' },
  { pattern: /[てで]いた/g, label: '〜ていた', explanation: 'Was doing / had been in a state (past progressive)' },
  { pattern: /なければならない/g, label: '〜なければならない', explanation: 'Must do / have to (strong obligation)' },
  { pattern: /なくてはいけない/g, label: '〜なくてはいけない', explanation: 'Must do (obligation, slightly softer)' },
  { pattern: /ことができる/g, label: '〜ことができる', explanation: 'Ability to do something (can / be able to)' },
  { pattern: /たことがある/g, label: '〜たことがある', explanation: 'Have experience of doing (experiential perfect)' },
  { pattern: /[てで]も/g, label: '〜ても', explanation: 'Even if / even though (concessive)' },
  { pattern: /[てで]から/g, label: '〜てから', explanation: 'After doing (sequential action)' },
  { pattern: /ために/g, label: '〜ために', explanation: 'For the purpose of / because of' },
  { pattern: /ような/g, label: '〜ような', explanation: 'Like / similar to (comparison)' },
  { pattern: /ないで/g, label: '〜ないで', explanation: "Without doing / please don't do" },
  { pattern: /[かき]った/g, label: '〜た (past)', explanation: 'Past tense verb ending' },
  { pattern: /ない(?!で)/g, label: '〜ない', explanation: 'Negative verb form (plain negative)' },
]

export function detectGrammarPatterns(text: string): GrammarAnnotation[] {
  const annotations: GrammarAnnotation[] = []
  for (const rule of RULES) {
    rule.pattern.lastIndex = 0
    while (rule.pattern.exec(text) !== null) {
      annotations.push({
        tokenIndices: [],
        pattern: rule.label,
        explanation: rule.explanation,
      })
    }
  }
  return annotations
}

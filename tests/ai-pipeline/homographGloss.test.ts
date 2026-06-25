import { describe, it, expect } from 'vitest'
import { homographLemmaGloss, homographLemmaKeys } from '../../src/ai-pipeline/homographGloss'

describe('homographLemmaKeys', () => {
  it('prefers 知る readings over JMdict homograph 尻', () => {
    expect(homographLemmaKeys('知り', 'shiri')).toContain('shiru')
  })

  it('resolves 触れ stem to fureru', () => {
    expect(homographLemmaKeys('触れない', 'furenai')).toContain('fureru')
  })

  it('resolves 救え stem to tasukeru', () => {
    expect(homographLemmaKeys('救えない', 'sukuenai')).toContain('tasukeru')
  })
})

describe('homographLemmaGloss', () => {
  const resolve = {
    glossForKey: (key: string) => {
      const table: Record<string, string> = {
        shiru: 'know',
        fureru: 'touch',
        tasukeru: 'save',
        iro: 'colour',
        omou: 'think',
      }
      return table[key]
    },
  }

  it('returns know for 知り via shiru', () => {
    expect(homographLemmaGloss('知り', 'shiri', resolve)).toBe('know')
  })

  it('returns touch for 触れない via fureru stem', () => {
    expect(homographLemmaGloss('触れない', 'furenai', resolve)).toBe('touch')
  })
})

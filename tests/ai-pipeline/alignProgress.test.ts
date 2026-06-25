import { describe, it, expect } from 'vitest'
import { alignSteps, alignStepIndex } from '../../src/ai-pipeline/alignProgress'

describe('alignProgress', () => {
  it('includes separation step only when vocal separation is enabled on full tier', () => {
    expect(alignSteps('full', false)).toHaveLength(4)
    expect(alignSteps('full', true)).toHaveLength(5)
    expect(alignSteps('full', true)[1].label).toMatch(/separating vocals/i)
    expect(alignSteps('lite', true)).toHaveLength(4)
  })

  it('maps stage indices with optional separation', () => {
    expect(alignStepIndex('full', 'loading', false)).toBe(1)
    expect(alignStepIndex('full', 'loading', true)).toBe(2)
    expect(alignStepIndex('full', 'separating', true)).toBe(1)
  })
})

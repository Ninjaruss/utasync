import { describe, it, expect, vi } from 'vitest'

// Mock fetch for cmudict.json
global.fetch = vi.fn().mockResolvedValue({
  json: async () => ({
    'STAR': 'S T AA1 R',
    'I': 'AY1',
    'LOVE': 'L AH1 V',
    'MUSIC': 'M Y UW1 Z IH0 K',
  })
}) as any

import { wordToIPA, sentenceToIPA } from '../../../src/language/english/phonetics'

describe('wordToIPA', () => {
  it('returns IPA for common word', async () => {
    const ipa = await wordToIPA('star')
    expect(ipa).toMatch(/stɑ|stɔ|stɑr/)
  })

  it('returns null for unknown word', async () => {
    const ipa = await wordToIPA('xyzabc')
    expect(ipa).toBeNull()
  })
})

describe('sentenceToIPA', () => {
  it('converts known words', async () => {
    const result = await sentenceToIPA('I love music')
    expect(result).toContain('/')
  })
})

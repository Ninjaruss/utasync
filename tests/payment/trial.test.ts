import { describe, it, expect, beforeEach, vi } from 'vitest'

const mockSettings = { isPro: false, trialSongsClaimed: 0, incrementTrial: vi.fn() }
vi.mock('../../src/payment/SettingsStore', () => ({
  useSettingsStore: { getState: () => mockSettings }
}))

import { canUsePro, claimTrialSlot } from '../../src/payment/trial'

describe('canUsePro', () => {
  beforeEach(() => {
    mockSettings.isPro = false
    mockSettings.trialSongsClaimed = 0
  })

  it('returns true when isPro', () => {
    mockSettings.isPro = true
    expect(canUsePro(false)).toBe(true)
  })

  it('returns true for a trial song', () => {
    expect(canUsePro(true)).toBe(true)
  })

  it('returns false when not pro and not trial song', () => {
    expect(canUsePro(false)).toBe(false)
  })
})

describe('claimTrialSlot', () => {
  it('returns true and increments when slots remain', () => {
    mockSettings.trialSongsClaimed = 0
    const result = claimTrialSlot()
    expect(result).toBe(true)
    expect(mockSettings.incrementTrial).toHaveBeenCalled()
  })

  it('returns false when trial limit reached', () => {
    mockSettings.trialSongsClaimed = 2
    const result = claimTrialSlot()
    expect(result).toBe(false)
  })
})

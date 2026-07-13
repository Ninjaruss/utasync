import { describe, it, expect } from 'vitest'
import { useSettingsStore } from '../../src/payment/SettingsStore'

describe('tapLookupEnabled setting', () => {
  it('defaults to on', () => {
    expect(useSettingsStore.getState().tapLookupEnabled).toBe(true)
  })

  it('can be toggled', () => {
    useSettingsStore.getState().setTapLookupEnabled(false)
    expect(useSettingsStore.getState().tapLookupEnabled).toBe(false)
    useSettingsStore.getState().setTapLookupEnabled(true)
    expect(useSettingsStore.getState().tapLookupEnabled).toBe(true)
  })
})
